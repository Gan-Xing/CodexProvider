import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCodexProviderMetaSearchService,
  createCodexProviderSearchEngineRegistry,
  createCodexProviderSearchEngineState,
  type CodexProviderEngineSearchOutcome,
  type CodexProviderSearchEngine,
  type CodexProviderSearchEngineRequest,
  type CodexProviderSearchProcessor,
} from '../src/index.js';

function createFakeEngine(
  name: string,
  options: {
    priority?: number;
    live?: boolean;
    categories?: CodexProviderSearchEngine['categories'];
  } = {},
): CodexProviderSearchEngine {
  return {
    name,
    categories: options.categories ?? ['web'],
    priority: options.priority ?? 0,
    live: options.live ?? true,
    buildRequest(request) {
      return {
        url: `https://${name}.example/search?q=${encodeURIComponent(request.query)}`,
      };
    },
    parseResponse(response) {
      const body = JSON.parse(response.text) as {
        results?: Array<{ title: string; url: string; snippet?: string; score?: number }>;
      };
      return (body.results ?? []).map((result, index) => ({
        type: 'web' as const,
        engine: name,
        title: result.title,
        url: result.url,
        snippet: result.snippet ?? '',
        rank: index + 1,
        score: result.score ?? null,
      }));
    },
  };
}

function createFakeProcessor(
  responses: Record<string, {
    ok?: boolean;
    durationMs?: number;
    results?: Array<{ title: string; url: string; snippet?: string; rank?: number; score?: number | null }>;
    error?: string;
  }>,
  calls: string[] = [],
): CodexProviderSearchProcessor {
  return {
    async search(engine, request): Promise<CodexProviderEngineSearchOutcome> {
      calls.push(engine.name);
      const response = responses[engine.name] ?? {};
      if (response.ok === false) {
        return {
          engine: engine.name,
          ok: false,
          durationMs: response.durationMs ?? 1,
          results: [],
          error: {
            code: 'fake_failure',
            message: response.error ?? `${engine.name} failed`,
            retryable: true,
          },
        };
      }
      return {
        engine: engine.name,
        ok: true,
        durationMs: response.durationMs ?? 1,
        results: (response.results ?? []).map((result, index) => ({
          type: 'web',
          engine: engine.name,
          title: result.title,
          url: result.url,
          snippet: result.snippet ?? '',
          rank: result.rank ?? index + 1,
          score: result.score ?? null,
        })),
        error: null,
      };
    },
  };
}

test('metasearch registry registers, lists, and rejects duplicate engines', () => {
  const registry = createCodexProviderSearchEngineRegistry();
  registry.register(createFakeEngine('slow', { priority: 1 }));
  registry.register(createFakeEngine('fast', { priority: 10 }));

  assert.equal(registry.has('FAST'), true);
  assert.equal(registry.get('fast')?.name, 'fast');
  assert.deepEqual(registry.list().map((engine) => engine.name), ['fast', 'slow']);
  assert.throws(() => registry.register(createFakeEngine('fast')), /already registered/u);
});

test('balanced mode runs engines in parallel and merges duplicate urls', async () => {
  const service = createCodexProviderMetaSearchService({
    engines: [
      createFakeEngine('brave', { priority: 10 }),
      createFakeEngine('serper', { priority: 5 }),
    ],
    processor: createFakeProcessor({
      brave: {
        results: [{
          title: 'CodexProvider Web Search',
          url: 'https://docs.example.com/web-search?utm_source=newsletter',
          snippet: 'CodexProvider native metasearch runtime.',
        }],
      },
      serper: {
        results: [{
          title: 'Web Search Runtime',
          url: 'https://docs.example.com/web-search',
          snippet: 'Native metasearch and retrieval runtime for CodexProvider.',
        }],
      },
    }),
  });

  const response = await service.search({
    query: 'codexprovider web search runtime',
    mode: 'balanced',
    maxResults: 5,
  });

  assert.equal(response.mode, 'balanced');
  assert.equal(response.results.length, 1);
  assert.deepEqual(response.results[0].engines, ['brave', 'serper']);
  assert.equal(response.results[0].engineRanks.brave, 1);
  assert.equal(response.results[0].engineRanks.serper, 1);
  assert.equal(response.unresponsiveEngines.length, 0);
});

