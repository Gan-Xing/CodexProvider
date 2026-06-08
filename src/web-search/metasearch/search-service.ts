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
    this.now = options.now ?? (() => new Date());
  }

  async search(request: CodexProviderSearchRequest): Promise<CodexProviderSearchResponse> {
    const normalizedRequest = normalizeSearchRequest(request, this.defaultMode, this.defaultMaxResults);
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

    const outcomes = await this.runMode(normalizedRequest.mode, activeEngines, normalizedRequest);
    for (const outcome of outcomes) {
      this.recordOutcome(outcome);
      container.addOutcome(outcome);
    }

    return {
      query: normalizedRequest.query,
      mode: normalizedRequest.mode,
      results: container.mergedResults(normalizedRequest.maxResults),
      unresponsiveEngines: container.unresponsiveEngines(),
      timings: container.engineTimings(),
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
    request: CodexProviderSearchEngineRequest,
  ): Promise<CodexProviderEngineSearchOutcome[]> {
    switch (mode) {
      case 'any':
        return this.runAnyMode(engines, request);
      case 'fast':
        return this.runParallelMode(engines, request, true);
      case 'exhaustive':
      case 'balanced':
      default:
        return this.runParallelMode(engines, request, false);
    }
  }

  private async runAnyMode(
    engines: CodexProviderSearchEngine[],
    request: CodexProviderSearchEngineRequest,
  ): Promise<CodexProviderEngineSearchOutcome[]> {
    const outcomes: CodexProviderEngineSearchOutcome[] = [];
    for (const engine of engines) {
      const outcome = await this.processor.search(engine, request);
      outcomes.push(outcome);
      if (outcome.ok && outcome.results.length >= request.maxResults) {
        break;
      }
    }
    return outcomes;
  }

  private async runParallelMode(
    engines: CodexProviderSearchEngine[],
    request: CodexProviderSearchEngineRequest,
    fastestOnly: boolean,
  ): Promise<CodexProviderEngineSearchOutcome[]> {
    const outcomes = await Promise.all(engines.map((engine) => this.processor.search(engine, request)));
    if (!fastestOnly) {
      return outcomes;
    }
    const successful = outcomes
      .filter((outcome) => outcome.ok && outcome.results.length > 0)
      .sort((left, right) => left.durationMs - right.durationMs);
    return successful[0] ? [successful[0]] : outcomes;
  }

  private recordOutcome(outcome: CodexProviderEngineSearchOutcome): void {
    if (outcome.ok) {
      this.engineState.recordSuccess(outcome.engine);
    } else {
      this.engineState.recordFailure(outcome.engine, this.now());
    }
  }
}

function normalizeSearchRequest(
  request: CodexProviderSearchRequest,
  defaultMode: CodexProviderSearchMode,
  defaultMaxResults: number,
): CodexProviderSearchEngineRequest & { mode: CodexProviderSearchMode } {
  return {
    query: normalizeString(request.query),
    mode: normalizeCodexProviderSearchMode(request.mode, defaultMode),
    category: normalizeSearchCategory(request.category),
    language: normalizeNullableString(request.language),
    region: normalizeNullableString(request.region),
    page: clampInteger(request.page, 1, 100, 1),
    safeSearch: normalizeSafeSearch(request.safeSearch),
    timeRange: normalizeTimeRange(request.timeRange),
    maxResults: clampInteger(request.maxResults, 1, 50, defaultMaxResults),
    allowedDomains: normalizeDomainList(request.allowedDomains),
    blockedDomains: normalizeDomainList(request.blockedDomains),
    externalWebAccess: request.externalWebAccess !== false,
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
