import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authModeForProfileMode,
  buildCodexProviderProfile,
  codexBaseUrlForProfile,
  createCodexProviderDashScopeQwenProfile,
  createCodexProviderDeepSeekProfile,
  createCodexProviderMiniMaxProfile,
  createCodexProviderMoonshotKimiProfile,
  createCodexProviderOpenRouterProfile,
  createCodexProviderSiliconFlowProfile,
  defaultProtocolForProfileMode,
  resolveCodexProviderProviderPresetCatalog,
  resolveCodexProviderProviderPreset,
} from '../src/index.js';

test('official profile points Codex directly at a Responses-compatible upstream', () => {
  const profile = buildCodexProviderProfile({
    mode: 'official',
    providerLabel: 'openai official',
    upstreamBaseUrl: 'https://api.openai.com/v1/',
    defaultModel: 'gpt-5.4',
    supportsWebsockets: true,
  });

  assert.equal(profile.mode, 'official');
  assert.equal(profile.providerLabel, 'openai_official');
  assert.equal(profile.providerProtocol, 'responses');
  assert.equal(profile.authMode, 'codex-auth-compatible');
  assert.equal(profile.upstreamBaseUrl, 'https://api.openai.com/v1');
  assert.equal(profile.codexBaseUrl, 'https://api.openai.com/v1');
  assert.equal(profile.needsLocalResponsesAdapter, false);
  assert.deepEqual(profile.hostedTools, []);
  assert.ok(profile.codexCliArgs.includes('model_providers.openai_official.requires_openai_auth=true'));
  assert.ok(profile.codexCliArgs.includes('model_providers.openai_official.supports_websockets=true'));
});

test('mixed profile uses a local Responses adapter while keeping Codex auth compatibility', () => {
  const profile = buildCodexProviderProfile({
    mode: 'mixed',
    providerLabel: 'deepseek',
    providerName: 'DeepSeek Mixed Adapter',
    upstreamBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-pro',
    experimentalBearerToken: 'sk-upstream',
    protocolProxyPort: 58011,
  });

  assert.equal(profile.mode, 'mixed');
  assert.equal(profile.providerName, 'DeepSeek Mixed Adapter');
  assert.equal(profile.providerProtocol, 'chat-completions');
  assert.equal(profile.authMode, 'codex-auth-compatible');
  assert.equal(profile.codexBaseUrl, 'http://127.0.0.1:58011/v1');
  assert.equal(profile.needsLocalResponsesAdapter, true);
  assert.deepEqual(profile.hostedTools, []);
  assert.ok(profile.codexCliArgs.includes('model_providers.deepseek.requires_openai_auth=true'));
  assert.ok(profile.codexCliArgs.includes('model_providers.deepseek.experimental_bearer_token="sk-upstream"'));
});

test('pure-api profile uses env-key auth through the local Responses adapter', () => {
  const profile = buildCodexProviderProfile({
    mode: 'pure-api',
    providerLabel: 'openrouter',
    upstreamBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-3.1-pro-preview',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    protocolProxyPort: 58012,
  });

  assert.equal(profile.mode, 'pure-api');
  assert.equal(profile.providerProtocol, 'chat-completions');
  assert.equal(profile.authMode, 'api-key-compatible');
  assert.equal(profile.toolStrategy, 'codex-local-first');
  assert.equal(profile.codexBaseUrl, 'http://127.0.0.1:58012/v1');
  assert.equal(profile.needsLocalResponsesAdapter, true);
  assert.deepEqual(profile.hostedTools, []);
  assert.ok(profile.codexCliArgs.includes('model_providers.openrouter.requires_openai_auth=false'));
  assert.ok(profile.codexCliArgs.includes('model_providers.openrouter.env_key="OPENROUTER_API_KEY"'));
});

