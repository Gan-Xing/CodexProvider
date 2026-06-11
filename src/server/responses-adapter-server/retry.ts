import type {
  OpenAICompatibleProviderCapabilities,
  OpenAICompatibleRetryCapabilities,
} from '../../capabilities/thinking_policy.js';
import {
  applyThinkingPolicyToOpenAIChatRequest,
} from '../../capabilities/thinking_policy.js';
import type {
  CodexProviderRequestAdjustment,
  JsonRecord,
} from './types.js';
import {
  clampInteger,
  cloneJson,
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

export function buildForcedToolChoiceRetryPlan(
  chatBody: JsonRecord,
  upstream: {
    response: Response;
    errorText: string | null;
  },
  {
    providerKind,
    providerCapabilities,
  }: {
    providerKind: string;
    providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  },
): {
  body: JsonRecord;
  adjustment: CodexProviderRequestAdjustment;
} | null {
  if (!shouldRetryWithoutForcedToolChoice(chatBody, upstream)) {
    return null;
  }

  const thinkingDisabledBody = cloneJson(chatBody);
  applyThinkingPolicyToOpenAIChatRequest(thinkingDisabledBody, {
    providerKind,
    requestedEffort: 'none',
    capabilities: providerCapabilities,
  });
  if (!hasDisabledThinkingSignal(thinkingDisabledBody)) {
    applyInferredDisabledThinkingControl(thinkingDisabledBody);
  }
  if (hasDisabledThinkingSignal(thinkingDisabledBody)) {
    return {
      body: thinkingDisabledBody,
      adjustment: {
        kind: 'thinking_disabled',
        path: 'thinking',
        reason: 'upstream_rejected_forced_tool_choice',
        before: summarizeThinkingControls(chatBody),
        after: summarizeThinkingControls(thinkingDisabledBody),
      },
    };
  }

  const downgradedChatBody = cloneJson(chatBody);
  const before = downgradedChatBody.tool_choice;
  delete downgradedChatBody.tool_choice;
  return {
    body: downgradedChatBody,
    adjustment: {
      kind: 'tool_choice_dropped',
      path: 'tool_choice',
      reason: 'upstream_rejected_forced_tool_choice',
      before,
    },
  };
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

function hasDisabledThinkingSignal(body: JsonRecord): boolean {
  if (body.enable_thinking === false || body.reasoning_split === false) {
    return true;
  }
  if (body.thinking && typeof body.thinking === 'object' && (body.thinking as JsonRecord).type === 'disabled') {
    return true;
  }
  const chatTemplateKwargs = body.chat_template_kwargs;
  return Boolean(
    chatTemplateKwargs
    && typeof chatTemplateKwargs === 'object'
    && (chatTemplateKwargs as JsonRecord).enable_thinking === false,
  );
}

function applyInferredDisabledThinkingControl(body: JsonRecord): void {
  const model = normalizeString(body.model).toLowerCase();
  if (
    model.includes('qwen')
    || model.includes('dashscope')
    || model.includes('bailian')
    || model.includes('siliconflow')
  ) {
    body.enable_thinking = false;
    return;
  }
  if (
    model.includes('kimi')
    || model.includes('moonshot')
    || model.includes('glm')
    || model.includes('zhipu')
    || model.includes('z.ai')
    || model.includes('mimo')
  ) {
    body.thinking = { type: 'disabled' };
    return;
  }
  if (model.includes('minimax')) {
    body.reasoning_split = false;
  }
}

function summarizeThinkingControls(body: JsonRecord): JsonRecord {
  const summary: JsonRecord = {};
  if (body.reasoning_effort !== undefined) {
    summary.reasoning_effort = body.reasoning_effort;
  }
  if (body.enable_thinking !== undefined) {
    summary.enable_thinking = body.enable_thinking;
  }
  if (body.reasoning_split !== undefined) {
    summary.reasoning_split = body.reasoning_split;
  }
  if (body.thinking !== undefined) {
    summary.thinking = body.thinking;
  }
  if (body.chat_template_kwargs !== undefined) {
    summary.chat_template_kwargs = body.chat_template_kwargs;
  }
  return summary;
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
