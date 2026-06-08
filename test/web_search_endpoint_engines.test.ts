import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCodexProviderOpenSerpEndpointEngine,
  createCodexProviderSearchProcessor,
  createCodexProviderSearxngEndpointEngine,
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

test('SearXNG endpoint engine builds JSON requests and normalizes results', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const engine = createCodexProviderSearxngEndpointEngine({
    endpoint: 'https://searxng.example.test/',
    maxResults: 3,
    apiKey: 'searxng-token',
  });
  const processor = createCodexProviderSearchProcessor({
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        query: 'codex provider web search',
        answers: [{
          title: 'Direct answer',
          url: 'https://docs.example.com/answer',
          answer: 'SearXNG answer text',
        }],
        results: [{
          title: 'SearXNG Result',
          url: 'https://docs.example.com/searxng',
          content: 'SearXNG result content',
          engine: 'duckduckgo',
          category: 'general',
          publishedDate: '2026-06-08T00:00:00Z',
          score: 0.81,
        }],
        unresponsive_engines: [],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const outcome = await processor.search(engine, baseEngineRequest({
    language: 'EN',
    page: 2,
    safeSearch: 'strict',
    timeRange: 'week',
    maxResults: 2,
  }));
  const url = new URL(calls[0].url);

  assert.equal(url.origin + url.pathname, 'https://searxng.example.test/search');
  assert.equal(url.searchParams.get('q'), 'codex provider web search');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('categories'), 'general');
  assert.equal(url.searchParams.get('language'), 'en');
  assert.equal(url.searchParams.get('pageno'), '2');
  assert.equal(url.searchParams.get('safesearch'), '2');
  assert.equal(url.searchParams.get('time_range'), 'week');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer searxng-token');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.results[0].type, 'answer');
  assert.equal(outcome.results[0].engine, 'searxng');
  assert.equal(outcome.results[0].url, 'https://docs.example.com/answer');
  assert.equal(outcome.results[1].title, 'SearXNG Result');
  assert.equal(outcome.results[1].snippet, 'SearXNG result content');
  assert.equal(outcome.results[1].publishedAt, '2026-06-08T00:00:00Z');
  assert.equal(outcome.results[1].score, 0.81);
});

test('OpenSERP endpoint engine builds engine paths and normalizes envelopes', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const engine = createCodexProviderOpenSerpEndpointEngine({
    endpoint: 'https://openserp.example.test/api',
    engine: 'google',
    maxResults: 4,
    region: 'DE',
  });
  const processor = createCodexProviderSearchProcessor({
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        query: {
          text: 'codex provider web search',
          lang: 'EN',
          region: 'DE',
        },
        meta: {
          request_id: 'req_1',
          engines_failed: [],
        },
        results: [{
          id: 's_1',
          rank: 1,
          type: 'organic',
          title: 'OpenSERP Result',
          url: 'https://docs.example.com/openserp',
          snippet: 'OpenSERP snippet',
          position: { absolute: 1 },
          engine: 'google',
          score: 0.9,
        }, {
          id: 's_2',
          rank: 2,
          type: 'news',
          title: 'OpenSERP News',
          url: 'https://news.example.com/openserp',
          snippet: 'OpenSERP news snippet',
          position: { absolute: 2 },
          engine: 'google',
        }],
        serp_features: [{
          id: 'f_1',
          type: 'ai_summary',
          text: 'OpenSERP answer text',
          confidence: 0.95,
          links: [{
            title: 'OpenSERP Source',
            url: 'https://docs.example.com/summary',
          }],
        }],
        pagination: {
          page: 1,
          has_more: false,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const outcome = await processor.search(engine, baseEngineRequest({
    language: 'EN',
    region: 'US',
    page: 3,
    maxResults: 2,
    allowedDomains: ['docs.example.com'],
  }));
  const url = new URL(calls[0].url);

  assert.equal(url.origin + url.pathname, 'https://openserp.example.test/api/google/search');
  assert.equal(url.searchParams.get('text'), 'codex provider web search');
  assert.equal(url.searchParams.get('limit'), '2');
  assert.equal(url.searchParams.get('start'), '4');
  assert.equal(url.searchParams.get('lang'), 'EN');
  assert.equal(url.searchParams.get('region'), 'DE');
  assert.equal(url.searchParams.get('site'), 'docs.example.com');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.results[0].type, 'answer');
  assert.equal(outcome.results[0].url, 'https://docs.example.com/summary');
  assert.equal(outcome.results[1].engine, 'openserp');
  assert.equal(outcome.results[1].title, 'OpenSERP Result');
  assert.equal(outcome.results[1].snippet, 'OpenSERP snippet');
  assert.equal(outcome.results[2].type, 'news');
});

test('endpoint engines surface JSON and HTTP endpoint errors', async () => {
  const jsonErrorEngine = createCodexProviderOpenSerpEndpointEngine({
    endpoint: 'https://openserp.example.test/',
  });
  const jsonErrorProcessor = createCodexProviderSearchProcessor({
    fetchImpl: (async () => new Response(JSON.stringify({
      error: 'bad_request',
      code: 400,
      reason: 'NO_ENGINES',
      message: 'NO_ENGINES: no engines are enabled',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch,
  });

  const jsonErrorOutcome = await jsonErrorProcessor.search(jsonErrorEngine, baseEngineRequest());

  assert.equal(jsonErrorOutcome.ok, false);
  assert.equal(jsonErrorOutcome.error?.code, 'endpoint_error');
  assert.equal(jsonErrorOutcome.error?.status, 400);
  assert.equal(jsonErrorOutcome.error?.retryable, false);

  const httpErrorEngine = createCodexProviderSearxngEndpointEngine({
    endpoint: 'https://searxng.example.test/',
  });
  const httpErrorProcessor = createCodexProviderSearchProcessor({
    fetchImpl: (async () => new Response('upstream unavailable', { status: 503 })) as typeof fetch,
  });

  const httpErrorOutcome = await httpErrorProcessor.search(httpErrorEngine, baseEngineRequest());

  assert.equal(httpErrorOutcome.ok, false);
  assert.equal(httpErrorOutcome.error?.code, 'http_error');
  assert.equal(httpErrorOutcome.error?.status, 503);
  assert.equal(httpErrorOutcome.error?.retryable, true);
});
