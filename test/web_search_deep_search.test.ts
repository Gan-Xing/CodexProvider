import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCodexProviderDeepSearchGraph,
  createCodexProviderDeepSearchRunner,
  createCodexProviderDeepWebSearchExecutor,
  mergeCodexProviderDeepSearchReferences,
  planCodexProviderDeepSearchQuery,
  type CodexProviderHostedToolExecutionRequest,
  type CodexProviderMetaSearchService,
  type CodexProviderSearchRequest,
  type CodexProviderSearchResponse,
  type CodexProviderUnresponsiveEngine,
} from '../src/index.js';

function searchResponse(
  request: CodexProviderSearchRequest,
  results: CodexProviderSearchResponse['results'],
  options: {
    unresponsiveEngines?: CodexProviderUnresponsiveEngine[];
  } = {},
): CodexProviderSearchResponse {
  return {
    query: request.query,
    mode: request.mode ?? 'balanced',
    results,
    unresponsiveEngines: options.unresponsiveEngines ?? [],
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

test('deep search planner exposes diagnostics for heuristic decomposition fixtures', () => {
  const fixtures = [
    {
      query: 'Compare local index vs hosted web search',
      maxSubqueries: 4,
      expectedQueryPattern: /comparison evidence|tradeoffs/u,
      minDiscarded: 1,
    },
    {
      query: 'local index caching, retrieval safety, citation annotations',
      maxSubqueries: 4,
      expectedQueryPattern: /retrieval safety/u,
      minDiscarded: 1,
    },
    {
      query: 'What evidence supports local web retrieval safety',
      maxSubqueries: 4,
      expectedQueryPattern: /current evidence/u,
      minDiscarded: 0,
    },
    {
      query: '比较 本地索引 与 托管搜索 的差异',
      maxSubqueries: 4,
      expectedQueryPattern: /对比证据|取舍/u,
      minDiscarded: 0,
    },
  ];

  for (const fixture of fixtures) {
    const plan = planCodexProviderDeepSearchQuery(fixture.query, {
      maxSubqueries: fixture.maxSubqueries,
    });
    const searchQueries = plan.nodes
      .filter((node) => node.type === 'search')
      .map((node) => node.query);

    assert.equal(plan.diagnostics?.strategy, 'heuristic');
    assert.equal(plan.diagnostics?.maxSubqueries, fixture.maxSubqueries);
    assert.equal(plan.diagnostics?.selectedCount, searchQueries.length);
    assert.equal(plan.diagnostics?.candidateCount, searchQueries.length + (plan.diagnostics?.discardedCount ?? 0));
    assert.deepEqual(plan.diagnostics?.selectedQueries, searchQueries);
    assert.ok((plan.diagnostics?.discardedCount ?? 0) >= fixture.minDiscarded);
    assert.equal(searchQueries.some((query) => fixture.expectedQueryPattern.test(query)), true);
  }
});

test('deep search graph rejects missing dependencies and cycles', () => {
  assert.throws(
    () => createCodexProviderDeepSearchGraph({
      query: 'missing dependency',
      nodes: [
        {
          id: 'q1',
          type: 'search',
          question: 'missing dependency',
          query: 'missing dependency',
          dependsOn: ['root'],
        },
      ],
    }),
    /depends on unknown node: root/u,
  );

  assert.throws(
    () => createCodexProviderDeepSearchGraph({
      query: 'cycle',
      nodes: [
        {
          id: 'root',
          type: 'root',
          question: 'cycle',
          query: 'cycle',
          dependsOn: ['q1'],
        },
        {
          id: 'q1',
          type: 'search',
          question: 'cycle evidence',
          query: 'cycle evidence',
          dependsOn: ['root'],
        },
      ],
    }),
    /dependency cycle/u,
  );
});

test('deep search reference merge canonicalizes URLs and keeps stable source ids', () => {
  const references = mergeCodexProviderDeepSearchReferences([
    {
      nodeId: 'q1',
      question: 'local index reliability',
      query: 'local index reliability',
      response: searchResponse({
        query: 'local index reliability',
      }, [
        {
          title: 'Shared Evidence',
          url: 'https://docs.example.com/shared',
          snippet: 'Shared evidence for local index reliability.',
          engines: ['local-index'],
          engineRanks: { 'local-index': 1 },
          score: 20,
        },
      ]),
      error: null,
    },
    {
      nodeId: 'q2',
      question: 'cache retrieval reliability',
      query: 'cache retrieval reliability',
      response: searchResponse({
        query: 'cache retrieval reliability',
      }, [
        {
          title: 'Shared Evidence Expanded',
          url: 'https://docs.example.com/shared?utm_source=test',
          snippet: 'Shared evidence for cache-backed retrieval with a longer snippet.',
          engines: ['html'],
          engineRanks: { html: 1 },
          score: 18,
        },
        {
          title: 'Secondary Evidence',
          url: 'https://docs.example.com/secondary',
          snippet: 'Secondary evidence.',
          engines: ['html'],
          engineRanks: { html: 2 },
          score: 9,
        },
      ]),
      error: null,
    },
  ], {
    maxSources: 2,
  });

  assert.equal(references.length, 2);
  assert.equal(references[0].id, 1);
  assert.equal(references[0].url, 'https://docs.example.com/shared');
  assert.equal(references[0].source, 'html,local-index');
  assert.deepEqual(references[0].node_ids, ['q1', 'q2']);
  assert.deepEqual(references[0].supporting_queries.sort(), [
    'cache retrieval reliability',
    'local index reliability',
  ]);
  assert.equal(references[1].id, 2);
  assert.equal(references[1].url, 'https://docs.example.com/secondary');
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

test('deep search runner records partial failures and unresponsive diagnostics', async () => {
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      if (request.query === 'failing branch') {
        throw new Error('branch unavailable');
      }
      if (request.query === 'slow branch') {
        return searchResponse(request, [], {
          unresponsiveEngines: [{
            engine: 'slow-engine',
            code: 'timeout',
            message: 'engine timed out',
            durationMs: 25,
          }],
        });
      }
      return searchResponse(request, [{
        title: 'Successful Branch',
        url: 'https://docs.example.com/success',
        snippet: 'Successful branch evidence.',
        engines: ['fake'],
        engineRanks: { fake: 1 },
        score: 12,
      }]);
    },
  };
  const runner = createCodexProviderDeepSearchRunner({
    search,
    planner: {
      plan: () => ({
        query: 'partial failure graph',
        nodes: [
          {
            id: 'root',
            type: 'root',
            question: 'partial failure graph',
            query: 'partial failure graph',
            dependsOn: [],
          },
          {
            id: 'q1',
            type: 'search',
            question: 'successful branch',
            query: 'successful branch',
            dependsOn: ['root'],
          },
          {
            id: 'q2',
            type: 'search',
            question: 'failing branch',
            query: 'failing branch',
            dependsOn: ['root'],
          },
          {
            id: 'q3',
            type: 'search',
            question: 'slow branch',
            query: 'slow branch',
            dependsOn: ['root'],
          },
        ],
      }),
    },
    now: () => new Date('2026-06-08T00:00:00.000Z'),
  });

  const response = await runner.run({
    query: 'partial failure graph',
    maxSources: 5,
  });

  assert.equal(response.sources.length, 1);
  assert.equal(response.sources[0].url, 'https://docs.example.com/success');
  assert.equal(response.subqueries.length, 3);
  assert.match(response.subqueries.find((subquery) => subquery.query === 'failing branch')?.error ?? '', /branch unavailable/u);
  assert.equal(response.unresponsive_engines.length, 1);
  assert.equal(response.unresponsive_engines[0].engine, 'slow-engine');
  assert.deepEqual(response.diagnostics, {
    planner_strategy: null,
    candidate_count: null,
    selected_subquery_count: 3,
    discarded_subquery_count: 0,
    failed_subquery_count: 1,
    timed_out_subquery_count: 1,
    retried_subquery_count: 0,
    subquery_attempt_count: 3,
    unresponsive_engine_count: 1,
    source_count: 1,
    search_node_count: 3,
    executed_subquery_count: 3,
    total_result_count: 1,
    max_subqueries: 4,
    max_results_per_subquery: 5,
    max_sources: 5,
    max_subquery_attempts: 1,
    subquery_timeout_ms: null,
    duration_ms: 0,
    minimum_source_count: null,
    below_minimum_sources: false,
    citation_budget: null,
    citation_count: 1,
    answer_shape: null,
    no_supporting_evidence: false,
  });
});

test('deep web search executor records when sources are below the requested minimum', async () => {
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      return searchResponse(request, [{
        title: 'Limited Evidence',
        url: 'https://docs.example.com/limited',
        snippet: 'Only one relevant source was found.',
        engines: ['fake'],
        engineRanks: { fake: 1 },
        score: 8,
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
    query: 'limited evidence topic',
    min_sources: 2,
  }));
  const content = result.content as any;

  assert.equal(content.sources.length, 1);
  assert.equal(content.synthesis.minimum_source_count, 2);
  assert.equal(content.synthesis.below_minimum_sources, true);
  assert.equal(content.synthesis.citation_budget, null);
  assert.equal(content.synthesis.citation_count, 1);
  assert.equal(content.synthesis.answer_shape, null);
  assert.equal(content.synthesis.no_supporting_evidence, false);
  assert.match(content.synthesis.instructions, /below the requested minimum of 2/u);
  assert.equal(content.diagnostics.minimum_source_count, 2);
  assert.equal(content.diagnostics.below_minimum_sources, true);
  assert.equal(content.diagnostics.citation_budget, null);
  assert.equal(content.diagnostics.citation_count, 1);
  assert.equal(content.diagnostics.answer_shape, null);
  assert.equal(content.diagnostics.no_supporting_evidence, false);
  assert.equal(result.metadata?.minimumSourceCount, 2);
  assert.equal(result.metadata?.belowMinimumSources, true);
  assert.equal(result.metadata?.citationBudget, null);
  assert.equal(result.metadata?.citationCount, 1);
  assert.equal(result.metadata?.answerShape, null);
  assert.equal(result.metadata?.noSupportingEvidence, false);
});

test('deep web search executor applies citation budget without dropping sources', async () => {
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      return searchResponse(request, [
        {
          title: 'Primary Evidence',
          url: 'https://docs.example.com/primary',
          snippet: 'Primary evidence for a budgeted citation.',
          engines: ['fake'],
          engineRanks: { fake: 1 },
          score: 12,
        },
        {
          title: 'Secondary Evidence',
          url: 'https://docs.example.com/secondary',
          snippet: 'Secondary evidence remains available as background.',
          engines: ['fake'],
          engineRanks: { fake: 2 },
          score: 8,
        },
      ]);
    },
  };
  const executor = createCodexProviderDeepWebSearchExecutor({
    search,
    maxSubqueries: 1,
    maxResultsPerSubquery: 2,
    now: () => new Date('2026-06-08T00:00:00.000Z'),
  });

  const result = await executor(baseRequest({
    query: 'citation budget topic',
    citation_budget: 1,
  }));
  const content = result.content as any;

  assert.equal(content.sources.length, 2);
  assert.equal(content.citations.length, 1);
  assert.equal(content.citations[0].url, 'https://docs.example.com/primary');
  assert.equal(content.synthesis.citation_budget, 1);
  assert.equal(content.synthesis.citation_count, 1);
  assert.match(content.synthesis.instructions, /no more than 1 distinct cited sources/u);
  assert.match(content.synthesis.instructions, /source ids 1 through 1/u);
  assert.equal(content.diagnostics.citation_budget, 1);
  assert.equal(content.diagnostics.citation_count, 1);
  assert.equal(result.metadata?.citationBudget, 1);
  assert.equal(result.metadata?.citationCount, 1);
});