test('provider-native hosted tools must be declared explicitly', () => {
  const profile = buildCodexProviderProfile({
    mode: 'official',
    providerLabel: 'openai',
    upstreamBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    toolStrategy: 'provider-native',
    hostedTools: [{
      name: 'web_search',
      mode: 'provider-native',
      providerToolName: 'web_search',
      description: 'OpenAI hosted web search.',
    }],
  });

  assert.deepEqual(profile.hostedTools, [{
    name: 'web_search',
    mode: 'provider-native',
    providerToolName: 'web_search',
    emulatedToolName: null,
    description: 'OpenAI hosted web search.',
  }]);
  assert.throws(() => buildCodexProviderProfile({
    mode: 'official',
    providerLabel: 'bad',
    upstreamBaseUrl: 'https://api.example.com/v1',
    defaultModel: 'example',
    toolStrategy: 'provider-native',
  }), /requires at least one explicit hosted tool/u);
});

test('adapter-emulated hosted tools must match the profile strategy', () => {
  const profile = buildCodexProviderProfile({
    mode: 'mixed',
    providerLabel: 'adapter-search',
    upstreamBaseUrl: 'https://api.example.com/v1',
    defaultModel: 'example',
    toolStrategy: 'adapter-emulated',
    hostedTools: [{
      name: 'file_search',
      mode: 'adapter-emulated',
      emulatedToolName: 'mcp_file_search',
    }],
  });

  assert.deepEqual(profile.hostedTools, [{
    name: 'file_search',
    mode: 'adapter-emulated',
    providerToolName: null,
    emulatedToolName: 'mcp_file_search',
    description: null,
  }]);
  assert.throws(() => buildCodexProviderProfile({
    mode: 'mixed',
    providerLabel: 'bad-adapter',
    upstreamBaseUrl: 'https://api.example.com/v1',
    defaultModel: 'example',
    toolStrategy: 'adapter-emulated',
    hostedTools: [{
      name: 'web_search',
      mode: 'provider-native',
    }],
  }), /declares provider-native, but profile strategy is adapter-emulated/u);
});

test('profile helper defaults are explicit and reusable by external app-servers', () => {
  assert.equal(defaultProtocolForProfileMode('official'), 'responses');
  assert.equal(defaultProtocolForProfileMode('mixed'), 'chat-completions');
  assert.equal(defaultProtocolForProfileMode('pure-api'), 'chat-completions');
  assert.equal(authModeForProfileMode('official'), 'codex-auth-compatible');
  assert.equal(authModeForProfileMode('mixed'), 'codex-auth-compatible');
  assert.equal(authModeForProfileMode('pure-api'), 'api-key-compatible');
  assert.equal(codexBaseUrlForProfile({
    mode: 'mixed',
    upstreamBaseUrl: 'https://api.example.com/v1',
    protocolProxyPort: 58013,
  }), 'http://127.0.0.1:58013/v1');
});

