import {
  applyInferredCodexPlusThinkingPolicy,
} from './codex_plus_thinking.js';
import {
  applyPayloadParams,
  normalizePayloadParams,
  setNestedPath,
  stripThinkingConfig,
} from './payload_compatibility.js';
import {
  normalizeCapabilityEffortList,
  normalizeEffortList,
  normalizeReasoningEffort,
  normalizeString,
  omitUndefined,
} from './thinking_policy_utils.js';

export {
  stripThinkingConfig,
} from './payload_compatibility.js';
export {
  mergeOpenAICompatibleProviderCapabilities,
  resolveOpenAICompatibleProviderCapabilitiesForModel,
} from './provider_capabilities.js';

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

  if (normalizeString(providerKind).toLowerCase() === 'openrouter') {
    const mapped = mapOpenRouterReasoningEffort(effort);
    if (mapped) {
      chat.reasoning = { effort: mapped };
    } else {
      delete chat.reasoning;
    }
    delete chat.reasoning_effort;
    return omitUndefined(chat);
  }

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
    if (effort) {
      const enabled = !(policy.booleanFalseEfforts ?? ['none']).includes(effort);
      if (policy.booleanField) {
        setNestedPath(chat, policy.booleanField, enabled);
      }
      applyPayloadParams(chat, enabled ? policy.booleanTrueParams : policy.booleanFalseParams);
    }
    return omitUndefined(chat);
  }

  if (effort) {
    chat.reasoning_effort = effort;
  }
  return omitUndefined(chat);
}

function mapOpenRouterReasoningEffort(effort: string | null): string | null {
  if (!effort) {
    return null;
  }
  if (effort === 'max') {
    return 'xhigh';
  }
  return ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'].includes(effort)
    ? effort
    : null;
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
