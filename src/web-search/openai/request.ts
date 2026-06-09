import type {
  CodexProviderHostedToolExecutionRequest,
  JsonRecord,
} from '../../hosted_tool_executors.js';
import type {
  CodexProviderNormalizedWebSearchReturnTokenBudget,
  CodexProviderWebSearchInvalidParameterStrategy,
  CodexProviderWebSearchParameterWarning,
} from '../types.js';
import type {
  CodexProviderSafeSearchMode,
  CodexProviderSearchCategory,
  CodexProviderSearchMode,
  CodexProviderSearchTimeRange,
} from '../metasearch/index.js';
import {
  normalizeWebSearchReturnTokenBudget,
} from '../validation.js';

export type CodexProviderOpenAiWebSearchContextSize = 'low' | 'medium' | 'high';

export interface CodexProviderOpenAiWebSearchBudget {
  searchResults: number;
  retrievedPages: number;
  chunks: number;
  chunkChars: number;
  chunkOverlapChars: number;
}

export interface CodexProviderOpenAiWebSearchRequest {
  query: string;
  mode: CodexProviderSearchMode | null;
  category: CodexProviderSearchCategory;
  language: string | null;
  region: string | null;
  page: number;
  safeSearch: CodexProviderSafeSearchMode | null;
  timeRange: CodexProviderSearchTimeRange | null;
  maxResults: number;
  allowedDomains: string[];
  blockedDomains: string[];
  externalWebAccess: boolean;
  searchContextSize: CodexProviderOpenAiWebSearchContextSize;
  returnTokenBudget: CodexProviderNormalizedWebSearchReturnTokenBudget;
  userLocation: JsonRecord | null;
  parameterWarnings: CodexProviderWebSearchParameterWarning[];
  budget: CodexProviderOpenAiWebSearchBudget;
  rawRequest: CodexProviderHostedToolExecutionRequest;
}

export interface CodexProviderOpenAiWebSearchRequestOptions {
  maxResults?: number | null;
  mode?: CodexProviderSearchMode | null;
  maxRetrievedPages?: number | null;
  maxChunks?: number | null;
  chunkChars?: number | null;
  chunkOverlapChars?: number | null;
  webSearchInvalidParameterStrategy?: CodexProviderWebSearchInvalidParameterStrategy | null;
}

export function normalizeCodexProviderOpenAiWebSearchRequest(
  request: CodexProviderHostedToolExecutionRequest,
  options: CodexProviderOpenAiWebSearchRequestOptions = {},
): CodexProviderOpenAiWebSearchRequest {
  const searchContextSize = normalizeSearchContextSize(request.arguments.search_context_size);
  const baseBudget = budgetForSearchContextSize(searchContextSize);
  const maxResults = clampInteger(
    request.arguments.max_results ?? request.arguments.max_num_results ?? request.arguments.num_results,
    1,
    50,
    clampInteger(options.maxResults, 1, 50, baseBudget.searchResults),
  );
  const budget = {
    searchResults: maxResults,
    retrievedPages: clampInteger(options.maxRetrievedPages, 1, 20, baseBudget.retrievedPages),
    chunks: clampInteger(options.maxChunks, 1, 100, baseBudget.chunks),
    chunkChars: clampInteger(options.chunkChars, 200, 8_000, baseBudget.chunkChars),
    chunkOverlapChars: clampInteger(options.chunkOverlapChars, 0, 1_000, baseBudget.chunkOverlapChars),
  };
  const filters = normalizeWebSearchFilters(request.arguments.filters);
  const parameterWarnings: CodexProviderWebSearchParameterWarning[] = [];
  return {
    query: webSearchQueryFromRequest(request),
    mode: normalizeSearchMode(request.arguments.mode) ?? options.mode ?? null,
    category: normalizeSearchCategory(request.arguments.category),
    language: normalizeNullableString(request.arguments.language ?? request.arguments.lang),
    region: normalizeNullableString(request.arguments.region ?? request.arguments.country),
    page: clampInteger(request.arguments.page, 1, 100, 1),
    safeSearch: normalizeSafeSearch(request.arguments.safe_search ?? request.arguments.safeSearch),
    timeRange: normalizeTimeRange(request.arguments.time_range ?? request.arguments.timeRange),
    maxResults,
    allowedDomains: filters.allowedDomains,
    blockedDomains: filters.blockedDomains,
    externalWebAccess: request.arguments.external_web_access !== false,
    searchContextSize,
    returnTokenBudget: normalizeReturnTokenBudget(
      request.arguments.return_token_budget,
      options.webSearchInvalidParameterStrategy,
      parameterWarnings,
    ),
    userLocation: normalizeUserLocation(request.arguments.user_location),
    parameterWarnings,
    budget,
    rawRequest: request,
  };
}

export function budgetForSearchContextSize(
  value: CodexProviderOpenAiWebSearchContextSize,
): CodexProviderOpenAiWebSearchBudget {
  switch (value) {
    case 'high':
      return {
        searchResults: 10,
        retrievedPages: 5,
        chunks: 16,
        chunkChars: 1_600,
        chunkOverlapChars: 160,
      };
    case 'low':
      return {
        searchResults: 3,
        retrievedPages: 1,
        chunks: 4,
        chunkChars: 800,
        chunkOverlapChars: 80,
      };
    case 'medium':
    default:
      return {
        searchResults: 5,
        retrievedPages: 3,
        chunks: 8,
        chunkChars: 1_200,
        chunkOverlapChars: 120,
      };
  }
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

function normalizeSearchContextSize(value: unknown): CodexProviderOpenAiWebSearchContextSize {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return 'medium';
}

function normalizeReturnTokenBudget(
  value: unknown,
  invalidParameterStrategy: CodexProviderWebSearchInvalidParameterStrategy | null | undefined,
  warnings: CodexProviderWebSearchParameterWarning[],
): CodexProviderNormalizedWebSearchReturnTokenBudget {
  return normalizeWebSearchReturnTokenBudget(value, {
    strategy: invalidParameterStrategy,
    warnings,
  });
}

function normalizeSearchMode(value: unknown): CodexProviderSearchMode | null {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'fast' || normalized === 'any' || normalized === 'balanced' || normalized === 'exhaustive') {
    return normalized;
  }
  return null;
}

function normalizeSearchCategory(value: unknown): CodexProviderSearchCategory {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'news' || normalized === 'images' || normalized === 'videos' || normalized === 'it' || normalized === 'science') {
    return normalized;
  }
  return 'web';
}

function normalizeSafeSearch(value: unknown): CodexProviderSafeSearchMode | null {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'off' || normalized === 'moderate' || normalized === 'strict') {
    return normalized;
  }
  return null;
}

function normalizeTimeRange(value: unknown): CodexProviderSearchTimeRange | null {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'day' || normalized === 'week' || normalized === 'month' || normalized === 'year') {
    return normalized;
  }
  return null;
}

function normalizeWebSearchFilters(value: unknown): { allowedDomains: string[]; blockedDomains: string[] } {
  if (!value || typeof value !== 'object') {
    return {
      allowedDomains: [],
      blockedDomains: [],
    };
  }
  const record = value as JsonRecord;
  return {
    allowedDomains: normalizeDomainList(
      record.allowed_domains ?? record.allowedDomains ?? record.include_domains ?? record.includeDomains,
    ),
    blockedDomains: normalizeDomainList(
      record.blocked_domains ?? record.blockedDomains ?? record.exclude_domains ?? record.excludeDomains,
    ),
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

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function normalizeNullableString(value: unknown): string | null {
  return normalizeString(value) || null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}
