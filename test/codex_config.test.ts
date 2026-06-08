import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCodexProviderCliArgs,
  buildCodexProviderConfig,
  buildCodexProviderTomlFragment,
  codexBaseUrlForProviderProtocol,
  localResponsesProxyBaseUrl,
  normalizeProviderLabel,
} from '../src/index.js';

test('builds Codex auth compatible provider config by default', () => {
  const config = buildCodexProviderConfig({
    providerLabel: 'Codex++ Adapter',
    providerName: 'Codex++ Adapter',
    upstreamBaseUrl: 'http://127.0.0.1:57321/v1/',
    defaultModel: 'deepseek-coder',
    experimentalBearerToken: 'sk-test',
  });

  assert.equal(config.providerLabel, 'Codex_Adapter');
  assert.equal(config.authMode, 'codex-auth-compatible');
  assert.equal(config.toolStrategy, 'codex-local-first');
  assert.deepEqual(config.entries, [
    { key: 'model', value: 'deepseek-coder' },
    { key: 'model_provider', value: 'Codex_Adapter' },
    { key: 'model_providers.Codex_Adapter.name', value: 'Codex++ Adapter' },
    { key: 'model_providers.Codex_Adapter.base_url', value: 'http://127.0.0.1:57321/v1' },
    { key: 'model_providers.Codex_Adapter.wire_api', value: 'responses' },
    { key: 'model_providers.Codex_Adapter.requires_openai_auth', value: true },
    { key: 'model_providers.Codex_Adapter.supports_websockets', value: false },
    { key: 'model_providers.Codex_Adapter.experimental_bearer_token', value: 'sk-test' },
  ]);
});

test('builds api-key compatible fallback config', () => {
  const toml = buildCodexProviderTomlFragment({
    providerLabel: 'openrouter',
    upstreamBaseUrl: 'http://127.0.0.1:41000/v1',
    defaultModel: 'openrouter/deepseek/deepseek-chat',
    authMode: 'api-key-compatible',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  });

  assert.equal(toml, [
    'model = "openrouter/deepseek/deepseek-chat"',
    'model_provider = "openrouter"',
    '',
    '[model_providers.openrouter]',
    'name = "Codex Provider"',
    'base_url = "http://127.0.0.1:41000/v1"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    'supports_websockets = false',
    'env_key = "OPENROUTER_API_KEY"',
    '',
  ].join('\n'));
});

test('builds Codex++ style config for Chat Completions upstreams through the local Responses proxy', () => {
  const config = buildCodexProviderConfig({
    providerLabel: 'deepseek',
    providerName: 'DeepSeek via Adapter',
    upstreamBaseUrl: 'https://api.deepseek.com/v1/',
    providerProtocol: 'chat-completions',
    protocolProxyPort: 57322,
    defaultModel: 'deepseek-coder',
    experimentalBearerToken: 'sk-chat',
  });

  assert.equal(config.providerProtocol, 'chat-completions');
  assert.equal(config.upstreamBaseUrl, 'https://api.deepseek.com/v1');
  assert.equal(config.codexBaseUrl, 'http://127.0.0.1:57322/v1');
  assert.equal(config.protocolProxyPort, 57322);
  assert.ok(config.entries.some((entry) =>
    entry.key === 'model_providers.deepseek.base_url'
      && entry.value === 'http://127.0.0.1:57322/v1',
  ));
  assert.ok(config.entries.some((entry) =>
    entry.key === 'model_providers.deepseek.requires_openai_auth'
      && entry.value === true,
  ));
  assert.ok(config.entries.some((entry) =>
    entry.key === 'model_providers.deepseek.experimental_bearer_token'
      && entry.value === 'sk-chat',
  ));
});

test('builds CLI -c args from config entries', () => {
  const args = buildCodexProviderCliArgs({
    providerLabel: 'adapter',
    upstreamBaseUrl: 'http://127.0.0.1:57321/v1',
    defaultModel: 'gpt-5.4',
    extraProviderFields: {
      custom_field: 'enabled',
      priority: 3,
    },
  });

  assert.deepEqual(args.slice(0, 6), [
    '-c',
    'model="gpt-5.4"',
    '-c',
    'model_provider="adapter"',
    '-c',
    'model_providers.adapter.name="Codex Provider"',
  ]);
  assert.ok(args.includes('model_providers.adapter.requires_openai_auth=true'));
  assert.ok(args.includes('model_providers.adapter.custom_field="enabled"'));
  assert.ok(args.includes('model_providers.adapter.priority=3'));
});

test('normalizes provider labels for TOML path usage', () => {
  assert.equal(normalizeProviderLabel('123 deep seek'), 'provider_123_deep_seek');
  assert.equal(normalizeProviderLabel('deep-seek_v3'), 'deep-seek_v3');
});

test('resolves Codex provider base URLs from upstream adapter protocol', () => {
  assert.equal(
    codexBaseUrlForProviderProtocol({
      upstreamBaseUrl: 'https://api.example.com/v1/',
      providerProtocol: 'responses',
    }),
    'https://api.example.com/v1',
  );
  assert.equal(
    codexBaseUrlForProviderProtocol({
      upstreamBaseUrl: 'https://api.example.com/v1',
      providerProtocol: 'chat-completions',
      protocolProxyPort: 58001,
    }),
    'http://127.0.0.1:58001/v1',
  );
  assert.equal(localResponsesProxyBaseUrl(), 'http://127.0.0.1:57321/v1');
  assert.throws(() => localResponsesProxyBaseUrl(0), /proxy port/u);
});
