import {
  buildCodexProviderCliArgs,
  buildCodexProviderConfig,
  codexBaseUrlForProviderProtocol,
  normalizeProviderLabel,
  normalizeProviderBaseUrl,
} from './codex_config.js';
import {
  assertHostedToolDeclarationsForStrategy,
  normalizeCodexProviderHostedTools,
  type CodexProviderHostedToolDeclaration,
  type NormalizedCodexProviderHostedToolDeclaration,
} from './hosted_tools.js';
import {
  getOpenAICompatibleProviderPreset,
  type OpenAICompatibleCapabilityPresetId,
  type OpenAICompatibleProviderPreset,
} from './capabilities/capability_presets.js';
import type {
  BuildCodexProviderConfigInput,
  CodexProviderAuthMode,
  CodexProviderConfig,
  CodexProviderProtocol,
  CodexProviderTomlPrimitive,
  CodexProviderToolStrategy,
} from './types.js';

export type CodexProviderProfileMode =
  | 'official'
  | 'mixed'
  | 'pure-api';

export interface BuildCodexProviderProfileInput {
  mode: CodexProviderProfileMode;
  providerLabel: string;
  upstreamBaseUrl: string;
  defaultModel: string;
  providerName?: string | null;
  protocolProxyPort?: number | null;
  experimentalBearerToken?: string | null;
  apiKeyEnv?: string | null;
  supportsWebsockets?: boolean | null;
  toolStrategy?: CodexProviderToolStrategy | null;
  hostedTools?: CodexProviderHostedToolDeclaration[] | null;
  extraProviderFields?: Record<string, CodexProviderTomlPrimitive | null | undefined> | null;
}

export interface CodexProviderProfile {
  mode: CodexProviderProfileMode;
  providerLabel: string;
  providerName: string;
  upstreamBaseUrl: string;
  codexBaseUrl: string;
  providerProtocol: CodexProviderProtocol;
  authMode: CodexProviderAuthMode;
  toolStrategy: CodexProviderToolStrategy;
  hostedTools: NormalizedCodexProviderHostedToolDeclaration[];
  needsLocalResponsesAdapter: boolean;
  configInput: BuildCodexProviderConfigInput;
  config: CodexProviderConfig;
  codexCliArgs: string[];
}

export type CodexProviderProviderProfilePresetId =
  | 'openrouter'
  | 'deepseek'
  | 'dashscope-qwen';

export interface BuildCodexProviderPresetProfileInput {
  mode?: CodexProviderProfileMode | null;
  providerLabel?: string | null;
  providerName?: string | null;
  upstreamBaseUrl?: string | null;
  defaultModel?: string | null;
  protocolProxyPort?: number | null;
  experimentalBearerToken?: string | null;
  apiKeyEnv?: string | null;
  supportsWebsockets?: boolean | null;
  toolStrategy?: CodexProviderToolStrategy | null;
  hostedTools?: CodexProviderHostedToolDeclaration[] | null;
  extraProviderFields?: Record<string, CodexProviderTomlPrimitive | null | undefined> | null;
}

export interface CodexProviderProviderProfilePresetEnv {
  apiKeyEnv: string;
  baseUrlEnv: string;
  modelEnv: string;
  alternativeApiKeyEnv: string | null;
  alternativeBaseUrlEnv: string | null;
  alternativeModelEnv: string | null;
}

export interface CodexProviderProviderProfilePresetMetadata {
  id: CodexProviderProviderProfilePresetId;
  capabilityPresetId: OpenAICompatibleCapabilityPresetId;
  displayName: string;
  recommendedProfileMode: CodexProviderProfileMode;
  env: CodexProviderProviderProfilePresetEnv;
  upstreamChatCompletionsPath: string;
  capabilities: OpenAICompatibleProviderPreset['capabilities'];
}

export type CodexProviderPresetProfile = CodexProviderProfile & {
  providerPreset: CodexProviderProviderProfilePresetMetadata;
};

