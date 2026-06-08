import type {
  CodexProviderHostedToolExecutionRequest,
  CodexProviderHostedToolExecutionResult,
  CodexProviderHostedToolExecutor,
  JsonRecord,
} from '../../hosted_tool_executors.js';
import type {
  CodexProviderMetaSearchService,
  CodexProviderSafeSearchMode,
  CodexProviderSearchCategory,
  CodexProviderSearchMode,
  CodexProviderSearchTimeRange,
  CodexProviderUnresponsiveEngine,
} from '../metasearch/index.js';
import {
  createCodexProviderDeepSearchGraph,
  type CodexProviderDeepSearchGraph,
} from './graph.js';
import {
  createCodexProviderHeuristicDeepSearchPlanner,
  type CodexProviderDeepSearchPlan,
  type CodexProviderDeepSearchPlanner,
} from './planner.js';
import {
  buildCodexProviderDeepSearchSynthesisInstructions,
  mergeCodexProviderDeepSearchReferences,
  type CodexProviderDeepSearchReference,
  type CodexProviderDeepSearchSubqueryResult,
} from './reference-merge.js';

export interface CodexProviderDeepSearchRequest {
  query: string;
  mode?: CodexProviderSearchMode | null;
  category?: CodexProviderSearchCategory | null;
  language?: string | null;
  region?: string | null;
  safeSearch?: CodexProviderSafeSearchMode | null;
  timeRange?: CodexProviderSearchTimeRange | null;
  maxSubqueries?: number | null;
  maxResultsPerSubquery?: number | null;
  maxSources?: number | null;
  allowedDomains?: string[] | null;
  blockedDomains?: string[] | null;
  externalWebAccess?: boolean | null;
}

export interface CodexProviderDeepSearchSource {
  id: number;
  title: string;
  url: string;
  source: string;
  snippet: string;
  supporting_queries: string[];
}

export interface CodexProviderDeepSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  score: number;
  supporting_queries: string[];
}

export interface CodexProviderDeepSearchResponse {
  query: string;
  provider: 'deep-search';
  plan: CodexProviderDeepSearchPlan;
  graph: {
    nodes: CodexProviderDeepSearchGraph['nodes'];
    levels: string[][];
  };
  subqueries: Array<{
    node_id: string;
    query: string;
    result_count: number;
    error?: string | null;
  }>;
  results: CodexProviderDeepSearchResult[];
  sources: CodexProviderDeepSearchSource[];
  citations: Array<{ type: 'url_citation'; title: string; url: string }>;
  synthesis: {
    instructions: string;
    source_count: number;
    subquery_count: number;
  };
  retrieved_at: string;
  external_web_access: boolean;
  unresponsive_engines: CodexProviderUnresponsiveEngine[];
}

export interface CodexProviderDeepSearchRunnerOptions {
  search: CodexProviderMetaSearchService;
  planner?: CodexProviderDeepSearchPlanner | null;
  maxSubqueries?: number | null;
  maxResultsPerSubquery?: number | null;
  maxSources?: number | null;
  mode?: CodexProviderSearchMode | null;
  now?: (() => Date) | null;
}

export interface CodexProviderDeepSearchRunner {
  run(request: CodexProviderDeepSearchRequest): Promise<CodexProviderDeepSearchResponse>;
}

export function createCodexProviderDeepSearchRunner(
  options: CodexProviderDeepSearchRunnerOptions,
): CodexProviderDeepSearchRunner {
  const planner = options.planner ?? createCodexProviderHeuristicDeepSearchPlanner({
    maxSubqueries: options.maxSubqueries,
  });
  const now = options.now ?? (() => new Date());
  return {
    async run(request) {
      const normalized = normalizeDeepSearchRequest(request, options);
      const plan = await planner.plan(normalized.query, {
        maxSubqueries: normalized.maxSubqueries,
      });
      const graph = createCodexProviderDeepSearchGraph(plan);
      const subqueries = await runDeepSearchGraph({
        search: options.search,
        graph,
        request: normalized,
      });
      const references = mergeCodexProviderDeepSearchReferences(subqueries, {
        maxSources: normalized.maxSources,
      });
      return deepSearchResponseFromReferences({
        request: normalized,
        plan,
        graph,
        subqueries,
        references,
        now: now(),
      });
    },
  };
}