test('deep web search executor supports zero citation budget without dropping sources', async () => {
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      return searchResponse(request, [{
        title: 'Uncited Evidence',
        url: 'https://docs.example.com/uncited',
        snippet: 'Evidence can still be inspected even when citations are disabled.',
        engines: ['fake'],
        engineRanks: { fake: 1 },
        score: 10,
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
    query: 'uncited evidence topic',
    max_citations: 0,
  }));
  const content = result.content as any;

  assert.equal(content.sources.length, 1);
  assert.equal(content.citations.length, 0);
  assert.equal(content.synthesis.citation_budget, 0);
  assert.equal(content.synthesis.citation_count, 0);
  assert.match(content.synthesis.instructions, /Citation budget is 0/u);
  assert.doesNotMatch(content.synthesis.instructions, /\[\[source:N\]\]/u);
  assert.equal(content.diagnostics.citation_budget, 0);
  assert.equal(content.diagnostics.citation_count, 0);
  assert.equal(result.metadata?.citationBudget, 0);
  assert.equal(result.metadata?.citationCount, 0);
});

test('deep web search executor records answer shape guidance', async () => {
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      return searchResponse(request, [{
        title: 'Evidence Table Source',
        url: 'https://docs.example.com/evidence-table',
        snippet: 'Evidence table source for answer-shape guidance.',
        engines: ['fake'],
        engineRanks: { fake: 1 },
        score: 10,
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
    query: 'answer shape topic',
    answer_shape: 'evidence-table',
  }));
  const content = result.content as any;

  assert.equal(content.synthesis.answer_shape, 'evidence_table');
  assert.match(content.synthesis.instructions, /Answer shape: evidence_table/u);
  assert.match(content.synthesis.instructions, /claim, cited source ids, and caveat columns/u);
  assert.equal(content.diagnostics.answer_shape, 'evidence_table');
  assert.equal(result.metadata?.answerShape, 'evidence_table');
});

