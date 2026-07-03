#!/usr/bin/env node

import {
  createCodexProviderStandaloneServerFromEnv,
  resolveCodexProviderStandaloneServerEnv,
} from './server/standalone_server.js';
import {
  createNativeGatewayServerFromEnv,
  formatNativeGatewayStatus,
  getNativeGatewayStatus,
  setupNativeGateway,
  startNativeGateway,
  stopNativeGateway,
  updateNativeGatewayRuntimeState,
} from './native_gateway.js';

type CliCommand = 'serve' | 'setup' | 'start' | 'status' | 'stop';

interface CliArgs {
  command: CliCommand;
  explicitCommand: boolean;
  envFilePath: string | null;
  help: boolean;
  trace: boolean;
  provider: string | null;
  model: string | null;
  port: string | null;
  setDefault: boolean;
  workspacePath: string | null;
  fileSearchRootPath: string | null;
  imageProvider: string | null;
  codeSandbox: string | null;
  computerAdapter: string | null;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.command === 'setup') {
    runSetup(args);
    return;
  }

  if (args.command === 'start') {
    await runStart(args);
    return;
  }

  if (args.command === 'status') {
    runStatus();
    return;
  }

  if (args.command === 'stop') {
    runStop();
    return;
  }

  await runServe(args);
}

