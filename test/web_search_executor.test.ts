import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCodexProviderWebSearchExecutor,
  createCodexProviderProviderWebSearchSource,
  createCodexProviderWebRetrievalFetcher,
  type CodexProviderWebSearchExecutorContent,
  type CodexProviderEngineSearchOutcome,
  type CodexProviderMetaSearchService,
  type CodexProviderSearchEngine,
  type CodexProviderSearchProcessor,
  type CodexProviderSearchRequest,
  type CodexProviderWebRetrievalFetcher,
} from '../src/index.js';

const PUBLIC_RESOLVER = {
  async lookup() {
    return [{ address: '93.184.216.34', family: 4 as const }];
  },
};

function baseRequest(argumentsValue: Record<string, any>) {
  return {
    toolName: 'web_search' as const,
    emulatedToolName: 'adapter_web_search',
    callId: 'call_search_1',
    arguments: argumentsValue,
    rawArguments: JSON.stringify(argumentsValue),
    model: 'example-model',
    providerKind: 'openai-compatible',
    providerName: 'Example',
  };
}

test('Tavily web_search executor posts Bearer-authenticated search requests', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const executor = createCodexProviderWebSearchExecutor({
    provider: 'tavily',
    apiKey: 'tvly-test',
    maxResults: 2,
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        answer: 'short answer',
        results: [{
          title: 'Result A',
          url: 'https://example.com/a',
          content: 'Snippet A',
          score: 0.9,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const result = await executor(baseRequest({
    query: 'codex adapter',
    search_context_size: 'high',
  }));
  const body = JSON.parse(String(calls[0].init.body));

  assert.equal(calls[0].url, 'https://api.tavily.com/search');
  assert.equal((calls[0].init.headers as any).Authorization, 'Bearer tvly-test');
  assert.equal(body.query, 'codex adapter');
  assert.equal(body.search_depth, 'advanced');
  const content = result.content as CodexProviderWebSearchExecutorContent;
  assert.equal(content.provider, 'tavily');
  assert.equal(content.answer, 'short answer');
  assert.equal(content.results[0].url, 'https://example.com/a');
});

test('Brave web_search executor maps web.results into normalized results', async () => {
  const calls: string[] = [];
  const executor = createCodexProviderWebSearchExecutor({
    provider: 'brave',
    apiKey: 'brave-test',
    maxResults: 3,
    country: 'us',
    language: 'en',
    fetchImpl: (async (url, init) => {
      calls.push(String(url));
      assert.equal((init?.headers as any)['X-Subscription-Token'], 'brave-test');
      return new Response(JSON.stringify({
        web: {
          results: [{
            title: 'Brave Result',
            url: 'https://example.com/brave',
            description: 'Brave snippet',
            page_age: '2026-06-07',
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const result = await executor(baseRequest({ query: 'brave query' }));
  const url = new URL(calls[0]);

  assert.equal(url.origin + url.pathname, 'https://api.search.brave.com/res/v1/web/search');
  assert.equal(url.searchParams.get('q'), 'brave query');
  assert.equal(url.searchParams.get('count'), '3');
  assert.equal(url.searchParams.get('country'), 'US');
  const content = result.content as CodexProviderWebSearchExecutorContent;
  assert.equal(content.provider, 'brave');
  assert.equal(content.results[0].snippet, 'Brave snippet');
});

test('Serper web_search executor maps organic results and answer boxes', async () => {
  const calls: RequestInit[] = [];
  const executor = createCodexProviderWebSearchExecutor({
    provider: 'serper',
    apiKey: 'serper-test',
    maxResults: 1,
    fetchImpl: (async (_url, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({
        answerBox: {
          answer: 'answer box',
        },
        organic: [{
          title: 'Serper Result',
          link: 'https://example.com/serper',
          snippet: 'Serper snippet',
          position: 1,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const result = await executor(baseRequest({ query: 'serper query' }));
  const body = JSON.parse(String(calls[0].body));

  assert.equal((calls[0].headers as any)['X-API-KEY'], 'serper-test');
  assert.equal(body.q, 'serper query');
  assert.equal(body.num, 1);
  const content = result.content as CodexProviderWebSearchExecutorContent;
  assert.equal(content.provider, 'serper');
  assert.equal(content.answer, 'answer box');
  assert.equal(content.results[0].url, 'https://example.com/serper');
});

test('SerpApi web_search executor maps organic results and answer boxes', async () => {
  const calls: string[] = [];
  const executor = createCodexProviderWebSearchExecutor({
    provider: 'serpapi',
    apiKey: 'serpapi-test',
    maxResults: 2,
    country: 'us',
    language: 'en',
    fetchImpl: (async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        answer_box: {
          answer: 'serpapi answer',
        },
        organic_results: [{
          title: 'SerpApi Result',
          link: 'https://example.com/serpapi',
          snippet: 'SerpApi snippet',
          position: 1,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const result = await executor(baseRequest({ query: 'serpapi query' }));
  const url = new URL(calls[0]);

  assert.equal(url.origin + url.pathname, 'https://serpapi.com/search.json');
  assert.equal(url.searchParams.get('engine'), 'google');
  assert.equal(url.searchParams.get('q'), 'serpapi query');
  assert.equal(url.searchParams.get('api_key'), 'serpapi-test');
  assert.equal(url.searchParams.get('num'), '2');
  assert.equal(url.searchParams.get('gl'), 'us');
  assert.equal(url.searchParams.get('hl'), 'en');
  const content = result.content as CodexProviderWebSearchExecutorContent;
  assert.equal(content.provider, 'serpapi');
  assert.equal(content.answer, 'serpapi answer');
  assert.equal(content.results[0].url, 'https://example.com/serpapi');
});

test('web_search executor rejects offline mode when only live providers are configured', async () => {
  let called = false;
  const executor = createCodexProviderWebSearchExecutor({
    provider: 'tavily',
    apiKey: 'tvly-test',
    fetchImpl: (async () => {
      called = true;
      return new Response('{}');
    }) as typeof fetch,
  });

  await assert.rejects(
    executor(baseRequest({
      query: 'offline query',
      external_web_access: false,
    })),
    /external_web_access=false requires a cache\/offline source/u,
  );
  assert.equal(called, false);
});

test('web_search executor uses cache source when external_web_access is false', async () => {
  let liveCalled = false;
  const executor = createCodexProviderWebSearchExecutor({
    sources: [
      createCodexProviderProviderWebSearchSource({
        provider: 'brave',
        apiKey: 'brave-test',
        fetchImpl: (async () => {
          liveCalled = true;
          return new Response('{}');
        }) as typeof fetch,
      }),
      {
        name: 'cache-index',
        type: 'cache',
        live: false,
        search(request) {
          assert.equal(request.externalWebAccess, false);
          assert.equal(request.returnTokenBudget, 'default');
          assert.deepEqual(request.userLocation, {
            type: 'approximate',
            country: 'US',
            city: 'New York',
          });
          return {
            answer: 'cached answer',
            results: [{
              title: 'Cached Result',
              url: 'https://example.com/cache',
              snippet: 'Cached snippet',
              source: 'cache-index',
            }],
            sources: [{
              title: 'Cached Source',
              url: 'https://example.com/cache',
              source: 'cache-index',
            }],
            citations: [{
              type: 'url_citation',
              title: 'Cached Citation',
              url: 'https://example.com/cache',
            }],
          };
        },
      },
    ],
  });

  const result = await executor(baseRequest({
    query: 'cached query',
    external_web_access: false,
    return_token_budget: 'default',
    user_location: {
      type: 'approximate',
      country: 'US',
      city: 'New York',
    },
  }));
  const content = result.content as CodexProviderWebSearchExecutorContent;

  assert.equal(liveCalled, false);
  assert.equal(content.provider, 'cache-index');
  assert.equal(content.answer, 'cached answer');
  assert.equal(content.external_web_access, false);
  assert.equal(content.search_context_size, 'medium');
  assert.equal(content.return_token_budget, 'default');
  assert.equal(content.sources?.[0].url, 'https://example.com/cache');
  assert.equal(content.citations?.[0].url, 'https://example.com/cache');
});

test('web_search executor accepts valid return_token_budget and rejects invalid values by default', async () => {
  const seenBudgets: unknown[] = [];
  const executor = createCodexProviderWebSearchExecutor({
    sources: [{
      name: 'budget-source',
      type: 'custom',
      live: true,
      search(request) {
        seenBudgets.push(request.returnTokenBudget);
        return {
          results: [],
        };
      },
    }],
  });

  const defaultResult = await executor(baseRequest({
    query: 'default budget',
    return_token_budget: 'default',
  }));
  const unlimitedResult = await executor(baseRequest({
    query: 'unlimited budget',
    return_token_budget: 'unlimited',
  }));

  await assert.rejects(
    () => executor(baseRequest({
      query: 'numeric budget',
      return_token_budget: 400,
    })),
    /expected "default" or "unlimited"/u,
  );
  await assert.rejects(
    () => executor(baseRequest({
      query: 'null budget',
      return_token_budget: null,
    })),
    /expected "default" or "unlimited"/u,
  );
  await assert.rejects(
    () => executor(baseRequest({
      query: 'bad string budget',
      return_token_budget: 'large',
    })),
    /expected "default" or "unlimited"/u,
  );

  assert.deepEqual(seenBudgets, ['default', 'unlimited']);
  assert.equal((defaultResult.content as CodexProviderWebSearchExecutorContent).return_token_budget, 'default');
  assert.equal((unlimitedResult.content as CodexProviderWebSearchExecutorContent).return_token_budget, 'unlimited');
});

test('web_search executor can explicitly drop invalid return_token_budget values with warnings', async () => {
  const seenBudgets: unknown[] = [];
  const executor = createCodexProviderWebSearchExecutor({
    webSearchInvalidParameterStrategy: 'drop',
    sources: [{
      name: 'budget-source',
      type: 'custom',
      live: true,
      search(request) {
        seenBudgets.push(request.returnTokenBudget);
        return {
          results: [],
        };
      },
    }],
  });

  const result = await executor(baseRequest({
    query: 'numeric budget',
    return_token_budget: 400,
  }));
  const content = result.content as CodexProviderWebSearchExecutorContent;

  assert.deepEqual(seenBudgets, [null]);
  assert.equal(content.return_token_budget, undefined);
  assert.equal(result.metadata?.returnTokenBudget, null);
  assert.equal(result.metadata?.warnings?.[0]?.param, 'return_token_budget');
  assert.equal(result.metadata?.warnings?.[0]?.strategy, 'drop');
});

test('web_search executor passes v2 fields and filters source results', async () => {
  const sourceRequests: any[] = [];
  const executor = createCodexProviderWebSearchExecutor({
    sources: [{
      name: 'custom-live',
      type: 'custom',
      live: true,
      search(request) {
        sourceRequests.push(JSON.parse(JSON.stringify({
          query: request.query,
          searchContextSize: request.searchContextSize,
          filters: request.filters,
          externalWebAccess: request.externalWebAccess,
          returnTokenBudget: request.returnTokenBudget,
        })));
        return {
          results: [{
            title: 'Allowed Result',
            url: 'https://docs.example.com/allowed',
            snippet: 'Allowed snippet',
          }, {
            title: 'Blocked Result',
            url: 'https://blocked.example.com/blocked',
            snippet: 'Blocked snippet',
          }],
        };
      },
    }],
  });

  const result = await executor(baseRequest({
    query: 'filtered query',
    search_context_size: 'high',
    return_token_budget: 'unlimited',
    filters: {
      allowed_domains: ['docs.example.com'],
      blocked_domains: ['blocked.example.com'],
    },
  }));
  const content = result.content as CodexProviderWebSearchExecutorContent;

  assert.equal(sourceRequests[0].query, 'filtered query');
  assert.equal(sourceRequests[0].searchContextSize, 'high');
  assert.equal(sourceRequests[0].externalWebAccess, true);
  assert.equal(sourceRequests[0].returnTokenBudget, 'unlimited');
  assert.deepEqual(sourceRequests[0].filters.allowedDomains, ['docs.example.com']);
  assert.deepEqual(sourceRequests[0].filters.blockedDomains, ['blocked.example.com']);
  assert.equal(content.results.length, 1);
  assert.equal(content.results[0].url, 'https://docs.example.com/allowed');
  assert.equal(content.sources?.[0].url, 'https://docs.example.com/allowed');
});

test('Tavily web_search source forwards domain filters to provider request', async () => {
  const calls: RequestInit[] = [];
  const executor = createCodexProviderWebSearchExecutor({
    provider: 'tavily',
    apiKey: 'tvly-test',
    fetchImpl: (async (_url, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({
        results: [{
          title: 'Allowed Result',
          url: 'https://docs.example.com/allowed',
          content: 'Allowed snippet',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const result = await executor(baseRequest({
    query: 'domain query',
    filters: {
      allowed_domains: ['https://docs.example.com/path'],
      blocked_domains: ['blocked.example.com'],
    },
  }));
  const body = JSON.parse(String(calls[0].body));
  const content = result.content as CodexProviderWebSearchExecutorContent;

  assert.deepEqual(body.include_domains, ['docs.example.com']);
  assert.deepEqual(body.exclude_domains, ['blocked.example.com']);
  assert.equal(content.results[0].url, 'https://docs.example.com/allowed');
});

test('metasearch web_search executor returns sources, chunks, and citation instructions', async () => {
  const searchRequests: CodexProviderSearchRequest[] = [];
  const retrievalRequests: any[] = [];
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      searchRequests.push(request);
      return {
        query: request.query,
        mode: request.mode ?? 'balanced',
        results: [{
          title: 'CodexProvider Web Search',
          url: 'https://docs.example.com/web-search',
          snippet: 'Native metasearch and retrieval runtime.',
          engines: ['fake'],
          engineRanks: { fake: 1 },
          score: 1,
        }],
        unresponsiveEngines: [],
        timings: { fake: 3 },
        searchedAt: '2026-06-08T00:00:00.000Z',
      };
    },
  };
  const retrieval: CodexProviderWebRetrievalFetcher = {
    async fetch(request) {
      retrievalRequests.push(request);
      const url = typeof request === 'string' ? request : request.url;
      return {
        url,
        finalUrl: url,
        status: 200,
        contentType: 'text/html',
        title: 'CodexProvider Web Search',
        text: 'CodexProvider retrieval citations use source mapping and quote safe snippets for web search integration.',
        bytes: 100,
        fetchedAt: '2026-06-08T00:00:00.000Z',
        fromCache: false,
        redirectChain: [url],
      };
    },
  };
  const executor = createCodexProviderWebSearchExecutor({
    search,
    retrieval,
    fetchPages: true,
    now: () => new Date('2026-06-08T00:00:00.000Z'),
  });

  const result = await executor(baseRequest({
    query: 'codex provider retrieval citations',
    search_context_size: 'high',
    return_token_budget: 'default',
    filters: {
      allowed_domains: ['docs.example.com'],
      blocked_domains: ['blocked.example.com'],
    },
  }));
  const content = result.content as any;

  assert.equal(searchRequests[0].query, 'codex provider retrieval citations');
  assert.equal(searchRequests[0].maxResults, 10);
  assert.deepEqual(searchRequests[0].allowedDomains, ['docs.example.com']);
  assert.deepEqual(searchRequests[0].blockedDomains, ['blocked.example.com']);
  assert.equal(retrievalRequests[0].url, 'https://docs.example.com/web-search');
  assert.equal(retrievalRequests[0].externalWebAccess, true);
  assert.equal(content.provider, 'metasearch');
  assert.equal(content.return_token_budget, 'default');
  assert.equal(content.results[0].url, 'https://docs.example.com/web-search');
  assert.equal(content.sources[0].id, 1);
  assert.equal(content.documents[0].from_cache, false);
  assert.match(content.chunks[0].text, /retrieval citations/u);
  assert.match(content.instructions, /\[\[source:N\]\]/u);
  assert.equal(result.metadata?.chunkCount, 1);
  assert.equal(result.metadata?.retrievalCacheHitCount, 0);
  assert.equal(result.metadata?.retrievalCacheMissCount, 1);
});

test('metasearch web_search executor fetches pages by default with engine results', async () => {
  const fetchUrls: string[] = [];
  const engine: CodexProviderSearchEngine = {
    name: 'default-fetch-engine',
    categories: ['web'],
    buildRequest(request) {
      return {
        url: `https://search.example.com?q=${encodeURIComponent(request.query)}`,
      };
    },
    parseResponse() {
      return [];
    },
  };
  const processor: CodexProviderSearchProcessor = {
    async search(searchEngine, request): Promise<CodexProviderEngineSearchOutcome> {
      return {
        engine: searchEngine.name,
        ok: true,
        durationMs: 1,
        results: [{
          type: 'web',
          engine: searchEngine.name,
          title: 'Default Fetch Result',
          url: 'https://docs.example.com/default-fetch',
          snippet: 'Search snippet before page retrieval.',
          rank: 1,
          score: 1,
        }],
        error: null,
      };
    },
  };
  const retrieval = createCodexProviderWebRetrievalFetcher({
    safety: { resolver: PUBLIC_RESOLVER },
    fetchImpl: (async (url) => {
      fetchUrls.push(String(url));
      return new Response([
        '<html><head><title>Default Fetch Result</title></head><body>',
        '<main>Default page retrieval content grounds the web search answer with citations.</main>',
        '</body></html>',
      ].join(''), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }) as typeof fetch,
  });
  const executor = createCodexProviderWebSearchExecutor({
    engines: [engine],
    processor,
    retrieval,
  });

  const result = await executor(baseRequest({
    query: 'default fetch query',
  }));
  const content = result.content as any;

  assert.deepEqual(fetchUrls, ['https://docs.example.com/default-fetch']);
  assert.equal(content.documents[0].url, 'https://docs.example.com/default-fetch');
  assert.match(content.chunks[0].text, /Default page retrieval content/u);
  assert.equal(result.metadata?.documentCount, 1);
  assert.equal(result.metadata?.chunkCount, 1);
  assert.equal(result.metadata?.retrievalCacheHitCount, 0);
  assert.equal(result.metadata?.retrievalCacheMissCount, 1);
});

test('metasearch web_search executor keeps page retrieval disabled when fetchPages is false', async () => {
  let fetchCalled = false;
  const engine: CodexProviderSearchEngine = {
    name: 'no-fetch-engine',
    categories: ['web'],
    buildRequest(request) {
      return {
        url: `https://search.example.com?q=${encodeURIComponent(request.query)}`,
      };
    },
    parseResponse() {
      return [];
    },
  };
  const processor: CodexProviderSearchProcessor = {
    async search(searchEngine, request): Promise<CodexProviderEngineSearchOutcome> {
      return {
        engine: searchEngine.name,
        ok: true,
        durationMs: 1,
        results: [{
          type: 'web',
          engine: searchEngine.name,
          title: 'No Fetch Result',
          url: 'https://docs.example.com/no-fetch',
          snippet: 'Search snippet only.',
          rank: 1,
          score: 1,
        }],
        error: null,
      };
    },
  };
  const executor = createCodexProviderWebSearchExecutor({
    engines: [engine],
    processor,
    fetchPages: false,
    fetchImpl: (async () => {
      fetchCalled = true;
      return new Response('');
    }) as typeof fetch,
  });

  const result = await executor(baseRequest({
    query: 'no fetch query',
  }));
  const content = result.content as any;

  assert.equal(fetchCalled, false);
  assert.equal(content.results[0].url, 'https://docs.example.com/no-fetch');
  assert.equal(content.documents.length, 0);
  assert.equal(content.chunks.length, 0);
});

test('metasearch web_search executor rejects invalid return_token_budget by default', async () => {
  const executor = createCodexProviderWebSearchExecutor({
    search: {
      async search(request) {
        return {
          query: request.query,
          mode: request.mode ?? 'balanced',
          results: [],
          unresponsiveEngines: [],
          timings: {},
          searchedAt: '2026-06-08T00:00:00.000Z',
        };
      },
    },
  });

  await assert.rejects(
    () => executor(baseRequest({
      query: 'invalid metasearch budget',
      return_token_budget: 'large',
    })),
    /expected "default" or "unlimited"/u,
  );
});

test('metasearch web_search executor passes external_web_access=false through retrieval', async () => {
  let searchExternalWebAccess: boolean | null | undefined;
  let retrievalExternalWebAccess: boolean | null | undefined;
  const search: CodexProviderMetaSearchService = {
    async search(request) {
      searchExternalWebAccess = request.externalWebAccess;
      return {
        query: request.query,
        mode: request.mode ?? 'balanced',
        results: [{
          title: 'Cached Result',
          url: 'https://cache.example.com/result',
          snippet: 'Cached snippet',
          engines: ['cache'],
          engineRanks: { cache: 1 },
          score: 1,
        }],
        unresponsiveEngines: [],
        timings: { cache: 1 },
        searchedAt: '2026-06-08T00:00:00.000Z',
      };
    },
  };
  const retrieval: CodexProviderWebRetrievalFetcher = {
    async fetch(request) {
      retrievalExternalWebAccess = typeof request === 'string' ? true : request.externalWebAccess;
      const url = typeof request === 'string' ? request : request.url;
      return {
        url,
        finalUrl: url,
        status: 200,
        contentType: 'text/html',
        title: 'Cached Result',
        text: 'Cached retrieval text for offline web search.',
        bytes: 48,
        fetchedAt: '2026-06-08T00:00:00.000Z',
        fromCache: true,
        redirectChain: [url],
      };
    },
  };
  const executor = createCodexProviderWebSearchExecutor({
    search,
    retrieval,
    fetchPages: true,
  });

  const result = await executor(baseRequest({
    query: 'offline cached query',
    external_web_access: false,
  }));
  const content = result.content as any;

  assert.equal(searchExternalWebAccess, false);
  assert.equal(retrievalExternalWebAccess, false);
  assert.equal(content.external_web_access, false);
  assert.equal(content.documents[0].from_cache, true);
  assert.equal(result.metadata?.retrievalCacheHitCount, 1);
  assert.equal(result.metadata?.retrievalCacheMissCount, 0);
});

test('web_search executor can build metasearch service from engines and processor', async () => {
  const calls: Array<{ engine: string; externalWebAccess: boolean }> = [];
  const engine: CodexProviderSearchEngine = {
    name: 'cache-engine',
    categories: ['web'],
    live: false,
    buildRequest(request) {
      return {
        url: `https://cache.example.com/search?q=${encodeURIComponent(request.query)}`,
      };
    },
    parseResponse() {
      return [];
    },
  };
  const processor: CodexProviderSearchProcessor = {
    async search(searchEngine, request): Promise<CodexProviderEngineSearchOutcome> {
      calls.push({
        engine: searchEngine.name,
        externalWebAccess: request.externalWebAccess,
      });
      return {
        engine: searchEngine.name,
        ok: true,
        durationMs: 2,
        results: [{
          type: 'web',
          engine: searchEngine.name,
          title: 'Engine Result',
          url: 'https://cache.example.com/engine',
          snippet: 'Engine snippet',
          rank: 1,
          score: 1,
        }],
        error: null,
      };
    },
  };
  const executor = createCodexProviderWebSearchExecutor({
    engines: [engine],
    processor,
    mode: 'any',
    fetchPages: false,
  });

  const result = await executor(baseRequest({
    query: 'cache engine query',
    external_web_access: false,
  }));
  const content = result.content as any;

  assert.deepEqual(calls, [{
    engine: 'cache-engine',
    externalWebAccess: false,
  }]);
  assert.equal(content.provider, 'metasearch');
  assert.equal(content.results[0].url, 'https://cache.example.com/engine');
  assert.equal(content.chunks.length, 0);
});
