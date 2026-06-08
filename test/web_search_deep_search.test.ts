import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCodexProviderDeepSearchGraph,
  createCodexProviderDeepSearchRunner,
  createCodexProviderDeepWebSearchExecutor,
  planCodexProviderDeepSearchQuery,
  type CodexProviderHostedToolExecutionRequest,
  type CodexProviderMetaSearchService,
  type CodexProviderSearchRequest,
  type CodexProviderSearchResponse,
} from '../src/index.js';

function searchResponse(
  request: CodexProviderSearchRequest,
  results: CodexProviderSearchResponse['results'],
): CodexProviderSearchResponse {
  return {
    query: request.query,
    mode: request.mode ?? 'balanced',
    results,
    unresponsiveEngines: [],
    timings: {
      fake: 1,
    },
    searchedAt: '2026-06-08T00:00:00.000Z',
  };
}

function baseRequest(argumentsObject: Record<string, any>): CodexProviderHostedToolExecutionRequest {
  return {
    toolName: 'custom:deep_web_search',
    emulatedToolName: 'deep_web_search',
    callId: 'call_deep_search_1',
    arguments: argumentsObject,
    rawArguments: JSON.stringify(argumentsObject),
    model: 'test-model',
    providerKind: 'openai-compatible',
    providerName: 'test-provider',
  };
}

test('deep search planner builds a sub-question graph from a broad query', () => {
  const plan = planCodexProviderDeepSearchQuery('Compare local index vs hosted web search', {
    maxSubqueries: 4,
  });
  const graph = createCodexProviderDeepSearchGraph(plan);

  assert.equal(plan.nodes[0].type, 'root');
  assert.equal(plan.nodes[0].id, 'root');
  assert.equal(plan.nodes.filter((node) => node.type === 'search').length, 4);
  assert.deepEqual(graph.levels.map((level) => level.map((node) => node.id)), [
    ['root'],
    ['q1', 'q2', 'q3', 'q4'],
  ]);
  assert.equal(plan.nodes.some((node) => /comparison evidence|tradeoffs/u.test(node.query)), true);
});

test('deep search runner executes subqueries and merges duplicate references', async () => {
  const calls: string[] = [];
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      calls.push(request.query);
      if (request.query === 'local index reliability') {
        return searchResponse(request, [
          {
            title: 'Shared Evidence',
            url: 'https://docs.example.com/shared',
            snippet: 'Shared evidence for local index reliability.',
            engines: ['local-index'],
            engineRanks: { 'local-index': 1 },
            score: 20,
          },
          {
            title: 'Local Index Details',
            url: 'https://docs.example.com/local',
            snippet: 'Local index detail page.',
            engines: ['local-index'],
            engineRanks: { 'local-index': 2 },
            score: 10,
          },
        ]);
      }
      return searchResponse(request, [
        {
          title: 'Shared Evidence Expanded',
          url: 'https://docs.example.com/shared?utm_source=test',
          snippet: 'Shared evidence for cache-backed retrieval.',
          engines: ['html'],
          engineRanks: { html: 1 },
          score: 18,
        },
        {
          title: 'Cache Retrieval Details',
          url: 'https://docs.example.com/cache',
          snippet: 'Cache retrieval detail page.',
          engines: ['html'],
          engineRanks: { html: 2 },
          score: 9,
        },
      ]);
    },
  };
  const runner = createCodexProviderDeepSearchRunner({
    search,
    planner: {
      plan: () => ({
        query: 'local index cache reliability',
        nodes: [
          {
            id: 'root',
            type: 'root',
            question: 'local index cache reliability',
            query: 'local index cache reliability',
            dependsOn: [],
          },
          {
            id: 'q1',
            type: 'search',
            question: 'local index reliability',
            query: 'local index reliability',
            dependsOn: ['root'],
          },
          {
            id: 'q2',
            type: 'search',
            question: 'cache retrieval reliability',
            query: 'cache retrieval reliability',
            dependsOn: ['root'],
          },
        ],
      }),
    },
    now: () => new Date('2026-06-08T00:00:00.000Z'),
  });

  const response = await runner.run({
    query: 'local index cache reliability',
    maxSources: 3,
    maxResultsPerSubquery: 2,
    externalWebAccess: false,
  });

  assert.deepEqual(calls.sort(), ['cache retrieval reliability', 'local index reliability']);
  assert.deepEqual(response.graph.levels, [['root'], ['q1', 'q2']]);
  assert.equal(response.sources.length, 3);
  assert.equal(response.sources[0].url, 'https://docs.example.com/shared');
  assert.deepEqual(response.sources[0].supporting_queries.sort(), [
    'cache retrieval reliability',
    'local index reliability',
  ]);
  assert.match(response.synthesis.instructions, /\[\[source:N\]\]/u);
  assert.equal(response.external_web_access, false);
});

test('deep web search executor exposes deep-search content for custom hosted tools', async () => {
  const seenRequests: CodexProviderSearchRequest[] = [];
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      seenRequests.push(JSON.parse(JSON.stringify(request)));
      return searchResponse(request, [{
        title: 'Executor Deep Search',
        url: 'https://docs.example.com/deep-executor',
        snippet: 'Executor deep search result.',
        engines: ['fake'],
        engineRanks: { fake: 1 },
        score: 5,
      }]);
    },
  };
  const executor = createCodexProviderDeepWebSearchExecutor({
    search,
    maxSubqueries: 1,
    maxResultsPerSubquery: 1,
    now: () => new Date('2026-06-08T00:00:00.000Z'),
  });

  const result = await executor(baseRequest({
    query: 'executor deep search',
    external_web_access: false,
    filters: {
      allowed_domains: ['docs.example.com'],
    },
  }));
  const content = result.content as any;

  assert.equal(content.provider, 'deep-search');
  assert.equal(content.sources[0].url, 'https://docs.example.com/deep-executor');
  assert.equal(content.citations[0].type, 'url_citation');
  assert.equal(content.synthesis.source_count, 1);
  assert.equal(content.external_web_access, false);
  assert.equal(result.metadata?.provider, 'deep-search');
  assert.equal(seenRequests[0].externalWebAccess, false);
  assert.deepEqual(seenRequests[0].allowedDomains, ['docs.example.com']);
});
