import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getOpenAICompatibleProviderPreset,
} from './capabilities/capability_presets.js';
import {
  createCodexProviderFileSearchExecutor,
} from './file_search_executor.js';
import type {
  CodexProviderHostedToolDeclaration,
} from './hosted_tools.js';
import type {
  CodexProviderHostedToolExecutorRegistryInput,
} from './hosted_tool_executors.js';
import type {
  ToolCatalogPolicy,
} from './converters/responses-adapter/types.js';
import {
  OpenAICompatibleResponsesAdapterServer,
  type CodexProviderTraceEvent,
  type CodexProviderTraceSink,
} from './server/responses-adapter-server/index.js';
import {
  createCodexProviderStandaloneServerConfigFromEnv,
  type CodexProviderStandaloneServerConfig,
} from './server/standalone_server.js';
import {
  createCodexProviderToolSearchExecutor,
} from './tool_search_executor.js';
import {
  createCodexProviderDuckDuckGoHtmlEngine,
  createCodexProviderEcosiaHtmlEngine,
  createCodexProviderMojeekHtmlEngine,
  createCodexProviderWebSearchExecutor,
} from './web-search/index.js';

type EnvRecord = Record<string, string | undefined>;

export const DEFAULT_NATIVE_GATEWAY_PORT = 47321;
export const NATIVE_GATEWAY_PROVIDER_ID = 'codex_provider_gateway';
export const NATIVE_GATEWAY_STATE_VERSION = 1;
export const NATIVE_GATEWAY_MANAGED_BLOCK_START = '# BEGIN codex-provider native-gateway';
export const NATIVE_GATEWAY_MANAGED_BLOCK_END = '# END codex-provider native-gateway';

export interface NativeGatewayPaths {
  homeDir: string;
  codexDir: string;
  codexConfigPath: string;
  stateDir: string;
  statePath: string;
  pidPath: string;
  logPath: string;
}

export interface NativeGatewayState {
  version: 1;
  provider: string;
  providerName: string;
  model: string;
  port: number;
  baseUrl: string;
  upstreamBaseUrl: string;
  upstreamChatCompletionsPath: string;
  envFilePath: string | null;
  trace: boolean;
  workspacePath: string | null;
  fileSearchRootPath: string | null;
  imageProvider: string | null;
  codeSandbox: string | null;
  computerAdapter: string | null;
  pid: number | null;
  startedAt: string | null;
  lastRequestAt: string | null;
  lastRoute: string | null;
  lastModel: string | null;
  lastTools: string[];
  lastUpstreamProvider: string | null;
  lastToolExecutionAt: string | null;
  lastToolExecution: string | null;
}

export interface NativeGatewaySetupOptions {
  provider?: string | null;
  model?: string | null;
  port?: number | string | null;
  setDefault?: boolean | null;
  envFilePath?: string | null;
  trace?: boolean | null;
  workspacePath?: string | null;
  fileSearchRootPath?: string | null;
  imageProvider?: string | null;
  codeSandbox?: string | null;
  computerAdapter?: string | null;
  homeDir?: string | null;
  now?: Date | null;
}

export interface NativeGatewaySetupResult {
  paths: NativeGatewayPaths;
  backupPath: string | null;
  state: NativeGatewayState;
}

export interface NativeGatewayStartOptions extends NativeGatewaySetupOptions {
  cliPath: string;
  env?: EnvRecord | null;
}

export interface NativeGatewayStartResult {
  paths: NativeGatewayPaths;
  pid: number;
  state: NativeGatewayState;
  alreadyRunning: boolean;
}

export interface NativeGatewayStopOptions {
  homeDir?: string | null;
}

export interface NativeGatewayStopResult {
  paths: NativeGatewayPaths;
  pid: number | null;
  stopped: boolean;
  stale: boolean;
}

export interface NativeGatewayStatusOptions {
  homeDir?: string | null;
}

