import type {
  JsonRecord,
} from '../../hosted_tool_executors.js';
import type {
  CodexProviderMergedSearchResult,
  CodexProviderSearchResponse,
  CodexProviderUnresponsiveEngine,
} from '../metasearch/index.js';
import type {
  CodexProviderWebRetrievalChunk,
  CodexProviderWebRetrievalDocument,
} from '../retrieval/index.js';
import type {
  CodexProviderOpenAiWebSearchRequest,
} from './request.js';
import type {
  CodexProviderWebSearchReturnTokenBudget,
} from '../types.js';

export interface CodexProviderOpenAiWebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string | null;
  publishedAt?: string | null;
  score?: number | null;
}

export interface CodexProviderOpenAiWebSearchSourceReference {
  id: number;
  title: string;
  url: string;
  source?: string | null;
  snippet?: string | null;
}

export interface CodexProviderOpenAiWebSearchDocument {
  source_id: number;
  url: string;
  final_url: string;
  title: string;
  text: string;
  content_type: string;
  fetched_at: string;
  from_cache: boolean;
}

export interface CodexProviderOpenAiWebSearchChunk {
  source_id: number;
  chunk_id: string;
  url: string;
  title: string;
  text: string;
  score?: number | null;
}

export interface CodexProviderOpenAiWebSearchExecutorContent {
  query: string;
  provider: 'metasearch';
  answer: string | null;
  results: CodexProviderOpenAiWebSearchResult[];
  sources: CodexProviderOpenAiWebSearchSourceReference[];
  documents: CodexProviderOpenAiWebSearchDocument[];
  chunks: CodexProviderOpenAiWebSearchChunk[];
  citations: Array<{ type: 'url_citation'; title: string; url: string }>;
  instructions: string;
  retrieved_at: string;
  external_web_access: boolean;
  search_context_size: string;
  return_token_budget?: CodexProviderWebSearchReturnTokenBudget;
  unresponsive_engines: CodexProviderUnresponsiveEngine[];
  timings: Record<string, number>;
}

export interface CodexProviderOpenAiWebSearchRetrievalBundle {
  result: CodexProviderMergedSearchResult;
  sourceId: number;
  document: CodexProviderWebRetrievalDocument | null;
  chunks: CodexProviderWebRetrievalChunk[];
  error?: string | null;
}

export function buildCodexProviderOpenAiWebSearchToolOutput({
  request,
  searchResponse,
  retrievals,
  now,
}: {
  request: CodexProviderOpenAiWebSearchRequest;
  searchResponse: CodexProviderSearchResponse;
  retrievals: CodexProviderOpenAiWebSearchRetrievalBundle[];
  now: Date;
}): { content: CodexProviderOpenAiWebSearchExecutorContent; metadata: JsonRecord } {
  const sources = searchResponse.results.map((result, index) => resultToSource(result, index + 1));
  const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
  const documents = retrievals
    .filter((entry) => entry.document)
    .map((entry) => ({
      source_id: entry.sourceId,
      url: entry.document!.url,
      final_url: entry.document!.finalUrl,
      title: entry.document!.title,
      text: entry.document!.text,
      content_type: entry.document!.contentType,
      fetched_at: entry.document!.fetchedAt,
      from_cache: entry.document!.fromCache,
    }));
  const chunks = retrievals.flatMap((entry) => entry.chunks.map((chunk) => ({
    source_id: entry.sourceId,
    chunk_id: chunk.id,
    url: chunk.url,
    title: chunk.title,
    text: chunk.text,
    score: chunk.score ?? null,
  })));
  const results = searchResponse.results.map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.snippet,
    source: result.engines.join(','),
    publishedAt: result.publishedAt ?? null,
    score: result.score,
  }));
  const citations = sources.map((source) => ({
    type: 'url_citation' as const,
    title: source.title,
    url: source.url,
  }));
  const retrievalErrors = retrievals
    .filter((entry) => entry.error)
    .map((entry) => ({
      source_id: entry.sourceId,
      url: entry.result.url,
      error: entry.error,
    }));
  const content: CodexProviderOpenAiWebSearchExecutorContent = {
    query: request.query,
    provider: 'metasearch',
    answer: null,
    results,
    sources,
    documents,
    chunks,
    citations,
    instructions: buildCitationInstructions(sources.length, chunks.length),
    retrieved_at: now.toISOString(),
    external_web_access: request.externalWebAccess,
    search_context_size: request.searchContextSize,
    unresponsive_engines: searchResponse.unresponsiveEngines,
    timings: searchResponse.timings,
  };
  if (request.returnTokenBudget) {
    content.return_token_budget = request.returnTokenBudget;
  }
  return {
    content,
    metadata: {
      provider: 'metasearch',
      mode: searchResponse.mode,
      resultCount: results.length,
      sourceCount: sources.length,
      documentCount: documents.length,
      chunkCount: chunks.length,
      retrievalErrorCount: retrievalErrors.length,
      retrievalErrors,
      externalWebAccess: request.externalWebAccess,
      searchContextSize: request.searchContextSize,
      returnTokenBudget: request.returnTokenBudget,
      warnings: request.parameterWarnings.length > 0 ? request.parameterWarnings : undefined,
      sourceUrls: [...sourceByUrl.keys()],
    },
  };
}

function resultToSource(
  result: CodexProviderMergedSearchResult,
  id: number,
): CodexProviderOpenAiWebSearchSourceReference {
  return {
    id,
    title: result.title,
    url: result.url,
    source: result.engines.join(','),
    snippet: result.snippet,
  };
}

function buildCitationInstructions(sourceCount: number, chunkCount: number): string {
  if (sourceCount === 0) {
    return 'No web sources were found. Do not invent citations.';
  }
  const chunkClause = chunkCount > 0
    ? `Prefer the provided ${chunkCount} retrieved chunks when grounding detailed claims.`
    : 'Use search snippets only; full page chunks were not retrieved.';
  return `Cite web evidence with [[source:N]] placeholders where N is a source id from 1 to ${sourceCount}. ${chunkClause}`;
}