test('deep web search executor marks no supporting evidence when all branches are empty', async () => {
  const seenRequests: CodexProviderSearchRequest[] = [];
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      seenRequests.push(JSON.parse(JSON.stringify(request)));
      return searchResponse(request, []);
    },
  };
  const executor = createCodexProviderDeepWebSearchExecutor({
    search,
    maxSubqueries: 2,
    maxResultsPerSubquery: 1,
    now: () => new Date('2026-06-08T00:00:00.000Z'),
  });

  const result = await executor(baseRequest({
    query: 'uncovered research topic',
    max_sources: 3,
  }));
  const content = result.content as any;

  assert.equal(seenRequests.length, 2);
  assert.equal(content.results.length, 0);
  assert.equal(content.sources.length, 0);
  assert.equal(content.citations.length, 0);
  assert.equal(content.synthesis.source_count, 0);
  assert.equal(content.synthesis.citation_budget, null);
  assert.equal(content.synthesis.citation_count, 0);
  assert.equal(content.synthesis.answer_shape, null);
  assert.equal(content.synthesis.no_supporting_evidence, true);
  assert.match(content.synthesis.instructions, /No supporting sources were found/u);
  assert.equal(content.diagnostics.source_count, 0);
  assert.equal(content.diagnostics.citation_budget, null);
  assert.equal(content.diagnostics.citation_count, 0);
  assert.equal(content.diagnostics.answer_shape, null);
  assert.equal(content.diagnostics.no_supporting_evidence, true);
  assert.equal(result.metadata?.sourceCount, 0);
  assert.equal(result.metadata?.resultCount, 0);
  assert.equal(result.metadata?.citationBudget, null);
  assert.equal(result.metadata?.citationCount, 0);
  assert.equal(result.metadata?.answerShape, null);
  assert.equal(result.metadata?.noSupportingEvidence, true);
});

