import {
  resolveOpenAICompatibleProviderCapabilitiesForModel,
} from '../../../capabilities/thinking_policy.js';
import type {
  ChatToResponsesOptions,
  JsonRecord,
} from '../types.js';
import {
  firstRecord,
  omitUndefined,
} from '../shared/json.js';
import {
  multiplyFinite,
  normalizeNumber,
  normalizePositiveOrZeroNumber,
} from '../shared/numbers.js';
import {
  normalizeString,
} from '../shared/strings.js';

export function mapProviderUsage(payload: JsonRecord | null | undefined): JsonRecord | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  return mapClaudeCacheUsage(payload.usage)
    ?? mapGeminiFamilyUsage(payload.usage)
    ?? mapUsage(payload.usage)
    ?? mapGeminiFamilyUsage(
      payload.usageMetadata
        ?? payload.usage_metadata
        ?? payload.response?.usageMetadata
        ?? payload.response?.usage_metadata,
    );
}

function mapUsage(usage: JsonRecord | null | undefined): JsonRecord | null {
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  const inputTokens = normalizeNumber(usage.prompt_tokens ?? usage.input_tokens) ?? 0;
  const outputTokens = normalizeNumber(usage.completion_tokens ?? usage.output_tokens) ?? 0;
  const inputTokenDetails = normalizeInputTokenDetails(usage);
  const outputTokenDetails = normalizeOutputTokenDetails(usage);
  return omitUndefined({
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: normalizeNumber(usage.total_tokens) ?? inputTokens + outputTokens,
    input_tokens_details: inputTokenDetails ?? undefined,
    output_tokens_details: outputTokenDetails ?? undefined,
  });
}

export function withUsagePricingMetadata(
  usage: JsonRecord | null | undefined,
  modelMetadata: JsonRecord | null | undefined,
): JsonRecord | null {
  if (!usage || typeof usage !== 'object') {
    return usage ?? null;
  }
  const pricing = normalizePricingMetadataForUsage(modelMetadata);
  if (!pricing) {
    return usage;
  }
  const metadata = firstRecord(usage.metadata) ?? {};
  const estimatedCost = buildEstimatedCostMetadata(usage, pricing);
  return omitUndefined({
    ...usage,
    metadata: omitUndefined({
      ...metadata,
      pricing,
      estimated_cost: estimatedCost ?? undefined,
    }),
  });
}

function mapGeminiFamilyUsage(usage: unknown): JsonRecord | null {
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  const record = usage as JsonRecord;
  const promptTokens = normalizeNumber(record.promptTokenCount ?? record.prompt_token_count) ?? 0;
  const outputTokens = normalizeNumber(record.candidatesTokenCount ?? record.candidates_token_count) ?? 0;
  const reasoningTokens = normalizeNumber(record.thoughtsTokenCount ?? record.thoughts_token_count) ?? 0;
  const cachedTokens = normalizeNumber(record.cachedContentTokenCount ?? record.cached_content_token_count) ?? 0;
  const totalTokens = normalizeNumber(record.totalTokenCount ?? record.total_token_count)
    ?? promptTokens + outputTokens + reasoningTokens;
  if (promptTokens === 0 && outputTokens === 0 && reasoningTokens === 0 && totalTokens === 0) {
    return null;
  }
  return {
    input_tokens: Math.max(0, promptTokens - cachedTokens),
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    input_tokens_details: { cached_tokens: cachedTokens },
    output_tokens_details: { reasoning_tokens: reasoningTokens },
  };
}

function mapClaudeCacheUsage(usage: JsonRecord | null | undefined): JsonRecord | null {
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  const cacheCreation5m = normalizeNumber(usage.cache_creation_5m_input_tokens);
  const cacheCreation1h = normalizeNumber(usage.cache_creation_1h_input_tokens);
  if (cacheCreation5m === null && cacheCreation1h === null) {
    return null;
  }
  const inputTokens = normalizeNumber(usage.input_tokens ?? usage.prompt_tokens) ?? 0;
  const outputTokens = normalizeNumber(usage.output_tokens ?? usage.completion_tokens) ?? 0;
  const cacheReadTokens = normalizeNumber(usage.cache_read_input_tokens) ?? 0;
  const cacheCreationTokens = (cacheCreation5m ?? 0) + (cacheCreation1h ?? 0);
  const totalTokens = normalizeNumber(usage.total_tokens)
    ?? inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  return omitUndefined({
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_5m_input_tokens: cacheCreation5m ?? undefined,
    cache_creation_1h_input_tokens: cacheCreation1h ?? undefined,
    cache_ttl: cacheCreation5m !== null && cacheCreation1h !== null
      ? 'mixed'
      : cacheCreation5m !== null
        ? '5m'
        : '1h',
  });
}

