import fs from 'node:fs';
import {
  buildOpenAICompatibleExternalModelCatalog,
  buildOpenAICompatibleModelCatalog,
  getOpenAICompatibleProviderPreset,
  OPENAI_COMPATIBLE_PROFILE_PRESET_REGISTRATIONS,
  type OpenAICompatibleCapabilityPresetId,
  type OpenAICompatibleProviderPreset,
} from '../capabilities/capability_presets.js';
import {
  mergeOpenAICompatibleProviderCapabilities,
  type OpenAICompatibleProviderCapabilities,
} from '../capabilities/thinking_policy.js';
import {
  type CodexProviderTraceSink,
  OpenAICompatibleResponsesAdapterServer,
  type OpenAICompatibleResponsesAdapterServerOptions,
} from './responses-adapter-server/index.js';
import {
  normalizeWebSearchInvalidParameterStrategy,
} from '../web-search/validation.js';

type EnvRecord = Record<string, string | undefined>;

export interface CodexProviderStandaloneServerConfig extends OpenAICompatibleResponsesAdapterServerOptions {
  presetId: OpenAICompatibleCapabilityPresetId;
  modelCatalogSource: 'preset' | 'json' | 'path';
  traceMode: 'off' | 'stderr-json';
}

export function createCodexProviderStandaloneServerConfigFromEnv(
  env: EnvRecord = process.env,
): CodexProviderStandaloneServerConfig {
  const resolvedEnv = resolveCodexProviderStandaloneServerEnv({ env });
  const preset = getOpenAICompatibleProviderPreset(resolveStandaloneEnvValue(resolvedEnv, 'CAPABILITY_PRESET') || 'default');
  const registration = OPENAI_COMPATIBLE_PROFILE_PRESET_REGISTRATIONS.find((entry) => entry.presetId === preset.id) ?? null;

  const apiKey = resolveConfiguredValue(resolvedEnv, [
    providerEnvKey('API_KEY'),
    preset.apiKeyEnv,
    registration?.alternativeApiKeyEnv,
  ]);
  if (!apiKey) {
    throw new Error(
      `Codex Provider standalone server requires an API key. Set ${providerEnvKey('API_KEY')} or ${[
        preset.apiKeyEnv,
        registration?.alternativeApiKeyEnv,
      ].filter(Boolean).join(' / ')}.`,
    );
  }

  const upstreamBaseUrl = resolveConfiguredValue(resolvedEnv, [
    providerEnvKey('BASE_URL'),
    registration ? `${registration.envPrefix}_BASE_URL` : null,
    registration?.alternativeBaseUrlEnv,
  ]) || preset.baseUrl;

  const defaultModel = resolveConfiguredValue(resolvedEnv, [
    providerEnvKey('MODEL'),
    registration ? `${registration.envPrefix}_MODEL` : null,
    registration?.alternativeModelEnv,
  ]) || preset.defaultModel;

  const providerName = resolveStandaloneEnvValue(resolvedEnv, 'PROVIDER_NAME') || preset.displayName;
  const providerKind = resolveStandaloneEnvValue(resolvedEnv, 'PROVIDER_KIND') || 'openai-compatible';
  const ownedBy = resolveStandaloneEnvValue(resolvedEnv, 'OWNED_BY') || preset.ownedBy;
  const host = resolveStandaloneEnvValue(resolvedEnv, 'HOST') || '127.0.0.1';
  const port = normalizePort(resolveStandaloneEnvValue(resolvedEnv, 'PORT'));
  const upstreamChatCompletionsPath = resolveStandaloneEnvValue(resolvedEnv, 'UPSTREAM_CHAT_PATH')
    || preset.upstreamChatCompletionsPath;
  const traceMode = resolveStandaloneTraceMode(resolvedEnv);
  const webSearchInvalidParameterStrategy = normalizeWebSearchInvalidParameterStrategy(
    resolveStandaloneEnvValue(resolvedEnv, 'WEB_SEARCH_INVALID_PARAMETER_STRATEGY'),
  );

  const capabilityOverrides = parseOptionalJson(
    resolveStandaloneEnvValue(resolvedEnv, 'CAPABILITY_OVERRIDES_JSON'),
    providerEnvKey('CAPABILITY_OVERRIDES_JSON'),
  );
  let providerCapabilities = mergeOpenAICompatibleProviderCapabilities(
    preset.capabilities,
    isRecord(capabilityOverrides) ? capabilityOverrides as OpenAICompatibleProviderCapabilities : null,
  );

  const inlineModelCatalog = parseOptionalJson(
    resolveStandaloneEnvValue(resolvedEnv, 'MODEL_CATALOG_JSON'),
    providerEnvKey('MODEL_CATALOG_JSON'),
  );
  const modelCatalogPath = resolveStandaloneEnvValue(resolvedEnv, 'MODEL_CATALOG_PATH');
  const modelCatalogFromPath = modelCatalogPath
    ? parseJsonFile(modelCatalogPath, providerEnvKey('MODEL_CATALOG_PATH'))
    : undefined;
  const modelCatalogRaw = inlineModelCatalog !== undefined ? inlineModelCatalog : modelCatalogFromPath;

  let modelCatalogSource: CodexProviderStandaloneServerConfig['modelCatalogSource'] = 'preset';
  let models = buildOpenAICompatibleModelCatalog({
    defaultModel,
    modelIds: preset.modelIds,
    displayName: providerName,
    capabilities: providerCapabilities,
  });

  if (modelCatalogRaw !== undefined) {
    modelCatalogSource = inlineModelCatalog !== undefined ? 'json' : 'path';
    const externalCatalog = buildOpenAICompatibleExternalModelCatalog({
      raw: modelCatalogRaw,
      defaultModel,
      displayName: providerName,
      capabilities: providerCapabilities,
    });
    if (externalCatalog.catalog.length === 0) {
      throw new Error(
        `Codex Provider standalone server received ${modelCatalogSource === 'json'
          ? providerEnvKey('MODEL_CATALOG_JSON')
          : providerEnvKey('MODEL_CATALOG_PATH')} but it did not contain any model entries.`,
      );
    }
    providerCapabilities = externalCatalog.capabilities;
    models = externalCatalog.catalog;
  }

  return {
    presetId: preset.id,
    modelCatalogSource,
    traceMode,
    apiKey,
    upstreamBaseUrl,
    defaultModel,
    models,
    host,
    port,
    providerKind,
    providerName,
    providerCapabilities,
    upstreamChatCompletionsPath,
    ownedBy,
    webSearchInvalidParameterStrategy,
  };
}

