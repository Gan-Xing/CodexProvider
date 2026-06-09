import type {
  OpenAICompatibleRetryCapabilities,
} from '../../capabilities/thinking_policy.js';
import type {
  JsonRecord,
} from './types.js';
import {
  clampInteger,
  normalizeArray,
  normalizeString,
} from './utils.js';

const DEFAULT_RETRY_STATUSES = [403, 408, 429, 500, 502, 503, 504];

export type NormalizedRetryCapabilities = {
  maxAttempts: number;
  retryStatuses: Set<number>;
  baseDelayMs: number;
  maxDelayMs: number;
  retryAfterMaxMs: number;
  retryNetworkErrors: boolean;
};

export function normalizeRetryCapabilities(
  capabilities: OpenAICompatibleRetryCapabilities | null | undefined,
): NormalizedRetryCapabilities {
  if (!capabilities || typeof capabilities !== 'object') {
    return {
      maxAttempts: 1,
      retryStatuses: new Set(DEFAULT_RETRY_STATUSES),
      baseDelayMs: 0,
      maxDelayMs: 0,
      retryAfterMaxMs: 0,
      retryNetworkErrors: false,
    };
  }
  const maxAttempts = clampInteger(capabilities.maxAttempts, 1, 5, 1);
  return {
    maxAttempts,
    retryStatuses: new Set(normalizeRetryStatuses(capabilities.retryStatuses) ?? DEFAULT_RETRY_STATUSES),
    baseDelayMs: clampInteger(capabilities.baseDelayMs, 0, 30_000, 250),
    maxDelayMs: clampInteger(capabilities.maxDelayMs, 0, 60_000, 2_000),
    retryAfterMaxMs: clampInteger(capabilities.retryAfterMaxMs, 0, 300_000, 30_000),
    retryNetworkErrors: Boolean(capabilities.retryNetworkErrors),
  };
}

export function buildNormalizedRetryMetadata(
  capabilities: OpenAICompatibleRetryCapabilities | null | undefined,
): JsonRecord {
  const normalized = normalizeRetryCapabilities(capabilities);
  const enabled = normalized.maxAttempts > 1;
  return {
    enabled,
    maxAttempts: normalized.maxAttempts,
    retryStatuses: enabled ? [...normalized.retryStatuses].sort((left, right) => left - right) : [],
    baseDelayMs: enabled ? normalized.baseDelayMs : 0,
    maxDelayMs: enabled ? normalized.maxDelayMs : 0,
    retryAfterMaxMs: enabled ? normalized.retryAfterMaxMs : 0,
    retryNetworkErrors: enabled ? normalized.retryNetworkErrors : false,
  };
}

function normalizeRetryStatuses(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const statuses = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 100 && entry <= 599);
  return statuses.length > 0 ? [...new Set(statuses)] : null;
}

export function shouldRetryWithoutForcedToolChoice(
  chatBody: JsonRecord,
  upstream: {
    response: Response;
    errorText: string | null;
  },
): boolean {
  if (upstream.response.ok || upstream.response.status < 400 || upstream.response.status >= 500) {
    return false;
  }
  if (!isForcedChatToolChoice(chatBody?.tool_choice) || normalizeArray(chatBody?.tools).length === 0) {
    return false;
  }
  const errorText = normalizeString(upstream.errorText).toLowerCase();
  if (!errorText.includes('tool_choice')) {
    return false;
  }
  return errorText.includes('not support')
    || errorText.includes('does not support')
    || errorText.includes('unsupported')
    || errorText.includes('invalidparameter')
    || errorText.includes('invalid parameter');
}

function isForcedChatToolChoice(value: unknown): boolean {
  if (value && typeof value === 'object') {
    return true;
  }
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized || normalized === 'auto' || normalized === 'none') {
    return false;
  }
  return true;
}

export function resolveRetryDelayMs(
  headers: Headers | null,
  text: string,
  attempt: number,
  retry: NormalizedRetryCapabilities,
): number {
  const retryAfter = parseRetryAfterMs(headers?.get('retry-after') ?? null)
    ?? parseRetryAfterMsFromBody(text);
  if (retryAfter !== null) {
    return retry.retryAfterMaxMs > 0 ? Math.min(retryAfter, retry.retryAfterMaxMs) : retryAfter;
  }
  if (retry.baseDelayMs <= 0 || retry.maxDelayMs <= 0) {
    return 0;
  }
  return Math.min(retry.maxDelayMs, retry.baseDelayMs * (2 ** Math.max(0, attempt - 1)));
}

export function parseRetryAfterMs(value: string | null): number | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const timestamp = Date.parse(normalized);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }
  return null;
}

export function parseRetryAfterMsFromBody(text: string): number | null {
  const trimmed = normalizeString(text);
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parseRetryAfterMs(
      parsed?.retry_after
        ?? parsed?.retryAfter
        ?? parsed?.error?.retry_after
        ?? parsed?.error?.retryAfter
        ?? null,
    );
  } catch {
    return null;
  }
}

export async function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}
