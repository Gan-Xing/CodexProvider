import type {
  OpenAICompatibleModelCapabilities,
  OpenAICompatibleMultimodalCapabilities,
  OpenAICompatiblePayloadRule,
  OpenAICompatibleProviderCapabilities,
} from './thinking_policy.js';
import {
  mergePayloadCompatibility,
  normalizeBuiltinWebSearchTransport,
  normalizePayloadParams,
  normalizeRetryStatuses,
} from './payload_compatibility.js';
import {
  normalizeCapabilityEffortList,
  normalizeString,
} from './thinking_policy_utils.js';

export function mergeOpenAICompatibleProviderCapabilities(
  ...entries: Array<OpenAICompatibleProviderCapabilities | null | undefined>
): OpenAICompatibleProviderCapabilities | null {
  let merged: OpenAICompatibleProviderCapabilities | null = null;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    if (!merged) {
      merged = {};
    }
    if (entry.supportsBuiltinWebSearchTool !== undefined) {
      merged.supportsBuiltinWebSearchTool = Boolean(entry.supportsBuiltinWebSearchTool);
    }
    if (entry.builtinWebSearchTransport !== undefined) {
      merged.builtinWebSearchTransport = normalizeBuiltinWebSearchTransport(entry.builtinWebSearchTransport);
    }
    if (entry.supportsTools !== undefined) {
      merged.supportsTools = Boolean(entry.supportsTools);
    }
    if (entry.supportsResponsesCompact !== undefined) {
      merged.supportsResponsesCompact = Boolean(entry.supportsResponsesCompact);
    }
    if (entry.upstreamResponsesPath !== undefined) {
      merged.upstreamResponsesPath = normalizeString(entry.upstreamResponsesPath) || null;
    }
    if (entry.upstreamResponsesCompactPath !== undefined) {
      merged.upstreamResponsesCompactPath = normalizeString(entry.upstreamResponsesCompactPath) || null;
    }
    if (entry.thinking && typeof entry.thinking === 'object') {
      const previous = merged.thinking && typeof merged.thinking === 'object'
        ? merged.thinking
        : {};
      merged.thinking = {
        ...previous,
        ...entry.thinking,
        supportedReasoningEfforts: normalizeCapabilityEffortList(entry.thinking.supportedReasoningEfforts)
          ?? normalizeCapabilityEffortList(previous.supportedReasoningEfforts)
          ?? undefined,
        stripFields: Array.isArray(entry.thinking.stripFields)
          ? entry.thinking.stripFields.map((segment) => String(segment ?? '').trim()).filter(Boolean)
          : previous.stripFields,
        booleanFalseEfforts: normalizeCapabilityEffortList(entry.thinking.booleanFalseEfforts)
          ?? normalizeCapabilityEffortList(previous.booleanFalseEfforts)
          ?? undefined,
        booleanTrueParams: normalizePayloadParams(entry.thinking.booleanTrueParams)
          ?? normalizePayloadParams(previous.booleanTrueParams)
          ?? undefined,
        booleanFalseParams: normalizePayloadParams(entry.thinking.booleanFalseParams)
          ?? normalizePayloadParams(previous.booleanFalseParams)
          ?? undefined,
      };
    }
    if (entry.payload && typeof entry.payload === 'object') {
      merged.payload = mergePayloadCompatibility(merged.payload, entry.payload);
    }
    if (entry.multimodal && typeof entry.multimodal === 'object') {
      merged.multimodal = {
        ...(merged.multimodal ?? {}),
        ...entry.multimodal,
      };
    }
    if (entry.usage && typeof entry.usage === 'object') {
      merged.usage = {
        ...(merged.usage ?? {}),
        ...entry.usage,
      };
    }
    if (entry.retry && typeof entry.retry === 'object') {
      merged.retry = {
        ...(merged.retry ?? {}),
        ...entry.retry,
        retryStatuses: normalizeRetryStatuses(entry.retry.retryStatuses)
          ?? normalizeRetryStatuses(merged.retry?.retryStatuses)
          ?? undefined,
      };
    }
    if (entry.modelCapabilities && typeof entry.modelCapabilities === 'object') {
      merged.modelCapabilities = {
        ...(merged.modelCapabilities ?? {}),
        ...entry.modelCapabilities,
      };
    }
  }
  return merged;
}

