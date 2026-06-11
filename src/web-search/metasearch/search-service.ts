import {
  normalizeSearchEngineName,
} from './engine.js';
import {
  createCodexProviderSearchEngineState,
} from './engine-state.js';
import {
  normalizeCodexProviderSearchMode,
} from './modes.js';
import {
  createCodexProviderSearchProcessor,
} from './processor.js';
import {
  createCodexProviderSearchEngineRegistry,
} from './registry.js';
import {
  CodexProviderSearchResultContainer,
} from './result-container.js';
import type {
  CodexProviderEngineSearchOutcome,
  CodexProviderMetaSearchService,
  CodexProviderMetaSearchServiceOptions,
  CodexProviderSearchCategory,
  CodexProviderSearchEngine,
  CodexProviderSearchEngineRequest,
  CodexProviderSearchMode,
  CodexProviderSearchRequest,
  CodexProviderSearchResponse,
} from './types.js';

export function createCodexProviderMetaSearchService(
  options: CodexProviderMetaSearchServiceOptions = {},
): CodexProviderMetaSearchService {
  return new DefaultCodexProviderMetaSearchService(options);
}

class DefaultCodexProviderMetaSearchService implements CodexProviderMetaSearchService {
  private readonly registry;
  private readonly processor;
  private readonly engineState;
  private readonly defaultMode: CodexProviderSearchMode;
  private readonly defaultMaxResults: number;
  private readonly defaultMaxEngineConcurrency: number | null;
  private readonly defaultMinFastModeResults: number;
  private readonly defaultOverallTimeoutMs: number;
  private readonly now: () => Date;

  constructor(options: CodexProviderMetaSearchServiceOptions) {
    this.registry = options.registry ?? createCodexProviderSearchEngineRegistry(options.engines ?? []);
    this.processor = options.processor ?? createCodexProviderSearchProcessor();
    this.engineState = options.engineState ?? createCodexProviderSearchEngineState({
      failureThreshold: options.failureThreshold,
      suspensionMs: options.suspensionMs,
    });
    this.defaultMode = normalizeCodexProviderSearchMode(options.mode);
    this.defaultMaxResults = clampInteger(options.maxResults, 1, 50, 10);
    this.defaultMaxEngineConcurrency = normalizeOptionalInteger(options.maxEngineConcurrency, 1, 50);
    this.defaultMinFastModeResults = clampInteger(options.minFastModeResults, 1, 50, 1);
    this.defaultOverallTimeoutMs = clampInteger(options.overallTimeoutMs, 50, 120_000, 30_000);
    this.now = options.now ?? (() => new Date());
  }

  async search(request: CodexProviderSearchRequest): Promise<CodexProviderSearchResponse> {
    const normalizedRequest = normalizeSearchRequest(request, {
      defaultMode: this.defaultMode,
      defaultMaxResults: this.defaultMaxResults,
      defaultMaxEngineConcurrency: this.defaultMaxEngineConcurrency,
      defaultMinFastModeResults: this.defaultMinFastModeResults,
      defaultOverallTimeoutMs: this.defaultOverallTimeoutMs,
    });
    if (!normalizedRequest.query) {
      throw new Error('MetaSearch requires a non-empty query.');
    }
    const selectedEngines = this.selectEngines(normalizedRequest);
    const container = new CodexProviderSearchResultContainer({
      query: normalizedRequest.query,
      allowedDomains: normalizedRequest.allowedDomains,
      blockedDomains: normalizedRequest.blockedDomains,
    });

    const activeEngines: CodexProviderSearchEngine[] = [];
    const now = this.now();
    for (const engine of selectedEngines) {
      const suspendedUntil = this.engineState.suspendedUntil(engine.name);
      if (this.engineState.isSuspended(engine.name, now)) {
        container.addUnresponsive({
          engine: engine.name,
          code: 'engine_suspended',
          message: `Search engine ${engine.name} is temporarily suspended.`,
          suspendedUntil: suspendedUntil?.toISOString() ?? null,
        });
      } else {
        activeEngines.push(engine);
      }
    }

    const controller = new AbortController();
    const startedAtMs = Date.now();
    const timeout = setTimeout(() => controller.abort(), normalizedRequest.overallTimeoutMs);
    let outcomes: CodexProviderEngineSearchOutcome[];
    try {
      outcomes = await this.runMode(normalizedRequest.mode, activeEngines, normalizedRequest, controller, startedAtMs);
    } finally {
      clearTimeout(timeout);
    }
    for (const outcome of outcomes) {
      this.recordOutcome(outcome);
      container.addOutcome(outcome);
    }
    const localIndex = summarizeLocalIndexOutcomes(
      outcomes,
      new Set(selectedEngines
        .filter((engine) => engine.localIndex === true)
        .map((engine) => engine.name)),
    );

    return {
      query: normalizedRequest.query,
      mode: normalizedRequest.mode,
      results: container.mergedResults(normalizedRequest.maxResults),
      unresponsiveEngines: container.unresponsiveEngines(),
      timings: container.engineTimings(),
      ...(localIndex ? { localIndex } : {}),
      searchedAt: now.toISOString(),
    };
  }