export interface NativeGatewayStatus {
  paths: NativeGatewayPaths;
  running: boolean;
  pid: number | null;
  state: NativeGatewayState;
  tools: NativeGatewayToolStatus[];
}

export interface NativeGatewayToolStatus {
  name: string;
  status: 'ready' | 'unavailable' | 'delegated' | 'delegated-to-codex';
  reason: string | null;
}

export interface NativeGatewayAdapterOptions {
  hostedTools: CodexProviderHostedToolDeclaration[];
  hostedToolExecutors: CodexProviderHostedToolExecutorRegistryInput;
  emitHostedToolSseEvents: boolean;
  exposeHostedToolResultsInResponsesOutput: boolean;
  exposeWebSearchDetailedActions: boolean;
  toolCatalogPolicy: ToolCatalogPolicy;
}

export interface NativeGatewayServerFactoryResult {
  config: CodexProviderStandaloneServerConfig;
  server: OpenAICompatibleResponsesAdapterServer;
}

export function resolveNativeGatewayPaths(homeDir: string | null | undefined = os.homedir()): NativeGatewayPaths {
  const resolvedHome = normalizeString(homeDir) || os.homedir();
  const codexDir = path.join(resolvedHome, '.codex');
  const stateDir = path.join(resolvedHome, '.codex-provider');
  return {
    homeDir: resolvedHome,
    codexDir,
    codexConfigPath: path.join(codexDir, 'config.toml'),
    stateDir,
    statePath: path.join(stateDir, 'native-gateway.json'),
    pidPath: path.join(stateDir, 'native-gateway.pid'),
    logPath: path.join(stateDir, 'native-gateway.log'),
  };
}

export function setupNativeGateway(options: NativeGatewaySetupOptions = {}): NativeGatewaySetupResult {
  const paths = resolveNativeGatewayPaths(options.homeDir);
  const state = buildNativeGatewayState(options, readNativeGatewayState(paths.statePath));
  fs.mkdirSync(paths.codexDir, { recursive: true });
  fs.mkdirSync(paths.stateDir, { recursive: true });

  const previousConfig = fs.existsSync(paths.codexConfigPath)
    ? fs.readFileSync(paths.codexConfigPath, 'utf8')
    : '';
  const backupPath = fs.existsSync(paths.codexConfigPath)
    ? backupCodexConfig(paths.codexConfigPath, options.now ?? new Date())
    : null;
  const nextConfig = buildCodexConfigToml(previousConfig, {
    baseUrl: state.baseUrl,
    model: state.model,
    setDefault: Boolean(options.setDefault),
  });
  fs.writeFileSync(paths.codexConfigPath, nextConfig, 'utf8');
  writeNativeGatewayState(paths.statePath, state);
  return { paths, backupPath, state };
}