test('deep web search executor records opt-in subquery timeout and retry metadata', async () => {
  const seenRequests: CodexProviderSearchRequest[] = [];
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      seenRequests.push(JSON.parse(JSON.stringify(request)));
      if (seenRequests.length === 1) {
        return searchResponse(request, [], {
          unresponsiveEngines: [{
            engine: 'timeout-engine',
            code: 'timeout',
            message: 'subquery timed out',
            durationMs: 75,
          }],
        });
      }
      return searchResponse(request, [{
        title: 'Retry Evidence',
        url: 'https://docs.example.com/retry-evidence',
        snippet: 'Evidence returned after a retry.',
        engines: ['fake'],
        engineRanks: { fake: 1 },
        score: 10,
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
    query: 'retryable timeout topic',
    subquery_timeout_ms: 75,
    max_subquery_attempts: 2,
  }));
  const content = result.content as any;

  assert.equal(seenRequests.length, 2);
  assert.equal(seenRequests[0].overallTimeoutMs, 75);
  assert.equal(seenRequests[1].overallTimeoutMs, 75);
  assert.equal(content.sources.length, 1);
  assert.equal(content.subqueries.length, 1);
  assert.equal(content.subqueries[0].attempt_count, 2);
  assert.equal(content.subqueries[0].timed_out, true);
  assert.equal(content.subqueries[0].error, null);
  assert.ok(content.subqueries[0].duration_ms >= 0);
  assert.equal(content.unresponsive_engines.length, 1);
  assert.equal(content.diagnostics.timed_out_subquery_count, 1);
  assert.equal(content.diagnostics.retried_subquery_count, 1);
  assert.equal(content.diagnostics.subquery_attempt_count, 2);
  assert.equal(content.diagnostics.max_subquery_attempts, 2);
  assert.equal(content.diagnostics.subquery_timeout_ms, 75);
  assert.equal(result.metadata?.timedOutSubqueryCount, 1);
  assert.equal(result.metadata?.retriedSubqueryCount, 1);
  assert.equal(result.metadata?.subqueryAttemptCount, 2);
  assert.equal(result.metadata?.maxSubqueryAttempts, 2);
  assert.equal(result.metadata?.subqueryTimeoutMs, 75);
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
  assert.equal(content.diagnostics.failed_subquery_count, 0);
  assert.equal(content.external_web_access, false);
  assert.equal(result.metadata?.provider, 'deep-search');
  assert.equal(result.metadata?.failedSubqueryCount, 0);
  assert.equal(seenRequests[0].externalWebAccess, false);
  assert.deepEqual(seenRequests[0].allowedDomains, ['docs.example.com']);
});

