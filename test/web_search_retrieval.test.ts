import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chunkCodexProviderWebRetrievalText,
  createCodexProviderMemoryWebRetrievalCache,
  createCodexProviderWebRetrievalFetcher,
  extractCodexProviderHtmlDocument,
  rankCodexProviderWebRetrievalChunks,
  type CodexProviderWebRetrievalCacheEntry,
} from '../src/index.js';

test('HTML extraction removes hidden content and returns readable text', () => {
  const html = `<!doctype html>
    <html lang="en">
      <head>
        <title>Codex Provider &amp; Retrieval</title>
        <meta name="description" content="Native web retrieval runtime">
        <style>.hidden { display: none; }</style>
        <script>window.secret = "ignore";</script>
      </head>
      <body>
        <main>
          <h1>Retrieval runtime</h1>
          <p>Extract <strong>clean</strong> article text for citations.</p>
        </main>
      </body>
    </html>`;

  const extracted = extractCodexProviderHtmlDocument(html);

  assert.equal(extracted.title, 'Codex Provider & Retrieval');
  assert.equal(extracted.description, 'Native web retrieval runtime');
  assert.equal(extracted.language, 'en');
  assert.match(extracted.text, /Retrieval runtime Extract clean article text for citations/u);
  assert.doesNotMatch(extracted.text, /window\.secret|display: none/u);
});

test('web retrieval fetcher extracts HTML and reuses cache when offline', async () => {
  let calls = 0;
  const cache = createCodexProviderMemoryWebRetrievalCache({
    now: () => new Date('2026-06-08T00:00:00.000Z').getTime(),
  });
  const fetcher = createCodexProviderWebRetrievalFetcher({
    cache,
    now: () => new Date('2026-06-08T00:00:00.000Z'),
    fetchImpl: (async () => {
      calls += 1;
      return new Response(`<!doctype html>
        <html>
          <head><title>Fetched Page</title></head>
          <body><article><p>Fetched retrieval body text.</p></article></body>
        </html>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }) as typeof fetch,
  });

  const live = await fetcher.fetch('https://docs.example.com/fetched#section');
  const offline = await fetcher.fetch({
    url: 'https://docs.example.com/fetched',
    externalWebAccess: false,
  });

  assert.equal(calls, 1);
  assert.equal(live.fromCache, false);
  assert.equal(live.title, 'Fetched Page');
  assert.match(live.text, /Fetched retrieval body text/u);
  assert.equal(offline.fromCache, true);
  assert.equal(offline.text, live.text);
  assert.deepEqual(cache.snapshotStats(), {
    hits: 1,
    misses: 1,
    entries: 1,
  });
});

test('web retrieval cache records hits, misses, and expiry', () => {
  let now = new Date('2026-06-08T00:00:00.000Z').getTime();
  const cache = createCodexProviderMemoryWebRetrievalCache({
    ttlMs: 100,
    now: () => now,
  });
  const entry: CodexProviderWebRetrievalCacheEntry = {
    url: 'https://docs.example.com/cache',
    finalUrl: 'https://docs.example.com/cache',
    status: 200,
    contentType: 'text/plain',
    title: 'Cached',
    text: 'Cached retrieval text',
    bytes: 21,
    fetchedAt: '2026-06-08T00:00:00.000Z',
    redirectChain: ['https://docs.example.com/cache'],
  };

  assert.equal(cache.get('https://docs.example.com/cache'), null);
  cache.set('https://docs.example.com/cache', entry);
  assert.equal(cache.get('https://docs.example.com/cache')?.title, 'Cached');
  now += 101;
  assert.equal(cache.get('https://docs.example.com/cache'), null);
  assert.deepEqual(cache.snapshotStats(), {
    hits: 1,
    misses: 2,
    entries: 0,
  });
});

test('web retrieval chunker splits text and ranker prioritizes query-relevant chunks', () => {
  const text = [
    'General introduction about provider adapters and configuration.',
    'Operational notes discuss deployment, credentials, and retries.',
    'Retrieval citations require chunk ranking, source mapping, and quote-safe snippets.',
    'Additional appendix material covers unrelated packaging details.',
  ].join(' ');
  const chunks = chunkCodexProviderWebRetrievalText({
    url: 'https://docs.example.com/retrieval',
    title: 'Codex Provider Retrieval',
    text,
    maxChars: 95,
    overlapChars: 10,
  });
  const ranked = rankCodexProviderWebRetrievalChunks(chunks, 'retrieval citations snippets', {
    maxResults: 2,
  });

  assert.equal(chunks.length > 1, true);
  assert.equal(chunks[0].index, 1);
  assert.equal(chunks[0].startOffset, 0);
  assert.equal(ranked.length, 2);
  assert.match(ranked[0].text, /Retrieval citations/u);
  assert.equal((ranked[0].score ?? 0) > (ranked[1].score ?? 0), true);
});
