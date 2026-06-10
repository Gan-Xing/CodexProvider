import type {
  JsonRecord,
  ProviderErrorCategory,
  ProviderRetryHint,
} from './types.js';
import {
  normalizeString,
  omitUndefined,
} from './utils.js';
import {
  parseRetryAfterMs,
  parseRetryAfterMsFromBody,
} from './retry.js';

export type CodexProviderHostedToolLoopExceededErrorCode =
  | 'hosted_tool_loop_exceeded'
  | 'hosted_tool_streaming_loop_exceeded';

export class CodexProviderHostedToolLoopExceededError extends Error {
  readonly type = 'unsupported_feature';
  readonly category = 'unsupported_feature';
  readonly code: CodexProviderHostedToolLoopExceededErrorCode;
  readonly retry: ReturnType<typeof buildProviderRetryMetadata>;

  constructor(input: {
    maxHostedToolIterations: number;
    streaming?: boolean | null;
  }) {
    const streaming = Boolean(input.streaming);
    super(
      streaming
        ? `Adapter-emulated hosted tool streaming loop exceeded ${input.maxHostedToolIterations} iterations.`
        : `Adapter-emulated hosted tool loop exceeded ${input.maxHostedToolIterations} iterations.`,
    );
    this.name = 'CodexProviderHostedToolLoopExceededError';
    this.code = streaming ? 'hosted_tool_streaming_loop_exceeded' : 'hosted_tool_loop_exceeded';
    this.retry = buildProviderRetryMetadata('unsupported_feature', null);
  }

  toResponseError(): JsonRecord {
    return {
      message: this.message,
      type: this.type,
      code: this.code,
      category: this.category,
      retry: this.retry,
    };
  }
}

export function buildHostedToolLoopExceededError(input: {
  maxHostedToolIterations: number;
  streaming?: boolean | null;
}): JsonRecord {
  return new CodexProviderHostedToolLoopExceededError(input).toResponseError();
}

export function extractUpstreamError(text: string): string | null {
  const trimmed = normalizeString(text);
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return normalizeString(parsed?.error?.message)
      || normalizeString(parsed?.message)
      || trimmed;
  } catch {
    return trimmed;
  }
}

export function normalizeUpstreamError(
  text: string,
  providerName: string,
  status: number,
  headers?: Headers | null,
): JsonRecord {
  const trimmed = normalizeString(text);
  const retryAfterMs = parseRetryAfterMs(headers?.get('retry-after') ?? null) ?? parseRetryAfterMsFromBody(trimmed);
  const metadata = buildUpstreamErrorMetadata(headers);
  const fallbackCode = upstreamErrorCode(status);
  const fallbackCategory = classifyProviderErrorCategory({
    status,
    code: fallbackCode,
    type: 'upstream_error',
    message: trimmed,
  });
  const fallbackRetry = buildProviderRetryMetadata(fallbackCategory, retryAfterMs);
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.error && typeof parsed.error === 'object') {
        const message = normalizeString(parsed.error.message) || `${providerName} upstream returned HTTP ${status}`;
        const type = normalizeString(parsed.error.type) || 'upstream_error';
        const code = parsed.error.code ?? fallbackCode;
        const category = classifyProviderErrorCategory({
          status,
          code,
          type,
          message,
        });
        return omitUndefined({
          message,
          type,
          code,
          category,
          retry: buildProviderRetryMetadata(category, retryAfterMs),
          param: parsed.error.param,
          retry_after_ms: retryAfterMs,
          metadata,
        });
      }
      const message = normalizeString(parsed?.message) || trimmed;
      const type = normalizeString(parsed?.type) || 'upstream_error';
      const code = parsed?.code ?? fallbackCode;
      const category = classifyProviderErrorCategory({
        status,
        code,
        type,
        message,
      });
      return omitUndefined({
        message,
        type,
        code,
        category,
        retry: buildProviderRetryMetadata(category, retryAfterMs),
        retry_after_ms: retryAfterMs,
        metadata,
      });
    } catch {
      return omitUndefined({
        message: trimmed,
        type: 'upstream_error',
        code: fallbackCode,
        category: fallbackCategory,
        retry: fallbackRetry,
        retry_after_ms: retryAfterMs,
        metadata,
      });
    }
  }
  return omitUndefined({
    message: `${providerName} upstream returned HTTP ${status}`,
    type: 'upstream_error',
    code: fallbackCode,
    category: fallbackCategory,
    retry: fallbackRetry,
    retry_after_ms: retryAfterMs,
    metadata,
  });
}

