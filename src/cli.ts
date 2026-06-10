#!/usr/bin/env node

import {
  createCodexProviderStandaloneServerFromEnv,
  resolveCodexProviderStandaloneServerEnv,
} from './server/standalone_server.js';

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const env = resolveCodexProviderStandaloneServerEnv({
    env: {
      ...process.env,
      ...(args.trace ? { CODEX_PROVIDER_TRACE: '1' } : {}),
    },
    envFilePath: args.envFilePath,
  });
  const { config, server } = createCodexProviderStandaloneServerFromEnv(env);
  await server.start();

  writeStdoutLine('Codex Provider standalone server started.');
  writeStdoutLine(`Provider preset: ${config.presetId}`);
  writeStdoutLine(`Provider: ${config.providerName} (${config.providerKind})`);
  writeStdoutLine(`Upstream base URL: ${config.upstreamBaseUrl}`);
  writeStdoutLine(`Default model: ${config.defaultModel}`);
  writeStdoutLine(`Local base URL: ${server.baseUrl}`);
  writeStdoutLine(`Model catalog source: ${config.modelCatalogSource}`);
  writeStdoutLine(`Trace mode: ${config.traceMode}`);
  if (args.envFilePath || env.CODEX_PROVIDER_ENV_FILE) {
    writeStdoutLine(`Env file: ${args.envFilePath ?? env.CODEX_PROVIDER_ENV_FILE}`);
  }
  writeStdoutLine('Routes: GET /models (alias /v1/models), POST /responses (alias /v1/responses), POST /responses/compact (alias /v1/responses/compact)');
  writeStdoutLine('Press Ctrl+C to stop.');

  const shutdown = async (signal: string) => {
    writeStdoutLine(`Received ${signal}, stopping Codex Provider standalone server...`);
    await server.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function parseCliArgs(argv: string[]): {
  envFilePath: string | null;
  help: boolean;
  trace: boolean;
} {
  let envFilePath: string | null = null;
  let help = false;
  let trace = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    if (arg === '--env-file') {
      const next = argv[index + 1];
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
    throw new Error(`Unknown codex-provider-server argument: ${arg}`);
  }

  return { envFilePath, help, trace };
}

function printHelp(): void {
  writeStdoutLine([
    'Usage: codex-provider-server [--env-file <path>] [--trace]',
    '',
    'Internal-only launcher for the Codex Provider local Responses adapter server.',
    '',
    'Options:',
    '  --env-file <path>  Load dotenv-style defaults before resolving provider env',
    '  --trace            Emit structured trace events to stderr as NDJSON',
    '  -h, --help         Show this help message',
  ].join('\n'));
}

function writeStdoutLine(message: string): void {
  process.stdout.write(`${message}\n`);
}