export function startNativeGateway(options: NativeGatewayStartOptions): NativeGatewayStartResult {
  const paths = resolveNativeGatewayPaths(options.homeDir);
  fs.mkdirSync(paths.stateDir, { recursive: true });

  const existingPid = readNativeGatewayPid(paths.pidPath);
  if (existingPid && isProcessRunning(existingPid)) {
    const state = buildNativeGatewayState(options, readNativeGatewayState(paths.statePath), {
      pid: existingPid,
    });
    writeNativeGatewayState(paths.statePath, state);
    return {
      paths,
      pid: existingPid,
      state,
      alreadyRunning: true,
    };
  }
  if (existingPid) {
    safeUnlink(paths.pidPath);
  }

  const now = new Date();
  const state = buildNativeGatewayState(options, readNativeGatewayState(paths.statePath), {
    startedAt: now.toISOString(),
  });
  const logFd = fs.openSync(paths.logPath, 'a');
  fs.writeSync(logFd, `\n[${now.toISOString()}] starting codex-provider native gateway\n`);

  const childEnv: EnvRecord = {
    ...process.env,
    ...(options.env ?? {}),
    CODEX_PROVIDER_CAPABILITY_PRESET: state.provider,
    CODEX_PROVIDER_MODEL: state.model,
    CODEX_PROVIDER_PORT: String(state.port),
    CODEX_PROVIDER_NATIVE_GATEWAY_STATE_FILE: paths.statePath,
    CODEX_PROVIDER_NATIVE_GATEWAY_LOG_FILE: paths.logPath,
    CODEX_PROVIDER_WORKSPACE: state.workspacePath ?? '',
    CODEX_PROVIDER_FILE_SEARCH_ROOT: state.fileSearchRootPath ?? '',
    CODEX_PROVIDER_IMAGE_PROVIDER: state.imageProvider ?? '',
    CODEX_PROVIDER_CODE_SANDBOX: state.codeSandbox ?? '',
    CODEX_PROVIDER_COMPUTER_ADAPTER: state.computerAdapter ?? '',
  };
  if (state.envFilePath) {
    childEnv.CODEX_PROVIDER_ENV_FILE = state.envFilePath;
  }
  if (state.trace) {
    childEnv.CODEX_PROVIDER_TRACE = '1';
  }

  const child = spawn(process.execPath, [options.cliPath, 'serve'], {
    detached: true,
    env: childEnv,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  const pid = child.pid ?? null;
  if (!pid) {
    throw new Error('Codex Provider native gateway could not be started: child process pid is missing.');
  }
  fs.writeFileSync(paths.pidPath, `${pid}\n`, 'utf8');
  const runningState = {
    ...state,
    pid,
    startedAt: now.toISOString(),
  };
  writeNativeGatewayState(paths.statePath, runningState);
  return {
    paths,
    pid,
    state: runningState,
    alreadyRunning: false,
  };
}

export function stopNativeGateway(options: NativeGatewayStopOptions = {}): NativeGatewayStopResult {
  const paths = resolveNativeGatewayPaths(options.homeDir);
  const pid = readNativeGatewayPid(paths.pidPath);
  if (!pid) {
    return { paths, pid: null, stopped: false, stale: false };
  }
  if (!isProcessRunning(pid)) {
    safeUnlink(paths.pidPath);
    updateNativeGatewayState(paths.statePath, {
      pid: null,
      startedAt: null,
    });
    return { paths, pid, stopped: false, stale: true };
  }
  process.kill(pid, 'SIGTERM');
  safeUnlink(paths.pidPath);
  updateNativeGatewayState(paths.statePath, {
    pid: null,
    startedAt: null,
  });
  return { paths, pid, stopped: true, stale: false };
}

export function getNativeGatewayStatus(options: NativeGatewayStatusOptions = {}): NativeGatewayStatus {
  const paths = resolveNativeGatewayPaths(options.homeDir);
  const persisted = readNativeGatewayState(paths.statePath);
  const state = buildNativeGatewayState({}, persisted);
  const pid = readNativeGatewayPid(paths.pidPath) ?? state.pid;
  const running = Boolean(pid && isProcessRunning(pid));
  return {
    paths,
    running,
    pid: running ? pid : null,
    state: {
      ...state,
      pid: running ? pid : null,
    },
    tools: resolveNativeGatewayToolStatuses(state),
  };
}

export function createNativeGatewayServerFromEnv(env: EnvRecord = process.env): NativeGatewayServerFactoryResult {
  const config = createCodexProviderStandaloneServerConfigFromEnv(env);
  const statePath = normalizeString(env.CODEX_PROVIDER_NATIVE_GATEWAY_STATE_FILE);
  const logPath = normalizeString(env.CODEX_PROVIDER_NATIVE_GATEWAY_LOG_FILE);
  const traceSink = createNativeGatewayTraceSink({
    statePath,
    logPath,
    traceMode: config.traceMode,
    provider: config.presetId,
    providerName: config.providerName,
    upstreamBaseUrl: config.upstreamBaseUrl,
  });
  if (statePath) {
    updateNativeGatewayState(statePath, {
      provider: config.presetId,
      providerName: config.providerName,
      model: config.defaultModel,
      upstreamBaseUrl: config.upstreamBaseUrl,
      upstreamChatCompletionsPath: config.upstreamChatCompletionsPath,
      lastUpstreamProvider: config.providerName,
    });
  }
  return {
    config,
    server: new OpenAICompatibleResponsesAdapterServer({
      ...config,
      ...buildNativeGatewayAdapterOptionsFromEnv(env),
      traceSink,
    }),
  };
}

export function updateNativeGatewayRuntimeState(
  statePath: string,
  state: Partial<NativeGatewayState>,
): void {
  updateNativeGatewayState(statePath, state);
}

export function buildNativeGatewayAdapterOptionsFromEnv(env: EnvRecord = process.env): NativeGatewayAdapterOptions {
  const roots = resolveFileSearchRootsFromEnv(env);
  const hostedTools: CodexProviderHostedToolDeclaration[] = [
    { name: 'web_search', mode: 'adapter-emulated' },
    { name: 'tool_search', mode: 'adapter-emulated' },
  ];
  const hostedToolExecutors: CodexProviderHostedToolExecutorRegistryInput = {
    web_search: createCodexProviderWebSearchExecutor({
      engines: [
        createCodexProviderDuckDuckGoHtmlEngine(),
        createCodexProviderEcosiaHtmlEngine(),
        createCodexProviderMojeekHtmlEngine(),
      ],
      fetchPages: false,
      webSearchInvalidParameterStrategy: 'drop',
    }),
    tool_search: createCodexProviderToolSearchExecutor(),
  };

  if (roots.length > 0) {
    hostedTools.push({ name: 'file_search', mode: 'adapter-emulated' });
    hostedToolExecutors.file_search = createCodexProviderFileSearchExecutor({
      roots,
      includeContent: false,
      maxResults: 10,
    });
  }

  return {
    hostedTools,
    hostedToolExecutors,
    emitHostedToolSseEvents: true,
    exposeHostedToolResultsInResponsesOutput: true,
    exposeWebSearchDetailedActions: true,
    toolCatalogPolicy: {
      namespaceStrategy: 'drop',
      maxForwardedTools: 64,
    },
  };
}

export function formatNativeGatewayStatus(status: NativeGatewayStatus): string {
  const state = status.state;
  return [
    `running: ${status.running ? 'true' : 'false'}`,
    `pid: ${status.pid ?? 'none'}`,
    `base_url: ${state.baseUrl}`,
    `provider: ${state.provider}`,
    `model: ${state.model}`,
    `upstream_base_url: ${redactUrl(state.upstreamBaseUrl)}`,
    `last_request_at: ${state.lastRequestAt ?? 'none'}`,
    `last_upstream_provider: ${state.lastUpstreamProvider ?? 'none'}`,
    'tools:',
    ...status.tools.map((tool) => `  ${tool.name}: ${tool.status}${tool.reason ? ` (${tool.reason})` : ''}`),
    `state_file: ${status.paths.statePath}`,
    `log_file: ${status.paths.logPath}`,
  ].join('\n');
}

function buildNativeGatewayState(
  options: NativeGatewaySetupOptions,
  previous: NativeGatewayState | null,
  overrides: Partial<NativeGatewayState> = {},
): NativeGatewayState {
  const provider = normalizeString(options.provider) || previous?.provider || 'default';
  const preset = getOpenAICompatibleProviderPreset(provider);
  const model = normalizeString(options.model) || previous?.model || preset.defaultModel;
  const port = normalizeNativeGatewayPort(options.port ?? previous?.port ?? DEFAULT_NATIVE_GATEWAY_PORT);
  const workspacePath = normalizePathOption(options.workspacePath) ?? previous?.workspacePath ?? null;
  const fileSearchRootPath = normalizePathOption(options.fileSearchRootPath) ?? previous?.fileSearchRootPath ?? null;
  return {
    version: NATIVE_GATEWAY_STATE_VERSION,
    provider: preset.id,
    providerName: preset.displayName,
    model,
    port,
    baseUrl: nativeGatewayBaseUrl(port),
    upstreamBaseUrl: previous?.upstreamBaseUrl || preset.baseUrl,
    upstreamChatCompletionsPath: previous?.upstreamChatCompletionsPath || preset.upstreamChatCompletionsPath,
    envFilePath: normalizePathOption(options.envFilePath) ?? previous?.envFilePath ?? null,
    trace: options.trace ?? previous?.trace ?? false,
    workspacePath,
    fileSearchRootPath,
    imageProvider: normalizeString(options.imageProvider) || previous?.imageProvider || null,
    codeSandbox: normalizeString(options.codeSandbox) || previous?.codeSandbox || null,
    computerAdapter: normalizeString(options.computerAdapter) || previous?.computerAdapter || null,
    pid: previous?.pid ?? null,
    startedAt: previous?.startedAt ?? null,
    lastRequestAt: previous?.lastRequestAt ?? null,
    lastRoute: previous?.lastRoute ?? null,
    lastModel: previous?.lastModel ?? null,
    lastTools: previous?.lastTools ?? [],
    lastUpstreamProvider: previous?.lastUpstreamProvider ?? preset.displayName,
    lastToolExecutionAt: previous?.lastToolExecutionAt ?? null,
    lastToolExecution: previous?.lastToolExecution ?? null,
    ...overrides,
  };
}

function buildCodexConfigToml(
  existingConfig: string,
  {
    baseUrl,
    model,
    setDefault,
  }: {
    baseUrl: string;
    model: string;
    setDefault: boolean;
  },
): string {
  const withoutManagedBlock = removeManagedCodexProviderBlock(existingConfig);
  const withDefaults = setDefault
    ? upsertRootStringAssignments(withoutManagedBlock, {
        model_provider: NATIVE_GATEWAY_PROVIDER_ID,
        model,
      })
    : withoutManagedBlock;
  const block = [
    NATIVE_GATEWAY_MANAGED_BLOCK_START,
    `[model_providers.${NATIVE_GATEWAY_PROVIDER_ID}]`,
    'name = "CodexProvider Gateway"',
    'wire_api = "responses"',
    'requires_openai_auth = true',
    `base_url = ${tomlString(baseUrl)}`,
    NATIVE_GATEWAY_MANAGED_BLOCK_END,
  ].join('\n');
  const prefix = withDefaults.trimEnd();
  return `${prefix ? `${prefix}\n\n` : ''}${block}\n`;
}

function removeManagedCodexProviderBlock(config: string): string {
  const start = config.indexOf(NATIVE_GATEWAY_MANAGED_BLOCK_START);
  if (start === -1) {
    return config;
  }
  const end = config.indexOf(NATIVE_GATEWAY_MANAGED_BLOCK_END, start);
  if (end === -1) {
    return config;
  }
  const afterEnd = end + NATIVE_GATEWAY_MANAGED_BLOCK_END.length;
  const before = config.slice(0, start).trimEnd();
  const after = config.slice(afterEnd).replace(/^\s*\n/u, '');
  return `${before}${before && after ? '\n\n' : ''}${after}`;
}

function upsertRootStringAssignments(config: string, values: Record<string, string>): string {
  const lines = config.split(/\r?\n/u);
  const firstTableIndex = lines.findIndex((line) => /^\s*\[[^\]]+\]\s*$/u.test(line));
  const rootEnd = firstTableIndex === -1 ? lines.length : firstTableIndex;
  const rootLines = lines.slice(0, rootEnd);
  const rest = lines.slice(rootEnd);

  for (const [key, value] of Object.entries(values)) {
    const assignment = `${key} = ${tomlString(value)}`;
    const existingIndex = rootLines.findIndex((line) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, 'u').test(line));
    if (existingIndex === -1) {
      rootLines.push(assignment);
    } else {
      rootLines[existingIndex] = assignment;
    }
  }

  return [...rootLines, ...rest].join('\n');
}

