export type CodexProviderAuthMode =
  | 'codex-auth-compatible'
  | 'api-key-compatible';

export type CodexProviderProtocol =
  | 'responses'
  | 'chat-completions';

export type CodexProviderToolStrategy =
  | 'codex-local-first'
  | 'provider-native'
  | 'adapter-emulated';

export type CodexProviderTomlPrimitive = string | number | boolean;

export interface CodexProviderTokenSource {
  experimentalBearerToken?: string | null;
  apiKeyEnv?: string | null;
}

export interface BuildCodexProviderConfigInput extends CodexProviderTokenSource {
  providerLabel: string;
  upstreamBaseUrl: string;
  defaultModel: string;
  providerName?: string | null;
  authMode?: CodexProviderAuthMode | null;
  providerProtocol?: CodexProviderProtocol | null;
  protocolProxyPort?: number | null;
  supportsWebsockets?: boolean | null;
  toolStrategy?: CodexProviderToolStrategy | null;
  extraProviderFields?: Record<string, CodexProviderTomlPrimitive | null | undefined> | null;
}

export interface CodexProviderConfigEntry {
  key: string;
  value: CodexProviderTomlPrimitive;
}

export interface CodexProviderConfig {
  providerLabel: string;
  providerName: string;
  authMode: CodexProviderAuthMode;
  providerProtocol: CodexProviderProtocol;
  upstreamBaseUrl: string;
  codexBaseUrl: string;
  protocolProxyPort: number;
  toolStrategy: CodexProviderToolStrategy;
  entries: CodexProviderConfigEntry[];
}
