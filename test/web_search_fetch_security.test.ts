import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodexProviderWebRetrievalError,
  createCodexProviderMemoryWebRetrievalCache,
  createCodexProviderWebRetrievalFetcher,
} from '../src/index.js';

function assertRetrievalError(error: unknown, code: string): boolean {
  assert.equal(error instanceof CodexProviderWebRetrievalError, true);
  assert.equal((error as CodexProviderWebRetrievalError).code, code);
  return true;
}

test('web retrieval blocks private and local URLs before fetch', async () => {
  let called = false;
  const fetcher = createCodexProviderWebRetrievalFetcher({
    fetchImpl: (async () => {
      called = true;
      return new Response('should not be called');
    }) as typeof fetch,
  });

  await assert.rejects(
    fetcher.fetch('http://127.0.0.1/admin'),
    (error) => assertRetrievalError(error, 'ssrf_blocked'),
  );

  assert.equal(called, false);
});

test('web retrieval blocks redirects to private hosts', async () => {
  const calls: string[] = [];
  const fetcher = createCodexProviderWebRetrievalFetcher({
    fetchImpl: (async (url) => {
      calls.push(String(url));
      return new Response('', {
        status: 302,
        headers: {
          Location: 'http://169.254.169.254/latest/meta-data',
        },
      });
    }) as typeof fetch,
  });

  await assert.rejects(
    fetcher.fetch('https://public.example.com/search-result'),
    (error) => assertRetrievalError(error, 'ssrf_blocked'),
  );

  assert.deepEqual(calls, ['https://public.example.com/search-result']);
});

test('web retrieval enforces max redirects', async () => {
  const calls: string[] = [];
  const fetcher = createCodexProviderWebRetrievalFetcher({
    maxRedirects: 1,
    fetchImpl: (async (url) => {
      calls.push(String(url));
      return new Response('', {
        status: 302,
        headers: {
          Location: `https://docs.example.com/hop-${calls.length}`,
        },
      });
    }) as typeof fetch,
  });

  await assert.rejects(
    fetcher.fetch('https://docs.example.com/start'),
    (error) => assertRetrievalError(error, 'max_redirects_exceeded'),
  );

  assert.deepEqual(calls, [
    'https://docs.example.com/start',
    'https://docs.example.com/hop-1',
  ]);
});

test('web retrieval times out and aborts slow fetches', async () => {
  let aborted = false;
  const fetcher = createCodexProviderWebRetrievalFetcher({
    timeoutMs: 20,
    fetchImpl: (async (_url, init) => new Promise<Response>((_resolve) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
      });
    })) as typeof fetch,
  });

  await assert.rejects(
    fetcher.fetch('https://docs.example.com/slow'),
    (error) => assertRetrievalError(error, 'timeout'),
  );

  assert.equal(aborted, true);
});

test('web retrieval enforces max bytes and content-type allowlist', async () => {
  const tooLargeFetcher = createCodexProviderWebRetrievalFetcher({
    maxBytes: 8,
    fetchImpl: (async () => new Response('0123456789', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })) as typeof fetch,
  });

  await assert.rejects(
    tooLargeFetcher.fetch('https://docs.example.com/large'),
    (error) => assertRetrievalError(error, 'max_bytes_exceeded'),
  );

  const binaryFetcher = createCodexProviderWebRetrievalFetcher({
    fetchImpl: (async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    })) as typeof fetch,
  });

  await assert.rejects(
    binaryFetcher.fetch('https://docs.example.com/binary'),
    (error) => assertRetrievalError(error, 'unsupported_content_type'),
  );
});

test('web retrieval refuses live fetches when external_web_access is false and cache misses', async () => {
  let called = false;
  const cache = createCodexProviderMemoryWebRetrievalCache();
  const fetcher = createCodexProviderWebRetrievalFetcher({
    cache,
    externalWebAccess: false,
    fetchImpl: (async () => {
      called = true;
      return new Response('should not be called');
    }) as typeof fetch,
  });

  await assert.rejects(
    fetcher.fetch('https://docs.example.com/not-cached'),
    (error) => assertRetrievalError(error, 'external_web_access_disabled'),
  );

  assert.equal(called, false);
  assert.deepEqual(cache.snapshotStats(), {
    hits: 0,
    misses: 1,
    entries: 0,
  });
});