function backupCodexConfig(configPath: string, now: Date): string {
  const backupPathBase = `${configPath}.codex-provider-backup-${timestampForFilename(now)}`;
  let backupPath = backupPathBase;
  let counter = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = `${backupPathBase}.${counter}`;
    counter += 1;
  }
  fs.copyFileSync(configPath, backupPath);
  return backupPath;
}

function createNativeGatewayTraceSink({
  statePath,
  logPath,
  traceMode,
  provider,
  providerName,
  upstreamBaseUrl,
}: {
  statePath: string;
  logPath: string;
  traceMode: CodexProviderStandaloneServerConfig['traceMode'];
  provider: string;
  providerName: string;
  upstreamBaseUrl: string;
}): CodexProviderTraceSink | null {
  if (!statePath && traceMode !== 'stderr-json') {
    return null;
  }
  return (event) => {
    const summary = summarizeTraceEvent(event, {
      provider,
      providerName,
      upstreamBaseUrl,
    });
    if (statePath) {
      updateNativeGatewayState(statePath, summary.state);
    }
    if (traceMode === 'stderr-json') {
      const line = JSON.stringify({
        source: 'codex-provider-native-gateway',
        ...summary.log,
      });
      process.stderr.write(`${line}\n`);
    }
  };
}

function summarizeTraceEvent(
  event: CodexProviderTraceEvent,
  context: {
    provider: string;
    providerName: string;
    upstreamBaseUrl: string;
  },
): {
  state: Partial<NativeGatewayState>;
  log: Record<string, unknown>;
} {
  const now = new Date().toISOString();
  const tools = traceTools(event);
  const route = 'route' in event ? event.route : null;
  const model = 'model' in event ? event.model : null;
  const state: Partial<NativeGatewayState> = {
    lastUpstreamProvider: context.providerName,
    upstreamBaseUrl: context.upstreamBaseUrl,
  };

  if (event.type === 'request.received') {
    state.lastRequestAt = now;
    state.lastRoute = route;
    state.lastModel = model;
    state.lastTools = tools;
  }
  if (event.type === 'hosted_tool.executed' || event.type === 'web_search.executed') {
    state.lastToolExecutionAt = now;
    state.lastToolExecution = event.type === 'web_search.executed'
      ? `${event.toolName}:${event.executionStatus}`
      : event.toolName;
  }

  return {
    state,
    log: {
      type: event.type,
      route,
      provider: context.provider,
      model,
      upstream: redactUrl(context.upstreamBaseUrl),
      tools,
      request_id: buildTraceRequestId(event),
    },
  };
}

