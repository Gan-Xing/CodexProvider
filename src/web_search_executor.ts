import type {
  CodexProviderHostedToolExecutionRequest,
  CodexProviderHostedToolExecutionResult,
  CodexProviderHostedToolExecutor,
  JsonRecord,
} from './hosted_tool_executors.js';
import {
  createCodexProviderOpenAiWebSearchExecutor,
} from './web-search/openai/executor.js';
import {
  createCodexProviderProviderWebSearchSource as createProviderWebSearchSource,
} from './web-search/provider-source.js';
import {
  clampInteger,
  normalizeArray,
  normalizeFiniteNumber,
  normalizePositiveInteger,
  normalizeString,
} from './web-search/executor-utils.js';
import type {
  CodexProviderMetaSearchService,
  CodexProviderSearchEngine,
  CodexProviderSearchMode,
  CodexProviderSearchProcessor,
} from './web-search/metasearch/index.js';
import type {
  CodexProviderWebRetrievalFetcher,
} from './web-search/retrieval/index.js';

export type CodexProviderWebSearchProvider =
  | 'tavily'
  | 'brave'
  | 'serper';

export type CodexProviderWebSearchContextSize = 'low' | 'medium' | 'high';

export interface CodexProviderWebSearchExecutorOptions {
  search?: CodexProviderMetaSearchService | null;
  retrieval?: CodexProviderWebRetrievalFetcher | null;
  engines?: CodexProviderSearchEngine[] | null;
  processor?: CodexProviderSearchProcessor | null;
  mode?: CodexProviderSearchMode | null;
  fetchPages?: boolean | null;
  provider?: CodexProviderWebSearchProvider | null;
  apiKey?: string | null;
  endpoint?: string | null;
  fetchImpl?: typeof fetch;
  maxResults?: number | null;
  maxRetrievedPages?: number | null;
  maxChunks?: number | null;
  chunkChars?: number | null;
  chunkOverlapChars?: number | null;
  country?: string | null;
  language?: string | null;
  sources?: CodexProviderWebSearchSourceInput[] | null;
  now?: (() => Date) | null;
}

export type CodexProviderWebSearchSourceInput =
  | CodexProviderWebSearchSource
  | CodexProviderProviderWebSearchSourceOptions;

export interface CodexProviderProviderWebSearchSourceOptions {
  type?: 'provider' | null;
  provider: CodexProviderWebSearchProvider;
  apiKey: string;
  endpoint?: string | null;
  fetchImpl?: typeof fetch;
  maxResults?: number | null;
  country?: string | null;
  language?: string | null;
}

export interface CodexProviderWebSearchSource {
  name: string;
  type?: string | null;
  live?: boolean | null;
  search(
    request: CodexProviderWebSearchSourceRequest,
  ): Promise<CodexProviderWebSearchSourceResult> | CodexProviderWebSearchSourceResult;
}

export interface CodexProviderWebSearchSourceRequest {
  query: string;
  maxResults: number;
  searchContextSize: CodexProviderWebSearchContextSize;
  userLocation: JsonRecord | null;
  filters: CodexProviderWebSearchFilters | null;
  externalWebAccess: boolean;
  returnTokenBudget: number | null;
  toolRequest: CodexProviderHostedToolExecutionRequest;
}

export interface CodexProviderWebSearchFilters {
  allowedDomains: string[];
  blockedDomains: string[];
  raw: JsonRecord | null;
}

export interface CodexProviderWebSearchSourceResult {
  answer?: string | null;
  results: CodexProviderWebSearchResult[];
  sources?: CodexProviderWebSearchSourceReference[] | null;
  citations?: CodexProviderWebSearchCitation[] | null;
  metadata?: JsonRecord | null;
}

export interface CodexProviderWebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string | null;
  publishedAt?: string | null;
  score?: number | null;
}

export interface CodexProviderWebSearchSourceReference {
  title?: string | null;
  url: string;
  source?: string | null;
  snippet?: string | null;
}