interface ProviderProfilePresetRegistration {
  id: CodexProviderProviderProfilePresetId;
  capabilityPresetId: OpenAICompatibleCapabilityPresetId;
  providerLabel: string;
  apiKeyEnv: string;
  baseUrlEnv: string;
  modelEnv: string;
  alternativeApiKeyEnv?: string | null;
  alternativeBaseUrlEnv?: string | null;
  alternativeModelEnv?: string | null;
  recommendedProfileMode: CodexProviderProfileMode;
}

const PROVIDER_PROFILE_PRESETS: Record<CodexProviderProviderProfilePresetId, ProviderProfilePresetRegistration> = {
  openrouter: {
    id: 'openrouter',
    capabilityPresetId: 'openrouter',
    providerLabel: 'openrouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrlEnv: 'OPENROUTER_BASE_URL',
    modelEnv: 'OPENROUTER_MODEL',
    recommendedProfileMode: 'mixed',
  },
  deepseek: {
    id: 'deepseek',
    capabilityPresetId: 'deepseek',
    providerLabel: 'deepseek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    modelEnv: 'DEEPSEEK_MODEL',
    recommendedProfileMode: 'mixed',
  },
  'dashscope-qwen': {
    id: 'dashscope-qwen',
    capabilityPresetId: 'qwen',
    providerLabel: 'dashscope_qwen',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    baseUrlEnv: 'DASHSCOPE_BASE_URL',
    modelEnv: 'DASHSCOPE_MODEL',
    alternativeApiKeyEnv: 'QWEN_API_KEY',
    alternativeBaseUrlEnv: 'QWEN_BASE_URL',
    alternativeModelEnv: 'QWEN_MODEL',
    recommendedProfileMode: 'mixed',
  },
};

export function buildCodexProviderProfile(
  input: BuildCodexProviderProfileInput,
): CodexProviderProfile {
  const mode = normalizeProfileMode(input.mode);
  const providerProtocol = defaultProtocolForProfileMode(mode);
  const authMode = authModeForProfileMode(mode);
  const toolStrategy = input.toolStrategy ?? 'codex-local-first';
  const hostedTools = normalizeCodexProviderHostedTools(input.hostedTools);
  assertHostedToolDeclarationsForStrategy(toolStrategy, hostedTools);
  const providerLabel = normalizeProviderLabel(input.providerLabel);
  const upstreamBaseUrl = normalizeProviderBaseUrl(input.upstreamBaseUrl);
  const defaultModel = normalizeString(input.defaultModel);
  if (!defaultModel) {
    throw new Error('Codex provider profile requires a default model.');
  }
  const configInput: BuildCodexProviderConfigInput = {
    providerLabel,
    providerName: input.providerName ?? defaultProviderNameForProfileMode(mode),
    upstreamBaseUrl: upstreamBaseUrl,
    providerProtocol,
    protocolProxyPort: input.protocolProxyPort ?? null,
    defaultModel,
    authMode,
    experimentalBearerToken: input.experimentalBearerToken ?? null,
    apiKeyEnv: input.apiKeyEnv ?? null,
    supportsWebsockets: input.supportsWebsockets ?? null,
    toolStrategy,
    extraProviderFields: input.extraProviderFields ?? null,
  };
  const config = buildCodexProviderConfig(configInput);
  return {
    mode,
    providerLabel: config.providerLabel,
    providerName: config.providerName,
    upstreamBaseUrl: config.upstreamBaseUrl,
    codexBaseUrl: config.codexBaseUrl,
    providerProtocol: config.providerProtocol,
    authMode: config.authMode,
    toolStrategy: config.toolStrategy,
    hostedTools,
    needsLocalResponsesAdapter: config.codexBaseUrl !== config.upstreamBaseUrl,
    configInput,
    config,
    codexCliArgs: buildCodexProviderCliArgs(configInput),
  };
}

export function createCodexProviderOpenRouterProfile(
  input: BuildCodexProviderPresetProfileInput = {},
): CodexProviderPresetProfile {
  return buildPresetProfile('openrouter', input);
}

export function createCodexProviderDeepSeekProfile(
  input: BuildCodexProviderPresetProfileInput = {},
): CodexProviderPresetProfile {
  return buildPresetProfile('deepseek', input);
}

export function createCodexProviderDashScopeQwenProfile(
  input: BuildCodexProviderPresetProfileInput = {},
): CodexProviderPresetProfile {
  return buildPresetProfile('dashscope-qwen', input);
}

