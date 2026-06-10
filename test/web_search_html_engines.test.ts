import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createCodexProviderBraveHtmlEngine,
  createCodexProviderDuckDuckGoHtmlEngine,
  createCodexProviderEcosiaHtmlEngine,
  createCodexProviderMojeekHtmlEngine,
  createCodexProviderSearchProcessor,
  type CodexProviderEngineHttpResponse,
  type CodexProviderSearchEngine,
  type CodexProviderSearchEngineRequest,
} from '../src/index.js';

const PUBLIC_RESOLVER = {
  async lookup() {
    return [{ address: '93.184.216.34', family: 4 as const }];
  },
};

const FIXTURE_BASE_URL = new URL('./fixtures/web-search/', import.meta.url);

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

async function fixture(name: string): Promise<string> {
  return readFile(new URL(name, FIXTURE_BASE_URL), 'utf8');
}

function htmlResponse(html: string): CodexProviderEngineHttpResponse {
  return {
    status: 200,
    ok: true,
    url: 'https://search.example.test/search',
    headers: { 'content-type': 'text/html' },
    text: html,
    json: null,
  };
}

test('HTML engines build GET requests with provider-specific params', async () => {
  const request = baseEngineRequest({
    language: 'EN',
    region: 'US',
    maxResults: 3,
  });

  const duckduckgoRequest = await createCodexProviderDuckDuckGoHtmlEngine({
    endpoint: 'https://duck.example.test/html/',
    maxResults: 7,
  }).buildRequest(request);
  const duckduckgoUrl = new URL(duckduckgoRequest.url);
  assert.equal(duckduckgoUrl.origin + duckduckgoUrl.pathname, 'https://duck.example.test/html/');
  assert.equal(duckduckgoUrl.searchParams.get('q'), 'codex provider web search');
  assert.equal(duckduckgoUrl.searchParams.get('count'), '3');

  const braveRequest = await createCodexProviderBraveHtmlEngine({
    endpoint: 'https://brave.example.test/search',
    language: 'FR',
    maxResults: 10,
  }).buildRequest(request);
  const braveUrl = new URL(braveRequest.url);
  assert.equal(braveUrl.searchParams.get('lang'), 'fr');
  assert.equal(braveUrl.searchParams.get('count'), '3');

  const ecosiaRequest = await createCodexProviderEcosiaHtmlEngine({
    endpoint: 'https://ecosia.example.test/search',
    region: 'DE',
  }).buildRequest(request);
  const ecosiaUrl = new URL(ecosiaRequest.url);
  assert.equal(ecosiaUrl.searchParams.get('lang'), 'en');
  assert.equal(ecosiaUrl.searchParams.get('addon'), 'de');

  const mojeekRequest = await createCodexProviderMojeekHtmlEngine({
    endpoint: 'https://mojeek.example.test/search',
  }).buildRequest(request);
  const mojeekUrl = new URL(mojeekRequest.url);
  assert.equal(mojeekUrl.searchParams.get('reg'), 'us');
});

const htmlEngineCases: Array<{
  name: string;
  engine: CodexProviderSearchEngine;
  fixture: string;
  expectedTitle: string;
  expectedUrl: string;
  expectedSnippet: string;
}> = [
  {
    name: 'DuckDuckGo HTML',
    engine: createCodexProviderDuckDuckGoHtmlEngine({ maxResults: 5 }),
    fixture: 'duckduckgo-html.html',
    expectedTitle: 'Duck result & docs',
    expectedUrl: 'https://docs.example.com/duckduckgo',
    expectedSnippet: 'Duck snippet native search.',
  },
  {
    name: 'Brave HTML',
    engine: createCodexProviderBraveHtmlEngine({ maxResults: 5 }),
    fixture: 'brave-html.html',
    expectedTitle: 'Brave Result',
    expectedUrl: 'https://brave.example.com/result',
    expectedSnippet: 'Brave HTML snippet.',
  },
  {
    name: 'Ecosia HTML',
    engine: createCodexProviderEcosiaHtmlEngine({ maxResults: 5 }),
    fixture: 'ecosia-html.html',
    expectedTitle: 'Ecosia Result',
    expectedUrl: 'https://ecosia.example.com/result',
    expectedSnippet: 'Ecosia HTML snippet.',
  },
  {
    name: 'Mojeek HTML',
    engine: createCodexProviderMojeekHtmlEngine({ maxResults: 5 }),
    fixture: 'mojeek-html.html',
    expectedTitle: 'Mojeek Result',
    expectedUrl: 'https://mojeek.example.com/result',
    expectedSnippet: 'Mojeek HTML snippet.',
  },
];

for (const htmlEngineCase of htmlEngineCases) {
  test(`${htmlEngineCase.name} parses fixture results and cleans tracking URLs`, async () => {
    const html = await fixture(htmlEngineCase.fixture);
    const results = await htmlEngineCase.engine.parseResponse(htmlResponse(html), baseEngineRequest());

    assert.equal(results.length, 1);
    assert.equal(results[0].engine, htmlEngineCase.engine.name);
    assert.equal(results[0].title, htmlEngineCase.expectedTitle);
    assert.equal(results[0].url, htmlEngineCase.expectedUrl);
    assert.equal(results[0].snippet, htmlEngineCase.expectedSnippet);
    assert.equal(results[0].rank, 1);
  });
}

test('HTML engines classify no-results pages as successful empty responses', async () => {
  const html = await fixture('no-results.html');
  const results = await createCodexProviderDuckDuckGoHtmlEngine()
    .parseResponse(htmlResponse(html), baseEngineRequest());

  assert.deepEqual(results, []);
});

test('HTML engines classify captcha and blocked pages as retryable engine errors', async () => {
  const html = await fixture('blocked.html');
  const engine = createCodexProviderDuckDuckGoHtmlEngine();
  const processor = createCodexProviderSearchProcessor({
    resolver: PUBLIC_RESOLVER,
    fetchImpl: (async () => new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })) as typeof fetch,
  });

  const outcome = await processor.search(engine, baseEngineRequest());

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error?.code, 'engine_blocked');
  assert.equal(outcome.error?.retryable, true);
});