export interface CodexProviderWebSearchCitation {
  type?: string | null;
  title?: string | null;
  url: string;
  start_index?: number | null;
  end_index?: number | null;
}

export interface CodexProviderWebSearchExecutorContent {
  query: string;
  provider: string;
  answer?: string | null;
  results: CodexProviderWebSearchResult[];
  sources?: CodexProviderWebSearchSourceReference[];
  citations?: CodexProviderWebSearchCitation[];
  retrieved_at: string;
  external_web_access: boolean;
  search_context_size: CodexProviderWebSearchContextSize;
  return_token_budget?: number | null;
}

export {
  createCodexProviderProviderWebSearchSource,
} from './web-search/provider-source.js';

export function createCodexProviderWebSearchExecutor(
  options: CodexProviderWebSearchExecutorOptions,
): CodexProviderHostedToolExecutor {
  if (shouldUseOpenAiWebSearchExecutor(options)) {
    return createCodexProviderOpenAiWebSearchExecutor(options);
  }
  return createLegacyCodexProviderWebSearchExecutor(options);
}

function shouldUseOpenAiWebSearchExecutor(options: CodexProviderWebSearchExecutorOptions): boolean {
  return Boolean(
    options.search
    || options.retrieval
    || (Array.isArray(options.engines) && options.engines.length > 0),
  );
}

function createLegacyCodexProviderWebSearchExecutor(
  options: CodexProviderWebSearchExecutorOptions,
): CodexProviderHostedToolExecutor {
  const sources = normalizeWebSearchSources(options);
  if (sources.length === 0) {
    throw new Error('web_search executor requires at least one source or provider API key.');
  }
  return async (request: CodexProviderHostedToolExecutionRequest): Promise<CodexProviderHostedToolExecutionResult> => {
    const normalizedRequest = normalizeWebSearchRequest(request, options.maxResults);
    if (!normalizedRequest.query) {
      throw new Error('web_search executor requires a non-empty query argument.');
    }
    const liveSources = sources.filter((source) => source.live !== false);
    const cacheSources = sources.filter((source) => source.live === false);
    const searchableSources = normalizedRequest.externalWebAccess ? sources : cacheSources;
    if (!normalizedRequest.externalWebAccess && liveSources.length > 0 && searchableSources.length === 0) {
      throw new Error('web_search external_web_access=false requires a cache/offline source; live providers were not called.');
    }

    const aggregatedResults: CodexProviderWebSearchResult[] = [];
    const aggregatedSources: CodexProviderWebSearchSourceReference[] = [];
    const aggregatedCitations: CodexProviderWebSearchCitation[] = [];
    const answers: string[] = [];
    for (const source of searchableSources) {
      const result = await source.search({
        ...normalizedRequest,
        toolRequest: request,
      });
      if (normalizeString(result.answer)) {
        answers.push(normalizeString(result.answer));
      }
      for (const entry of result.results ?? []) {
        const normalized = normalizeWebSearchResult(entry, source.name);
        if (normalized && webSearchResultMatchesFilters(normalized, normalizedRequest.filters)) {
          aggregatedResults.push(normalized);
        }
      }
      for (const entry of result.sources ?? []) {
        const normalized = normalizeWebSearchSourceReference(entry, source.name);
        if (normalized && webSearchUrlMatchesFilters(normalized.url, normalizedRequest.filters)) {
          aggregatedSources.push(normalized);
        }
      }
      for (const entry of result.citations ?? []) {
        const normalized = normalizeWebSearchCitation(entry);
        if (normalized && webSearchUrlMatchesFilters(normalized.url, normalizedRequest.filters)) {
          aggregatedCitations.push(normalized);
        }
      }
    }

    const limitedResults = aggregatedResults.slice(0, normalizedRequest.maxResults);
    const sourcesFromResults = limitedResults.map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      source: result.source ?? null,
    }));
    return {
      content: {
        query: normalizedRequest.query,
        provider: searchableSources.length === 1 ? searchableSources[0].name : 'multi-source',
        answer: answers[0] ?? null,
        results: limitedResults,
        sources: dedupeWebSearchSources([...aggregatedSources, ...sourcesFromResults]),
        citations: dedupeWebSearchCitations(aggregatedCitations),
        retrieved_at: new Date().toISOString(),
        external_web_access: normalizedRequest.externalWebAccess,
        search_context_size: normalizedRequest.searchContextSize,
        return_token_budget: normalizedRequest.returnTokenBudget,
      } satisfies CodexProviderWebSearchExecutorContent,
      metadata: {
        provider: searchableSources.length === 1 ? searchableSources[0].name : 'multi-source',
        sourceCount: searchableSources.length,
        resultCount: limitedResults.length,
        externalWebAccess: normalizedRequest.externalWebAccess,
        searchContextSize: normalizedRequest.searchContextSize,
        returnTokenBudget: normalizedRequest.returnTokenBudget,
      },
    };
  };
}