function traceTools(event: CodexProviderTraceEvent): string[] {
  if (
    event.type === 'request.translated'
    && Array.isArray(event.upstreamRequest?.tools)
  ) {
    return event.upstreamRequest.tools
      .map((tool: unknown) => normalizeString((tool as { type?: unknown; function?: { name?: unknown } } | null)?.type)
        || normalizeString((tool as { function?: { name?: unknown } } | null)?.function?.name))
      .filter(Boolean);
  }
  if ('request' in event && Array.isArray(event.request?.tools)) {
    return event.request.tools
      .map((tool: unknown) => normalizeString((tool as { type?: unknown } | null)?.type))
      .filter(Boolean);
  }
  if ('upstreamRequest' in event && Array.isArray(event.upstreamRequest?.tools)) {
    return event.upstreamRequest.tools
      .map((tool: unknown) => normalizeString((tool as { type?: unknown; function?: { name?: unknown } } | null)?.type)
        || normalizeString((tool as { function?: { name?: unknown } } | null)?.function?.name))
      .filter(Boolean);
  }
  if ('toolName' in event) {
    return [event.toolName];
  }
  return [];
}

function buildTraceRequestId(event: CodexProviderTraceEvent): string {
  if ('callId' in event) {
    return event.callId;
  }
  const route = 'route' in event ? event.route : 'unknown';
  const model = 'model' in event ? event.model : 'unknown';
  return `${route}:${model}`;
}