test('any mode stops after the first priority engine returns enough results', async () => {
  const calls: string[] = [];
  const service = createCodexProviderMetaSearchService({
    engines: [
      createFakeEngine('primary', { priority: 10 }),
      createFakeEngine('secondary', { priority: 1 }),
    ],
    processor: createFakeProcessor({
      primary: {
        results: [
          { title: 'A', url: 'https://example.com/a' },
          { title: 'B', url: 'https://example.com/b' },
        ],
      },
      secondary: {
        results: [{ title: 'C', url: 'https://example.com/c' }],
      },
    }, calls),
  });

  const response = await service.search({
    query: 'first enough',
    mode: 'any',
    maxResults: 2,
  });

  assert.deepEqual(calls, ['primary']);
  assert.equal(response.results.length, 2);
});

test('fast mode returns the first successful engine result set to complete', async () => {
  const service = createCodexProviderMetaSearchService({
    engines: [
      createFakeEngine('slow', { priority: 10 }),
      createFakeEngine('quick', { priority: 1 }),
    ],
    processor: {
      async search(engine): Promise<CodexProviderEngineSearchOutcome> {
        if (engine.name === 'slow') {
          await new Promise((resolve) => {
            setTimeout(resolve, 40);
          });
          return {
            engine: engine.name,
            ok: true,
            durationMs: 40,
            results: [{
              type: 'web',
              engine: engine.name,
              title: 'Slow',
              url: 'https://example.com/slow',
              snippet: '',
              rank: 1,
              score: null,
            }],
            error: null,
          };
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
        return {
          engine: engine.name,
          ok: true,
          durationMs: 5,
          results: [{
            type: 'web',
            engine: engine.name,
            title: 'Quick',
            url: 'https://example.com/quick',
            snippet: '',
            rank: 1,
            score: null,
          }],
          error: null,
        };
      },
    },
  });

  const response = await service.search({
    query: 'latency',
    mode: 'fast',
    maxResults: 5,
  });

  assert.deepEqual(response.results.map((result) => result.url), ['https://example.com/quick']);
});

test('exhaustive mode records partial failures without failing the whole search', async () => {
  const service = createCodexProviderMetaSearchService({
    engines: [
      createFakeEngine('good'),
      createFakeEngine('bad'),
    ],
    processor: createFakeProcessor({
      good: {
        results: [{ title: 'Good', url: 'https://example.com/good' }],
      },
      bad: {
        ok: false,
        error: 'upstream blocked',
      },
    }),
  });

  const response = await service.search({
    query: 'partial failure',
    mode: 'exhaustive',
  });

  assert.equal(response.results.length, 1);
  assert.deepEqual(response.unresponsiveEngines.map((engine) => engine.engine), ['bad']);
  assert.equal(response.unresponsiveEngines[0].code, 'fake_failure');
});

test('engine state suspends repeatedly failing engines', async () => {
  const now = new Date('2026-06-08T00:00:00.000Z');
  const engineState = createCodexProviderSearchEngineState({
    failureThreshold: 2,
    suspensionMs: 30_000,
  });
  const calls: string[] = [];
  const service = createCodexProviderMetaSearchService({
    engines: [createFakeEngine('flaky')],
    engineState,
    now: () => now,
    processor: createFakeProcessor({
      flaky: {
        ok: false,
        error: 'timeout',
      },
    }, calls),
  });

  await service.search({ query: 'one' });
  await service.search({ query: 'two' });
  const response = await service.search({ query: 'three' });

  assert.deepEqual(calls, ['flaky', 'flaky']);
  assert.equal(response.results.length, 0);
  assert.equal(response.unresponsiveEngines[0].code, 'engine_suspended');
  assert.match(response.unresponsiveEngines[0].suspendedUntil ?? '', /^2026-06-08T00:00:30\.000Z$/u);
});

test('domain filters are normalized and applied after engine search', async () => {
  let seenRequest: CodexProviderSearchEngineRequest | null = null;
  const service = createCodexProviderMetaSearchService({
    engines: [createFakeEngine('filter')],
    processor: {
      async search(engine, request) {
        seenRequest = request;
        return createFakeProcessor({
          filter: {
            results: [
              { title: 'Allowed', url: 'https://docs.example.com/allowed' },
              { title: 'Blocked', url: 'https://blocked.example.com/nope' },
              { title: 'Other', url: 'https://other.example.com/nope' },
            ],
          },
        }).search(engine, request);
      },
    },
  });

  const response = await service.search({
    query: 'filters',
    allowedDomains: ['https://docs.example.com/path', 'docs.example.com'],
    blockedDomains: ['blocked.example.com'],
  });

  assert.deepEqual(seenRequest?.allowedDomains, ['docs.example.com']);
  assert.deepEqual(response.results.map((result) => result.url), ['https://docs.example.com/allowed']);
});
