import {
  buildCliproxyModelCapabilitiesForEntry,
  findCliproxyModelCatalogEntry,
} from './cliproxy_model_catalog.js';
import {
  mergeOpenAICompatibleProviderCapabilities,
  type OpenAICompatibleModelCapabilities,
  type OpenAICompatibleProviderCapabilities,
} from './thinking_policy.js';
import {
  buildOpenAICompatibleCapabilityCatalogMetadata,
} from './capability_catalog_metadata.js';
import {
  buildNormalizedModelCatalogMetadata,
  normalizePositiveNumber,
  normalizeString,
} from './capability_catalog_utils.js';
import type {
  ExternalModelCatalogBuildResult,
} from './capability_preset_types.js';

export function buildOpenAICompatibleExternalModelCatalog({
  raw,
  defaultModel,
  displayName,
  capabilities,
}: {
  raw: unknown;
  defaultModel: string;
  displayName: string;
  capabilities: OpenAICompatibleProviderCapabilities | null;
}): ExternalModelCatalogBuildResult {
  const entries = extractExternalModelCatalogEntries(raw);
  if (entries.length === 0) {
    return {
      catalog: [],
      capabilities: mergeOpenAICompatibleProviderCapabilities(capabilities),
    };
  }
  const seen = new Set<string>();
  const modelCapabilities: Record<string, OpenAICompatibleModelCapabilities> = {};
  const catalog: any[] = [];
  for (const rawEntry of entries) {
    const id = normalizeString(rawEntry.id) || normalizeString(rawEntry.model) || normalizeString(rawEntry.slug);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const cliproxyEntry = findCliproxyModelCatalogEntry(id);
    const capabilitiesForModel = rawEntry.capabilities && typeof rawEntry.capabilities === 'object'
      ? rawEntry.capabilities as OpenAICompatibleModelCapabilities
      : cliproxyEntry
        ? buildCliproxyModelCapabilitiesForEntry(cliproxyEntry)
        : buildCapabilitiesFromExternalModelEntry(rawEntry);
    if (capabilitiesForModel) {
      modelCapabilities[id] = capabilitiesForModel;
    }
    const reasoning = capabilitiesForModel?.reasoning && typeof capabilitiesForModel.reasoning === 'object'
      ? capabilitiesForModel.reasoning
      : null;
    catalog.push({
      ...rawEntry,
      id,
      model: normalizeString(rawEntry.model) || id,
      displayName: normalizeString(rawEntry.displayName)
        || normalizeString(rawEntry.display_name)
        || cliproxyEntry?.displayName
        || normalizeString(rawEntry.name)
        || id,
      description: normalizeString(rawEntry.description)
        || cliproxyEntry?.description
        || `${displayName} model through the generic OpenAI-compatible Responses adapter.`,
      isDefault: id === defaultModel,
      supportedReasoningEfforts: Array.isArray(rawEntry.supportedReasoningEfforts)
        ? rawEntry.supportedReasoningEfforts.map((entry: unknown) => normalizeString(entry)).filter(Boolean)
        : reasoning?.supportedReasoningEfforts ?? [],
      defaultReasoningEffort: normalizeString(rawEntry.defaultReasoningEffort)
        || reasoning?.defaultReasoningEffort
        || null,
      capabilities: capabilitiesForModel,
      capabilityCatalog: buildOpenAICompatibleCapabilityCatalogMetadata({
        modelId: id,
        providerKind: 'openai-compatible',
        providerCapabilities: capabilities,
        modelCapabilities: capabilitiesForModel,
      }),
      ...buildNormalizedModelCatalogMetadata(rawEntry),
    });
  }
  return {
    catalog,
    capabilities: mergeOpenAICompatibleProviderCapabilities(
      capabilities,
      { modelCapabilities },
    ),
  };
}

function extractExternalModelCatalogEntries(raw: unknown): any[] {
  if (Array.isArray(raw)) {
    return raw.filter((entry) => entry && typeof entry === 'object');
  }
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const entries: any[] = [];
  for (const [category, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      if (entry && typeof entry === 'object') {
        entries.push({
          ...(entry as Record<string, unknown>),
          category: normalizeString((entry as Record<string, unknown>).category) || category,
        });
      }
    }
  }
  return entries;
}

