import {
  normalizeSearchEngineResult,
} from './engine.js';
import {
  CodexProviderMetaSearchError,
  searchEngineErrorFromUnknown,
} from './errors.js';
import {
  assertSafeRetrievalUrlWithDns,
  CodexProviderWebRetrievalError,
  type CodexProviderWebRetrievalSafetyOptions,
  type CodexProviderNetworkResolver,
} from '../retrieval/safety.js';
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
  allowPrivateHosts?: boolean | null;
  resolver?: CodexProviderNetworkResolver | null;
  safety?: CodexProviderWebRetrievalSafetyOptions | null;
  maxResponseBytes?: number | null;
}

export function createCodexProviderSearchProcessor(
  options: CodexProviderSearchProcessorOptions = {},
): CodexProviderSearchProcessor {
  return new DefaultCodexProviderSearchProcessor(options);
}

class DefaultCodexProviderSearchProcessor implements CodexProviderSearchProcessor {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly safety: CodexProviderWebRetrievalSafetyOptions;
  private readonly maxResponseBytes: number;

  constructor(options: CodexProviderSearchProcessorOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.safety = {
      ...(options.safety ?? {}),
      ...(options.resolver ? { resolver: options.resolver } : {}),
      ...(options.allowPrivateHosts !== undefined && options.allowPrivateHosts !== null
        ? { allowPrivateHosts: options.allowPrivateHosts }
        : {}),
    };
    this.maxResponseBytes = clampInteger(options.maxResponseBytes, 1, 20_000_000, DEFAULT_SEARCH_RESPONSE_MAX_BYTES);
  }

