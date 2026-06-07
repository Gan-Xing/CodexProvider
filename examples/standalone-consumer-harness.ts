import assert from 'node:assert/strict';
import {
  CodexProviderRuntime,
  createCodexProviderFileSearchExecutor,
  createCodexProviderMemoryFileSearchSource,
  type CodexProviderAdapterServerOptions,
} from '@codex-provider/core';

const fileSearch = createCodexProviderFileSearchExecutor({
  sources: [
    createCodexProviderMemoryFileSearchSource({
      name: 'standalone-memory',
      documents: [{
        id: 'codex-provider-target',
        title: 'CodexProvider target',
        path: 'docs/target.md',
        content: [
          'CodexProvider lets non-OpenAI models participate in the Codex native tool-call loop.',
          'Hosted tools must be explicit and executor-backed.',
        ].join('\n'),
        metadata: { source: 'standalone-harness' },
      }],
      includeContent: true,
    }),
  ],
  includeContent: true,
  maxResults: 3,
});

const searchResult = await fileSearch({
  toolName: 'file_search',
  relayToolName: 'relay_file_search',
  callId: 'call_standalone_file_search',
  arguments: {
    query: 'Codex native tool-call loop',
    include_content: true,
    max_num_results: 3,
  },
  rawArguments: JSON.stringify({ query: 'Codex native tool-call loop' }),
  model: 'standalone-model',
  providerKind: 'standalone-provider',
  providerName: 'Standalone Provider',
});

assert.equal(typeof searchResult.content, 'object');
const content = searchResult.content as {
  data?: Array<{ filename?: string; content?: Array<{ text?: string }> }>;
};
assert.equal(content.data?.[0]?.filename, 'target.md');
assert.match(content.data?.[0]?.content?.[0]?.text ?? '', /CodexProvider/u);

const receivedAdapterOptions: CodexProviderAdapterServerOptions[] = [];
let startCount = 0;
let stopCount = 0;

const runtime = new CodexProviderRuntime({
  apiKey: 'sk-standalone-test',
  upstreamBaseUrl: 'https://provider.example/v1',
  defaultModel: 'standalone-model',
  providerLabel: 'standalone_provider',
  providerName: 'Standalone Provider',
  profileMode: 'mixed',
  toolStrategy: 'relay-emulated',
  hostedTools: [{ name: 'file_search', mode: 'relay-emulated', relayToolName: 'relay_file_search' }],
  hostedToolExecutors: { file_search: fileSearch },
  adapterServerFactory: (options) => {
    receivedAdapterOptions.push(options);
    return {
      baseUrl: 'http://127.0.0.1:45454',
      async start() {
        startCount += 1;
      },
      async stop() {
        stopCount += 1;
      },
    };
  },
});

const state = await runtime.start();

assert.equal(startCount, 1);
assert.equal(runtime.isStarted(), true);
assert.equal(state.adapterBaseUrl, 'http://127.0.0.1:45454/v1');
assert.equal(state.codexBaseUrl, 'http://127.0.0.1:45454/v1');
assert.equal(state.relayProfile.mode, 'mixed');
assert.equal(state.relayProfile.toolStrategy, 'relay-emulated');
assert.deepEqual(state.relayProfile.hostedTools, [{
  name: 'file_search',
  mode: 'relay-emulated',
  providerToolName: null,
  relayToolName: 'relay_file_search',
  description: null,
}]);
const hostedToolExecutors = receivedAdapterOptions[0]?.hostedToolExecutors as Record<string, unknown> | undefined;
assert.equal(hostedToolExecutors?.file_search, fileSearch);

await runtime.stop();

assert.equal(stopCount, 1);
assert.equal(runtime.isStarted(), false);

console.log('standalone consumer harness passed');
