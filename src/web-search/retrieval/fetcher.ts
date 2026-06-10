import {
  assertAllowedRetrievalContentType,
  DEFAULT_RETRIEVAL_CONTENT_TYPES,
  isHtmlRetrievalContentType,
} from './content-type.js';
import {
  extractCodexProviderHtmlDocument,
  textFromPlainRetrievalDocument,
} from './html-extractor.js';
import {
  DEFAULT_RETRIEVAL_MAX_REDIRECTS,
  isRetrievalRedirectStatus,
  resolveRetrievalRedirectUrl,
} from './redirects.js';
import {
  assertSafeRetrievalUrl,
  assertSafeRetrievalUrlWithDns,
  CodexProviderWebRetrievalError,
  normalizeRetrievalUrlForCache,
  type CodexProviderWebRetrievalSafetyOptions,
} from './safety.js';
import type {
  CodexProviderWebRetrievalCache,
  CodexProviderWebRetrievalCacheEntry,
} from './cache.js';

export interface CodexProviderWebRetrievalFetchRequest {
  url: string;
  query?: string | null;
  externalWebAccess?: boolean | null;
  maxBytes?: number | null;
  timeoutMs?: number | null;
  maxRedirects?: number | null;
  allowedContentTypes?: string[] | null;
  headers?: Record<string, string> | null;
  safety?: CodexProviderWebRetrievalSafetyOptions | null;
}

export interface CodexProviderWebRetrievalFetcherOptions {
  fetchImpl?: typeof fetch | null;
  cache?: CodexProviderWebRetrievalCache | null;
  externalWebAccess?: boolean | null;
  maxBytes?: number | null;
  timeoutMs?: number | null;
  maxRedirects?: number | null;
  allowedContentTypes?: string[] | null;
  headers?: Record<string, string> | null;
  userAgent?: string | null;
  safety?: CodexProviderWebRetrievalSafetyOptions | null;
  now?: (() => Date) | null;
}

export interface CodexProviderWebRetrievalDocument {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string;
  text: string;
  bytes: number;
  fetchedAt: string;
  fromCache: boolean;
  redirectChain: string[];
}

export interface CodexProviderWebRetrievalFetcher {
  fetch(request: string | CodexProviderWebRetrievalFetchRequest): Promise<CodexProviderWebRetrievalDocument>;
}

const DEFAULT_RETRIEVAL_MAX_BYTES = 1_000_000;
const DEFAULT_RETRIEVAL_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIEVAL_USER_AGENT = 'CodexProviderWebRetrieval/0.1';

export function createCodexProviderWebRetrievalFetcher(
  options: CodexProviderWebRetrievalFetcherOptions = {},
): CodexProviderWebRetrievalFetcher {
  return {
    fetch(request) {
      return fetchCodexProviderWebRetrievalDocument(request, options);
    },
  };
}

export async function fetchCodexProviderWebRetrievalDocument(
  request: string | CodexProviderWebRetrievalFetchRequest,
  options: CodexProviderWebRetrievalFetcherOptions = {},
): Promise<CodexProviderWebRetrievalDocument> {
  const normalizedRequest = normalizeFetchRequest(request, options);
  const initialUrl = assertSafeRetrievalUrl(normalizedRequest.url, normalizedRequest.safety);
  const cache = options.cache ?? null;
  const cached = cache?.get(initialUrl.toString());
  if (cached) {
    return documentFromCacheEntry(cached);
  }
  if (!normalizedRequest.externalWebAccess) {
    throw new CodexProviderWebRetrievalError(
      'Live retrieval is disabled because external_web_access=false and no cached document was found.',
      'external_web_access_disabled',
      null,
      false,
    );
  }

  const fetched = await fetchWithRedirects(initialUrl, normalizedRequest, options.fetchImpl ?? fetch);
  cache?.set(initialUrl.toString(), cacheEntryFromDocument(fetched));
  if (fetched.finalUrl !== initialUrl.toString()) {
    cache?.set(fetched.finalUrl, cacheEntryFromDocument(fetched));
  }
  return fetched;
}

