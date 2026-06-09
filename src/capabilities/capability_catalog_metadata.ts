import {
  getProviderThinkingSupport,
  resolveOpenAICompatibleProviderCapabilitiesForModel,
  type OpenAICompatibleModelCapabilities,
  type OpenAICompatibleProviderCapabilities,
} from './thinking_policy.js';
import type {
  OpenAICompatibleCapabilityCatalogMetadata,
} from './capability_preset_types.js';
import {
  normalizeNullableBoolean,
  normalizePositiveNumber,
  normalizeString,
  unique,
} from './capability_catalog_utils.js';

export function buildOpenAICompatibleCapabilityCatalogMetadata({
  modelId,
  providerKind,
  providerCapabilities,
  modelCapabilities,
}: {
  modelId: string;
  providerKind: string | null | undefined;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  modelCapabilities?: OpenAICompatibleModelCapabilities | null;
}): OpenAICompatibleCapabilityCatalogMetadata {
  const normalizedModelId = normalizeString(modelId);
  const effectiveCapabilities = resolveOpenAICompatibleProviderCapabilitiesForModel(
    modelCapabilities
      ? {
        ...(providerCapabilities ?? {}),
        modelCapabilities: {
          ...(providerCapabilities?.modelCapabilities ?? {}),
          [normalizedModelId]: modelCapabilities,
        },
      }
      : providerCapabilities,
    normalizedModelId,
  );
  const reasoning = getProviderThinkingSupport(providerKind, effectiveCapabilities);
  const multimodal = effectiveCapabilities?.multimodal ?? null;
  const fileSupport = normalizeNullableBoolean(multimodal?.supportsFileInput);
  const pdfSupport = normalizeNullableBoolean(multimodal?.supportsPdfInput) ?? (fileSupport === false ? false : null);
  const quirks = unique([
    ...(payloadBlocksPath(effectiveCapabilities?.payload, 'parallel_tool_calls') ? ['parallel_tool_calls_filtered'] : []),
    ...(payloadBlocksPath(effectiveCapabilities?.payload, 'response_format') ? ['json_schema_filtered'] : []),
    ...(hasPayloadModelOverride(effectiveCapabilities?.payload, normalizedModelId) ? ['upstream_model_alias_required'] : []),
    ...(effectiveCapabilities?.thinking?.mode === 'boolean' && normalizeString(effectiveCapabilities.thinking.booleanField)
      ? ['provider_specific_thinking_toggle']
      : []),
    ...normalizeUnsupportedInputQuirk(multimodal?.unsupportedInputPartStrategy),
  ]);

  return {
    toolCalling: {
      supported: effectiveCapabilities?.supportsTools !== false,
      parallel: typeof modelCapabilities?.parallelToolCalls === 'boolean'
        ? modelCapabilities.parallelToolCalls
        : !payloadBlocksPath(effectiveCapabilities?.payload, 'parallel_tool_calls'),
      builtinWebSearch: effectiveCapabilities?.supportsBuiltinWebSearchTool ?? null,
    },
    inputModalities: {
      image: normalizeNullableBoolean(multimodal?.supportsImageInput),
      file: fileSupport,
      pdf: pdfSupport,
    },
    structuredOutput: {
      jsonSchema: typeof modelCapabilities?.jsonSchema === 'boolean'
        ? modelCapabilities.jsonSchema
        : !payloadBlocksPath(effectiveCapabilities?.payload, 'response_format'),
    },
    reasoning: {
      supported: reasoning.supportedReasoningEfforts.length > 0,
      supportedReasoningEfforts: reasoning.supportedReasoningEfforts,
      defaultReasoningEffort: reasoning.defaultReasoningEffort,
    },
    responses: {
      compact: effectiveCapabilities?.supportsResponsesCompact ?? null,
    },
    limits: {
      maxOutputTokens: normalizePositiveNumber(modelCapabilities?.maxOutputTokens),
    },
    quirks,
  };
}

function payloadBlocksPath(
  payload: OpenAICompatibleProviderCapabilities['payload'] | null | undefined,
  path: string,
): boolean {
  const normalizedPath = normalizeString(path);
  if (!normalizedPath) {
    return false;
  }
  return Boolean(payload?.filter?.some((rule) => (
    Array.isArray(rule?.paths)
    && rule.paths.some((entry) => normalizeString(entry) === normalizedPath)
  )));
}

function hasPayloadModelOverride(
  payload: OpenAICompatibleProviderCapabilities['payload'] | null | undefined,
  modelId: string,
): boolean {
  const normalizedModelId = normalizeString(modelId);
  if (!normalizedModelId) {
    return false;
  }
  return Boolean(payload?.override?.some((rule) => {
    const overrideModel = normalizeString((rule?.params as Record<string, unknown> | undefined)?.model);
    return Boolean(overrideModel) && overrideModel !== normalizedModelId;
  }));
}

function normalizeUnsupportedInputQuirk(
  strategy: 'drop' | 'text-placeholder' | 'error' | undefined,
): string[] {
  switch (strategy) {
    case 'drop':
      return ['drop_unsupported_input_parts'];
    case 'text-placeholder':
      return ['text_placeholder_for_unsupported_input_parts'];
    case 'error':
      return ['error_on_unsupported_input_parts'];
    default:
      return [];
  }
}