test('provider profile presets expose recommended mode, env names, and capability metadata', () => {
  const openrouter = createCodexProviderOpenRouterProfile({
    protocolProxyPort: 58014,
  });
  assert.equal(openrouter.mode, 'mixed');
  assert.equal(openrouter.providerLabel, 'openrouter');
  assert.equal(openrouter.upstreamBaseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(openrouter.codexBaseUrl, 'http://127.0.0.1:58014/v1');
  assert.equal(openrouter.configInput.apiKeyEnv, 'OPENROUTER_API_KEY');
  assert.equal(openrouter.providerPreset.env.apiKeyEnv, 'OPENROUTER_API_KEY');
  assert.equal(openrouter.providerPreset.env.baseUrlEnv, 'OPENROUTER_BASE_URL');
  assert.equal(openrouter.providerPreset.env.modelEnv, 'OPENROUTER_MODEL');
  assert.equal(openrouter.providerPreset.capabilityPresetId, 'openrouter');
  assert.equal(openrouter.providerPreset.capabilities?.supportsBuiltinWebSearchTool, false);

  const openrouterPreset = resolveCodexProviderProviderPreset('openrouter');
  assert.equal(openrouterPreset.defaultModel, 'deepseek/deepseek-v4-pro');
  assert.equal(openrouterPreset.env.apiKeyEnv, 'OPENROUTER_API_KEY');
  assert.deepEqual(
    openrouterPreset.models.find((model: any) => model.id === 'deepseek/deepseek-v4-pro')?.supportedReasoningEfforts,
    ['high', 'xhigh'],
  );

  const deepseek = createCodexProviderDeepSeekProfile({
    protocolProxyPort: 58015,
  });
  assert.equal(deepseek.mode, 'mixed');
  assert.equal(deepseek.upstreamBaseUrl, 'https://api.deepseek.com');
  assert.equal(deepseek.configInput.apiKeyEnv, 'DEEPSEEK_API_KEY');
  assert.equal(deepseek.providerPreset.capabilityPresetId, 'deepseek');

  const qwen = createCodexProviderDashScopeQwenProfile({
    mode: 'pure-api',
    protocolProxyPort: 58016,
  });
  assert.equal(qwen.mode, 'pure-api');
  assert.equal(qwen.providerLabel, 'dashscope_qwen');
  assert.equal(qwen.upstreamBaseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(qwen.configInput.apiKeyEnv, 'DASHSCOPE_API_KEY');
  assert.equal(qwen.providerPreset.env.alternativeApiKeyEnv, 'QWEN_API_KEY');
  assert.equal(qwen.providerPreset.capabilityPresetId, 'qwen');
  assert.equal(qwen.providerPreset.capabilities?.supportsBuiltinWebSearchTool, true);
  assert.ok(qwen.codexCliArgs.includes('model_providers.dashscope_qwen.env_key="DASHSCOPE_API_KEY"'));

  const siliconflow = createCodexProviderSiliconFlowProfile({
    protocolProxyPort: 58017,
  });
  assert.equal(siliconflow.mode, 'mixed');
  assert.equal(siliconflow.providerLabel, 'siliconflow');
  assert.equal(siliconflow.upstreamBaseUrl, 'https://api.siliconflow.cn/v1');
  assert.equal(siliconflow.configInput.apiKeyEnv, 'SILICONFLOW_API_KEY');
  assert.equal(siliconflow.providerPreset.env.baseUrlEnv, 'SILICONFLOW_BASE_URL');
  assert.equal(siliconflow.providerPreset.env.modelEnv, 'SILICONFLOW_MODEL');
  assert.equal(siliconflow.providerPreset.capabilityPresetId, 'siliconflow');
  assert.equal(siliconflow.providerPreset.capabilities?.multimodal?.supportsFileInput, false);

  const minimax = createCodexProviderMiniMaxProfile({
    protocolProxyPort: 58018,
  });
  assert.equal(minimax.mode, 'mixed');
  assert.equal(minimax.providerLabel, 'minimax');
  assert.equal(minimax.upstreamBaseUrl, 'https://api.minimaxi.com/v1');
  assert.equal(minimax.configInput.apiKeyEnv, 'MINIMAX_API_KEY');
  assert.equal(minimax.providerPreset.env.modelEnv, 'MINIMAX_MODEL');
  assert.equal(minimax.providerPreset.capabilityPresetId, 'minimax');
  assert.equal(minimax.providerPreset.capabilities?.multimodal?.supportsImageInput, false);

  const kimi = createCodexProviderMoonshotKimiProfile({
    protocolProxyPort: 58019,
  });
  assert.equal(kimi.mode, 'mixed');
  assert.equal(kimi.providerLabel, 'kimi');
  assert.equal(kimi.upstreamBaseUrl, 'https://api.moonshot.cn/v1');
  assert.equal(kimi.configInput.apiKeyEnv, 'KIMI_API_KEY');
  assert.equal(kimi.providerPreset.env.alternativeApiKeyEnv, 'MOONSHOT_API_KEY');
  assert.equal(kimi.providerPreset.capabilityPresetId, 'kimi');
  assert.equal(kimi.providerPreset.capabilities?.multimodal?.supportsFileInput, false);
});

test('provider preset catalog can hydrate OpenRouter models from provider /models', async () => {
  const preset = await resolveCodexProviderProviderPresetCatalog('openrouter', {
    apiKey: 'test-key',
    fetchImpl: async (url, init) => {
      assert.equal(String(url), 'https://openrouter.ai/api/v1/models');
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-key');
      return new Response(JSON.stringify({
        data: [
          {
            id: 'deepseek/deepseek-v4-pro',
            name: 'DeepSeek: DeepSeek V4 Pro',
            context_length: 1048576,
            supported_parameters: ['tools', 'reasoning', 'response_format'],
            reasoning: {
              supported_efforts: ['xhigh', 'high'],
              default_effort: 'high',
            },
          },
          {
            id: 'anthropic/claude-sonnet-4.5',
            name: 'Anthropic: Claude Sonnet 4.5',
            supported_parameters: ['tools'],
          },
        ],
      }), { status: 200 });
    },
  });

  assert.equal(preset.defaultModel, 'deepseek/deepseek-v4-pro');
  assert.equal(preset.models.length >= 2, true);
  assert.equal(preset.models[0].id, 'deepseek/deepseek-v4-pro');
  assert.equal(preset.models.some((model: any) => model.id === 'anthropic/claude-sonnet-4.5'), true);
  assert.deepEqual(
    preset.capabilities?.modelCapabilities?.['deepseek/deepseek-v4-pro']?.reasoning,
    { supportedReasoningEfforts: ['high', 'xhigh'], defaultReasoningEffort: null },
  );
});

test('provider preset catalog hydrates non-OpenRouter compatible providers too', async () => {
  const preset = await resolveCodexProviderProviderPresetCatalog('deepseek', {
    apiKey: 'deepseek-key',
    fetchImpl: async (url, init) => {
      assert.equal(String(url), 'https://api.deepseek.com/models');
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer deepseek-key');
      return new Response(JSON.stringify({
        data: [
          {
            id: 'deepseek-v4-pro',
            name: 'DeepSeek V4 Pro',
            supported_parameters: ['tools', 'reasoning', 'response_format'],
          },
          {
            id: 'deepseek-chat',
            name: 'DeepSeek Chat',
            supported_parameters: ['tools', 'response_format'],
          },
          {
            id: 'deepseek-reasoner',
            name: 'DeepSeek Reasoner',
            supported_parameters: ['tools', 'reasoning'],
          },
        ],
      }), { status: 200 });
    },
  });

  assert.equal(preset.defaultModel, 'deepseek-v4-flash');
  assert.equal(preset.models.length >= 3, true);
  assert.equal(preset.models[0].id, preset.defaultModel);
  assert.equal(preset.models.some((model: any) => model.id === 'deepseek-chat'), true);
  assert.equal(preset.models.some((model: any) => model.id === 'deepseek-reasoner'), true);
});

test('provider preset catalog hydrates Kimi models from Moonshot /models', async () => {
  const preset = await resolveCodexProviderProviderPresetCatalog('moonshot-kimi', {
    apiKey: 'kimi-key',
    fetchImpl: async (url, init) => {
      assert.equal(String(url), 'https://api.moonshot.cn/v1/models');
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer kimi-key');
      return new Response(JSON.stringify({
        data: [
          { id: 'kimi-k2.7-code', owned_by: 'moonshot' },
          { id: 'kimi-k2.7-code-highspeed', owned_by: 'moonshot' },
          { id: 'moonshot-v1-128k', owned_by: 'moonshot' },
        ],
      }), { status: 200 });
    },
  });

  assert.equal(preset.defaultModel, 'kimi-k2.7-code');
  assert.equal(preset.baseUrl, 'https://api.moonshot.cn/v1');
  assert.equal(preset.models[0].id, 'kimi-k2.7-code');
  assert.equal(preset.models.some((model: any) => model.id === 'kimi-k2.7-code-highspeed'), true);
});
