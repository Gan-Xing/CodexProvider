import {
  buildCliproxyModelCapabilityMap,
  buildCliproxyModelIds,
  type CliproxyModelCategory,
} from './cliproxy_model_catalog.js';
import {
  mergeOpenAICompatibleProviderCapabilities,
  type OpenAICompatibleProviderCapabilities,
} from './thinking_policy.js';
import type {
  OpenAICompatibleCapabilityPresetId,
  OpenAICompatibleProfilePresetRegistration,
  OpenAICompatibleProviderPreset,
} from './capability_preset_types.js';
import {
  normalizeString,
} from './capability_catalog_utils.js';

const OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES: OpenAICompatibleProviderCapabilities = {
  supportsBuiltinWebSearchTool: false,
  supportsResponsesCompact: false,
  usage: {
    estimateWhenMissing: true,
  },
};

const TEXT_ONLY_MULTIMODAL = {
  supportsImageInput: false,
  supportsFileInput: false,
  unsupportedInputPartStrategy: 'text-placeholder' as const,
};

const PRESETS: Record<OpenAICompatibleCapabilityPresetId, OpenAICompatibleProviderPreset> = {
  default: buildPreset({
    id: 'default',
    displayName: 'OpenAI Compatible',
    apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    ownedBy: 'openai-compatible',
    categories: ['codex-pro'],
  }),
  deepseek: buildPreset({
    id: 'deepseek',
    displayName: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    ownedBy: 'deepseek',
    categories: ['deepseek-codex'],
    extraCapabilities: {
      multimodal: TEXT_ONLY_MULTIMODAL,
    },
  }),
  minimax: buildPreset({
    id: 'minimax',
    displayName: 'MiniMax',
    apiKeyEnv: 'MINIMAX_API_KEY',
    baseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-M2.7',
    ownedBy: 'minimax',
    categories: ['minimax-codex'],
    extraCapabilities: {
      multimodal: TEXT_ONLY_MULTIMODAL,
    },
  }),
  qwen: buildPreset({
    id: 'qwen',
    displayName: 'Qwen',
    apiKeyEnv: 'QWEN_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    ownedBy: 'qwen',
    categories: ['qwen'],
    extraCapabilities: {
      supportsBuiltinWebSearchTool: true,
      builtinWebSearchTransport: 'chat_enable_search',
      multimodal: TEXT_ONLY_MULTIMODAL,
    },
  }),
  openrouter: buildPreset({
    id: 'openrouter',
    displayName: 'OpenRouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    ownedBy: 'openrouter',
    categories: ['openrouter'],
  }),
  iflow: buildPreset({
    id: 'iflow',
    displayName: 'iFlow',
    apiKeyEnv: 'IFLOW_API_KEY',
    baseUrl: 'https://apis.iflow.cn/v1',
    defaultModel: 'qwen3-coder-plus',
    ownedBy: 'iflow',
    categories: ['iflow'],
    extraCapabilities: {
      multimodal: {
        supportsImageInput: true,
        supportsFileInput: false,
        unsupportedInputPartStrategy: 'text-placeholder',
      },
    },
  }),
  kimi: buildPreset({
    id: 'kimi',
    displayName: 'Kimi',
    apiKeyEnv: 'KIMI_API_KEY',
    baseUrl: 'https://api.kimi.com/coding',
    defaultModel: 'kimi-k2',
    ownedBy: 'moonshot',
    categories: ['kimi'],
    extraCapabilities: {
      multimodal: TEXT_ONLY_MULTIMODAL,
    },
  }),
  antigravity: buildPreset({
    id: 'antigravity',
    displayName: 'Antigravity',
    apiKeyEnv: 'ANTIGRAVITY_API_KEY',
    baseUrl: 'https://cloudcode-pa.googleapis.com',
    defaultModel: 'gemini-3-flash',
    ownedBy: 'antigravity',
    categories: ['antigravity'],
  }),
  claude: buildPreset({
    id: 'claude',
    displayName: 'Claude',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-6',
    ownedBy: 'anthropic',
    categories: ['claude'],
    extraCapabilities: {
      multimodal: {
        supportsImageInput: true,
        supportsFileInput: false,
        unsupportedInputPartStrategy: 'text-placeholder',
      },
    },
  }),
  gemini: buildPreset({
    id: 'gemini',
    displayName: 'Gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    ownedBy: 'google',
    categories: ['gemini'],
  }),
  aistudio: buildPreset({
    id: 'aistudio',
    displayName: 'AI Studio',
    apiKeyEnv: 'AISTUDIO_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    ownedBy: 'google',
    categories: ['aistudio'],
  }),
  vertex: buildPreset({
    id: 'vertex',
    displayName: 'Vertex',
    apiKeyEnv: 'VERTEX_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    ownedBy: 'google',
    categories: ['vertex'],
  }),
  'gemini-cli': buildPreset({
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    apiKeyEnv: 'GEMINI_CLI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    ownedBy: 'google',
    categories: ['gemini-cli'],
  }),
  'codex-free': buildPreset({
    id: 'codex-free',
    displayName: 'Codex Free',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    ownedBy: 'openai',
    categories: ['codex-free'],
  }),
  'codex-team': buildPreset({
    id: 'codex-team',
    displayName: 'Codex Team',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    ownedBy: 'openai',
    categories: ['codex-team'],
  }),
  'codex-plus': buildPreset({
    id: 'codex-plus',
    displayName: 'Codex Plus',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    ownedBy: 'openai',
    categories: ['codex-plus'],
  }),
  'codex-pro': buildPreset({
    id: 'codex-pro',
    displayName: 'Codex Pro',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    ownedBy: 'openai',
    categories: ['codex-pro'],
  }),
};

