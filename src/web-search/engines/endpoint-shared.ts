import {
  CodexProviderMetaSearchError,
  type CodexProviderSearchResultType,
  type JsonRecord,
} from '../metasearch/index.js';
import {
  normalizeEngineEndpoint,
  normalizeEngineNumber,
  normalizeEngineString,
} from './shared.js';

export interface CodexProviderEndpointSearchEngineOptions {
  endpoint: string;
  maxResults?: number | null;
  language?: string | null;
  region?: string | null;
  apiKey?: string | null;
  priority?: number | null;
  timeoutMs?: number | null;
  headers?: Record<string, string> | null;
}

export function normalizeEndpointEngineEndpoint(value: unknown, provider: string): string {
  const endpoint = normalizeEngineEndpoint(value, '');
  if (!endpoint) {
    throw new Error(`${provider} endpoint web_search engine requires an endpoint.`);
  }
  return endpoint;
}

export function normalizeEndpointEngineNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampEndpointEngineInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

export function endpointJsonHeaders(
  options: Pick<CodexProviderEndpointSearchEngineOptions, 'apiKey' | 'headers'>,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers ?? {}),
  };
  const apiKey = normalizeEngineString(options.apiKey);
  if (apiKey && !headers.Authorization) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export function appendEndpointPath(endpoint: string, path: string): string {
  const url = new URL(endpoint);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = normalizedPath;
  } else if (!url.pathname.endsWith(normalizedPath)) {
    url.pathname = `${url.pathname.replace(/\/+$/u, '')}${normalizedPath}`;
  }
  return url.toString();
}

export function assertEndpointJsonResponseOk(body: JsonRecord, provider: string): void {
  const hasResults = Array.isArray(body.results);
  const error = normalizeEngineString(body.error);
  if (!error || hasResults) {
    return;
  }
  const reason = normalizeEngineString(body.reason);
  const message = normalizeEngineString(body.message) || reason || error;
  const status = normalizeEndpointStatus(body.code);
  throw new CodexProviderMetaSearchError(
    `${provider} endpoint returned an error: ${message}`,
    'endpoint_error',
    status,
    isRetryableEndpointError(error, status),
  );
}

export function endpointResultType(value: unknown): CodexProviderSearchResultType {
  const normalized = normalizeEngineString(value).toLowerCase();
  if (normalized === 'news') {
    return 'news';
  }
  if (normalized === 'image' || normalized === 'images_inline') {
    return 'image';
  }
  if (normalized === 'video' || normalized === 'videos') {
    return 'video';
  }
  if (
    normalized === 'answer_box'
    || normalized === 'featured_snippet'
    || normalized === 'ai_summary'
    || normalized === 'calculator'
    || normalized === 'weather'
    || normalized === 'dictionary'
  ) {
    return 'answer';
  }
  return 'web';
}

export function endpointString(value: unknown): string {
  return normalizeEngineString(value);
}

export function endpointNumber(value: unknown): number | null {
  return normalizeEngineNumber(value);
}

function normalizeEndpointStatus(value: unknown): number | null {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function isRetryableEndpointError(error: string, status: number | null): boolean {
  if (status === 429 || (status !== null && status >= 500)) {
    return true;
  }
  const normalized = error.toLowerCase();
  return normalized === 'rate_limited'
    || normalized === 'service_unavailable'
    || normalized === 'search_timeout'
    || normalized === 'proxy_timeout'
    || normalized === 'proxy_unavailable'
    || normalized === 'all_engines_failed'
    || normalized === 'circuit_open'
    || normalized === 'request_timeout';
}
