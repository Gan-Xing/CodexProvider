import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildNativeGatewayAdapterOptionsFromEnv,
  formatNativeGatewayStatus,
  getNativeGatewayStatus,
  NATIVE_GATEWAY_MANAGED_BLOCK_END,
  NATIVE_GATEWAY_MANAGED_BLOCK_START,
  resolveNativeGatewayPaths,
  setupNativeGateway,
  stopNativeGateway,
} from '../src/native_gateway.js';
import {
  responsesRequestToChatCompletions,
} from '../src/converters/responses-adapter/index.js';

test('native gateway setup writes only the managed Codex config block and creates a backup', () => {
  const homeDir = makeTempHome();
  const paths = resolveNativeGatewayPaths(homeDir);
  fs.mkdirSync(paths.codexDir, { recursive: true });
  fs.writeFileSync(paths.codexConfigPath, [
    'approval_policy = "on-request"',
    '',
    '[profiles.default]',
    'sandbox_mode = "workspace-write"',
    '',
  ].join('\n'), 'utf8');

  const result = setupNativeGateway({
    homeDir,
    provider: 'openrouter',
    model: 'deepseek/deepseek-chat',
    now: new Date('2026-07-02T00:00:00.000Z'),
  });

  const config = fs.readFileSync(paths.codexConfigPath, 'utf8');
  assert.equal(result.backupPath?.endsWith('config.toml.codex-provider-backup-2026-07-02T00-00-00-000Z'), true);
  assert.equal(fs.readFileSync(result.backupPath ?? '', 'utf8').includes('approval_policy = "on-request"'), true);
  assert.match(config, /approval_policy = "on-request"/u);
  assert.match(config, /\[profiles\.default\]/u);
  assert.match(config, new RegExp(NATIVE_GATEWAY_MANAGED_BLOCK_START, 'u'));
  assert.match(config, /base_url = "http:\/\/127\.0\.0\.1:47321\/v1"/u);
  assert.doesNotMatch(config, /^model_provider =/mu);
  assert.doesNotMatch(config, /^model = "deepseek\/deepseek-chat"/mu);
});

test('native gateway setup replaces only its previous managed block on repeat runs', () => {
  const homeDir = makeTempHome();
  setupNativeGateway({
    homeDir,
    provider: 'openrouter',
    model: 'deepseek/deepseek-chat',
    now: new Date('2026-07-02T00:00:00.000Z'),
  });
  setupNativeGateway({
    homeDir,
    provider: 'deepseek',
    model: 'deepseek-chat',
    port: 49999,
    now: new Date('2026-07-02T00:00:01.000Z'),
  });

  const config = fs.readFileSync(resolveNativeGatewayPaths(homeDir).codexConfigPath, 'utf8');
  assert.equal(matchCount(config, NATIVE_GATEWAY_MANAGED_BLOCK_START), 1);
  assert.equal(matchCount(config, NATIVE_GATEWAY_MANAGED_BLOCK_END), 1);
  assert.match(config, /base_url = "http:\/\/127\.0\.0\.1:49999\/v1"/u);
  assert.doesNotMatch(config, /deepseek\/deepseek-chat/u);
});

test('native gateway setup writes root defaults only when requested', () => {
  const homeDir = makeTempHome();
  const paths = resolveNativeGatewayPaths(homeDir);
  fs.mkdirSync(paths.codexDir, { recursive: true });
  fs.writeFileSync(paths.codexConfigPath, [
    'model = "old-model"',
    '',
    '[profiles.default]',
    'model = "profile-model"',
    '',
  ].join('\n'), 'utf8');

  setupNativeGateway({
    homeDir,
    provider: 'openrouter',
    model: 'deepseek/deepseek-chat',
    setDefault: true,
    now: new Date('2026-07-02T00:00:00.000Z'),
  });

  const config = fs.readFileSync(paths.codexConfigPath, 'utf8');
  assert.match(config, /^model_provider = "codex_provider_gateway"$/mu);
  assert.match(config, /^model = "deepseek\/deepseek-chat"$/mu);
  assert.match(config, /\[profiles\.default\]\nmodel = "profile-model"/u);
  assert.equal(config.indexOf('model_provider = "codex_provider_gateway"') < config.indexOf('[profiles.default]'), true);
});

