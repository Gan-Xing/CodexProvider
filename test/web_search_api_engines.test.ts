import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCodexProviderBraveApiEngine,
  createCodexProviderSearchProcessor,
  createCodexProviderSerpApiEngine,
  createCodexProviderSerperApiEngine,
  createCodexProviderTavilyApiEngine,
  type CodexProviderSearchEngineRequest,
} from '../src/index.js';

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

const PUBLIC_RESOLVER = {
  async lookup() {
    return [{ address: '93.184.216.34', family: 4 as const }];
  },
};

test('Tavily API engine posts bearer-authenticated search requests and normalizes results', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const engine = createCodexProviderTavilyApiEngine({
    apiKey: 'tvly-test',
    maxResults: 3,
    searchDepth: 'advanced',
  });
  const processor = createCodexProviderSearchProcessor({
    resolver: PUBLIC_RESOLVER,
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        results: [{
          title: 'Tavily Result',
          url: 'https://docs.example.com/tavily',
          content: 'Tavily content snippet',
          published_date: '2026-06-08',
          score: 0.92,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const outcome = await processor.search(engine, baseEngineRequest({
    maxResults: 2,
    allowedDomains: ['docs.example.com'],
    blockedDomains: ['blocked.example.com'],
    timeRange: 'week',
  }));
  const body = JSON.parse(String(calls[0].init.body));

  assert.equal(calls[0].url, 'https://api.tavily.com/search');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tvly-test');
  assert.equal(body.query, 'codex provider web search');
  assert.equal(body.max_results, 2);
  assert.equal(body.search_depth, 'advanced');
  assert.deepEqual(body.include_domains, ['docs.example.com']);
  assert.deepEqual(body.exclude_domains, ['blocked.example.com']);
  assert.equal(body.time_range, 'week');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.results[0].engine, 'tavily');
  assert.equal(outcome.results[0].url, 'https://docs.example.com/tavily');
  assert.equal(outcome.results[0].snippet, 'Tavily content snippet');
  assert.equal(outcome.results[0].publishedAt, '2026-06-08');
});

test('Brave API engine sends query params and maps web results', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const engine = createCodexProviderBraveApiEngine({
    apiKey: 'brave-test',
    maxResults: 4,
    country: 'us',
    language: 'en',
  });
  const processor = createCodexProviderSearchProcessor({
    resolver: PUBLIC_RESOLVER,
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        web: {
          results: [{
            title: 'Brave Result',
            url: 'https://example.com/brave',
            description: 'Brave description',
            page_age: '2026-06-07',
            thumbnail: {
              src: 'https://example.com/thumb.png',
            },
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const outcome = await processor.search(engine, baseEngineRequest({
    maxResults: 2,
    safeSearch: 'strict',
  }));
  const url = new URL(calls[0].url);

  assert.equal(url.origin + url.pathname, 'https://api.search.brave.com/res/v1/web/search');
  assert.equal(url.searchParams.get('q'), 'codex provider web search');
  assert.equal(url.searchParams.get('count'), '2');
  assert.equal(url.searchParams.get('country'), 'US');
  assert.equal(url.searchParams.get('search_lang'), 'en');
  assert.equal(url.searchParams.get('safesearch'), 'strict');
  assert.equal((calls[0].init.headers as Record<string, string>)['X-Subscription-Token'], 'brave-test');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.results[0].engine, 'brave');
  assert.equal(outcome.results[0].snippet, 'Brave description');
  assert.equal(outcome.results[0].thumbnail, 'https://example.com/thumb.png');
});

test('Serper API engine posts JSON body and maps answer plus organic results', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const engine = createCodexProviderSerperApiEngine({
    apiKey: 'serper-test',
    maxResults: 3,
  });
  const processor = createCodexProviderSearchProcessor({
    resolver: PUBLIC_RESOLVER,
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        answerBox: {
          title: 'Direct Answer',
          answer: 'Serper answer text',
          link: 'https://example.com/answer',
        },
        organic: [{
          title: 'Serper Result',
          link: 'https://example.com/serper',
          snippet: 'Serper snippet',
          date: 'Jun 8, 2026',
          position: 1,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const outcome = await processor.search(engine, baseEngineRequest({
    maxResults: 2,
    region: 'US',
    language: 'EN',
  }));
  const body = JSON.parse(String(calls[0].init.body));

  assert.equal(calls[0].url, 'https://google.serper.dev/search');
  assert.equal((calls[0].init.headers as Record<string, string>)['X-API-KEY'], 'serper-test');
  assert.equal(body.q, 'codex provider web search');
  assert.equal(body.num, 2);
  assert.equal(body.gl, 'us');
  assert.equal(body.hl, 'en');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.results[0].type, 'answer');
  assert.equal(outcome.results[0].url, 'https://example.com/answer');
  assert.equal(outcome.results[1].url, 'https://example.com/serper');
  assert.equal(outcome.results[1].publishedAt, 'Jun 8, 2026');
});

test('SerpApi engine sends query params and maps answer plus organic results', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const engine = createCodexProviderSerpApiEngine({
    apiKey: 'serpapi-test',
    maxResults: 4,
    country: 'us',
    language: 'en',
  });
  const processor = createCodexProviderSearchProcessor({
    resolver: PUBLIC_RESOLVER,
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        answer_box: {
          title: 'Direct Answer',
          answer: 'SerpApi answer text',
          link: 'https://example.com/serpapi-answer',
        },
        organic_results: [{
          title: 'SerpApi Result',
          link: 'https://example.com/serpapi',
          snippet: 'SerpApi snippet',
          date: 'Jun 30, 2026',
          position: 1,
          thumbnail: 'https://example.com/thumb.png',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const outcome = await processor.search(engine, baseEngineRequest({
    maxResults: 2,
    safeSearch: 'strict',
    page: 2,
  }));
  const url = new URL(calls[0].url);

  assert.equal(url.origin + url.pathname, 'https://serpapi.com/search.json');
  assert.equal(url.searchParams.get('engine'), 'google');
  assert.equal(url.searchParams.get('q'), 'codex provider web search');
  assert.equal(url.searchParams.get('api_key'), 'serpapi-test');
  assert.equal(url.searchParams.get('num'), '2');
  assert.equal(url.searchParams.get('start'), '2');
  assert.equal(url.searchParams.get('gl'), 'us');
  assert.equal(url.searchParams.get('hl'), 'en');
  assert.equal(url.searchParams.get('safe'), 'active');
  assert.equal((calls[0].init.headers as Record<string, string>).Accept, 'application/json');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.results[0].type, 'answer');
  assert.equal(outcome.results[0].engine, 'serpapi');
  assert.equal(outcome.results[0].url, 'https://example.com/serpapi-answer');
  assert.equal(outcome.results[1].url, 'https://example.com/serpapi');
  assert.equal(outcome.results[1].publishedAt, 'Jun 30, 2026');
  assert.equal(outcome.results[1].thumbnail, 'https://example.com/thumb.png');
});

test('API engines require explicit keys and processor reports HTTP errors', async () => {
  assert.throws(() => createCodexProviderBraveApiEngine({ apiKey: '' }), /requires an API key/u);

  const engine = createCodexProviderTavilyApiEngine({
    apiKey: 'tvly-test',
  });
  const processor = createCodexProviderSearchProcessor({
    resolver: PUBLIC_RESOLVER,
    fetchImpl: (async () => new Response('rate limited', { status: 429 })) as typeof fetch,
  });

  const outcome = await processor.search(engine, baseEngineRequest());

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error?.code, 'http_error');
  assert.equal(outcome.error?.status, 429);
  assert.equal(outcome.error?.retryable, true);
});