test('deep web search executor metadata records planner budgets and unresponsive engines', async () => {
  const seenRequests: CodexProviderSearchRequest[] = [];
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      seenRequests.push(JSON.parse(JSON.stringify(request)));
      return searchResponse(request, [{
        title: `Budget ${request.query}`,
        url: `https://docs.example.com/${seenRequests.length}`,
        snippet: 'Budgeted deep search result.',
        engines: ['fake'],
        engineRanks: { fake: 1 },
        score: 10 - seenRequests.length,
      }], seenRequests.length === 1
        ? {
            unresponsiveEngines: [{
              engine: 'slow-budget-engine',
              code: 'timeout',
              message: 'engine timed out',
            }],
          }
        : {});
    },
  };
  const timestamps = [
    new Date('2026-06-08T00:00:00.000Z'),
    new Date('2026-06-08T00:00:01.250Z'),
  ];
  const executor = createCodexProviderDeepWebSearchExecutor({
    search,
    now: () => timestamps.shift() ?? new Date('2026-06-08T00:00:01.250Z'),
  });

  const result = await executor(baseRequest({
    query: 'alpha, beta, gamma',
    max_subqueries: 2,
    max_results_per_subquery: 1,
    max_sources: 1,
  }));
  const content = result.content as any;

  assert.equal(seenRequests.length, 2);
  assert.equal(seenRequests[0].maxResults, 1);
  assert.equal(content.sources.length, 1);
  assert.equal(content.diagnostics.planner_strategy, 'heuristic');
  assert.equal(content.diagnostics.selected_subquery_count, 2);
  assert.ok(content.diagnostics.discarded_subquery_count > 0);
  assert.equal(content.diagnostics.timed_out_subquery_count, 1);
  assert.equal(content.diagnostics.retried_subquery_count, 0);
  assert.equal(content.diagnostics.subquery_attempt_count, 2);
  assert.equal(content.diagnostics.unresponsive_engine_count, 1);
  assert.equal(content.diagnostics.search_node_count, 2);
  assert.equal(content.diagnostics.executed_subquery_count, 2);
  assert.equal(content.diagnostics.total_result_count, 2);
  assert.equal(content.diagnostics.max_subqueries, 2);
  assert.equal(content.diagnostics.max_results_per_subquery, 1);
  assert.equal(content.diagnostics.max_sources, 1);
  assert.equal(content.diagnostics.max_subquery_attempts, 1);
  assert.equal(content.diagnostics.subquery_timeout_ms, null);
  assert.equal(content.diagnostics.duration_ms, 1250);
  assert.equal(result.metadata?.plannerStrategy, 'heuristic');
  assert.equal(result.metadata?.selectedSubqueryCount, 2);
  assert.equal(result.metadata?.discardedSubqueryCount, content.diagnostics.discarded_subquery_count);
  assert.equal(result.metadata?.timedOutSubqueryCount, 1);
  assert.equal(result.metadata?.retriedSubqueryCount, 0);
  assert.equal(result.metadata?.subqueryAttemptCount, 2);
  assert.equal(result.metadata?.unresponsiveEngineCount, 1);
  assert.equal(result.metadata?.searchNodeCount, 2);
  assert.equal(result.metadata?.executedSubqueryCount, 2);
  assert.equal(result.metadata?.totalResultCount, 2);
  assert.equal(result.metadata?.maxSubqueries, 2);
  assert.equal(result.metadata?.maxResultsPerSubquery, 1);
  assert.equal(result.metadata?.maxSources, 1);
  assert.equal(result.metadata?.maxSubqueryAttempts, 1);
  assert.equal(result.metadata?.subqueryTimeoutMs, null);
  assert.equal(result.metadata?.durationMs, 1250);
  assert.equal(result.metadata?.sourceCount, 1);
});