async function fetchWithRedirects(
  initialUrl: URL,
  request: Required<NormalizedFetchRequest>,
  fetchImpl: typeof fetch,
): Promise<CodexProviderWebRetrievalDocument> {
  const redirectChain = [initialUrl.toString()];
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= request.maxRedirects; redirectCount += 1) {
    currentUrl = await assertSafeRetrievalUrlWithDns(currentUrl, request.safety);
    const response = await fetchWithTimeout(fetchImpl, currentUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: request.headers,
    }, request.timeoutMs);
    if (isRetrievalRedirectStatus(response.status)) {
      const nextUrl = resolveRetrievalRedirectUrl(
        currentUrl.toString(),
        response.headers.get('location'),
        request.safety,
      );
      if (!nextUrl) {
        throw new CodexProviderWebRetrievalError(
          `Retrieval redirect response ${response.status} did not include a Location header.`,
          'http_error',
          response.status,
          false,
        );
      }
      redirectChain.push(nextUrl.toString());
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) {
      throw new CodexProviderWebRetrievalError(
        `Retrieval returned HTTP ${response.status}.`,
        'http_error',
        response.status,
        response.status >= 500 || response.status === 429,
      );
    }
    const contentType = assertAllowedRetrievalContentType(
      response.headers.get('content-type'),
      request.allowedContentTypes,
    );
    const body = await readResponseTextWithLimit(response, request.maxBytes);
    const extracted = isHtmlRetrievalContentType(contentType)
      ? extractCodexProviderHtmlDocument(body.text)
      : {
          title: '',
          description: '',
          text: textFromPlainRetrievalDocument(body.text),
          language: null,
        };
    const finalUrl = response.url || currentUrl.toString();
    return {
      url: initialUrl.toString(),
      finalUrl,
      status: response.status,
      contentType,
      title: extracted.title || titleFromUrl(finalUrl),
      text: extracted.text || extracted.description,
      bytes: body.bytes,
      fetchedAt: request.now().toISOString(),
      fromCache: false,
      redirectChain,
    };
  }
  throw new CodexProviderWebRetrievalError(
    `Retrieval exceeded ${request.maxRedirects} redirects.`,
    'max_redirects_exceeded',
    null,
    false,
  );
}

interface NormalizedFetchRequest {
  url: string;
  externalWebAccess: boolean;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  allowedContentTypes: string[];
  headers: Record<string, string>;
  safety: CodexProviderWebRetrievalSafetyOptions;
  now: () => Date;
}

function normalizeFetchRequest(
  request: string | CodexProviderWebRetrievalFetchRequest,
  options: CodexProviderWebRetrievalFetcherOptions,
): Required<NormalizedFetchRequest> {
  const record = typeof request === 'string' ? { url: request } : request;
  const userAgent = String(options.userAgent ?? DEFAULT_RETRIEVAL_USER_AGENT).trim();
  return {
    url: record.url,
    externalWebAccess: record.externalWebAccess ?? options.externalWebAccess ?? true,
    maxBytes: clampInteger(record.maxBytes ?? options.maxBytes, 1, 20_000_000, DEFAULT_RETRIEVAL_MAX_BYTES),
    timeoutMs: clampInteger(record.timeoutMs ?? options.timeoutMs, 10, 60_000, DEFAULT_RETRIEVAL_TIMEOUT_MS),
    maxRedirects: clampInteger(record.maxRedirects ?? options.maxRedirects, 0, 20, DEFAULT_RETRIEVAL_MAX_REDIRECTS),
    allowedContentTypes: record.allowedContentTypes ?? options.allowedContentTypes ?? DEFAULT_RETRIEVAL_CONTENT_TYPES,
    headers: {
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
      ...(options.headers ?? {}),
      ...(record.headers ?? {}),
    },
    safety: {
      ...(options.safety ?? {}),
      ...(record.safety ?? {}),
    },
    now: options.now ?? (() => new Date()),
  };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<Response>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new CodexProviderWebRetrievalError(
          `Retrieval timed out after ${timeoutMs}ms.`,
          'timeout',
          null,
          true,
        ));
      }, timeoutMs);
    });
    return await Promise.race([
      fetchImpl(url, {
        ...init,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
  } catch (error) {
    if (error instanceof CodexProviderWebRetrievalError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CodexProviderWebRetrievalError(
        `Retrieval timed out after ${timeoutMs}ms.`,
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
  }
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number }> {
  if (!response.body) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text);
    assertMaxBytes(bytes, maxBytes);
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
      assertMaxBytes(bytes, maxBytes);
      chunks.push(value);
    }
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return {
    text: new TextDecoder().decode(body),
    bytes,
  };
}

function assertMaxBytes(bytes: number, maxBytes: number): void {
  if (bytes > maxBytes) {
    throw new CodexProviderWebRetrievalError(
      `Retrieval response exceeded max bytes (${bytes} > ${maxBytes}).`,
      'max_bytes_exceeded',
      null,
      false,
    );
  }
}

function documentFromCacheEntry(entry: CodexProviderWebRetrievalCacheEntry): CodexProviderWebRetrievalDocument {
  return {
    ...entry,
    fromCache: true,
    redirectChain: [...entry.redirectChain],
  };
}

function cacheEntryFromDocument(document: CodexProviderWebRetrievalDocument): CodexProviderWebRetrievalCacheEntry {
  return {
    url: normalizeRetrievalUrlForCache(document.url),
    finalUrl: normalizeRetrievalUrlForCache(document.finalUrl),
    status: document.status,
    contentType: document.contentType,
    title: document.title,
    text: document.text,
    bytes: document.bytes,
    fetchedAt: document.fetchedAt,
    redirectChain: [...document.redirectChain],
  };
}

function titleFromUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname;
  } catch {
    return value;
  }
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}