function resolveNativeGatewayToolStatuses(state: NativeGatewayState): NativeGatewayToolStatus[] {
  const fileSearchRoot = state.fileSearchRootPath || state.workspacePath;
  return [
    {
      name: 'web_search',
      status: 'ready',
      reason: 'adapter-emulated metasearch executor',
    },
    {
      name: 'file_search',
      status: fileSearchRoot ? 'ready' : 'unavailable',
      reason: fileSearchRoot ? `scoped to ${fileSearchRoot}` : 'requires --workspace or --file-search-root',
    },
    {
      name: 'tool_search',
      status: 'ready',
      reason: 'adapter-emulated deferred tool executor',
    },
    {
      name: 'image_generation',
      status: state.imageProvider ? 'ready' : 'unavailable',
      reason: state.imageProvider ? `provider ${state.imageProvider}` : 'requires --image-provider',
    },
    {
      name: 'code_interpreter',
      status: state.codeSandbox ? 'ready' : 'delegated',
      reason: state.codeSandbox ? `sandbox ${state.codeSandbox}` : 'Codex owns local code execution',
    },
    {
      name: 'computer',
      status: state.computerAdapter ? 'ready' : 'delegated',
      reason: state.computerAdapter ? `adapter ${state.computerAdapter}` : 'Codex owns computer approval/execution',
    },
    {
      name: 'apply_patch',
      status: 'delegated-to-codex',
      reason: 'Codex owns patch approval/execution',
    },
    {
      name: 'shell',
      status: 'delegated-to-codex',
      reason: 'Codex owns shell approval/execution',
    },
  ];
}

