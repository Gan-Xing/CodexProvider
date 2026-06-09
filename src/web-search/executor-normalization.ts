import type {
  CodexProviderHostedToolExecutionRequest,
  JsonRecord,
} from '../hosted_tool_executors.js';
import type {
  CodexProviderProviderWebSearchSourceOptions,
  CodexProviderWebSearchCitation,
  CodexProviderWebSearchContextSize,
  CodexProviderWebSearchExecutorOptions,
  CodexProviderWebSearchFilters,
  CodexProviderWebSearchResult,
  CodexProviderWebSearchSource,
  CodexProviderWebSearchSourceInput,
  CodexProviderWebSearchSourceReference,
  CodexProviderWebSearchSourceRequest,
} from './types.js';
import {
  clampInteger,
  normalizeFiniteNumber,
  normalizePositiveInteger,
  normalizeString,
} from './executor-utils.js';
import {
  createCodexProviderProviderWebSearchSource,
} from './provider-source.js';

export function normalizeWebSearchSources(
  options: CodexProviderWebSearchExecutorOptions,
): CodexProviderWebSearchSource[] {
  const sources: CodexProviderWebSearchSource[] = [];
  if (Array.isArray(options.sources)) {
    for (const source of options.sources) {
      sources.push(normalizeWebSearchSource(source));
    }
  }
  if (normalizeString(options.provider) || normalizeString(options.apiKey)) {
    sources.push(createCodexProviderProviderWebSearchSource({
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
  return createCodexProviderProviderWebSearchSource(source as CodexProviderProviderWebSearchSourceOptions);
}

export function normalizeWebSearchRequest(
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

export function webSearchResultMatchesFilters(
  result: CodexProviderWebSearchResult,
  filters: CodexProviderWebSearchFilters | null,
): boolean {
  return webSearchUrlMatchesFilters(result.url, filters);
}

export function webSearchUrlMatchesFilters(
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

export function normalizeWebSearchResult(
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

export function normalizeWebSearchSourceReference(
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

export function normalizeWebSearchCitation(
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

export function dedupeWebSearchSources(
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

export function dedupeWebSearchCitations(
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
