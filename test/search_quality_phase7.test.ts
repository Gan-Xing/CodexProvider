import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  canonicalSearchResultUrl,
  createCodexProviderFileSearchExecutor,
  createCodexProviderLocalIndexSearchEngine,
  createCodexProviderMemoryFileSearchSource,
  createCodexProviderMemoryWebSearchLocalIndex,
  extractCodexProviderHtmlDocument,
  mergeSearchResults,
  rankCodexProviderWebRetrievalChunks,
  searchUrlMatchesDomainFilters,
  tokenizeSearchText,
  type CodexProviderFileSearchExecutorContent,
  type CodexProviderSearchResult,
} from '../src/index.js';

const FIXTURE_BASE_URL = new URL('./fixtures/web-search-ranking/', import.meta.url);

interface RankingFixtures {
  duplicateQuery: string;
  duplicateResults: CodexProviderSearchResult[];
  titleQuery: string;
  titleResults: CodexProviderSearchResult[];
  trackingQuery: string;
  trackingResults: CodexProviderSearchResult[];
  chineseQuery: string;
  chineseResults: CodexProviderSearchResult[];
  dateQuery: string;
  dateResults: CodexProviderSearchResult[];
}

function baseFileSearchRequest(argumentsValue: Record<string, any>) {
  return {
    toolName: 'file_search' as const,
    emulatedToolName: 'adapter_file_search',
    callId: 'call_phase7_file_search',
    arguments: argumentsValue,
    rawArguments: JSON.stringify(argumentsValue),
    model: 'example-model',
    providerKind: 'openai-compatible',
    providerName: 'Example',
  };
}

async function fixture(name: string): Promise<string> {
  return readFile(new URL(name, FIXTURE_BASE_URL), 'utf8');
}

async function rankingFixtures(): Promise<RankingFixtures> {
  return JSON.parse(await fixture('metasearch-results.json')) as RankingFixtures;
}

test('shared search tokenizer preserves Latin tokens and emits CJK bigrams and trigrams', () => {
  const tokens = tokenizeSearchText('CodexProvider 量子计算平台 file_search');

  assert.ok(tokens.includes('codexprovider'));
  assert.ok(tokens.includes('file_search'));
  assert.ok(tokens.includes('file'));
  assert.ok(tokens.includes('search'));
  assert.ok(tokens.includes('量子计算平台'));
  assert.ok(tokens.includes('量子'));
  assert.ok(tokens.includes('计算'));
  assert.ok(tokens.includes('平台'));
  assert.ok(tokens.includes('量子计'));
  assert.ok(tokens.includes('算平台'));
});

test('metasearch ranking fixtures boost duplicate engines and exact title matches', async () => {
  const fixtures = await rankingFixtures();
  const duplicateRanked = mergeSearchResults(fixtures.duplicateResults, fixtures.duplicateQuery);
  const titleRanked = mergeSearchResults(fixtures.titleResults, fixtures.titleQuery);
  const dateRanked = mergeSearchResults(fixtures.dateResults, fixtures.dateQuery);

  assert.equal(canonicalSearchResultUrl(duplicateRanked[0].url), 'https://docs.example.com/ranking-fixture');
  assert.deepEqual(duplicateRanked[0].engines, ['alpha', 'beta']);
  assert.equal(titleRanked[0].title, 'Canonical extraction quality');
  assert.equal(dateRanked[0].publishedAt, '2026-06-10T00:00:00.000Z');
});

test('metasearch dedupes tracking URLs and enforces domain filters', async () => {
  const fixtures = await rankingFixtures();
  const ranked = mergeSearchResults(fixtures.trackingResults, fixtures.trackingQuery);

  assert.equal(ranked.length, 1);
  assert.equal(canonicalSearchResultUrl(ranked[0].url), 'https://docs.example.com/tracking-cleanup?a=1&b=2');
  assert.equal(searchUrlMatchesDomainFilters(ranked[0].url, ['docs.example.com'], []), true);
  assert.equal(searchUrlMatchesDomainFilters(ranked[0].url, ['example.org'], []), false);
  assert.equal(searchUrlMatchesDomainFilters(ranked[0].url, [], ['example.com']), false);
});

test('CJK query terms rank Chinese metasearch and retrieval results', async () => {
  const fixtures = await rankingFixtures();
  const ranked = mergeSearchResults(fixtures.chineseResults, fixtures.chineseQuery);
  const chunks = rankCodexProviderWebRetrievalChunks([
    {
      id: 'classic-1',
      url: 'https://example.cn/classic',
      title: '传统计算平台',
      text: '传统服务器资料。',
      index: 1,
      startOffset: 0,
      endOffset: 8,
    },
    {
      id: 'quantum-1',
      url: 'https://example.cn/quantum',
      title: '量子计算平台白皮书',
      text: '这个页面用于验证中文查询分词、排序和正文抽取。',
      index: 2,
      startOffset: 9,
      endOffset: 32,
    },
  ], fixtures.chineseQuery);

  assert.equal(ranked[0].url, 'https://example.cn/quantum');
  assert.equal(chunks[0].url, 'https://example.cn/quantum');
});

