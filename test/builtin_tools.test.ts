import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS,
  createCodexProviderHostedToolExecutorRegistry,
  isCodexProviderAdapterEmulatedBuiltinToolType,
  normalizeCodexProviderBuiltinToolName,
  normalizeCodexProviderHostedTools,
} from '../src/index.js';

test('builtin tool registry exposes canonical tool definitions', () => {
  assert.equal(CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS.web_search.name, 'web_search');
  assert.equal(CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS.file_search.adapterEmulatedSupported, true);
  assert.equal(CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS.tool_search.adapterEmulatedSupported, true);
  assert.equal(CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS.image_generation.adapterEmulatedSupported, true);
  assert.equal(CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS.code_interpreter.adapterEmulatedSupported, true);
  assert.equal(CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS.code_interpreter.unsafeByDefault, true);
  assert.equal(CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS.computer.adapterEmulatedSupported, true);
  assert.equal(CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS.computer.unsafeByDefault, true);
  assert.equal(CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS.apply_patch.status, 'supported');
});

test('builtin tool aliases normalize without enabling unsupported adapter tools', () => {
  assert.equal(normalizeCodexProviderBuiltinToolName('web_search_preview'), 'web_search');
  assert.equal(normalizeCodexProviderBuiltinToolName('web_search_preview_2025_03_11'), 'web_search');
  assert.equal(normalizeCodexProviderBuiltinToolName('tool_search'), 'tool_search');
  assert.equal(normalizeCodexProviderBuiltinToolName('image_generation'), 'image_generation');
  assert.equal(normalizeCodexProviderBuiltinToolName('code_interpreter'), 'code_interpreter');
  assert.equal(normalizeCodexProviderBuiltinToolName('computer_use'), 'computer');
  assert.equal(normalizeCodexProviderBuiltinToolName('computer_use_preview'), 'computer');
  assert.equal(normalizeCodexProviderBuiltinToolName('not_a_builtin_tool'), null);
  assert.equal(isCodexProviderAdapterEmulatedBuiltinToolType('web_search_preview'), true);
  assert.equal(isCodexProviderAdapterEmulatedBuiltinToolType('file_search'), true);
  assert.equal(isCodexProviderAdapterEmulatedBuiltinToolType('tool_search'), true);
  assert.equal(isCodexProviderAdapterEmulatedBuiltinToolType('image_generation'), true);
  assert.equal(isCodexProviderAdapterEmulatedBuiltinToolType('code_interpreter'), true);
  assert.equal(isCodexProviderAdapterEmulatedBuiltinToolType('computer_use_preview'), true);
});

test('hosted tool declarations normalize legacy aliases to canonical names', () => {
  const hostedTools = normalizeCodexProviderHostedTools([
    {
      name: 'web_search_preview',
      mode: 'adapter-emulated',
    },
    {
      name: 'computer_use_preview',
      mode: 'provider-native',
    },
  ]);

  assert.deepEqual(hostedTools, [
    {
      name: 'web_search',
      mode: 'adapter-emulated',
      providerToolName: null,
      emulatedToolName: 'web_search',
      description: null,
    },
    {
      name: 'computer',
      mode: 'provider-native',
      providerToolName: 'computer',
      emulatedToolName: null,
      description: null,
    },
  ]);
  assert.throws(() => normalizeCodexProviderHostedTools([{
    name: 'unknown_builtin',
    mode: 'adapter-emulated',
  } as any]), /Unsupported hosted tool name/u);
});

test('hosted tool executor registry resolves legacy aliases to canonical names', async () => {
  const registry = createCodexProviderHostedToolExecutorRegistry({
    computer_use_preview: () => ({ content: 'ok' }),
  });

  assert.equal(registry.has('computer'), true);
  assert.equal(registry.has('computer_use'), true);
  assert.deepEqual(await registry.execute({
    toolName: 'computer',
    emulatedToolName: 'adapter_computer',
    callId: 'call_computer_1',
    arguments: {},
    rawArguments: '{}',
    model: null,
    providerKind: null,
    providerName: null,
  }), {
    content: 'ok',
    metadata: null,
  });
});
