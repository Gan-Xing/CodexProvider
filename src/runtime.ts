import {
  normalizeProviderBaseUrl,
} from './codex_config.js';
import {
  authModeForProfileMode,
  buildCodexProviderProfile,
  type CodexProviderProfile,
  type CodexProviderProfileMode,
} from './profiles.js';
import type {
  CodexProviderHostedToolDeclaration,
} from './hosted_tools.js';
import type {
  CodexProviderHostedToolExecutorRegistryInput,
} from './hosted_tool_executors.js';
import type {
  CodexProviderAuthMode,
  CodexProviderConfig,
  CodexProviderToolStrategy,
  CodexProviderTomlPrimitive,
} from './types.js';
import {
  OpenAICompatibleResponsesAdapterServer,
  type OpenAICompatibleResponsesAdapterServerOptions,
} from './server/responses_adapter_server.js';

export interface CodexProviderAdapterServer {
  readonly baseUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type CodexProviderAdapterServerOptions = {
  apiKey: string;
  upstreamBaseUrl: string;
  defaultModel: string;
  host?: string;
  port?: number;
} & OpenAICompatibleResponsesAdapterServerOptions & Record<string, unknown>;

export type CodexProviderAdapterServerFactory = (
  options: CodexProviderAdapterServerOptions,
) => CodexProviderAdapterServer;

export interface CodexProviderRuntimeOptions {
  apiKey: string;
  upstreamBaseUrl: string;
  defaultModel: string;
  providerLabel: string;
  providerName?: string | null;
  profileMode?: CodexProviderProfileMode | null;
  authMode?: CodexProviderAuthMode | null;
  experimentalBearerToken?: string | null;
  apiKeyEnv?: string | null;
  supportsWebsockets?: boolean | null;
  toolStrategy?: CodexProviderToolStrategy | null;
  hostedTools?: CodexProviderHostedToolDeclaration[] | null;
  hostedToolExecutors?: CodexProviderHostedToolExecutorRegistryInput;
  maxHostedToolIterations?: number | null;
  emitHostedToolSseEvents?: boolean | null;
  extraProviderFields?: Record<string, CodexProviderTomlPrimitive | null | undefined> | null;
  adapterHost?: string | null;
  adapterPort?: number | null;
  adapterOptions?: Record<string, unknown> | null;
  adapterServerFactory?: CodexProviderAdapterServerFactory | null;
}

export interface CodexProviderRuntimeState {
  adapterBaseUrl: string | null;
  codexBaseUrl: string;
  codexCliArgs: string[];
  codexConfig: CodexProviderConfig;
  profile: CodexProviderProfile;
}

export class CodexProviderRuntime {
  private readonly options: CodexProviderRuntimeOptions;

  private adapterServer: CodexProviderAdapterServer | null;

  private currentState: CodexProviderRuntimeState | null;

  constructor(options: CodexProviderRuntimeOptions) {
    this.options = options;
    this.adapterServer = null;
    this.currentState = null;
  }

  get state(): CodexProviderRuntimeState | null {
    return this.currentState;
  }

  isStarted(): boolean {
    return Boolean(this.adapterServer && this.currentState);
  }