export function defaultProtocolForProfileMode(
  mode: CodexProviderProfileMode,
): CodexProviderProtocol {
  switch (mode) {
    case 'official':
      return 'responses';
    case 'mixed':
    case 'pure-api':
      return 'chat-completions';
    default:
      assertNeverProfileMode(mode);
  }
}

export function authModeForProfileMode(
  mode: CodexProviderProfileMode,
): CodexProviderAuthMode {
  switch (mode) {
    case 'official':
    case 'mixed':
      return 'codex-auth-compatible';
    case 'pure-api':
      return 'api-key-compatible';
    default:
      assertNeverProfileMode(mode);
  }
}

export function codexBaseUrlForProfile(input: {
  mode: CodexProviderProfileMode;
  upstreamBaseUrl: string;
  protocolProxyPort?: number | null;
}): string {
  return codexBaseUrlForProviderProtocol({
    upstreamBaseUrl: input.upstreamBaseUrl,
    providerProtocol: defaultProtocolForProfileMode(input.mode),
    protocolProxyPort: input.protocolProxyPort,
  });
}

function defaultProviderNameForProfileMode(mode: CodexProviderProfileMode): string {
  switch (mode) {
    case 'official':
      return 'Official Responses Provider';
    case 'mixed':
      return 'Mixed Codex Provider';
    case 'pure-api':
      return 'Pure API Provider';
    default:
      assertNeverProfileMode(mode);
  }
}

function buildPresetProfile(
  id: CodexProviderProviderProfilePresetId,
  input: BuildCodexProviderPresetProfileInput,
): CodexProviderPresetProfile {
  const registration = PROVIDER_PROFILE_PRESETS[id];
  const capabilityPreset = getOpenAICompatibleProviderPreset(registration.capabilityPresetId);
  const mode = input.mode ?? registration.recommendedProfileMode;
  const profile = buildCodexProviderProfile({
    mode,
    providerLabel: normalizeString(input.providerLabel) || registration.providerLabel,
    providerName: normalizeString(input.providerName) || `${capabilityPreset.displayName} CodexProvider Adapter`,
    upstreamBaseUrl: normalizeString(input.upstreamBaseUrl) || capabilityPreset.baseUrl,
    defaultModel: normalizeString(input.defaultModel) || capabilityPreset.defaultModel,
    protocolProxyPort: input.protocolProxyPort ?? null,
    experimentalBearerToken: input.experimentalBearerToken ?? null,
    apiKeyEnv: normalizeString(input.apiKeyEnv) || registration.apiKeyEnv,
    supportsWebsockets: input.supportsWebsockets ?? false,
    toolStrategy: input.toolStrategy ?? 'codex-local-first',
    hostedTools: input.hostedTools ?? null,
    extraProviderFields: input.extraProviderFields ?? null,
  });
  return {
    ...profile,
    providerPreset: {
      id: registration.id,
      capabilityPresetId: registration.capabilityPresetId,
      displayName: capabilityPreset.displayName,
      recommendedProfileMode: registration.recommendedProfileMode,
      env: {
        apiKeyEnv: normalizeString(input.apiKeyEnv) || registration.apiKeyEnv,
        baseUrlEnv: registration.baseUrlEnv,
        modelEnv: registration.modelEnv,
        alternativeApiKeyEnv: registration.alternativeApiKeyEnv ?? null,
        alternativeBaseUrlEnv: registration.alternativeBaseUrlEnv ?? null,
        alternativeModelEnv: registration.alternativeModelEnv ?? null,
      },
      upstreamChatCompletionsPath: capabilityPreset.upstreamChatCompletionsPath,
      capabilities: capabilityPreset.capabilities,
    },
  };
}

function normalizeProfileMode(mode: CodexProviderProfileMode): CodexProviderProfileMode {
  if (mode === 'official' || mode === 'mixed' || mode === 'pure-api') {
    return mode;
  }
  throw new Error(`Unsupported Codex provider profile mode: ${String(mode)}`);
}

function assertNeverProfileMode(mode: never): never {
  throw new Error(`Unsupported Codex provider profile mode: ${String(mode)}`);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
