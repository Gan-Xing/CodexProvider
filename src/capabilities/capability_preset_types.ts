import type {
  OpenAICompatibleModelCapabilities,
  OpenAICompatibleProviderCapabilities,
} from './thinking_policy.js';

export type OpenAICompatibleCapabilityPresetId =
  | 'default'
  | 'deepseek'
  | 'minimax'
  | 'qwen'
  | 'siliconflow'
  | 'openrouter'
  | 'iflow'
  | 'kimi'
  | 'antigravity'
  | 'claude'
  | 'gemini'
  | 'aistudio'
  | 'vertex'
  | 'gemini-cli'
  | 'codex-free'
  | 'codex-team'
  | 'codex-plus'
  | 'codex-pro';

export interface OpenAICompatibleProviderPreset {
  id: OpenAICompatibleCapabilityPresetId;
  displayName: string;
  apiKeyEnv: string;
  baseUrl: string;
  defaultModel: string;
  modelIds: string[];
  ownedBy: string;
  upstreamChatCompletionsPath: string;
  capabilities: OpenAICompatibleProviderCapabilities | null;
}

export interface OpenAICompatibleProfilePresetRegistration {
  presetId: OpenAICompatibleCapabilityPresetId;
  envPrefix: string;
  alternativeApiKeyEnv?: string | null;
  alternativeBaseUrlEnv?: string | null;
  alternativeModelEnv?: string | null;
}

export interface OpenAICompatibleCapabilityCatalogMetadata {
  toolCalling: {
    supported: boolean;
    parallel: boolean | null;
    builtinWebSearch: boolean | null;
  };
  inputModalities: {
    image: boolean | null;
    file: boolean | null;
    pdf: boolean | null;
  };
  structuredOutput: {
    jsonSchema: boolean | null;
  };
  reasoning: {
    supported: boolean;
    supportedReasoningEfforts: string[];
    defaultReasoningEffort: string | null;
  };
  responses: {
    compact: boolean | null;
  };
  limits: {
    maxOutputTokens: number | null;
  };
  quirks: string[];
}

export type ExternalModelCatalogEntry = Record<string, any>;

export type ExternalModelCatalogBuildResult = {
  catalog: any[];
  capabilities: OpenAICompatibleProviderCapabilities | null;
};

export type ModelCatalogEntryCapabilities = OpenAICompatibleModelCapabilities | null | undefined;