export function resolveOpenAICompatibleProviderCapabilitiesForModel(
  capabilities: OpenAICompatibleProviderCapabilities | null | undefined,
  model: string | null | undefined,
): OpenAICompatibleProviderCapabilities | null {
  const normalizedModel = normalizeString(model).toLowerCase();
  if (!capabilities || typeof capabilities !== 'object' || !normalizedModel) {
    return capabilities && typeof capabilities === 'object'
      ? mergeOpenAICompatibleProviderCapabilities(capabilities)
      : null;
  }
  const modelCapabilities = resolveModelCapabilityEntry(capabilities.modelCapabilities, normalizedModel);
  if (!modelCapabilities) {
    return mergeOpenAICompatibleProviderCapabilities(capabilities);
  }
  return mergeOpenAICompatibleProviderCapabilities(
    capabilities,
    convertModelCapabilitiesToProviderCapabilities(modelCapabilities),
  );
}

function resolveModelCapabilityEntry(
  catalog: Record<string, OpenAICompatibleModelCapabilities> | null | undefined,
  normalizedModel: string,
): OpenAICompatibleModelCapabilities | null {
  if (!catalog || typeof catalog !== 'object') {
    return null;
  }
  for (const [key, value] of Object.entries(catalog)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    if (normalizeString(key).toLowerCase() === normalizedModel) {
      return value;
    }
  }
  return null;
}

function convertModelCapabilitiesToProviderCapabilities(
  modelCapabilities: OpenAICompatibleModelCapabilities,
): OpenAICompatibleProviderCapabilities {
  const overrides: OpenAICompatibleProviderCapabilities = {};
  if (modelCapabilities.tools !== undefined) {
    overrides.supportsTools = Boolean(modelCapabilities.tools);
  }
  if (modelCapabilities.webSearch !== undefined) {
    overrides.supportsBuiltinWebSearchTool = Boolean(modelCapabilities.webSearch);
  }
  if (
    modelCapabilities.vision !== undefined
    || modelCapabilities.fileInput !== undefined
    || modelCapabilities.pdfInput !== undefined
    || modelCapabilities.multimodal
  ) {
    const multimodalOverrides: OpenAICompatibleMultimodalCapabilities = {
      ...(modelCapabilities.multimodal ?? {}),
    };
    if (modelCapabilities.vision !== undefined) {
      multimodalOverrides.supportsImageInput = Boolean(modelCapabilities.vision);
    }
    if (modelCapabilities.fileInput !== undefined) {
      multimodalOverrides.supportsFileInput = Boolean(modelCapabilities.fileInput);
    }
    if (modelCapabilities.pdfInput !== undefined) {
      multimodalOverrides.supportsPdfInput = Boolean(modelCapabilities.pdfInput);
    }
    overrides.multimodal = multimodalOverrides;
  }
  if (modelCapabilities.reasoning === false) {
    overrides.thinking = {
      supportsReasoningEffortSelection: false,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
      stripFields: ['reasoning_effort', 'thinking'],
      mode: 'boolean',
      booleanField: null,
    };
  } else if (modelCapabilities.reasoning && typeof modelCapabilities.reasoning === 'object') {
    overrides.thinking = {
      supportsReasoningEffortSelection: true,
      supportedReasoningEfforts: modelCapabilities.reasoning.supportedReasoningEfforts,
      defaultReasoningEffort: modelCapabilities.reasoning.defaultReasoningEffort,
    };
  }
  if (modelCapabilities.thinking && typeof modelCapabilities.thinking === 'object') {
    overrides.thinking = {
      ...(overrides.thinking ?? {}),
      ...modelCapabilities.thinking,
    };
  }
  const filters: OpenAICompatiblePayloadRule[] = [];
  if (modelCapabilities.parallelToolCalls === false) {
    filters.push({ paths: ['parallel_tool_calls'] });
  }
  if (modelCapabilities.jsonSchema === false) {
    filters.push({ paths: ['response_format'] });
  }
  if (filters.length > 0 || modelCapabilities.payload) {
    overrides.payload = mergePayloadCompatibility({ filter: filters }, modelCapabilities.payload ?? {});
  }
  if (modelCapabilities.usage && typeof modelCapabilities.usage === 'object') {
    overrides.usage = modelCapabilities.usage;
  }
  if (modelCapabilities.retry && typeof modelCapabilities.retry === 'object') {
    overrides.retry = modelCapabilities.retry;
  }
  return overrides;
}