function normalizeInputTokenDetails(usage: JsonRecord): JsonRecord | null {
  const explicit = firstRecord(usage.prompt_tokens_details, usage.input_tokens_details);
  const normalized = omitUndefined({
    ...(explicit ?? {}),
    cached_tokens: normalizeNumber(
      explicit?.cached_tokens
      ?? usage.cache_read_input_tokens
      ?? usage.cached_input_tokens,
    ) ?? undefined,
    cache_creation_tokens: normalizeNumber(
      explicit?.cache_creation_tokens
      ?? usage.cache_creation_input_tokens
      ?? usage.cached_creation_input_tokens,
    ) ?? undefined,
    audio_tokens: normalizeNumber(
      explicit?.audio_tokens
      ?? usage.input_audio_tokens
      ?? usage.audio_tokens,
    ) ?? undefined,
  });
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeOutputTokenDetails(usage: JsonRecord): JsonRecord | null {
  const explicit = firstRecord(usage.completion_tokens_details, usage.output_tokens_details);
  const normalized = omitUndefined({
    ...(explicit ?? {}),
    reasoning_tokens: normalizeNumber(
      explicit?.reasoning_tokens
      ?? usage.reasoning_tokens
      ?? usage.thinking_tokens,
    ) ?? undefined,
    audio_tokens: normalizeNumber(
      explicit?.audio_tokens
      ?? usage.output_audio_tokens,
    ) ?? undefined,
    accepted_prediction_tokens: normalizeNumber(
      explicit?.accepted_prediction_tokens
      ?? usage.accepted_prediction_tokens,
    ) ?? undefined,
    rejected_prediction_tokens: normalizeNumber(
      explicit?.rejected_prediction_tokens
      ?? usage.rejected_prediction_tokens,
    ) ?? undefined,
  });
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizePricingMetadataForUsage(modelMetadata: JsonRecord | null | undefined): JsonRecord | null {
  const source = firstRecord(modelMetadata?.pricing, modelMetadata);
  if (!source) {
    return null;
  }
  const pricing = omitUndefined({
    inputCostPerToken: normalizePositiveOrZeroNumber(
      source.inputCostPerToken ?? source.input_cost_per_token,
    ) ?? undefined,
    outputCostPerToken: normalizePositiveOrZeroNumber(
      source.outputCostPerToken ?? source.output_cost_per_token,
    ) ?? undefined,
    inputCostPerAudioToken: normalizePositiveOrZeroNumber(
      source.inputCostPerAudioToken ?? source.input_cost_per_audio_token,
    ) ?? undefined,
    outputCostPerReasoningToken: normalizePositiveOrZeroNumber(
      source.outputCostPerReasoningToken ?? source.output_cost_per_reasoning_token,
    ) ?? undefined,
    inputCostPerImage: normalizePositiveOrZeroNumber(
      source.inputCostPerImage ?? source.input_cost_per_image,
    ) ?? undefined,
    outputCostPerImage: normalizePositiveOrZeroNumber(
      source.outputCostPerImage ?? source.output_cost_per_image,
    ) ?? undefined,
    inputCostPerPixel: normalizePositiveOrZeroNumber(
      source.inputCostPerPixel ?? source.input_cost_per_pixel,
    ) ?? undefined,
    outputCostPerPixel: normalizePositiveOrZeroNumber(
      source.outputCostPerPixel ?? source.output_cost_per_pixel,
    ) ?? undefined,
    searchContextCostPerQuery: normalizePricingObject(
      source.searchContextCostPerQuery ?? source.search_context_cost_per_query,
    ) ?? undefined,
  });
  return Object.keys(pricing).length > 0 ? pricing : null;
}

function buildEstimatedCostMetadata(usage: JsonRecord, pricing: JsonRecord): JsonRecord | null {
  const inputCost = multiplyFinite(
    normalizeNumber(usage.input_tokens),
    normalizeNumber(pricing.inputCostPerToken),
  );
  const outputCost = multiplyFinite(
    normalizeNumber(usage.output_tokens),
    normalizeNumber(pricing.outputCostPerToken),
  );
  const totalCost = [inputCost, outputCost].reduce<number | null>((sum, value) => {
    if (value === null) {
      return sum;
    }
    return (sum ?? 0) + value;
  }, null);
  const estimated = omitUndefined({
    input_cost: inputCost ?? undefined,
    output_cost: outputCost ?? undefined,
    total_cost: totalCost ?? undefined,
  });
  return Object.keys(estimated).length > 0 ? estimated : null;
}

export function estimateUsageIfEnabled(
  request: JsonRecord | null | undefined,
  output: JsonRecord[],
  options: ChatToResponsesOptions,
): JsonRecord | null {
  const model = normalizeString(request?.model);
  const providerCapabilities = resolveOpenAICompatibleProviderCapabilitiesForModel(
    options.providerCapabilities,
    model,
  );
  if (!providerCapabilities?.usage?.estimateWhenMissing) {
    return null;
  }
  const inputTokens = estimateTokens([
    request?.instructions,
    request?.input,
    request?.tools,
  ]);
  const outputTokens = estimateTokens(output);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  };
}

function estimateTokens(value: unknown): number {
  const text = collectTextForUsage(value).join(' ');
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
}

function collectTextForUsage(value: unknown): string[] {
  if (typeof value === 'string') {
    return value ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextForUsage(entry));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const record = value as JsonRecord;
  const texts: string[] = [];
  for (const key of ['text', 'content', 'arguments', 'output', 'summary', 'instructions', 'name', 'description']) {
    texts.push(...collectTextForUsage(record[key]));
  }
  return texts;
}

function normalizePricingObject(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const normalized = omitUndefined(Object.fromEntries(
    Object.entries(value as JsonRecord).map(([key, entry]) => [
      key,
      normalizePositiveOrZeroNumber(entry) ?? undefined,
    ]),
  ));
  return Object.keys(normalized).length > 0 ? normalized : null;
}