export function resolveCodexProviderStandaloneServerEnv(
  {
    env = process.env,
    envFilePath = null,
  }: {
    env?: EnvRecord;
    envFilePath?: string | null;
  } = {},
): EnvRecord {
  const resolvedPath = normalizeString(envFilePath)
    || normalizeString(env.CODEX_PROVIDER_ENV_FILE);
  if (!resolvedPath) {
    return { ...env };
  }
  return {
    ...loadCodexProviderStandaloneEnvFile(resolvedPath),
    ...env,
  };
}

export function loadCodexProviderStandaloneEnvFile(filePath: string): Record<string, string> {
  const resolvedPath = normalizeString(filePath);
  if (!resolvedPath) {
    throw new Error('Codex Provider standalone server env file path must not be empty.');
  }
  try {
    const content = fs.readFileSync(resolvedPath, 'utf8');
    return parseDotenvLikeContent(content);
  } catch (error) {
    throw new Error(`Codex Provider standalone server env file could not be loaded from ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function createCodexProviderStandaloneServerFromEnv(
  env: EnvRecord = process.env,
): {
  config: CodexProviderStandaloneServerConfig;
  server: OpenAICompatibleResponsesAdapterServer;
} {
  const config = createCodexProviderStandaloneServerConfigFromEnv(env);
  return {
    config,
    server: new OpenAICompatibleResponsesAdapterServer({
      ...config,
      traceSink: createStandaloneTraceSink(config.traceMode),
    }),
  };
}

function resolveStandaloneTraceMode(env: EnvRecord): CodexProviderStandaloneServerConfig['traceMode'] {
  const normalized = resolveStandaloneEnvValue(env, 'TRACE').toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'stderr-json'
    ? 'stderr-json'
    : 'off';
}

function createStandaloneTraceSink(
  traceMode: CodexProviderStandaloneServerConfig['traceMode'],
): CodexProviderTraceSink | null {
  if (traceMode !== 'stderr-json') {
    return null;
  }
  return (event) => {
    process.stderr.write(`${JSON.stringify({
      source: 'codex-provider-trace',
      ...event,
    })}\n`);
  };
}

function resolveStandaloneEnvValue(env: EnvRecord, suffix: string): string {
  return resolveConfiguredValue(env, [
    providerEnvKey(suffix),
  ]);
}

function providerEnvKey(suffix: string): string {
  return `CODEX_PROVIDER_${suffix}`;
}

function resolveConfiguredValue(env: EnvRecord, keys: Array<string | null | undefined>): string {
  for (const key of keys) {
    if (!key) {
      continue;
    }
    const value = normalizeString(env[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function parseOptionalJson(value: string | undefined, fieldName: string): unknown {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }
  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseJsonFile(filePath: string, fieldName: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${fieldName} could not be loaded from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizePort(value: string | undefined): number {
  const normalized = normalizeString(value);
  if (!normalized) {
    return 0;
  }
  const port = Number.parseInt(normalized, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${providerEnvKey('PORT')} must be an integer between 0 and 65535. Received: ${normalized}`);
  }
  return port;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseDotenvLikeContent(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}