function normalizeWebSearchSources(
  options: CodexProviderWebSearchExecutorOptions,
): CodexProviderWebSearchSource[] {
  const sources: CodexProviderWebSearchSource[] = [];
  if (Array.isArray(options.sources)) {
    for (const source of options.sources) {
      sources.push(normalizeWebSearchSource(source));
    }
  }
  if (normalizeString(options.provider) || normalizeString(options.apiKey)) {
    sources.push(createProviderWebSearchSource({
      provider: options.provider ?? 'tavily',
      apiKey: options.apiKey ?? '',
      endpoint: options.endpoint,
      fetchImpl: options.fetchImpl,
      maxResults: options.maxResults,
      country: options.country,
      language: options.language,
    }));
  }
  return sources;
}

function normalizeWebSearchSource(source: CodexProviderWebSearchSourceInput): CodexProviderWebSearchSource {
  if (source && typeof (source as CodexProviderWebSearchSource).search === 'function') {
    const adapter = source as CodexProviderWebSearchSource;
    const name = normalizeString(adapter.name);
    if (!name) {
      throw new Error('web_search source adapters require a non-empty name.');
    }
    return {
      ...adapter,
      name,
      type: normalizeString(adapter.type) || 'custom',
      live: adapter.live !== false,
    };
  }
  return createProviderWebSearchSource(source as CodexProviderProviderWebSearchSourceOptions);
}

function normalizeWebSearchRequest(
  request: CodexProviderHostedToolExecutionRequest,
  fallbackMaxResults: unknown,
): Omit<CodexProviderWebSearchSourceRequest, 'toolRequest'> {
  return {
    query: webSearchQueryFromRequest(request),
    maxResults: clampInteger(
      request.arguments.max_results ?? request.arguments.max_num_results ?? request.arguments.num_results,
      1,
      20,
      clampInteger(fallbackMaxResults, 1, 20, 5),
    ),
    searchContextSize: normalizeSearchContextSize(request.arguments.search_context_size),
    userLocation: normalizeUserLocation(request.arguments.user_location),
    filters: normalizeWebSearchFilters(request.arguments.filters),
    externalWebAccess: request.arguments.external_web_access !== false,
    returnTokenBudget: normalizePositiveInteger(request.arguments.return_token_budget),
  };
}

function webSearchQueryFromRequest(request: CodexProviderHostedToolExecutionRequest): string {
  return firstNonEmptyString([
    request.arguments.query,
    request.arguments.q,
    request.arguments.search_query,
    request.arguments.input,
    request.rawArguments,
  ]);
}

function normalizeSearchContextSize(value: unknown): CodexProviderWebSearchContextSize {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return 'medium';
}

function normalizeUserLocation(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as JsonRecord;
  const approximate = record.approximate && typeof record.approximate === 'object'
    ? record.approximate as JsonRecord
    : record;
  const normalized = {
    type: normalizeString(record.type) || 'approximate',
    country: normalizeString(approximate.country),
    city: normalizeString(approximate.city),
    region: normalizeString(approximate.region),
    timezone: normalizeString(approximate.timezone),
  };
  return Object.fromEntries(Object.entries(normalized).filter(([, entry]) => Boolean(entry)));
}