export function buildMalformedUpstreamPayloadError(
  providerName: string,
  detail: string,
): JsonRecord {
  const message = normalizeString(detail)
    ? `${providerName} upstream returned a malformed success payload: ${normalizeString(detail)}`
    : `${providerName} upstream returned a malformed success payload.`;
  return {
    message,
    type: 'upstream_error',
    code: 'malformed_upstream_payload',
    category: 'malformed_upstream',
    retry: buildProviderRetryMetadata('malformed_upstream', null),
  };
}

function buildUpstreamErrorMetadata(headers?: Headers | null): JsonRecord | undefined {
  if (!headers) {
    return undefined;
  }
  const requestId = normalizeString(headers.get('x-request-id') ?? headers.get('request-id'));
  const region = normalizeString(headers.get('x-ms-region') ?? headers.get('openai-processing-ms'));
  const rateLimitHeaders = collectRateLimitHeaders(headers);
  if (!requestId && !region && !rateLimitHeaders) {
    return undefined;
  }
  return omitUndefined({
    request_id: requestId || undefined,
    region: region || undefined,
    rate_limit_headers: rateLimitHeaders ?? undefined,
  });
}

function collectRateLimitHeaders(headers: Headers): JsonRecord | undefined {
  const values: JsonRecord = {};
  for (const [key, value] of headers.entries()) {
    const normalizedKey = key.toLowerCase();
    if (!normalizedKey.startsWith('x-ratelimit-') && !normalizedKey.startsWith('ratelimit-')) {
      continue;
    }
    const normalizedValue = normalizeString(value);
    if (!normalizedValue) {
      continue;
    }
    values[normalizedKey] = normalizedValue;
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

function upstreamErrorCode(status: number): string {
  switch (status) {
    case 401:
      return 'invalid_api_key';
    case 403:
      return 'insufficient_quota';
    case 404:
      return 'model_not_found';
    case 408:
      return 'request_timeout';
    case 429:
      return 'rate_limit_exceeded';
    default:
      if (status >= 500) {
        return 'internal_server_error';
      }
      if (status >= 400) {
        return 'invalid_request_error';
      }
      return 'unknown_error';
  }
}

function classifyProviderErrorCategory({
  status,
  code,
  type,
  message,
}: {
  status: number;
  code: unknown;
  type: unknown;
  message: unknown;
}): ProviderErrorCategory {
  const normalizedCode = normalizeString(code).toLowerCase();
  const normalizedType = normalizeString(type).toLowerCase();
  const normalizedMessage = normalizeString(message).toLowerCase();
  if (
    status === 401
    || normalizedCode.includes('invalid_api_key')
    || normalizedCode.includes('authentication')
    || normalizedType.includes('authentication')
    || normalizedMessage.includes('invalid api key')
    || normalizedMessage.includes('unauthorized')
  ) {
    return 'authentication';
  }
  if (
    status === 429
    || normalizedCode.includes('rate_limit')
    || normalizedType.includes('rate_limit')
    || normalizedMessage.includes('rate limit')
    || normalizedMessage.includes('too many requests')
  ) {
    return 'rate_limit';
  }
  if (
    normalizedCode.includes('unsupported')
    || normalizedType.includes('unsupported')
    || normalizedMessage.includes('not support')
    || normalizedMessage.includes('unsupported')
    || normalizedMessage.includes('does not support')
  ) {
    return 'unsupported_feature';
  }
  if (status === 404 || normalizedCode.includes('not_found') || normalizedMessage.includes('not found')) {
    return 'not_found';
  }
  if (status === 408 || status >= 500) {
    return 'transient_upstream';
  }
  if (status >= 400 && status < 500) {
    return 'invalid_request';
  }
  return 'upstream_failure';
}

function buildProviderRetryMetadata(
  category: ProviderErrorCategory,
  retryAfterMs: number | null,
): { retryable: boolean; hint: ProviderRetryHint; retry_after_ms?: number } {
  switch (category) {
    case 'authentication':
      return omitUndefined({
        retryable: false,
        hint: 'check_api_key_or_access',
      });
    case 'rate_limit':
      return omitUndefined({
        retryable: true,
        hint: 'respect_retry_after',
        retry_after_ms: retryAfterMs ?? undefined,
      });
    case 'transient_upstream':
      return omitUndefined({
        retryable: true,
        hint: 'retry_with_backoff',
        retry_after_ms: retryAfterMs ?? undefined,
      });
    case 'unsupported_feature':
      return {
        retryable: false,
        hint: 'remove_or_downgrade_unsupported_feature',
      };
    case 'not_found':
      return {
        retryable: false,
        hint: 'check_model_or_route',
      };
    case 'invalid_request':
      return {
        retryable: false,
        hint: 'fix_request',
      };
    case 'malformed_upstream':
    case 'upstream_failure':
    default:
      return omitUndefined({
        retryable: true,
        hint: 'retry_or_inspect_upstream',
        retry_after_ms: retryAfterMs ?? undefined,
      });
  }
}