test('HTML extraction fixtures prefer article content and preserve docs structures', async () => {
  const article = extractCodexProviderHtmlDocument(await fixture('article-with-chrome.html'));
  const docs = extractCodexProviderHtmlDocument(await fixture('docs-page.html'));
  const chinese = extractCodexProviderHtmlDocument(await fixture('chinese-page.html'));
  const malformed = extractCodexProviderHtmlDocument(await fixture('malformed-page.html'));

  assert.equal(article.title, 'Article Fixture & Quality');
  assert.equal(article.description, 'Article extraction fixture');
  assert.equal(article.canonicalUrl, 'https://docs.example.com/article-fixture');
  assert.equal(article.language, 'en');
  assert.match(article.text, /Measured Retrieval Quality/u);
  assert.match(article.text, /keeps evidence text for citations & summaries/u);
  assert.doesNotMatch(article.text, /Global header|Products Pricing|Footer legal|window\.__noise|Hidden campaign/u);

  assert.equal(docs.description, 'Docs page fixture');
  assert.match(docs.text, /rankCodexProviderWebRetrievalChunks\(chunks, "query"\)/u);
  assert.match(docs.text, /Signal Weight Title High/u);
  assert.match(docs.text, /Tokenize the query/u);

  assert.equal(chinese.language, 'zh-CN');
  assert.equal(chinese.canonicalUrl, 'https://example.cn/quantum');
  assert.match(chinese.text, /中文查询分词/u);

  assert.match(malformed.text, /Extractor should still recover useful body text/u);
});

test('local web index ranks offline web documents without leaking into file_search', async () => {
  const webIndex = createCodexProviderMemoryWebSearchLocalIndex({
    documents: [{
      url: 'https://docs.example.com/web-only',
      title: 'Web-only retrieval quality guide',
      text: 'Offline web index document about retrieval quality oracle ranking.',
      fetchedAt: '2026-06-10T00:00:00.000Z',
    }],
  });
  const webEngine = createCodexProviderLocalIndexSearchEngine({
    index: webIndex,
    name: 'local-web',
  });
  const webResults = await webEngine.search({
    query: 'retrieval quality oracle',
    category: 'web',
    language: null,
    region: null,
    page: 1,
    safeSearch: null,
    timeRange: null,
    maxResults: 5,
    allowedDomains: [],
    blockedDomains: [],
    externalWebAccess: false,
    rawRequest: {},
  });
  const fileSearch = createCodexProviderFileSearchExecutor({
    sources: [
      createCodexProviderMemoryFileSearchSource({
        name: 'files',
        documents: [{
          id: 'file-only',
          title: 'File-only search guide',
          path: 'docs/file-only.md',
          content: 'File search document about hosted chunk ranking.',
        }],
      }),
    ],
  });
  const fileResult = await fileSearch(baseFileSearchRequest({
    query: 'retrieval quality oracle',
  }));
  const fileContent = fileResult.content as CodexProviderFileSearchExecutorContent;

  assert.equal(webResults[0].url, 'https://docs.example.com/web-only');
  assert.equal(fileContent.data.length, 0);
});

test('file_search ranking fixtures prefer title hits and CJK content terms', async () => {
  const fileSearch = createCodexProviderFileSearchExecutor({
    sources: [
      createCodexProviderMemoryFileSearchSource({
        name: 'quality-fixtures',
        documents: [{
          id: 'title-hit',
          title: 'Canonical extraction quality',
          path: 'docs/canonical-extraction-quality.md',
          content: 'Short guide for retrieval scoring.',
        }, {
          id: 'snippet-hit',
          title: 'General note',
          path: 'docs/general.md',
          content: 'canonical extraction quality is only mentioned once in this body',
        }, {
          id: 'cjk-hit',
          title: '量子计算平台资料',
          path: 'docs/quantum.md',
          content: '中文文件用于验证量子计算平台查询。',
        }],
      }),
    ],
    maxResults: 3,
  });
  const titleResult = await fileSearch(baseFileSearchRequest({
    query: 'canonical extraction quality',
  }));
  const cjkResult = await fileSearch(baseFileSearchRequest({
    query: '量子计算 平台',
  }));
  const titleContent = titleResult.content as CodexProviderFileSearchExecutorContent;
  const cjkContent = cjkResult.content as CodexProviderFileSearchExecutorContent;

  assert.equal(titleContent.data[0].filename, 'canonical-extraction-quality.md');
  assert.equal(cjkContent.data[0].filename, 'quantum.md');
  assert.match(cjkContent.data[0].content.map((chunk) => chunk.text).join('\n'), /量子计算平台/u);
});