function normalizeWebSearchFilters(value: unknown): CodexProviderWebSearchFilters | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as JsonRecord;
  const allowedDomains = normalizeDomainList(
    record.allowed_domains ?? record.allowedDomains ?? record.include_domains ?? record.includeDomains,
  );
  const blockedDomains = normalizeDomainList(
    record.blocked_domains ?? record.blockedDomains ?? record.exclude_domains ?? record.excludeDomains,
  );
  return {
    allowedDomains,
    blockedDomains,
    raw: record,
  };
}

function normalizeDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .map((entry) => normalizeString(entry)
      .replace(/^https?:\/\//iu, '')
      .replace(/\/.*$/u, '')
      .toLowerCase())
    .filter(Boolean))];
}

function webSearchResultMatchesFilters(
  result: CodexProviderWebSearchResult,
  filters: CodexProviderWebSearchFilters | null,
): boolean {
  return webSearchUrlMatchesFilters(result.url, filters);
}

function webSearchUrlMatchesFilters(
  url: string,
  filters: CodexProviderWebSearchFilters | null,
): boolean {
  if (!filters) {
    return true;
  }
  const hostname = hostnameFromUrl(url);
  if (!hostname) {
    return false;
  }
  if (filters.allowedDomains.length > 0 && !filters.allowedDomains.some((domain) => domainMatches(hostname, domain))) {
    return false;
  }
  if (filters.blockedDomains.some((domain) => domainMatches(hostname, domain))) {
    return false;
  }
  return true;
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function hostnameFromUrl(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function normalizeWebSearchResult(
  result: CodexProviderWebSearchResult,
  fallbackSource: string,
): CodexProviderWebSearchResult | null {
  const url = normalizeString(result.url);
  if (!url) {
    return null;
  }
  return {
    title: normalizeString(result.title) || url,
    url,
    snippet: normalizeString(result.snippet),
    source: normalizeString(result.source) || fallbackSource,
    publishedAt: normalizeString(result.publishedAt) || null,
    score: normalizeFiniteNumber(result.score),
  };
}

function normalizeWebSearchSourceReference(
  source: CodexProviderWebSearchSourceReference,
  fallbackSource: string,
): CodexProviderWebSearchSourceReference | null {
  const url = normalizeString(source.url);
  if (!url) {
    return null;
  }
  return {
    title: normalizeString(source.title) || url,
    url,
    source: normalizeString(source.source) || fallbackSource,
    snippet: normalizeString(source.snippet) || null,
  };
}

function normalizeWebSearchCitation(
  citation: CodexProviderWebSearchCitation,
): CodexProviderWebSearchCitation | null {
  const url = normalizeString(citation.url);
  if (!url) {
    return null;
  }
  return {
    type: normalizeString(citation.type) || 'url_citation',
    title: normalizeString(citation.title) || null,
    url,
    start_index: normalizeFiniteNumber(citation.start_index),
    end_index: normalizeFiniteNumber(citation.end_index),
  };
}

function dedupeWebSearchSources(
  sources: CodexProviderWebSearchSourceReference[],
): CodexProviderWebSearchSourceReference[] {
  const seen = new Set<string>();
  const deduped: CodexProviderWebSearchSourceReference[] = [];
  for (const source of sources) {
    const key = source.url;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}

function dedupeWebSearchCitations(
  citations: CodexProviderWebSearchCitation[],
): CodexProviderWebSearchCitation[] {
  const seen = new Set<string>();
  const deduped: CodexProviderWebSearchCitation[] = [];
  for (const citation of citations) {
    const key = `${citation.url}:${citation.start_index ?? ''}:${citation.end_index ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(citation);
  }
  return deduped;
}

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}