function buildCapabilitiesFromExternalModelEntry(entry: Record<string, any>): OpenAICompatibleModelCapabilities {
  const id = normalizeString(entry.id).toLowerCase();
  const category = normalizeString(entry.category).toLowerCase();
  const supportedParameters = Array.isArray(entry.supportedParameters)
    ? entry.supportedParameters
    : Array.isArray(entry.supported_parameters)
      ? entry.supported_parameters
      : null;
  const hasSupportedParameters = Array.isArray(supportedParameters);
  const maxOutputTokens = normalizePositiveNumber(entry.maxOutputTokens)
    ?? normalizePositiveNumber(entry.max_completion_tokens)
    ?? normalizePositiveNumber(entry.outputTokenLimit);
  const reasoning = entry.reasoning && typeof entry.reasoning === 'object' ? entry.reasoning : null;
  const reasoningLevels = inferExternalReasoningLevels(entry.thinking ?? reasoning, supportedParameters);
  const defaultReasoningEffort = normalizeString(reasoning?.default_effort)
    || normalizeString(reasoning?.defaultEffort)
    || null;
  return {
    tools: hasSupportedParameters ? supportedParameters.includes('tools') : !isExternalNonChatModel(id),
    vision: inferExternalVisionSupport(id, category, entry),
    fileInput: false,
    pdfInput: false,
    jsonSchema: !hasSupportedParameters || supportedParameters.includes('response_format'),
    reasoning: reasoningLevels.length > 0
      ? {
        supportedReasoningEfforts: reasoningLevels,
        defaultReasoningEffort,
      }
      : false,
    thinking: reasoningLevels.length > 0
      ? {
        supportsReasoningEffortSelection: true,
        supportedReasoningEfforts: reasoningLevels,
        defaultReasoningEffort,
        stripFields: ['thinking'],
        mode: 'reasoning_effort',
      }
      : {
        supportsReasoningEffortSelection: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
        stripFields: ['reasoning_effort', 'thinking'],
        mode: 'boolean',
        booleanField: null,
      },
    webSearch: false,
    parallelToolCalls: !id.startsWith('minimax'),
    maxOutputTokens: maxOutputTokens ?? undefined,
  };
}

function inferExternalReasoningLevels(thinking: unknown, supportedParameters: unknown): string[] {
  const parameters = Array.isArray(supportedParameters)
    ? supportedParameters.map((entry) => normalizeString(entry)).filter(Boolean)
    : [];
  if (!thinking || typeof thinking !== 'object') {
    return parameters.includes('reasoning') ? ['low', 'medium', 'high'] : [];
  }
  const record = thinking as Record<string, unknown>;
  if (Array.isArray(record.supported_efforts)) {
    return [...new Set(record.supported_efforts.map((entry) => normalizeString(entry)).filter(Boolean))];
  }
  if (Array.isArray(record.supportedEfforts)) {
    return [...new Set(record.supportedEfforts.map((entry) => normalizeString(entry)).filter(Boolean))];
  }
  if (Array.isArray(record.levels)) {
    return [...new Set(record.levels.map((entry) => normalizeString(entry)).filter(Boolean))];
  }
  if (
    normalizePositiveNumber(record.min) !== null
    || normalizePositiveNumber(record.max) !== null
    || Boolean(record.dynamic_allowed)
    || Boolean(record.dynamicAllowed)
  ) {
    const levels = ['low', 'medium', 'high'];
    if (record.zero_allowed === true || record.zeroAllowed === true) {
      levels.unshift('none');
    }
    return levels;
  }
  return [];
}

function inferExternalVisionSupport(id: string, category: string, entry: Record<string, any>): boolean {
  if (isExternalNonChatModel(id)) {
    return false;
  }
  if (entry.vision !== undefined) {
    return Boolean(entry.vision);
  }
  return id.includes('vl')
    || id.includes('image')
    || category === 'gemini'
    || category === 'vertex'
    || category === 'gemini-cli'
    || category === 'aistudio'
    || category === 'antigravity';
}

function isExternalNonChatModel(id: string): boolean {
  return id.includes('embedding') || id.startsWith('imagen-');
}