  async search(
    engine: CodexProviderSearchEngine,
    request: CodexProviderSearchEngineRequest,
  ): Promise<CodexProviderEngineSearchOutcome> {
    const startedAt = this.now();
    try {
      const parsedResults = typeof engine.search === 'function'
        ? await this.searchCustomEngine(engine, request)
        : await this.searchHttpEngine(engine, request);
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

  private async searchCustomEngine(
    engine: CodexProviderSearchEngine,
    request: CodexProviderSearchEngineRequest,
  ): Promise<unknown> {
    if (typeof engine.search !== 'function') {
      throw new CodexProviderMetaSearchError(
        `Search engine ${engine.name} does not expose a custom search() implementation.`,
        'invalid_engine',
        null,
        false,
      );
    }
    const timeoutMs = normalizeTimeoutMs(engine.timeoutMs);
    const controller = new AbortController();
    const parentSignal = request.signal ?? null;
    const abortFromParent = () => controller.abort();
    let timeout: NodeJS.Timeout | null = null;
    let abortListener: (() => void) | null = null;
    try {
      if (parentSignal?.aborted) {
        controller.abort();
      } else {
        parentSignal?.addEventListener('abort', abortFromParent, { once: true });
      }
      const abortPromise = new Promise<never>((_resolve, reject) => {
        abortListener = () => {
          reject(new CodexProviderMetaSearchError(
            `Search engine ${engine.name} timed out after ${timeoutMs}ms.`,
            'timeout',
            null,
            true,
          ));
        };
        controller.signal.addEventListener('abort', abortListener, { once: true });
      });
      if (controller.signal.aborted) {
        abortListener();
      }
      timeout = setTimeout(() => controller.abort(), timeoutMs);
      return await Promise.race([
        engine.search({
          ...request,
          signal: controller.signal,
        }),
        abortPromise,
      ]);
    } catch (error) {
      if (error instanceof CodexProviderMetaSearchError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CodexProviderMetaSearchError(
          `Search engine ${engine.name} timed out after ${timeoutMs}ms.`,
          'timeout',
          null,
          true,
        );
      }
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (abortListener) {
        controller.signal.removeEventListener('abort', abortListener);
      }
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  }

  private async searchHttpEngine(
    engine: CodexProviderSearchEngine,
    request: CodexProviderSearchEngineRequest,
  ): Promise<unknown> {
    if (typeof engine.buildRequest !== 'function' || typeof engine.parseResponse !== 'function') {
      throw new CodexProviderMetaSearchError(
        `Search engine ${engine.name} requires search() or buildRequest() and parseResponse().`,
        'invalid_engine',
        null,
        false,
      );
    }
    const httpRequest = await engine.buildRequest(request);
    const response = await this.executeHttpRequest(httpRequest, engine.timeoutMs, request.signal);
    return engine.parseResponse(response, request);
  }

  private async executeHttpRequest(
    request: CodexProviderEngineHttpRequest,
    fallbackTimeoutMs: number | null | undefined,
    signal: AbortSignal | null | undefined,
  ): Promise<CodexProviderEngineHttpResponse> {
    const timeoutMs = normalizeTimeoutMs(request.timeoutMs ?? fallbackTimeoutMs);
    const maxResponseBytes = clampInteger(request.maxResponseBytes, 1, 20_000_000, this.maxResponseBytes);
    const maxRedirects = clampInteger(request.maxRedirects, 0, 20, DEFAULT_SEARCH_MAX_REDIRECTS);
    let currentUrl = await assertSafeRetrievalUrlWithDns(request.url, this.safety);
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const response = await this.fetchHttpResponse(currentUrl.toString(), request, timeoutMs, signal);
      if (isHttpRedirectStatus(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new CodexProviderMetaSearchError(
            `Search engine redirect response ${response.status} did not include a Location header.`,
            'http_error',
            response.status,
            false,
          );
        }
        currentUrl = await assertSafeRetrievalUrlWithDns(new URL(location, currentUrl), this.safety);
        continue;
      }
      const text = await readResponseTextWithLimit(response, maxResponseBytes);
      if (!response.ok) {
        throw new CodexProviderMetaSearchError(
          `Search engine returned HTTP ${response.status}: ${text.text.slice(0, 500)}`,
          'http_error',
          response.status,
          response.status >= 500 || response.status === 429,
        );
      }
      return {
        status: response.status,
        ok: response.ok,
        url: response.url || currentUrl.toString(),
        headers: Object.fromEntries(response.headers.entries()),
        text: text.text,
        json: parseJsonOrNull(text.text),
      };
    }
    throw new CodexProviderMetaSearchError(
      `Search engine exceeded ${maxRedirects} redirects.`,
      'max_redirects_exceeded',
      null,
      false,
    );
  }

  private async fetchHttpResponse(
    url: string,
    request: CodexProviderEngineHttpRequest,
    timeoutMs: number,
    parentSignal: AbortSignal | null | undefined,
  ): Promise<Response> {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    if (parentSignal?.aborted) {
      controller.abort();
    } else {
      parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: request.method ?? 'GET',
        headers: request.headers ?? undefined,
        body: request.body ?? undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof CodexProviderMetaSearchError || error instanceof CodexProviderWebRetrievalError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CodexProviderMetaSearchError(
          `Search engine request timed out after ${timeoutMs}ms.`,
          'timeout',
          null,
          true,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  }
}

const DEFAULT_SEARCH_RESPONSE_MAX_BYTES = 2_000_000;
const DEFAULT_SEARCH_MAX_REDIRECTS = 5;

function normalizeTimeoutMs(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 60_000) : 8_000;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function isHttpRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number }> {
  if (!response.body) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text);
    assertMaxResponseBytes(bytes, maxBytes);
    return { text, bytes };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      bytes += value.byteLength;
      assertMaxResponseBytes(bytes, maxBytes);
      chunks.push(value);
    }
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return {
    text: new TextDecoder().decode(body),
    bytes,
  };
}

function assertMaxResponseBytes(bytes: number, maxBytes: number): void {
  if (bytes > maxBytes) {
    throw new CodexProviderMetaSearchError(
      `Search engine response exceeded max bytes (${bytes} > ${maxBytes}).`,
      'max_bytes_exceeded',
      null,
      false,
    );
  }
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
