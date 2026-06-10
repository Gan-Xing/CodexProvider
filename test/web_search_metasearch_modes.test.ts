import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCodexProviderMetaSearchService,
  createCodexProviderSearchProcessor,
  type CodexProviderEngineSearchOutcome,
  type CodexProviderSearchEngine,
  type CodexProviderSearchEngineRequest,
} from '../src/index.js';

function result(engine: string, url: string) {
  return {
    type: 'web' as const,
    engine,
    title: `${engine} result`,
    url,
    snippet: '',
    rank: 1,
    score: null,
  };
}

function baseEngineRequest(overrides: Partial<CodexProviderSearchEngineRequest> = {}): CodexProviderSearchEngineRequest {
  return {
    query: 'codex provider web search',
    category: 'web',
    language: null,
    region: null,
    page: 1,
    safeSearch: null,
    timeRange: null,
    maxResults: 5,
    allowedDomains: [],
    blockedDomains: [],
    externalWebAccess: true,
    rawRequest: {
      query: 'codex provider web search',
    },
    ...overrides,
  };
}

test('fast mode returns before a slow engine finishes and aborts in-flight work', async () => {
  let slowStarted = false;
  let slowAborted = false;
  let slowFinished = false;
  const slow: CodexProviderSearchEngine = {
    name: 'slow',
    categories: ['web'],
    priority: 10,
    search(request) {
      slowStarted = true;
      request.signal?.addEventListener('abort', () => {
        slowAborted = true;
      });
      return new Promise(() => undefined);
    },
  };
  const quick: CodexProviderSearchEngine = {
    name: 'quick',
    categories: ['web'],
    priority: 1,
    async search() {
      return [result('quick', 'https://example.com/quick')];
    },
  };
  const service = createCodexProviderMetaSearchService({
    engines: [slow, quick],
    overallTimeoutMs: 1_000,
  });

  const startedAt = Date.now();
  const response = await service.search({
    query: 'latency',
    mode: 'fast',
  });

  assert.equal(Date.now() - startedAt < 500, true);
  assert.deepEqual(response.results.map((entry) => entry.url), ['https://example.com/quick']);
  assert.equal(slowStarted, true);
  assert.equal(slowAborted, true);
  assert.equal(slowFinished, false);
});

test('balanced mode obeys maxEngineConcurrency and returns all outcomes', async () => {
  let active = 0;
  let maxActive = 0;
  const engines = ['one', 'two', 'three'].map((name): CodexProviderSearchEngine => ({
    name,
    categories: ['web'],
    async search() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      active -= 1;
      return [result(name, `https://example.com/${name}`)];
    },
  }));
  const service = createCodexProviderMetaSearchService({
    engines,
    maxEngineConcurrency: 2,
  });

  const response = await service.search({
    query: 'parallel',
    mode: 'balanced',
    maxResults: 5,
  });

  assert.equal(maxActive <= 2, true);
  assert.equal(response.results.length, 3);
  assert.deepEqual(response.unresponsiveEngines, []);
});

test('any mode stops after the first sufficient successful engine', async () => {
  const calls: string[] = [];
  const engines = ['primary', 'secondary'].map((name): CodexProviderSearchEngine => ({
    name,
    categories: ['web'],
    async search() {
      calls.push(name);
      return [
        result(name, `https://example.com/${name}-1`),
        result(name, `https://example.com/${name}-2`),
      ];
    },
  }));
  const service = createCodexProviderMetaSearchService({
    engines,
  });

  const response = await service.search({
    query: 'first enough',
    mode: 'any',
    maxResults: 2,
  });

  assert.deepEqual(calls, ['primary']);
  assert.equal(response.results.length, 2);
});

test('exhaustive mode records timeout failures without hanging', async () => {
  const good: CodexProviderSearchEngine = {
    name: 'good',
    categories: ['web'],
    async search() {
      return [result('good', 'https://example.com/good')];
    },
  };
  const slow: CodexProviderSearchEngine = {
    name: 'slow',
    categories: ['web'],
    timeoutMs: 20,
    search() {
      return new Promise(() => {});
    },
  };
  const service = createCodexProviderMetaSearchService({
    engines: [good, slow],
    overallTimeoutMs: 200,
  });

  const startedAt = Date.now();
  const response = await service.search({
    query: 'bounded exhaustive',
    mode: 'exhaustive',
  });

  assert.equal(Date.now() - startedAt < 500, true);
  assert.equal(response.results.length, 1);
  assert.equal(response.unresponsiveEngines.length, 1);
  assert.equal(response.unresponsiveEngines[0].engine, 'slow');
  assert.equal(response.unresponsiveEngines[0].code, 'timeout');
});

test('custom engine.search is timeout-wrapped by the processor', async () => {
  const processor = createCodexProviderSearchProcessor();
  const engine: CodexProviderSearchEngine = {
    name: 'custom-timeout',
    categories: ['web'],
    timeoutMs: 20,
    search() {
      return new Promise(() => {});
    },
  };

  const startedAt = Date.now();
  const outcome: CodexProviderEngineSearchOutcome = await processor.search(engine, baseEngineRequest());

  assert.equal(Date.now() - startedAt < 500, true);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error?.code, 'timeout');
  assert.equal(outcome.error?.retryable, true);
});