export function createCodexProviderDeepWebSearchExecutor(
  options: CodexProviderDeepSearchRunnerOptions,
): CodexProviderHostedToolExecutor {
  const runner = createCodexProviderDeepSearchRunner(options);
  return async (request: CodexProviderHostedToolExecutionRequest): Promise<CodexProviderHostedToolExecutionResult> => {
    const content = await runner.run(deepSearchRequestFromHostedTool(request, options));
    return {
      content,
      metadata: {
        provider: 'deep-search',
        subqueryCount: content.subqueries.length,
        sourceCount: content.sources.length,
        resultCount: content.results.length,
        externalWebAccess: content.external_web_access,
      },
    };
  };
}

async function runDeepSearchGraph({
  search,
  graph,
  request,
}: {
  search: CodexProviderMetaSearchService;
  graph: CodexProviderDeepSearchGraph;
  request: RequiredDeepSearchRequest;
}): Promise<CodexProviderDeepSearchSubqueryResult[]> {
  const results: CodexProviderDeepSearchSubqueryResult[] = [];
  for (const level of graph.levels) {
    const searchable = level.filter((node) => node.type === 'search');
    const levelResults = await Promise.all(searchable.map(async (node): Promise<CodexProviderDeepSearchSubqueryResult> => {
      try {
        const response = await search.search({
          query: node.query,
          mode: request.mode,
          category: request.category,
          language: request.language,
          region: request.region,
          safeSearch: request.safeSearch,
          timeRange: request.timeRange,
          maxResults: request.maxResultsPerSubquery,
          allowedDomains: request.allowedDomains,
          blockedDomains: request.blockedDomains,
          externalWebAccess: request.externalWebAccess,
        });
        return {
          nodeId: node.id,
          question: node.question,
          query: node.query,
          response,
          error: null,
        };
      } catch (error) {
        return {
          nodeId: node.id,
          question: node.question,
          query: node.query,
          response: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    results.push(...levelResults);
  }
  return results;
}

function deepSearchResponseFromReferences({
  request,
  plan,
  graph,
  subqueries,
  references,
  now,
}: {
  request: RequiredDeepSearchRequest;
  plan: CodexProviderDeepSearchPlan;
  graph: CodexProviderDeepSearchGraph;
  subqueries: CodexProviderDeepSearchSubqueryResult[];
  references: CodexProviderDeepSearchReference[];
  now: Date;
}): CodexProviderDeepSearchResponse {
  return {
    query: request.query,
    provider: 'deep-search',
    plan,
    graph: {
      nodes: graph.nodes,
      levels: graph.levels.map((level) => level.map((node) => node.id)),
    },
    subqueries: subqueries.map((subquery) => ({
      node_id: subquery.nodeId,
      query: subquery.query,
      result_count: subquery.response?.results.length ?? 0,
      error: subquery.error ?? null,
    })),
    results: references.map((reference) => ({
      title: reference.title,
      url: reference.url,
      snippet: reference.snippet,
      source: reference.source,
      score: reference.score,
      supporting_queries: [...reference.supporting_queries],
    })),
    sources: references.map((reference) => ({
      id: reference.id,
      title: reference.title,
      url: reference.url,
      source: reference.source,
      snippet: reference.snippet,
      supporting_queries: [...reference.supporting_queries],
    })),
    citations: references.map((reference) => ({
      type: 'url_citation' as const,
      title: reference.title,
      url: reference.url,
    })),
    synthesis: {
      instructions: buildCodexProviderDeepSearchSynthesisInstructions(references),
      source_count: references.length,
      subquery_count: subqueries.length,
    },
    retrieved_at: now.toISOString(),
    external_web_access: request.externalWebAccess,
    unresponsive_engines: subqueries.flatMap((subquery) => subquery.response?.unresponsiveEngines ?? []),
  };
}

interface RequiredDeepSearchRequest {
  query: string;
  mode: CodexProviderSearchMode | null;
  category: CodexProviderSearchCategory;
  language: string | null;
  region: string | null;
  safeSearch: CodexProviderSafeSearchMode | null;
  timeRange: CodexProviderSearchTimeRange | null;
  maxSubqueries: number;
  maxResultsPerSubquery: number;
  maxSources: number;
  allowedDomains: string[];
  blockedDomains: string[];
  externalWebAccess: boolean;
}

function normalizeDeepSearchRequest(
  request: CodexProviderDeepSearchRequest,
  options: CodexProviderDeepSearchRunnerOptions,
): RequiredDeepSearchRequest {
  const query = normalizeString(request.query);
  if (!query) {
    throw new Error('Deep search requires a non-empty query.');
  }
  return {
    query,
    mode: normalizeSearchMode(request.mode ?? options.mode),
    category: normalizeSearchCategory(request.category),
    language: normalizeNullableString(request.language),
    region: normalizeNullableString(request.region),
    safeSearch: normalizeSafeSearch(request.safeSearch),
    timeRange: normalizeTimeRange(request.timeRange),
    maxSubqueries: clampInteger(request.maxSubqueries ?? options.maxSubqueries, 1, 12, 4),
    maxResultsPerSubquery: clampInteger(request.maxResultsPerSubquery ?? options.maxResultsPerSubquery, 1, 20, 5),
    maxSources: clampInteger(request.maxSources ?? options.maxSources, 1, 100, 20),
    allowedDomains: normalizeDomainList(request.allowedDomains),
    blockedDomains: normalizeDomainList(request.blockedDomains),
    externalWebAccess: request.externalWebAccess !== false,
  };
}

function deepSearchRequestFromHostedTool(
  request: CodexProviderHostedToolExecutionRequest,
  options: CodexProviderDeepSearchRunnerOptions,
): CodexProviderDeepSearchRequest {
  const args = request.arguments;
  const filters = normalizeFilterRecord(args.filters);
  return {
    query: firstNonEmptyString([args.query, args.q, args.search_query, args.input, request.rawArguments]),
    mode: normalizeSearchMode(args.mode ?? options.mode),
    category: normalizeSearchCategory(args.category),
    language: normalizeNullableString(args.language ?? args.lang),
    region: normalizeNullableString(args.region ?? args.country),
    safeSearch: normalizeSafeSearch(args.safe_search ?? args.safeSearch),
    timeRange: normalizeTimeRange(args.time_range ?? args.timeRange),
    maxSubqueries: args.max_subqueries ?? args.maxSubqueries,
    maxResultsPerSubquery: args.max_results_per_subquery ?? args.maxResultsPerSubquery ?? args.max_results,
    maxSources: args.max_sources ?? args.maxSources,
    allowedDomains: filters.allowedDomains,
    blockedDomains: filters.blockedDomains,
    externalWebAccess: args.external_web_access !== false,
  };
}

function normalizeFilterRecord(value: unknown): { allowedDomains: string[]; blockedDomains: string[] } {
  if (!value || typeof value !== 'object') {
    return {
      allowedDomains: [],
      blockedDomains: [],
    };
  }
  const record = value as JsonRecord;
  return {
    allowedDomains: normalizeDomainList(record.allowed_domains ?? record.allowedDomains),
    blockedDomains: normalizeDomainList(record.blocked_domains ?? record.blockedDomains),
  };
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

function firstNonEmptyString(values: unknown[]): string {
  return values.map(normalizeString).find(Boolean) ?? '';
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
