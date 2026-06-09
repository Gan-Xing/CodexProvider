import {
  applyInferredCodexPlusThinkingPolicy,
} from './codex_plus_thinking.js';
import {
  applyPayloadParams,
  mergePayloadCompatibility,
  normalizeBuiltinWebSearchTransport,
  normalizePayloadParams,
  normalizeRetryStatuses,
  setNestedPath,
  stripThinkingConfig,
} from './payload_compatibility.js';
import {
  normalizeReasoningEffort,
  normalizeString,
  omitUndefined,
} from './thinking_policy_utils.js';

export {
  stripThinkingConfig,
} from './payload_compatibility.js';

export type JsonRecord = Record<string, any>;

export interface OpenAICompatibleModelInfo {
  supportedReasoningEfforts?: unknown;
  defaultReasoningEffort?: unknown;
}

const DEFAULT_OPENAI_COMPATIBLE_REASONING_EFFORTS = [
  'none',
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export interface OpenAICompatibleThinkingPolicy {
  providerKind: string;
  supportsReasoningEffortSelection: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  stripFields: string[];
  mode: 'reasoning_effort' | 'disabled' | 'boolean';
  disabledThinkingValue?: JsonRecord | null;
  booleanField?: string | null;
  booleanFalseEfforts?: string[];
  booleanTrueParams?: Record<string, unknown>;
  booleanFalseParams?: Record<string, unknown>;
}

export interface OpenAICompatibleThinkingPolicyOverrides {
  supportsReasoningEffortSelection?: boolean;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string | null;
  stripFields?: string[];
  mode?: 'reasoning_effort' | 'disabled' | 'boolean';
  disabledThinkingValue?: JsonRecord | null;
  booleanField?: string | null;
  booleanFalseEfforts?: string[];
  booleanTrueParams?: Record<string, unknown>;
  booleanFalseParams?: Record<string, unknown>;
}

export type OpenAICompatiblePayloadModelRule = string | {
  name?: string | null;
  protocol?: string | null;
};

export interface OpenAICompatiblePayloadRule {
  models?: OpenAICompatiblePayloadModelRule[];
  root?: string | null;
  paths?: string[];
  params?: Record<string, unknown> | string[];
}

export interface OpenAICompatiblePayloadCompatibility {
  default?: OpenAICompatiblePayloadRule[];
  defaultRaw?: OpenAICompatiblePayloadRule[];
  override?: OpenAICompatiblePayloadRule[];
  overrideRaw?: OpenAICompatiblePayloadRule[];
  filter?: OpenAICompatiblePayloadRule[];
}

export interface OpenAICompatibleMultimodalCapabilities {
  supportsImageInput?: boolean;
  supportsImageUrlInput?: boolean;
  supportsImageBase64Input?: boolean;
  supportsFileInput?: boolean;
  supportsPdfInput?: boolean;
  supportsFileDataInput?: boolean;
  supportsFileIdInput?: boolean;
  supportsFileUrlInput?: boolean;
  unsupportedInputPartStrategy?: 'drop' | 'text-placeholder' | 'error';
}

export interface OpenAICompatibleUsageCapabilities {
  estimateWhenMissing?: boolean;
}

export interface OpenAICompatibleRetryCapabilities {
  maxAttempts?: number;
  retryStatuses?: number[];
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryAfterMaxMs?: number;
  retryNetworkErrors?: boolean;
}

export interface OpenAICompatibleModelCapabilities {
  tools?: boolean;
  vision?: boolean;
  fileInput?: boolean;
  pdfInput?: boolean;
  jsonSchema?: boolean;
  reasoning?: boolean | {
    supportedReasoningEfforts?: string[];
    defaultReasoningEffort?: string | null;
  };
  webSearch?: boolean;
  parallelToolCalls?: boolean;
  maxOutputTokens?: number;
  thinking?: OpenAICompatibleThinkingPolicyOverrides | null;
  payload?: OpenAICompatiblePayloadCompatibility | null;
  multimodal?: OpenAICompatibleMultimodalCapabilities | null;
  usage?: OpenAICompatibleUsageCapabilities | null;
  retry?: OpenAICompatibleRetryCapabilities | null;
}

export interface OpenAICompatibleProviderCapabilities {
  supportsBuiltinWebSearchTool?: boolean;
  builtinWebSearchTransport?: 'openai_tool' | 'chat_enable_search';
  supportsTools?: boolean;
  supportsResponsesCompact?: boolean;
  upstreamResponsesPath?: string | null;
  upstreamResponsesCompactPath?: string | null;
  thinking?: OpenAICompatibleThinkingPolicyOverrides | null;
  payload?: OpenAICompatiblePayloadCompatibility | null;
  multimodal?: OpenAICompatibleMultimodalCapabilities | null;
  usage?: OpenAICompatibleUsageCapabilities | null;
  retry?: OpenAICompatibleRetryCapabilities | null;
  modelCapabilities?: Record<string, OpenAICompatibleModelCapabilities> | null;
}

const DEFAULT_OPENAI_COMPATIBLE_THINKING_POLICY: OpenAICompatibleThinkingPolicy = {
  providerKind: 'openai-compatible',
  supportsReasoningEffortSelection: true,
  supportedReasoningEfforts: [...DEFAULT_OPENAI_COMPATIBLE_REASONING_EFFORTS],
  defaultReasoningEffort: null,
  stripFields: ['thinking'],
  mode: 'reasoning_effort',
  disabledThinkingValue: null,
  booleanField: null,
  booleanFalseEfforts: ['none'],
  booleanTrueParams: undefined,
  booleanFalseParams: undefined,
};

export function getOpenAICompatibleThinkingPolicy(
  providerKind: string | null | undefined,
  capabilities: OpenAICompatibleProviderCapabilities | null | undefined = null,
): OpenAICompatibleThinkingPolicy {
  const base = resolveBaseThinkingPolicy(providerKind);
  const overrides = capabilities?.thinking;
  if (!overrides || typeof overrides !== 'object') {
    return cloneThinkingPolicy(base);
  }
  return {
    providerKind: base.providerKind,
    supportsReasoningEffortSelection: overrides.supportsReasoningEffortSelection ?? base.supportsReasoningEffortSelection,
    supportedReasoningEfforts: normalizeCapabilityEffortList(overrides.supportedReasoningEfforts) ?? [...base.supportedReasoningEfforts],
    defaultReasoningEffort: overrides.defaultReasoningEffort === undefined
      ? base.defaultReasoningEffort
      : normalizeReasoningEffort(overrides.defaultReasoningEffort),
    stripFields: Array.isArray(overrides.stripFields)
      ? overrides.stripFields.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : [...base.stripFields],
    mode: overrides.mode ?? base.mode,
    disabledThinkingValue: overrides.disabledThinkingValue === undefined
      ? base.disabledThinkingValue
      : overrides.disabledThinkingValue,
    booleanField: overrides.booleanField === undefined
      ? base.booleanField ?? null
      : normalizeString(overrides.booleanField),
    booleanFalseEfforts: normalizeCapabilityEffortList(overrides.booleanFalseEfforts)
      ?? [...(base.booleanFalseEfforts ?? ['none'])],
    booleanTrueParams: normalizePayloadParams(overrides.booleanTrueParams)
      ?? normalizePayloadParams(base.booleanTrueParams)
      ?? undefined,
    booleanFalseParams: normalizePayloadParams(overrides.booleanFalseParams)
      ?? normalizePayloadParams(base.booleanFalseParams)
      ?? undefined,
  };
}

export function getProviderThinkingSupport(
  providerKind: string | null | undefined,
  capabilities: OpenAICompatibleProviderCapabilities | null | undefined = null,
): {
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
} {
  const policy = getOpenAICompatibleThinkingPolicy(providerKind, capabilities);
  if (!policy.supportsReasoningEffortSelection) {
    return {
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
    };
  }
  return {
    supportedReasoningEfforts: [...policy.supportedReasoningEfforts],
    defaultReasoningEffort: policy.defaultReasoningEffort,
  };
}

export function resolveReasoningEffortForProvider({
  providerKind,
  modelInfo,
  requestedEffort,
  capabilities = null,
}: {
  providerKind: string | null | undefined;
  modelInfo: OpenAICompatibleModelInfo | null;
  requestedEffort: string | null | undefined;
  capabilities?: OpenAICompatibleProviderCapabilities | null;
}): string | null {
  const policy = getOpenAICompatibleThinkingPolicy(providerKind, capabilities);
  if (!policy.supportsReasoningEffortSelection) {
    return null;
  }

  const supported = normalizeEffortList(modelInfo?.supportedReasoningEfforts);
  const fallbackSupported = supported.length > 0
    ? supported
    : normalizeEffortList(policy.supportedReasoningEfforts);
  const fallback = normalizeReasoningEffort(modelInfo?.defaultReasoningEffort)
    || normalizeReasoningEffort(policy.defaultReasoningEffort);
  const requested = normalizeReasoningEffort(requestedEffort);

  if (requested) {
    if (fallbackSupported.length === 0 || fallbackSupported.includes(requested)) {
      return requested;
    }
    if (fallback && (fallbackSupported.length === 0 || fallbackSupported.includes(fallback))) {
      return fallback;
    }
    return fallbackSupported[0] ?? null;
  }

  if (fallback && (fallbackSupported.length === 0 || fallbackSupported.includes(fallback))) {
    return fallback;
  }
  return null;
}

export function applyThinkingPolicyToOpenAIChatRequest(
  chat: JsonRecord,
  {
    providerKind,
    requestedEffort,
    capabilities = null,
  }: {
    providerKind?: string | null;
    requestedEffort?: string | null;
    capabilities?: OpenAICompatibleProviderCapabilities | null;
  } = {},
): JsonRecord {
  const policy = getOpenAICompatibleThinkingPolicy(providerKind, capabilities);
  stripThinkingConfig(chat, policy.stripFields);
  const effort = normalizeReasoningEffort(requestedEffort);

  if (!capabilities?.thinking && policy.mode === 'reasoning_effort') {
    return applyInferredCodexPlusThinkingPolicy(chat, effort);
  }

  if (policy.mode === 'disabled') {
    chat.thinking = policy.disabledThinkingValue ?? { type: 'disabled' };
    delete chat.reasoning_effort;
    return omitUndefined(chat);
  }

  if (policy.mode === 'boolean') {
    delete chat.reasoning_effort;
    if (policy.booleanField && effort) {
      const enabled = !(policy.booleanFalseEfforts ?? ['none']).includes(effort);
      setNestedPath(chat, policy.booleanField, enabled);
      applyPayloadParams(chat, enabled ? policy.booleanTrueParams : policy.booleanFalseParams);
    }
    return omitUndefined(chat);
  }

  if (effort) {
    chat.reasoning_effort = effort;
  }
  return omitUndefined(chat);
}

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

function resolveBaseThinkingPolicy(providerKind: string | null | undefined): OpenAICompatibleThinkingPolicy {
  const normalized = normalizeString(providerKind);
  return {
    ...DEFAULT_OPENAI_COMPATIBLE_THINKING_POLICY,
    providerKind: normalized || DEFAULT_OPENAI_COMPATIBLE_THINKING_POLICY.providerKind,
  };
}

function cloneThinkingPolicy(policy: OpenAICompatibleThinkingPolicy): OpenAICompatibleThinkingPolicy {
  return {
    ...policy,
    supportedReasoningEfforts: [...policy.supportedReasoningEfforts],
    stripFields: [...policy.stripFields],
    disabledThinkingValue: policy.disabledThinkingValue ? { ...policy.disabledThinkingValue } : policy.disabledThinkingValue,
    booleanTrueParams: policy.booleanTrueParams ? { ...policy.booleanTrueParams } : policy.booleanTrueParams,
    booleanFalseParams: policy.booleanFalseParams ? { ...policy.booleanFalseParams } : policy.booleanFalseParams,
  };
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

function normalizeEffortList(value: unknown): string[] {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => normalizeReasoningEffort(entry))
      .filter(Boolean),
  )] as string[];
}

function normalizeCapabilityEffortList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return normalizeEffortList(value);
}
