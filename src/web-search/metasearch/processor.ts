import {
  normalizeSearchEngineResult,
} from './engine.js';
import {
  CodexProviderMetaSearchError,
  searchEngineErrorFromUnknown,
} from './errors.js';
import type {
  CodexProviderEngineHttpRequest,
  CodexProviderEngineHttpResponse,
  CodexProviderEngineSearchOutcome,
  CodexProviderSearchEngine,
  CodexProviderSearchEngineRequest,
  CodexProviderSearchProcessor,
} from './types.js';

export interface CodexProviderSearchProcessorOptions {
  fetchImpl?: typeof fetch | null;
  now?: (() => number) | null;
}

export function createCodexProviderSearchProcessor(
  options: CodexProviderSearchProcessorOptions = {},
): CodexProviderSearchProcessor {
  return new DefaultCodexProviderSearchProcessor(options);
}

class DefaultCodexProviderSearchProcessor implements CodexProviderSearchProcessor {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: CodexProviderSearchProcessorOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  async search(
    engine: CodexProviderSearchEngine,
    request: CodexProviderSearchEngineRequest,
  ): Promise<CodexProviderEngineSearchOutcome> {
    const startedAt = this.now();
    try {
      const httpRequest = await engine.buildRequest(request);
      const response = await this.executeHttpRequest(httpRequest, engine.timeoutMs);
      const parsedResults = await engine.parseResponse(response, request);
      const results = (Array.isArray(parsedResults) ? parsedResults : [])
        .map((result, index) => normalizeSearchEngineResult(result, engine.name, index + 1))
        .filter(Boolean);
      return {
        engine: engine.name,
        ok: true,
        durationMs: Math.max(0, this.now() - startedAt),
        results,
        error: null,
      };
    } catch (error) {
      return {
        engine: engine.name,
        ok: false,
        durationMs: Math.max(0, this.now() - startedAt),
        results: [],
        error: searchEngineErrorFromUnknown(error),
      };
    }
  }

  private async executeHttpRequest(
    request: CodexProviderEngineHttpRequest,
    fallbackTimeoutMs: number | null | undefined,
  ): Promise<CodexProviderEngineHttpResponse> {
    const timeoutMs = normalizeTimeoutMs(request.timeoutMs ?? fallbackTimeoutMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(request.url, {
        method: request.method ?? 'GET',
        headers: request.headers ?? undefined,
        body: request.body ?? undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new CodexProviderMetaSearchError(
          `Search engine returned HTTP ${response.status}: ${text.slice(0, 500)}`,
          'http_error',
          response.status,
          response.status >= 500 || response.status === 429,
        );
      }
      return {
        status: response.status,
        ok: response.ok,
        url: response.url || request.url,
        headers: Object.fromEntries(response.headers.entries()),
        text,
        json: parseJsonOrNull(text),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeTimeoutMs(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 60_000) : 8_000;
}

function parseJsonOrNull(text: string): unknown {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