test('native gateway status redacts upstream credentials and reports delegated tools', () => {
  const homeDir = makeTempHome();
  setupNativeGateway({
    homeDir,
    provider: 'openrouter',
    model: 'deepseek/deepseek-chat',
    fileSearchRootPath: homeDir,
  });
  const paths = resolveNativeGatewayPaths(homeDir);
  const state = JSON.parse(fs.readFileSync(paths.statePath, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(paths.statePath, `${JSON.stringify({
    ...state,
    upstreamBaseUrl: 'https://user:secret@api.example.test/v1?api_key=secret',
    pid: 99999999,
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(paths.pidPath, '99999999\n', 'utf8');

  const formatted = formatNativeGatewayStatus(getNativeGatewayStatus({ homeDir }));
  assert.match(formatted, /running: false/u);
  assert.match(formatted, /upstream_base_url: https:\/\/api\.example\.test\/v1/u);
  assert.doesNotMatch(formatted, /secret/u);
  assert.match(formatted, /file_search: ready/u);
  assert.match(formatted, /apply_patch: delegated-to-codex/u);
  assert.match(formatted, /shell: delegated-to-codex/u);
});

test('native gateway stop removes stale pid state', () => {
  const homeDir = makeTempHome();
  setupNativeGateway({ homeDir });
  const paths = resolveNativeGatewayPaths(homeDir);
  fs.writeFileSync(paths.pidPath, '99999999\n', 'utf8');

  const result = stopNativeGateway({ homeDir });
  assert.equal(result.stale, true);
  assert.equal(result.stopped, false);
  assert.equal(fs.existsSync(paths.pidPath), false);
});

test('native gateway adapter options expose implemented tools by default and require explicit file roots', () => {
  const withoutRoot = buildNativeGatewayAdapterOptionsFromEnv({});
  assert.deepEqual(withoutRoot.hostedTools.map((tool) => tool.name).sort(), ['tool_search', 'web_search']);
  assert.equal(typeof (withoutRoot.hostedToolExecutors as Record<string, unknown>).web_search, 'function');
  assert.equal(typeof (withoutRoot.hostedToolExecutors as Record<string, unknown>).tool_search, 'function');
  assert.deepEqual(withoutRoot.toolCatalogPolicy, {
    namespaceStrategy: 'drop',
    maxForwardedTools: 64,
  });

  const homeDir = makeTempHome();
  const withRoot = buildNativeGatewayAdapterOptionsFromEnv({
    CODEX_PROVIDER_FILE_SEARCH_ROOT: homeDir,
  });
  assert.deepEqual(withRoot.hostedTools.map((tool) => tool.name).sort(), ['file_search', 'tool_search', 'web_search']);
  assert.equal(typeof (withRoot.hostedToolExecutors as Record<string, unknown>).file_search, 'function');
});

test('native gateway tool catalog policy does not expand Codex App namespace tools into the upstream prompt', () => {
  const adapterOptions = buildNativeGatewayAdapterOptionsFromEnv({});
  const chat = responsesRequestToChatCompletions({
    model: 'deepseek/deepseek-chat',
    input: 'hello',
    tools: [
      {
        type: 'function',
        name: 'exec_command',
        description: 'Run a command.',
        parameters: {
          type: 'object',
          properties: {
            cmd: { type: 'string' },
          },
          required: ['cmd'],
          additionalProperties: false,
        },
      },
      {
        type: 'namespace',
        name: 'mcp__large_catalog',
        tools: Array.from({ length: 120 }, (_, index) => ({
          type: 'function',
          name: `tool_${index}`,
          description: `Large tool ${index}`,
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string' },
            },
            required: ['input'],
          },
        })),
      },
      {
        type: 'web_search',
      },
    ],
  }, {
    hostedTools: adapterOptions.hostedTools,
    toolCatalogPolicy: adapterOptions.toolCatalogPolicy,
  });

  assert.deepEqual(
    chat.tools.map((tool: any) => tool.function.name),
    ['exec_command', 'web_search'],
  );
});

function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-provider-native-gateway-'));
}

function matchCount(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}
