import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCodexProviderLocalIndexingWebRetrievalCache,
  createCodexProviderLocalIndexSearchEngine,
  createCodexProviderMemoryWebRetrievalCache,
  createCodexProviderMemoryWebSearchLocalIndex,
  createCodexProviderMetaSearchService,
  createCodexProviderSqliteFtsLocalIndex,
  createCodexProviderWebSearchExecutor,
  createCodexProviderWebRetrievalFetcher,
  type CodexProviderHostedToolExecutionRequest,
  type CodexProviderOpenAiWebSearchExecutorContent,
} from '../src/index.js';

function baseRequest(argumentsObject: Record<string, any>): CodexProviderHostedToolExecutionRequest {
  return {
    toolName: 'web_search',
    emulatedToolName: 'adapter_web_search',
    callId: 'call_local_index_1',
    arguments: argumentsObject,
    rawArguments: JSON.stringify(argumentsObject),
    model: 'test-model',
    providerKind: 'openai-compatible',
    providerName: 'test-provider',
  };
}

test('memory local web search index ranks cached documents and applies domain filters', () => {
  const index = createCodexProviderMemoryWebSearchLocalIndex({
    documents: [
      {
        url: 'https://docs.example.com/local-index',
        title: 'Local Index Runtime',
        text: 'CodexProvider local index supports retrieval cache search and offline citations.',
        fetchedAt: '2026-06-08T00:00:00.000Z',
      },
      {
        url: 'https://blocked.example.com/local-index',
        title: 'Blocked Local Index',
        text: 'This blocked page also mentions retrieval cache search.',
        fetchedAt: '2026-06-08T00:01:00.000Z',
      },
      {
        url: 'https://docs.example.com/other',
        title: 'Other Runtime',
        text: 'Unrelated deployment notes.',
        fetchedAt: '2026-06-08T00:02:00.000Z',
      },
    ],
  });

  const ranked = index.search({
    query: 'local index retrieval cache',
    maxResults: 3,
    allowedDomains: ['docs.example.com'],
    blockedDomains: ['blocked.example.com'],
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].url, 'https://docs.example.com/local-index');
  assert.equal(ranked[0].rank, 1);
  assert.match(ranked[0].snippet, /local index supports retrieval cache/u);
  assert.deepEqual(index.snapshotStats?.(), {
    entries: 3,
  });
});

test('retrieval cache can index fetched pages for offline metasearch', async () => {
  let fetchCalls = 0;
  const localIndex = createCodexProviderMemoryWebSearchLocalIndex();
  const cache = createCodexProviderLocalIndexingWebRetrievalCache({
    cache: createCodexProviderMemoryWebRetrievalCache(),
    index: localIndex,
    source: 'test-cache',
  });
  const fetcher = createCodexProviderWebRetrievalFetcher({
    cache,
    now: () => new Date('2026-06-08T00:00:00.000Z'),
    fetchImpl: (async () => {
      fetchCalls += 1;
      return new Response(`<!doctype html>
        <html>
          <head><title>Cached Local Index Page</title></head>
          <body>
            <main>
              <p>Cached local index retrieval page for offline web search citations.</p>
            </main>
          </body>
        </html>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }) as typeof fetch,
  });

  await fetcher.fetch('https://docs.example.com/local-index-cache');
  const service = createCodexProviderMetaSearchService({
    engines: [createCodexProviderLocalIndexSearchEngine({
      index: localIndex,
      name: 'local-cache',
    })],
    mode: 'any',
  });
  const response = await service.search({
    query: 'offline web search citations',
    externalWebAccess: false,
  });

  assert.equal(fetchCalls, 1);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].url, 'https://docs.example.com/local-index-cache');
  assert.deepEqual(response.results[0].engines, ['local-cache']);
  assert.equal(response.unresponsiveEngines.length, 0);
});

test('web_search executor uses local index and cached retrieval when external web access is false', async () => {
  const localIndex = createCodexProviderMemoryWebSearchLocalIndex();
  const cache = createCodexProviderLocalIndexingWebRetrievalCache({
    cache: createCodexProviderMemoryWebRetrievalCache(),
    index: localIndex,
  });
  const fetcher = createCodexProviderWebRetrievalFetcher({
    cache,
    now: () => new Date('2026-06-08T00:00:00.000Z'),
    fetchImpl: (async () => new Response(`<!doctype html>
      <html>
        <head><title>Executor Local Index</title></head>
        <body>
          <article>
            Executor local index cache entry grounds offline web search answers.
          </article>
        </body>
      </html>`, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })) as typeof fetch,
  });

  await fetcher.fetch('https://docs.example.com/executor-local-index');
  const executor = createCodexProviderWebSearchExecutor({
    engines: [createCodexProviderLocalIndexSearchEngine({
      index: localIndex,
      name: 'local-cache',
    })],
    retrieval: fetcher,
    mode: 'any',
  });
  const result = await executor(baseRequest({
    query: 'executor local index cache',
    external_web_access: false,
    search_context_size: 'low',
  }));
  const content = result.content as CodexProviderOpenAiWebSearchExecutorContent;

  assert.equal(content.provider, 'metasearch');
  assert.equal(content.external_web_access, false);
  assert.equal(content.results[0].url, 'https://docs.example.com/executor-local-index');
  assert.equal(content.results[0].source, 'local-cache');
  assert.equal(content.documents[0].from_cache, true);
  assert.match(content.chunks[0].text, /Executor local index cache entry/u);
});

test('sqlite fts local index contract delegates to supplied adapter', () => {
  const calls: string[] = [];
  const index = createCodexProviderSqliteFtsLocalIndex({
    adapter: {
      upsert(document) {
        calls.push(`upsert:${document.url}`);
      },
      delete(url) {
        calls.push(`delete:${url}`);
        return true;
      },
      clear() {
        calls.push('clear');
      },
      search(request) {
        calls.push(`search:${request.query}`);
        return [{
          url: 'https://docs.example.com/sqlite',
          finalUrl: 'https://docs.example.com/sqlite',
          title: 'SQLite FTS Result',
          text: 'SQLite FTS adapter contract result.',
          snippet: 'SQLite FTS adapter contract result.',
          contentType: 'text/html',
          fetchedAt: '2026-06-08T00:00:00.000Z',
          source: 'sqlite-fts',
          metadata: null,
          score: 10,
          rank: 1,
        }];
      },
      snapshotStats() {
        return { entries: 1 };
      },
    },
  });

  index.upsert({
    url: 'https://docs.example.com/sqlite',
    text: 'SQLite FTS adapter contract result.',
  });
  const results = index.search({ query: 'sqlite contract' });
  assert.equal(index.delete('https://docs.example.com/sqlite'), true);
  index.clear();

  assert.equal(results[0].title, 'SQLite FTS Result');
  assert.deepEqual(index.snapshotStats?.(), { entries: 1 });
  assert.deepEqual(calls, [
    'upsert:https://docs.example.com/sqlite',
    'search:sqlite contract',
    'delete:https://docs.example.com/sqlite',
    'clear',
  ]);
});
