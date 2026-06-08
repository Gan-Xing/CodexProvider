import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodexProviderRuntime,
  type CodexProviderAdapterServerOptions,
} from '../src/index.js';

test('CodexProviderRuntime starts a local Responses adapter and returns Codex launch config', async () => {
  const receivedOptions: CodexProviderAdapterServerOptions[] = [];
  let started = 0;
  let stopped = 0;
  const runtime = new CodexProviderRuntime({
    apiKey: 'sk-upstream',
    upstreamBaseUrl: 'https://api.deepseek.com/v1/',
    defaultModel: 'deepseek-coder',
    providerLabel: 'deepseek',
    providerName: 'DeepSeek',
    authMode: 'codex-auth-compatible',
    adapterOptions: {
      adapterPrivateModelList: [{ id: 'deepseek-coder', model: 'deepseek-coder' }],
      adapterPrivateProviderKind: 'deepseek',
      adapterPrivateFeatureFlags: { supportsBuiltinWebSearchTool: true },
      adapterPrivatePath: '/chat/completions',
    },
    adapterServerFactory: (options) => {
      receivedOptions.push(options);
      return {
        baseUrl: 'http://127.0.0.1:57321',
        async start() {
          started += 1;
        },
        async stop() {
          stopped += 1;
        },
      };
    },
  });

  const state = await runtime.start();
  const secondStart = await runtime.start();

  assert.equal(started, 1);
  assert.equal(stopped, 0);
  assert.equal(secondStart, state);
  assert.equal(runtime.isStarted(), true);
  assert.equal(state.adapterBaseUrl, 'http://127.0.0.1:57321/v1');
  assert.equal(state.codexBaseUrl, 'http://127.0.0.1:57321/v1');
  assert.equal(state.profile.mode, 'mixed');
  assert.equal(state.profile.authMode, 'codex-auth-compatible');
  assert.ok(state.codexCliArgs.includes('model_providers.deepseek.requires_openai_auth=true'));
  assert.ok(state.codexCliArgs.includes('model_providers.deepseek.experimental_bearer_token="sk-upstream"'));
  assert.deepEqual(receivedOptions[0], {
    adapterPrivateModelList: [{ id: 'deepseek-coder', model: 'deepseek-coder' }],
    adapterPrivateProviderKind: 'deepseek',
    adapterPrivateFeatureFlags: { supportsBuiltinWebSearchTool: true },
    adapterPrivatePath: '/chat/completions',
    apiKey: 'sk-upstream',
    upstreamBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-coder',
    host: undefined,
    port: undefined,
  });

  await runtime.stop();
  assert.equal(stopped, 1);
  assert.equal(runtime.isStarted(), false);
  assert.equal(runtime.state, null);
});

test('CodexProviderRuntime preserves api-key compatible Codex config for existing adapters', async () => {
  const runtime = new CodexProviderRuntime({
    apiKey: 'sk-upstream',
    upstreamBaseUrl: 'https://example.com/v1',
    defaultModel: 'example-model',
    providerLabel: 'example_provider',
    providerName: 'Example Provider',
    authMode: 'api-key-compatible',
    apiKeyEnv: 'EXAMPLE_API_KEY',
    adapterServerFactory: () => ({
      baseUrl: 'http://127.0.0.1:4321',
      async start() {},
      async stop() {},
    }),
  });

  const state = await runtime.start();

  assert.equal(state.profile.mode, 'pure-api');
  assert.equal(state.profile.authMode, 'api-key-compatible');
  assert.ok(state.codexCliArgs.includes('model_providers.example_provider.base_url="http://127.0.0.1:4321/v1"'));
  assert.ok(state.codexCliArgs.includes('model_providers.example_provider.requires_openai_auth=false'));
  assert.ok(state.codexCliArgs.includes('model_providers.example_provider.env_key="EXAMPLE_API_KEY"'));
  assert.equal(state.codexCliArgs.some((entry) => entry.includes('experimental_bearer_token')), false);
});