  async start(): Promise<CodexProviderRuntimeState> {
    if (this.adapterServer && this.currentState) {
      return this.currentState;
    }
    const profileMode = this.resolveProfileMode();
    const apiKey = normalizeString(this.options.apiKey);
    if (profileMode !== 'official' && !apiKey) {
      throw new Error('Codex provider runtime requires an upstream API key.');
    }
    const upstreamBaseUrl = normalizeProviderBaseUrl(this.options.upstreamBaseUrl);
    const defaultModel = normalizeString(this.options.defaultModel);
    if (!defaultModel) {
      throw new Error('Codex provider runtime requires a default model.');
    }

    if (profileMode === 'official') {
      const profile = this.buildProfile({
        profileMode,
        upstreamBaseUrl,
        protocolProxyPort: null,
        apiKey,
        defaultModel,
      });
      const state: CodexProviderRuntimeState = {
        adapterBaseUrl: null,
        codexBaseUrl: profile.codexBaseUrl,
        codexCliArgs: profile.codexCliArgs,
        codexConfig: profile.config,
        profile,
      };
      this.currentState = state;
      return state;
    }

    const adapterServerFactory = this.options.adapterServerFactory
      ?? createDefaultCodexProviderAdapterServer;
    const server = adapterServerFactory({
      ...normalizeAdapterOptions(this.options.adapterOptions),
      apiKey,
      upstreamBaseUrl,
      defaultModel,
      host: normalizeString(this.options.adapterHost) || undefined,
      port: normalizePort(this.options.adapterPort),
      ...(this.options.hostedTools !== undefined ? { hostedTools: this.options.hostedTools ?? null } : {}),
      ...(this.options.hostedToolExecutors !== undefined ? { hostedToolExecutors: this.options.hostedToolExecutors ?? null } : {}),
      ...(this.options.maxHostedToolIterations !== undefined ? { maxHostedToolIterations: this.options.maxHostedToolIterations ?? null } : {}),
      ...(this.options.emitHostedToolSseEvents !== undefined ? { emitHostedToolSseEvents: this.options.emitHostedToolSseEvents ?? null } : {}),
    });
    await server.start();

    const adapterBaseUrl = normalizeProviderBaseUrl(`${server.baseUrl}/v1`);
    const protocolProxyPort = protocolProxyPortFromBaseUrl(adapterBaseUrl);
    const profile = this.buildProfile({
      profileMode,
      upstreamBaseUrl,
      protocolProxyPort,
      apiKey,
      defaultModel,
    });
    const state: CodexProviderRuntimeState = {
      adapterBaseUrl,
      codexBaseUrl: profile.codexBaseUrl,
      codexCliArgs: profile.codexCliArgs,
      codexConfig: profile.config,
      profile,
    };

    this.adapterServer = server;
    this.currentState = state;
    return state;
  }

  async stop(): Promise<void> {
    const server = this.adapterServer;
    this.adapterServer = null;
    this.currentState = null;
    await server?.stop?.();
  }

  private buildProfile({
    profileMode,
    upstreamBaseUrl,
    protocolProxyPort,
    apiKey,
    defaultModel,
  }: {
    profileMode: CodexProviderProfileMode;
    upstreamBaseUrl: string;
    protocolProxyPort: number | null;
    apiKey: string;
    defaultModel: string;
  }): CodexProviderProfile {
    const authMode = authModeForProfileMode(profileMode);
    return buildCodexProviderProfile({
      mode: profileMode,
      providerLabel: this.options.providerLabel,
      providerName: normalizeString(this.options.providerName) || null,
      upstreamBaseUrl,
      protocolProxyPort,
      defaultModel,
      experimentalBearerToken: authMode === 'codex-auth-compatible'
        ? normalizeString(this.options.experimentalBearerToken) || apiKey || null
        : normalizeString(this.options.experimentalBearerToken) || null,
      apiKeyEnv: normalizeString(this.options.apiKeyEnv) || null,
      supportsWebsockets: this.options.supportsWebsockets ?? false,
      toolStrategy: this.options.toolStrategy ?? 'codex-local-first',
      hostedTools: this.options.hostedTools ?? null,
      extraProviderFields: this.options.extraProviderFields ?? null,
    });
  }

  private resolveProfileMode(): CodexProviderProfileMode {
    return this.options.profileMode
      ?? profileModeForAuthMode(this.options.authMode ?? 'codex-auth-compatible');
  }
}

function profileModeForAuthMode(authMode: CodexProviderAuthMode): CodexProviderProfileMode {
  return authMode === 'api-key-compatible' ? 'pure-api' : 'mixed';
}

function normalizePort(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error('Codex provider adapter port must be an integer from 0 to 65535.');
  }
  return value;
}

function protocolProxyPortFromBaseUrl(baseUrl: string): number | null {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.port) {
      return Number(parsed.port);
    }
    if (parsed.protocol === 'http:') {
      return 80;
    }
    if (parsed.protocol === 'https:') {
      return 443;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeAdapterOptions(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createDefaultCodexProviderAdapterServer(
  options: CodexProviderAdapterServerOptions,
): CodexProviderAdapterServer {
  return new OpenAICompatibleResponsesAdapterServer(options);
}
