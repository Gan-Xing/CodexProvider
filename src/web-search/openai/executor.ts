import type {
  CodexProviderHostedToolExecutionRequest,
  CodexProviderHostedToolExecutionResult,
  CodexProviderHostedToolExecutor,
} from '../../hosted_tool_executors.js';
import {
  createCodexProviderMetaSearchService,
  type CodexProviderMetaSearchService,
  type CodexProviderMergedSearchResult,
  type CodexProviderSearchEngine,
  type CodexProviderSearchMode,
  type CodexProviderSearchProcessor,
} from '../metasearch/index.js';
import {
  chunkCodexProviderWebRetrievalText,
  createCodexProviderWebRetrievalFetcher,
  rankCodexProviderWebRetrievalChunks,
  type CodexProviderWebRetrievalFetcher,
} from '../retrieval/index.js';
import {
  normalizeCodexProviderOpenAiWebSearchRequest,
} from './request.js';
import {
  buildCodexProviderOpenAiWebSearchToolOutput,
  type CodexProviderOpenAiWebSearchRetrievalBundle,
} from './tool-output.js';

export interface CodexProviderOpenAiWebSearchExecutorOptions {
  search?: CodexProviderMetaSearchService | null;
  retrieval?: CodexProviderWebRetrievalFetcher | null;
  engines?: CodexProviderSearchEngine[] | null;
  processor?: CodexProviderSearchProcessor | null;
  mode?: CodexProviderSearchMode | null;
  fetchPages?: boolean | null;
  fetchImpl?: typeof fetch | null;
  maxResults?: number | null;
  maxRetrievedPages?: number | null;
  maxChunks?: number | null;
  chunkChars?: number | null;
  chunkOverlapChars?: number | null;
  now?: (() => Date) | null;
}

export function createCodexProviderOpenAiWebSearchExecutor(
  options: CodexProviderOpenAiWebSearchExecutorOptions,
): CodexProviderHostedToolExecutor {
  const search = options.search ?? createSearchServiceFromOptions(options);
  const retrieval = options.retrieval ?? createCodexProviderWebRetrievalFetcher({
    fetchImpl: options.fetchImpl ?? undefined,
    externalWebAccess: true,
  });
  const fetchPages = options.fetchPages === true || Boolean(options.retrieval);
  const now = options.now ?? (() => new Date());
  return async (request: CodexProviderHostedToolExecutionRequest): Promise<CodexProviderHostedToolExecutionResult> => {
    const normalizedRequest = normalizeCodexProviderOpenAiWebSearchRequest(request, {
      maxResults: options.maxResults,
      mode: options.mode,
      maxRetrievedPages: options.maxRetrievedPages,
      maxChunks: options.maxChunks,
      chunkChars: options.chunkChars,
      chunkOverlapChars: options.chunkOverlapChars,
    });
    if (!normalizedRequest.query) {
      throw new Error('web_search executor requires a non-empty query argument.');
    }
    const searchResponse = await search.search({
      query: normalizedRequest.query,
      mode: normalizedRequest.mode,
      category: normalizedRequest.category,
      language: normalizedRequest.language,
      region: normalizedRequest.region,
      page: normalizedRequest.page,
      safeSearch: normalizedRequest.safeSearch,
      timeRange: normalizedRequest.timeRange,
      maxResults: normalizedRequest.maxResults,
      allowedDomains: normalizedRequest.allowedDomains,
      blockedDomains: normalizedRequest.blockedDomains,
      externalWebAccess: normalizedRequest.externalWebAccess,
    });
    const retrievals = fetchPages
      ? await retrieveSearchResults({
          retrieval,
          query: normalizedRequest.query,
          results: searchResponse.results,
          externalWebAccess: normalizedRequest.externalWebAccess,
          maxPages: normalizedRequest.budget.retrievedPages,
          maxChunks: normalizedRequest.budget.chunks,
          chunkChars: normalizedRequest.budget.chunkChars,
          chunkOverlapChars: normalizedRequest.budget.chunkOverlapChars,
        })
      : [];
    return buildCodexProviderOpenAiWebSearchToolOutput({
      request: normalizedRequest,
      searchResponse,
      retrievals,
      now: now(),
    });
  };
}

function createSearchServiceFromOptions(
  options: CodexProviderOpenAiWebSearchExecutorOptions,
): CodexProviderMetaSearchService {
  if (!Array.isArray(options.engines) || options.engines.length === 0) {
    throw new Error('web_search metasearch executor requires a search service or at least one engine.');
  }
  return createCodexProviderMetaSearchService({
    engines: options.engines,
    processor: options.processor,
    mode: options.mode,
    maxResults: options.maxResults,
  });
}

async function retrieveSearchResults({
  retrieval,
  query,
  results,
  externalWebAccess,
  maxPages,
  maxChunks,
  chunkChars,
  chunkOverlapChars,
}: {
  retrieval: CodexProviderWebRetrievalFetcher;
  query: string;
  results: CodexProviderMergedSearchResult[];
  externalWebAccess: boolean;
  maxPages: number;
  maxChunks: number;
  chunkChars: number;
  chunkOverlapChars: number;
}): Promise<CodexProviderOpenAiWebSearchRetrievalBundle[]> {
  const bundles: CodexProviderOpenAiWebSearchRetrievalBundle[] = [];
  const candidates = results.slice(0, maxPages);
  for (const [index, result] of candidates.entries()) {
    try {
      const document = await retrieval.fetch({
        url: result.url,
        externalWebAccess,
      });
      const chunks = chunkCodexProviderWebRetrievalText({
        url: document.finalUrl || document.url,
        title: document.title || result.title,
        text: document.text,
        maxChars: chunkChars,
        overlapChars: chunkOverlapChars,
      });
      bundles.push({
        result,
        sourceId: index + 1,
        document,
        chunks: rankCodexProviderWebRetrievalChunks(chunks, query, {
          maxResults: maxChunks,
        }),
      });
    } catch (error) {
      bundles.push({
        result,
        sourceId: index + 1,
        document: null,
        chunks: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return bundles;
}
