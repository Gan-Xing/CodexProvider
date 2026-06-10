import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodexProviderWebRetrievalError,
  createCodexProviderSearchProcessor,
  createCodexProviderWebRetrievalFetcher,
  type CodexProviderNetworkResolver,
  type CodexProviderSearchEngine,
  type CodexProviderSearchEngineRequest,
} from '../src/index.js';

function resolverFor(hosts: Record<string, string>, fallback = '93.184.216.34'): CodexProviderNetworkResolver {
  return {
    async lookup(hostname) {
      const address = hosts[hostname.toLowerCase()] ?? fallback;
      return [{
        address,
        family: address.includes(':') ? 6 : 4,
      }];
    },
  };
}

function assertRetrievalError(error: unknown, code: string): boolean {
  assert.equal(error instanceof CodexProviderWebRetrievalError, true);
  assert.equal((error as CodexProviderWebRetrievalError).code, code);
  return true;
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

function endpointEngine(url: string): CodexProviderSearchEngine {
  return {
    name: 'endpoint',
    categories: ['web'],
    buildRequest() {
      return { url };
    },
    parseResponse(response) {
      const body = JSON.parse(response.text) as {
        results?: Array<{ title: string; url: string; snippet?: string }>;
      };
      return (body.results ?? []).map((result, index) => ({
        type: 'web' as const,
        engine: 'endpoint',
        title: result.title,
        url: result.url,
        snippet: result.snippet ?? '',
        rank: index + 1,
      }));
    },
  };
}

test('web retrieval blocks hostname resolving to 127.0.0.1', async () => {
  let called = false;
  const fetcher = createCodexProviderWebRetrievalFetcher({
    safety: {
      resolver: resolverFor({ 'public.test': '127.0.0.1' }),
    },
    fetchImpl: (async () => {
      called = true;
      return new Response('should not be called');
    }) as typeof fetch,
  });

  await assert.rejects(
    fetcher.fetch('https://public.test/page'),
    (error) => assertRetrievalError(error, 'ssrf_blocked'),
  );
  assert.equal(called, false);
});

test('web retrieval blocks hostname resolving to 10.x.x.x', async () => {
  let called = false;
  const fetcher = createCodexProviderWebRetrievalFetcher({
    safety: {
      resolver: resolverFor({ 'public.test': '10.1.2.3' }),
    },
    fetchImpl: (async () => {
      called = true;
      return new Response('should not be called');
    }) as typeof fetch,
  });

  await assert.rejects(
    fetcher.fetch('https://public.test/page'),
    (error) => assertRetrievalError(error, 'ssrf_blocked'),
  );
  assert.equal(called, false);
});

test('web retrieval blocks hostname resolving to 169.254.169.254', async () => {
  let called = false;
  const fetcher = createCodexProviderWebRetrievalFetcher({
    safety: {
      resolver: resolverFor({ 'metadata-proxy.test': '169.254.169.254' }),
    },
    fetchImpl: (async () => {
      called = true;
      return new Response('should not be called');
    }) as typeof fetch,
  });

  await assert.rejects(
    fetcher.fetch('https://metadata-proxy.test/latest'),
    (error) => assertRetrievalError(error, 'ssrf_blocked'),
  );
  assert.equal(called, false);
});

test('web retrieval blocks redirect targets resolving to private addresses', async () => {
  const calls: string[] = [];
  const fetcher = createCodexProviderWebRetrievalFetcher({
    safety: {
      resolver: resolverFor({
        'public.test': '93.184.216.34',
        'internal.test': '10.0.0.5',
      }),
    },
    fetchImpl: (async (url) => {
      calls.push(String(url));
      return new Response('', {
        status: 302,
        headers: {
          Location: 'https://internal.test/admin',
        },
      });
    }) as typeof fetch,
  });

  await assert.rejects(
    fetcher.fetch('https://public.test/search-result'),
    (error) => assertRetrievalError(error, 'ssrf_blocked'),
  );
  assert.deepEqual(calls, ['https://public.test/search-result']);
});

test('metasearch HTTP engine endpoint resolving private is blocked before fetch', async () => {
  let called = false;
  const processor = createCodexProviderSearchProcessor({
    resolver: resolverFor({ 'searxng.test': '10.0.0.8' }),
    fetchImpl: (async () => {
      called = true;
      return new Response('should not be called');
    }) as typeof fetch,
  });

  const outcome = await processor.search(endpointEngine('https://searxng.test/search?q=test'), baseEngineRequest());

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error?.code, 'ssrf_blocked');
  assert.equal(called, false);
});

test('metasearch HTTP engine redirect target resolving private is blocked', async () => {
  const calls: string[] = [];
  const processor = createCodexProviderSearchProcessor({
    resolver: resolverFor({
      'search.test': '93.184.216.34',
      'private-search.test': '10.0.0.9',
    }),
    fetchImpl: (async (url) => {
      calls.push(String(url));
      return new Response('', {
        status: 302,
        headers: {
          Location: 'https://private-search.test/search',
        },
      });
    }) as typeof fetch,
  });

  const outcome = await processor.search(endpointEngine('https://search.test/search?q=test'), baseEngineRequest());

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error?.code, 'ssrf_blocked');
  assert.deepEqual(calls, ['https://search.test/search?q=test']);
});

test('allowPrivateHosts works only when explicitly enabled', async () => {
  const resolver = resolverFor({ 'private.test': '127.0.0.1' });
  const defaultFetcher = createCodexProviderWebRetrievalFetcher({
    safety: { resolver },
    fetchImpl: (async () => new Response('should not be called')) as typeof fetch,
  });

  await assert.rejects(
    defaultFetcher.fetch('https://private.test/page'),
    (error) => assertRetrievalError(error, 'ssrf_blocked'),
  );

  let called = false;
  const allowedFetcher = createCodexProviderWebRetrievalFetcher({
    safety: {
      resolver,
      allowPrivateHosts: true,
    },
    fetchImpl: (async () => {
      called = true;
      return new Response('<html><head><title>Private</title></head><body>Allowed private host.</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }) as typeof fetch,
  });

  const document = await allowedFetcher.fetch('https://private.test/page');

  assert.equal(called, true);
  assert.equal(document.status, 200);
  assert.equal(document.title, 'Private');
});

test('metasearch HTTP engine response byte limit blocks large responses', async () => {
  const processor = createCodexProviderSearchProcessor({
    resolver: resolverFor({ 'search.test': '93.184.216.34' }),
    maxResponseBytes: 8,
    fetchImpl: (async () => new Response('0123456789', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch,
  });

  const outcome = await processor.search(endpointEngine('https://search.test/search?q=test'), baseEngineRequest());

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error?.code, 'max_bytes_exceeded');
});
