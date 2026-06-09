import {
  buildCliproxyModelCapabilitiesForEntry,
  findCliproxyModelCatalogEntry,
} from './cliproxy_model_catalog.js';
import type {
  OpenAICompatibleProviderCapabilities,
} from './thinking_policy.js';
import {
  buildOpenAICompatibleCapabilityCatalogMetadata,
} from './capability_catalog_metadata.js';
import {
  buildNormalizedModelCatalogMetadata,
  normalizeString,
} from './capability_catalog_utils.js';

export function buildOpenAICompatibleModelCatalog({
  defaultModel,
  modelIds,
  displayName,
  capabilities,
}: {
  defaultModel: string;
  modelIds: string[];
  displayName: string;
  capabilities: OpenAICompatibleProviderCapabilities | null;
}) {
  const uniqueIds = [...new Set([defaultModel, ...modelIds].map((entry) => normalizeString(entry)).filter(Boolean))];
  return uniqueIds.map((id) => {
    const cliproxyEntry = findCliproxyModelCatalogEntry(id);
    const modelCapabilities = capabilities?.modelCapabilities?.[id]
      ?? (cliproxyEntry ? buildCliproxyModelCapabilitiesForEntry(cliproxyEntry) : undefined);
    const reasoning = modelCapabilities?.reasoning && typeof modelCapabilities.reasoning === 'object'
      ? modelCapabilities.reasoning
      : null;
    return {
      id,
      model: id,
      displayName: cliproxyEntry?.displayName ?? id,
      description: cliproxyEntry?.description ?? `${displayName} model through the generic OpenAI-compatible Responses adapter.`,
      isDefault: id === defaultModel,
      supportedReasoningEfforts: reasoning?.supportedReasoningEfforts ?? [],
      defaultReasoningEffort: reasoning?.defaultReasoningEffort ?? null,
      capabilities: modelCapabilities,
      capabilityCatalog: buildOpenAICompatibleCapabilityCatalogMetadata({
        modelId: id,
        providerKind: 'openai-compatible',
        providerCapabilities: capabilities,
        modelCapabilities,
      }),
      ...buildNormalizedModelCatalogMetadata(cliproxyEntry),
    };
  });
}