export const OPENAI_COMPATIBLE_PROFILE_PRESET_REGISTRATIONS: readonly OpenAICompatibleProfilePresetRegistration[] = [
  {
    presetId: 'deepseek',
    envPrefix: 'DEEPSEEK',
  },
  {
    presetId: 'minimax',
    envPrefix: 'MINIMAX',
  },
  {
    presetId: 'qwen',
    envPrefix: 'QWEN',
    alternativeApiKeyEnv: 'DASHSCOPE_API_KEY',
    alternativeBaseUrlEnv: 'DASHSCOPE_BASE_URL',
    alternativeModelEnv: 'DASHSCOPE_MODEL',
  },
  {
    presetId: 'openrouter',
    envPrefix: 'OPENROUTER',
  },
  {
    presetId: 'kimi',
    envPrefix: 'KIMI',
  },
  {
    presetId: 'gemini',
    envPrefix: 'GEMINI',
  },
  {
    presetId: 'iflow',
    envPrefix: 'IFLOW',
  },
] as const;

export function getOpenAICompatibleProviderPreset(id: string | null | undefined): OpenAICompatibleProviderPreset {
  const normalized = normalizePresetId(id);
  return PRESETS[normalized] ?? PRESETS.default;
}

function buildPreset({
  id,
  displayName,
  apiKeyEnv,
  baseUrl,
  defaultModel,
  ownedBy,
  categories,
  extraCapabilities = null,
}: {
  id: OpenAICompatibleCapabilityPresetId;
  displayName: string;
  apiKeyEnv: string;
  baseUrl: string;
  defaultModel: string;
  ownedBy: string;
  categories: CliproxyModelCategory[];
  extraCapabilities?: OpenAICompatibleProviderCapabilities | null;
}): OpenAICompatibleProviderPreset {
  const modelIds = buildCliproxyModelIds(categories);
  const capabilities = mergeOpenAICompatibleProviderCapabilities(
    OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
    {
      modelCapabilities: buildCliproxyModelCapabilityMap(categories),
    },
    extraCapabilities,
  );
  return {
    id,
    displayName,
    apiKeyEnv,
    baseUrl,
    defaultModel,
    modelIds,
    ownedBy,
    upstreamChatCompletionsPath: '/chat/completions',
    capabilities,
  };
}

function normalizePresetId(id: string | null | undefined): OpenAICompatibleCapabilityPresetId {
  const normalized = normalizeString(id).toLowerCase();
  switch (normalized) {
    case 'deepseek':
    case 'minimax':
    case 'qwen':
    case 'openrouter':
    case 'iflow':
    case 'kimi':
    case 'antigravity':
    case 'claude':
    case 'gemini':
    case 'aistudio':
    case 'vertex':
    case 'gemini-cli':
    case 'codex-free':
    case 'codex-team':
    case 'codex-plus':
    case 'codex-pro':
      return normalized;
    default:
      return 'default';
  }
}
