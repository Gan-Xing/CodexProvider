import {
  buildOpenAICompatibleCapabilityCatalogMetadata,
} from '../../capabilities/capability_presets.js';
import {
  getOpenAICompatibleThinkingPolicy,
  getProviderThinkingSupport,
  resolveOpenAICompatibleProviderCapabilitiesForModel,
  type OpenAICompatibleModelCapabilities,
  type OpenAICompatibleProviderCapabilities,
} from '../../capabilities/thinking_policy.js';
import {
  inspectOpenAICompatiblePayloadCompatibility,
} from '../../converters/responses-adapter/index.js';
import type {
  JsonRecord,
  OpenAICompatibleResponsesAdapterServerOptions,
} from './types.js';
import {
  normalizeNullableBoolean,
  normalizePath,
  normalizePositiveNumber,
  normalizeString,
} from './utils.js';
import {
  buildNormalizedRetryMetadata,
} from './retry.js';

export function normalizeModels(
  models: OpenAICompatibleResponsesAdapterServerOptions['models'],
  defaultModel: string,
  ownedBy: string,
  providerKind: string,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null,
) {
  const now = Math.floor(Date.now() / 1000);
  const entries = (Array.isArray(models) ? models : [])
    .map((model) => {
      const id = normalizeString(model?.id) || normalizeString(model?.model);
      if (!id) {
        return null;
      }
      return {
        ...model,
        id,
        slug: normalizeString(model?.slug) || id,
        object: normalizeString(model?.object) || 'model',
        created: Number.isFinite(Number(model?.created)) ? Number(model.created) : now,
        owned_by: normalizeString(model?.owned_by) || ownedBy,
        displayName: normalizeString(model?.displayName) || normalizeString(model?.display_name) || id,
        display_name: normalizeString(model?.display_name) || normalizeString(model?.displayName) || id,
        capabilityCatalog: model?.capabilityCatalog && typeof model.capabilityCatalog === 'object'
          ? model.capabilityCatalog
          : buildOpenAICompatibleCapabilityCatalogMetadata({
            modelId: id,
            providerKind,
            providerCapabilities,
            modelCapabilities: model?.capabilities && typeof model.capabilities === 'object'
              ? model.capabilities as OpenAICompatibleModelCapabilities
              : null,
          }),
        protocol: buildProtocolMetadataForModel({
          modelId: id,
          modelEntry: model,
          providerKind,
          providerCapabilities,
        }),
      };
    })
    .filter(Boolean);
  if (entries.length > 0) {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (!entry || seen.has(entry.id)) {
        return false;
      }
      seen.add(entry.id);
      return true;
    });
  }
  return [{
    id: defaultModel,
    slug: defaultModel,
    object: 'model',
    created: now,
    owned_by: ownedBy,
    capabilityCatalog: buildOpenAICompatibleCapabilityCatalogMetadata({
      modelId: defaultModel,
      providerKind,
      providerCapabilities,
      modelCapabilities: null,
    }),
    protocol: buildProtocolMetadataForModel({
      modelId: defaultModel,
      modelEntry: null,
      providerKind,
      providerCapabilities,
    }),
  }];
}