  private selectEngines(request: CodexProviderSearchEngineRequest & { mode: CodexProviderSearchMode }): CodexProviderSearchEngine[] {
    const requestedEngines = new Set((request.rawRequest.engines ?? [])
      .map(normalizeSearchEngineName)
      .filter(Boolean));
    return this.registry.list()
      .filter((engine) => requestedEngines.size === 0 || requestedEngines.has(engine.name))
      .filter((engine) => engine.categories.includes(request.category))
      .filter((engine) => request.externalWebAccess || engine.live === false);
  }

  private async runMode(
    mode: CodexProviderSearchMode,
    engines: CodexProviderSearchEngine[],
    request: NormalizedSearchRequest,
    controller: AbortController,
    startedAtMs: number,
  ): Promise<CodexProviderEngineSearchOutcome[]> {
    switch (mode) {
      case 'any':
        return this.runAnyMode(engines, request, controller.signal, startedAtMs);
      case 'fast':
        return this.runConcurrentMode(engines, request, controller, startedAtMs, true);
      case 'exhaustive':
      case 'balanced':
      default:
        return this.runConcurrentMode(engines, request, controller, startedAtMs, false);
    }
  }

  private async runAnyMode(
    engines: CodexProviderSearchEngine[],
    request: NormalizedSearchRequest,
    signal: AbortSignal,
    startedAtMs: number,
  ): Promise<CodexProviderEngineSearchOutcome[]> {
    const outcomes: CodexProviderEngineSearchOutcome[] = [];
    for (const engine of engines) {
      const outcome = await this.runEngineWithOverallTimeout(engine, request, signal, startedAtMs);
      outcomes.push(outcome);
      if (outcome.ok && outcome.results.length >= request.maxResults) {
        break;
      }
      if (signal.aborted) {
        break;
      }
    }
    return outcomes;
  }

  private async runConcurrentMode(
    engines: CodexProviderSearchEngine[],
    request: NormalizedSearchRequest,
    controller: AbortController,
    startedAtMs: number,
    fastMode: boolean,
  ): Promise<CodexProviderEngineSearchOutcome[]> {
    if (engines.length === 0) {
      return [];
    }
    const signal = controller.signal;
    const concurrency = normalizeConcurrency(request.maxEngineConcurrency, engines.length);
    const outcomes: Array<CodexProviderEngineSearchOutcome | null> = Array(engines.length).fill(null);
    let nextIndex = 0;
    let active = 0;
    let completed = 0;
    let settled = false;

    return await new Promise((resolve) => {
      const compactOutcomes = () => outcomes.filter((outcome): outcome is CodexProviderEngineSearchOutcome => outcome !== null);
      const timeoutMissingOutcomes = () => {
        for (const [index, engine] of engines.entries()) {
          if (!outcomes[index]) {
            outcomes[index] = this.timeoutOutcome(engine, startedAtMs);
          }
        }
      };
      const finish = (value: CodexProviderEngineSearchOutcome[]) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const launchMore = () => {
        if (settled) {
          return;
        }
        if (signal.aborted) {
          timeoutMissingOutcomes();
          finish(compactOutcomes());
          return;
        }
        while (active < concurrency && nextIndex < engines.length) {
          const index = nextIndex;
          const engine = engines[index];
          nextIndex += 1;
          active += 1;
          void this.runEngineWithOverallTimeout(engine, request, signal, startedAtMs)
            .then((outcome) => {
              active -= 1;
              completed += 1;
              outcomes[index] = outcome;
              if (settled) {
                return;
              }
              if (fastMode && outcome.ok && outcome.results.length >= request.minFastModeResults) {
                finish([outcome]);
                controller.abort();
                return;
              }
              if (completed >= engines.length) {
                finish(compactOutcomes());
                return;
              }
              launchMore();
            });
        }
        if (active === 0 && nextIndex >= engines.length) {
          finish(compactOutcomes());
        }
      };
      signal.addEventListener('abort', () => {
        if (!settled) {
          timeoutMissingOutcomes();
          finish(compactOutcomes());
        }
      }, { once: true });
      launchMore();
    });
  }