function resolveFileSearchRootsFromEnv(env: EnvRecord): string[] {
  return [
    ...splitPathList(env.CODEX_PROVIDER_FILE_SEARCH_ROOTS),
    normalizeString(env.CODEX_PROVIDER_FILE_SEARCH_ROOT),
    normalizeString(env.CODEX_PROVIDER_WORKSPACE),
  ]
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function splitPathList(value: unknown): string[] {
  const normalized = normalizeString(value);
  return normalized
    ? normalized.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function readNativeGatewayState(statePath: string): NativeGatewayState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<NativeGatewayState>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== NATIVE_GATEWAY_STATE_VERSION) {
      return null;
    }
    return parsed as NativeGatewayState;
  } catch {
    return null;
  }
}

function writeNativeGatewayState(statePath: string, state: NativeGatewayState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function updateNativeGatewayState(statePath: string, update: Partial<NativeGatewayState>): void {
  if (!statePath) {
    return;
  }
  const previous = readNativeGatewayState(statePath);
  const next = {
    ...buildNativeGatewayState({}, previous),
    ...update,
  };
  writeNativeGatewayState(statePath, next);
}

function readNativeGatewayPid(pidPath: string): number | null {
  try {
    const value = Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Ignore missing files and permission races during status cleanup.
  }
}

function nativeGatewayBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}

function normalizeNativeGatewayPort(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value > 0 && value <= 65535) {
      return value;
    }
    throw new Error(`Native gateway port must be an integer between 1 and 65535. Received: ${value}`);
  }
  const normalized = normalizeString(value);
  if (!normalized) {
    return DEFAULT_NATIVE_GATEWAY_PORT;
  }
  const port = Number.parseInt(normalized, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Native gateway port must be an integer between 1 and 65535. Received: ${normalized}`);
  }
  return port;
}

function normalizePathOption(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized ? path.resolve(normalized) : null;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return normalizeString(value) || 'none';
  }
}

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/gu, '-');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