function buildProtocolMetadataForModel({
  modelId,
  modelEntry,
  providerKind,
  providerCapabilities,
}: {
  modelId: string;
  modelEntry: Record<string, any> | null | undefined;
  providerKind: string;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
}): JsonRecord {
  const modelCapabilities = modelEntry?.capabilities && typeof modelEntry.capabilities === 'object'
    ? modelEntry.capabilities as OpenAICompatibleModelCapabilities
    : null;
  const effectiveCapabilities = resolveOpenAICompatibleProviderCapabilitiesForModel(
    modelCapabilities
      ? {
        ...(providerCapabilities ?? {}),
        modelCapabilities: {
          ...(providerCapabilities?.modelCapabilities ?? {}),
          [modelId]: modelCapabilities,
        },
      }
      : providerCapabilities,
    modelId,
  );
  const reasoning = getProviderThinkingSupport(providerKind, effectiveCapabilities);
  const thinkingPolicy = getOpenAICompatibleThinkingPolicy(providerKind, effectiveCapabilities);
  const multimodal = effectiveCapabilities?.multimodal ?? null;
  const payloadCompatibility = inspectOpenAICompatiblePayloadCompatibility({
    model: modelId,
    protocol: providerKind,
    providerCapabilities: effectiveCapabilities,
  });

  return {
    tools: {
      supported: effectiveCapabilities?.supportsTools !== false,
      builtinWebSearch: effectiveCapabilities?.supportsBuiltinWebSearchTool !== false,
      parallelToolCalls: typeof modelCapabilities?.parallelToolCalls === 'boolean'
        ? modelCapabilities.parallelToolCalls
        : !payloadBlocksPath(effectiveCapabilities?.payload, 'parallel_tool_calls'),
    },
    multimodal: {
      imageInput: normalizeNullableBoolean(multimodal?.supportsImageInput),
      imageUrlInput: normalizeNullableBoolean(multimodal?.supportsImageUrlInput),
      imageBase64Input: normalizeNullableBoolean(multimodal?.supportsImageBase64Input),
      fileInput: normalizeNullableBoolean(multimodal?.supportsFileInput),
      pdfInput: normalizeNullableBoolean(multimodal?.supportsPdfInput)
        ?? (normalizeNullableBoolean(multimodal?.supportsFileInput) === false ? false : null),
      fileDataInput: normalizeNullableBoolean(multimodal?.supportsFileDataInput),
      fileIdInput: normalizeNullableBoolean(multimodal?.supportsFileIdInput),
      fileUrlInput: normalizeNullableBoolean(multimodal?.supportsFileUrlInput),
      unsupportedInputPartStrategy: normalizeString(multimodal?.unsupportedInputPartStrategy) || null,
    },
    reasoning: {
      supported: reasoning.supportedReasoningEfforts.length > 0,
      supportedReasoningEfforts: reasoning.supportedReasoningEfforts,
      defaultReasoningEffort: reasoning.defaultReasoningEffort,
      transport: {
        mode: thinkingPolicy.mode,
        booleanField: normalizeString(thinkingPolicy.booleanField) || null,
        strippedFields: [...thinkingPolicy.stripFields],
      },
    },
    retry: buildNormalizedRetryMetadata(effectiveCapabilities?.retry),
    structuredOutput: {
      jsonSchema: typeof modelCapabilities?.jsonSchema === 'boolean'
        ? modelCapabilities.jsonSchema
        : !payloadBlocksPath(effectiveCapabilities?.payload, 'response_format'),
    },
    responses: {
      supportsCompact: effectiveCapabilities?.supportsResponsesCompact === true,
    },
    routing: {
      upstreamModel: payloadCompatibility.upstreamModel,
      requiresModelAlias: payloadCompatibility.upstreamModel !== modelId,
    },
    limits: {
      maxOutputTokens: normalizePositiveNumber(modelCapabilities?.maxOutputTokens),
    },
  };
}

export function buildModelsResponseMetadata({
  defaultModel,
  ownedBy,
  providerKind,
  providerName,
  providerCapabilities,
  upstreamChatCompletionsPath,
}: {
  defaultModel: string;
  ownedBy: string;
  providerKind: string;
  providerName: string;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  upstreamChatCompletionsPath: string;
}): JsonRecord {
  return {
    provider: {
      kind: providerKind,
      name: providerName,
      ownedBy,
    },
    defaults: {
      model: defaultModel,
    },
    retry: buildNormalizedRetryMetadata(providerCapabilities?.retry),
    routes: {
      primary: {
        models: '/models',
        responses: '/responses',
        responsesCompact: '/responses/compact',
      },
      compatibility: {
        models: '/v1/models',
        responses: '/v1/responses',
        responsesCompact: '/v1/responses/compact',
      },
      upstream: {
        chatCompletions: upstreamChatCompletionsPath,
        responsesCompact: providerCapabilities?.supportsResponsesCompact === true
          ? normalizePath(providerCapabilities.upstreamResponsesCompactPath) || '/responses/compact'
          : null,
      },
    },
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

export function resolveModelMetadata(
  models: Array<Record<string, any> & { id?: string; slug?: string; model?: string }>,
  modelId: string,
): JsonRecord | null {
  const normalizedModelId = normalizeString(modelId);
  if (!normalizedModelId) {
    return null;
  }
  return models.find((model) => (
    normalizeString(model?.id) === normalizedModelId
    || normalizeString(model?.slug) === normalizedModelId
    || normalizeString(model?.model) === normalizedModelId
  )) ?? null;
}