  private async runEngineWithOverallTimeout(
    engine: CodexProviderSearchEngine,
    request: NormalizedSearchRequest,
    signal: AbortSignal,
    startedAtMs: number,
  ): Promise<CodexProviderEngineSearchOutcome> {
    if (signal.aborted) {
      return this.timeoutOutcome(engine, startedAtMs);
    }
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (outcome: CodexProviderEngineSearchOutcome) => {
        if (!settled) {
          settled = true;
          signal.removeEventListener('abort', abortHandler);
          resolve(outcome);
        }
      };
      const abortHandler = () => finish(this.timeoutOutcome(engine, startedAtMs));
      signal.addEventListener('abort', abortHandler, { once: true });
      void this.processor.search(engine, {
        ...request,
        signal,
      }).then(finish, (error) => {
        finish({
          engine: engine.name,
          ok: false,
          durationMs: Math.max(0, Date.now() - startedAtMs),
          results: [],
          error: {
            code: 'engine_error',
            message: error instanceof Error ? error.message : String(error),
            retryable: null,
            status: null,
          },
        });
      });
    });
  }

  private timeoutOutcome(
    engine: CodexProviderSearchEngine,
    startedAtMs: number,
  ): CodexProviderEngineSearchOutcome {
    return {
      engine: engine.name,
      ok: false,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      results: [],
      error: {
        code: 'timeout',
        message: `Search engine ${engine.name} timed out before completion.`,
        retryable: true,
        status: null,
      },
    };
  }

  private recordOutcome(outcome: CodexProviderEngineSearchOutcome): void {
    if (outcome.ok) {
      this.engineState.recordSuccess(outcome.engine);
    } else {
      this.engineState.recordFailure(outcome.engine, this.now());
    }
  }
}

interface NormalizedSearchRequest extends CodexProviderSearchEngineRequest {
  mode: CodexProviderSearchMode;
  maxEngineConcurrency: number | null;
  minFastModeResults: number;
  overallTimeoutMs: number;
}

function normalizeSearchRequest(
  request: CodexProviderSearchRequest,
  defaults: {
    defaultMode: CodexProviderSearchMode;
    defaultMaxResults: number;
    defaultMaxEngineConcurrency: number | null;
    defaultMinFastModeResults: number;
    defaultOverallTimeoutMs: number;
  },
): NormalizedSearchRequest {
  return {
    query: normalizeString(request.query),
    mode: normalizeCodexProviderSearchMode(request.mode, defaults.defaultMode),
    category: normalizeSearchCategory(request.category),
    language: normalizeNullableString(request.language),
    region: normalizeNullableString(request.region),
    page: clampInteger(request.page, 1, 100, 1),
    safeSearch: normalizeSafeSearch(request.safeSearch),
    timeRange: normalizeTimeRange(request.timeRange),
    maxResults: clampInteger(request.maxResults, 1, 50, defaults.defaultMaxResults),
    allowedDomains: normalizeDomainList(request.allowedDomains),
    blockedDomains: normalizeDomainList(request.blockedDomains),
    externalWebAccess: request.externalWebAccess !== false,
    maxEngineConcurrency: normalizeOptionalInteger(request.maxEngineConcurrency, 1, 50)
      ?? defaults.defaultMaxEngineConcurrency,
    minFastModeResults: clampInteger(request.minFastModeResults, 1, 50, defaults.defaultMinFastModeResults),
    overallTimeoutMs: clampInteger(request.overallTimeoutMs, 50, 120_000, defaults.defaultOverallTimeoutMs),
    rawRequest: request,
  };
}

function normalizeSearchCategory(value: unknown): CodexProviderSearchCategory {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'news' || normalized === 'images' || normalized === 'videos' || normalized === 'it' || normalized === 'science') {
    return normalized;
  }
  return 'web';
}

function normalizeSafeSearch(value: unknown): 'off' | 'moderate' | 'strict' | null {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'off' || normalized === 'moderate' || normalized === 'strict') {
    return normalized;
  }
  return null;
}

function normalizeTimeRange(value: unknown): 'day' | 'week' | 'month' | 'year' | null {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'day' || normalized === 'week' || normalized === 'month' || normalized === 'year') {
    return normalized;
  }
  return null;
}

function normalizeDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .map((entry) => normalizeString(entry)
      .replace(/^https?:\/\//iu, '')
      .replace(/\/.*$/u, '')
      .toLowerCase())
    .filter(Boolean))];
}

function summarizeLocalIndexOutcomes(
  outcomes: CodexProviderEngineSearchOutcome[],
  localIndexEngineNames: Set<string>,
): { hitCount: number; missCount: number } | null {
  if (localIndexEngineNames.size === 0) {
    return null;
  }
  let hitCount = 0;
  let missCount = 0;
  for (const outcome of outcomes) {
    if (!localIndexEngineNames.has(outcome.engine) || !outcome.ok) {
      continue;
    }
    if (outcome.results.length > 0) {
      hitCount += outcome.results.length;
    } else {
      missCount += 1;
    }
  }
  return {
    hitCount,
    missCount,
  };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableString(value: unknown): string | null {
  return normalizeString(value) || null;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function normalizeOptionalInteger(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return null;
  }
  return Math.min(max, Math.max(min, number));
}

function normalizeConcurrency(value: number | null, engineCount: number): number {
  if (engineCount <= 0) {
    return 1;
  }
  return Math.min(engineCount, Math.max(1, value ?? engineCount));
}