async function runServe(args: CliArgs): Promise<void> {
  const env = resolveCodexProviderStandaloneServerEnv({
    env: {
      ...process.env,
      ...(args.provider ? { CODEX_PROVIDER_CAPABILITY_PRESET: args.provider } : {}),
      ...(args.model ? { CODEX_PROVIDER_MODEL: args.model } : {}),
      ...(args.port ? { CODEX_PROVIDER_PORT: args.port } : {}),
      ...(args.workspacePath ? { CODEX_PROVIDER_WORKSPACE: args.workspacePath } : {}),
      ...(args.fileSearchRootPath ? { CODEX_PROVIDER_FILE_SEARCH_ROOT: args.fileSearchRootPath } : {}),
      ...(args.trace ? { CODEX_PROVIDER_TRACE: '1' } : {}),
    },
    envFilePath: args.envFilePath,
  });
  const isNativeGatewayServe = Boolean(env.CODEX_PROVIDER_NATIVE_GATEWAY_STATE_FILE);
  const { config, server } = isNativeGatewayServe
    ? createNativeGatewayServerFromEnv(env)
    : createCodexProviderStandaloneServerFromEnv(env);
  await server.start();
  if (isNativeGatewayServe && env.CODEX_PROVIDER_NATIVE_GATEWAY_STATE_FILE) {
    updateNativeGatewayRuntimeState(env.CODEX_PROVIDER_NATIVE_GATEWAY_STATE_FILE, {
      pid: process.pid,
      baseUrl: responsesBaseUrl(server.baseUrl),
      startedAt: new Date().toISOString(),
    });
  }

  writeStdoutLine(isNativeGatewayServe
    ? 'Codex Provider native gateway server started.'
    : 'Codex Provider standalone server started.');
  writeStdoutLine(`Provider preset: ${config.presetId}`);
  writeStdoutLine(`Provider: ${config.providerName} (${config.providerKind})`);
  writeStdoutLine(`Upstream base URL: ${config.upstreamBaseUrl}`);
  writeStdoutLine(`Default model: ${config.defaultModel}`);
  writeStdoutLine(`Local base URL: ${isNativeGatewayServe ? responsesBaseUrl(server.baseUrl) : server.baseUrl}`);
  writeStdoutLine(`Model catalog source: ${config.modelCatalogSource}`);
  writeStdoutLine(`Trace mode: ${config.traceMode}`);
  if (args.envFilePath || env.CODEX_PROVIDER_ENV_FILE) {
    writeStdoutLine(`Env file: ${args.envFilePath ?? env.CODEX_PROVIDER_ENV_FILE}`);
  }
  writeStdoutLine('Routes: GET /models (alias /v1/models), POST /responses (alias /v1/responses), POST /responses/compact (alias /v1/responses/compact)');
  writeStdoutLine('Press Ctrl+C to stop.');

  const shutdown = async (signal: string) => {
    writeStdoutLine(`Received ${signal}, stopping Codex Provider ${isNativeGatewayServe ? 'native gateway' : 'standalone'} server...`);
    await server.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
}

function runSetup(args: CliArgs): void {
  const result = setupNativeGateway({
    provider: args.provider,
    model: args.model,
    port: args.port,
    setDefault: args.setDefault,
    envFilePath: args.envFilePath,
    trace: args.trace,
    workspacePath: args.workspacePath,
    fileSearchRootPath: args.fileSearchRootPath,
    imageProvider: args.imageProvider,
    codeSandbox: args.codeSandbox,
    computerAdapter: args.computerAdapter,
  });
  writeStdoutLine('Codex Provider native gateway setup complete.');
  writeStdoutLine(`Config: ${result.paths.codexConfigPath}`);
  writeStdoutLine(`Backup: ${result.backupPath ?? 'none'}`);
  writeStdoutLine(`Provider: ${result.state.provider}`);
  writeStdoutLine(`Model: ${result.state.model}`);
  writeStdoutLine(`Base URL: ${result.state.baseUrl}`);
  writeStdoutLine('Next: codex-provider-server start');
}

async function runStart(args: CliArgs): Promise<void> {
  const result = startNativeGateway({
    cliPath: process.argv[1],
    provider: args.provider,
    model: args.model,
    port: args.port,
    envFilePath: args.envFilePath,
    trace: args.trace,
    workspacePath: args.workspacePath,
    fileSearchRootPath: args.fileSearchRootPath,
    imageProvider: args.imageProvider,
    codeSandbox: args.codeSandbox,
    computerAdapter: args.computerAdapter,
    env: process.env,
  });
  if (!result.alreadyRunning) {
    await delay(750);
    const status = getNativeGatewayStatus();
    if (!status.running) {
      throw new Error(`Codex Provider native gateway exited during startup. Inspect log: ${result.paths.logPath}`);
    }
  }
  writeStdoutLine(result.alreadyRunning
    ? 'Codex Provider native gateway is already running.'
    : 'Codex Provider native gateway started.');
  writeStdoutLine(`PID: ${result.pid}`);
  writeStdoutLine(`Base URL: ${result.state.baseUrl}`);
  writeStdoutLine(`Log: ${result.paths.logPath}`);
}

function runStatus(): void {
  writeStdoutLine(formatNativeGatewayStatus(getNativeGatewayStatus()));
}

function runStop(): void {
  const result = stopNativeGateway();
  if (result.stale) {
    writeStdoutLine(`Removed stale native gateway pid: ${result.pid}`);
    return;
  }
  if (result.stopped) {
    writeStdoutLine(`Stopped Codex Provider native gateway pid: ${result.pid}`);
    return;
  }
  writeStdoutLine('Codex Provider native gateway is not running.');
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function parseCliArgs(argv: string[]): {
  command: CliCommand;
  explicitCommand: boolean;
  envFilePath: string | null;
  help: boolean;
  trace: boolean;
  provider: string | null;
  model: string | null;
  port: string | null;
  setDefault: boolean;
  workspacePath: string | null;
  fileSearchRootPath: string | null;
  imageProvider: string | null;
  codeSandbox: string | null;
  computerAdapter: string | null;
} {
  const first = argv[0];
  const explicitCommand = isCliCommand(first);
  const command = explicitCommand ? first as CliCommand : 'serve';
  const optionArgv = explicitCommand ? argv.slice(1) : argv;
  let envFilePath: string | null = null;
  let help = false;
  let trace = false;
  let provider: string | null = null;
  let model: string | null = null;
  let port: string | null = null;
  let setDefault = false;
  let workspacePath: string | null = null;
  let fileSearchRootPath: string | null = null;
  let imageProvider: string | null = null;
  let codeSandbox: string | null = null;
  let computerAdapter: string | null = null;

  for (let index = 0; index < optionArgv.length; index += 1) {
    const arg = optionArgv[index];
    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    if (arg === '--env-file') {
      const next = optionArgv[index + 1];
      if (!next) {
        throw new Error('--env-file requires a path argument.');
      }
      envFilePath = next;
      index += 1;
      continue;
    }
    if (arg === '--trace') {
      trace = true;
      continue;
    }
    if (arg === '--provider') {
      provider = requireNextArg(optionArgv, index, '--provider');
      index += 1;
      continue;
    }
    if (arg === '--model') {
      model = requireNextArg(optionArgv, index, '--model');
      index += 1;
      continue;
    }
    if (arg === '--port') {
      port = requireNextArg(optionArgv, index, '--port');
      index += 1;
      continue;
    }
    if (arg === '--set-default') {
      setDefault = true;
      continue;
    }
    if (arg === '--workspace') {
      workspacePath = requireNextArg(optionArgv, index, '--workspace');
      index += 1;
      continue;
    }
    if (arg === '--file-search-root') {
      fileSearchRootPath = requireNextArg(optionArgv, index, '--file-search-root');
      index += 1;
      continue;
    }
    if (arg === '--image-provider') {
      imageProvider = requireNextArg(optionArgv, index, '--image-provider');
      index += 1;
      continue;
    }
    if (arg === '--code-sandbox') {
      codeSandbox = requireNextArg(optionArgv, index, '--code-sandbox');
      index += 1;
      continue;
    }
    if (arg === '--computer-adapter') {
      computerAdapter = requireNextArg(optionArgv, index, '--computer-adapter');
      index += 1;
      continue;
    }
    throw new Error(`Unknown codex-provider-server argument: ${arg}`);
  }

  return {
    command,
    explicitCommand,
    envFilePath,
    help,
    trace,
    provider,
    model,
    port,
    setDefault,
    workspacePath,
    fileSearchRootPath,
    imageProvider,
    codeSandbox,
    computerAdapter,
  };
}

function printHelp(): void {
  writeStdoutLine([
    'Usage: codex-provider-server [serve] [--env-file <path>] [--trace]',
    '       codex-provider-server setup [--provider <preset>] [--model <model>] [--port <port>] [--set-default]',
    '       codex-provider-server start [--trace]',
    '       codex-provider-server status',
    '       codex-provider-server stop',
    '',
    'Codex Provider local Responses adapter server and native gateway manager.',
    '',
    'Commands:',
    '  serve             Explicit alias for the existing standalone server behavior',
    '  setup             Safely write the managed Codex native gateway config block',
    '  start             Start the native gateway in the background',
    '  status            Show gateway pid, provider, model, tools, and last request',
    '  stop              Stop the native gateway or clean stale pid state',
    '',
    'Options:',
    '  --env-file <path>  Load dotenv-style defaults before resolving provider env',
    '  --provider <id>    Provider preset such as openrouter, deepseek, qwen, kimi',
    '  --model <model>    Default upstream model',
    '  --port <port>      Local native gateway port; default 47321',
    '  --set-default      Make Codex root defaults point at the native gateway',
    '  --workspace <path> Scope file_search to a workspace root',
    '  --file-search-root <path>  Explicit file_search root',
    '  --image-provider <provider>  Mark image_generation provider readiness',
    '  --code-sandbox <adapter>     Mark code_interpreter sandbox readiness',
    '  --computer-adapter <adapter> Mark computer adapter readiness',
    '  --trace            Emit structured trace events to stderr as NDJSON',
    '  -h, --help         Show this help message',
  ].join('\n'));
}

function isCliCommand(value: string | undefined): value is CliCommand {
  return value === 'serve'
    || value === 'setup'
    || value === 'start'
    || value === 'status'
    || value === 'stop';
}

function requireNextArg(argv: string[], index: number, flag: string): string {
  const next = argv[index + 1];
  if (!next) {
    throw new Error(`${flag} requires an argument.`);
  }
  return next;
}

function responsesBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/v1`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function writeStdoutLine(message: string): void {
  process.stdout.write(`${message}\n`);
}