test('CodexProviderRuntime uses explicit profile mode and hosted tool declarations', async () => {
  const runtime = new CodexProviderRuntime({
    apiKey: 'sk-upstream',
    upstreamBaseUrl: 'https://example.com/v1',
    defaultModel: 'example-model',
    providerLabel: 'example_provider',
    profileMode: 'mixed',
    authMode: 'api-key-compatible',
    toolStrategy: 'adapter-emulated',
    hostedTools: [{
      name: 'web_search',
      mode: 'adapter-emulated',
      emulatedToolName: 'mcp_web_search',
    }],
    adapterServerFactory: () => ({
      baseUrl: 'http://127.0.0.1:4322',
      async start() {},
      async stop() {},
    }),
  });

  const state = await runtime.start();

  assert.equal(state.profile.mode, 'mixed');
  assert.equal(state.profile.authMode, 'codex-auth-compatible');
  assert.equal(state.profile.toolStrategy, 'adapter-emulated');
  assert.deepEqual(state.profile.hostedTools, [{
    name: 'web_search',
    mode: 'adapter-emulated',
    providerToolName: null,
    emulatedToolName: 'mcp_web_search',
    description: null,
  }]);
  assert.ok(state.codexCliArgs.includes('model_providers.example_provider.requires_openai_auth=true'));
  assert.ok(state.codexCliArgs.includes('model_providers.example_provider.experimental_bearer_token="sk-upstream"'));
});

test('CodexProviderRuntime points official profiles directly at the upstream Responses API', async () => {
  let factoryCalled = false;
  const runtime = new CodexProviderRuntime({
    apiKey: '',
    upstreamBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    providerLabel: 'openai',
    profileMode: 'official',
    adapterServerFactory: () => {
      factoryCalled = true;
      throw new Error('official profile must not start a local adapter');
    },
  });

  const state = await runtime.start();

  assert.equal(factoryCalled, false);
  assert.equal(state.adapterBaseUrl, null);
  assert.equal(state.profile.mode, 'official');
  assert.equal(state.profile.providerProtocol, 'responses');
  assert.equal(state.profile.needsLocalResponsesAdapter, false);
  assert.equal(state.codexBaseUrl, 'https://api.openai.com/v1');
  assert.ok(state.codexCliArgs.includes('model_providers.openai.base_url="https://api.openai.com/v1"'));
});

test('CodexProviderRuntime starts the built-in local adapter without a custom factory', async () => {
  const runtime = new CodexProviderRuntime({
    apiKey: 'sk-upstream',
    upstreamBaseUrl: 'https://example.com/v1',
    defaultModel: 'example-model',
    providerLabel: 'example',
    profileMode: 'pure-api',
    adapterHost: '127.0.0.1',
    adapterPort: 0,
    adapterOptions: {
      fetchImpl: async () => new Response('{}'),
    },
  });

  const state = await runtime.start();

  assert.match(state.adapterBaseUrl ?? '', /^http:\/\/127\.0\.0\.1:\d+\/v1$/u);
  assert.equal(state.profile.mode, 'pure-api');
  assert.equal(state.profile.needsLocalResponsesAdapter, true);
  assert.equal(state.codexBaseUrl, state.adapterBaseUrl);
  await runtime.stop();
  assert.equal(runtime.isStarted(), false);
});

test('CodexProviderRuntime validates adapter inputs before creating a server', async () => {
  let factoryCalled = false;
  const runtime = new CodexProviderRuntime({
    apiKey: '',
    upstreamBaseUrl: 'https://example.com/v1',
    defaultModel: 'example-model',
    providerLabel: 'example',
    adapterServerFactory: () => {
      factoryCalled = true;
      return {
        baseUrl: 'http://127.0.0.1:4321',
        async start() {},
        async stop() {},
      };
    },
  });

  await assert.rejects(() => runtime.start(), /requires an upstream API key/u);
  assert.equal(factoryCalled, false);
});
