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
  CodexProviderSearchResponse,
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
  type CodexProviderDeepSearchPlanNode,
  type CodexProviderDeepSearchPlanner,
} from './planner.js';
import {
  buildCodexProviderDeepSearchSynthesisInstructions,
  mergeCodexProviderDeepSearchReferences,
  type CodexProviderDeepSearchAnswerShape,
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
  minSources?: number | null;
  citationBudget?: number | null;
  answerShape?: CodexProviderDeepSearchAnswerShape | null;
  subqueryTimeoutMs?: number | null;
  maxSubqueryAttempts?: number | null;
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
  supporting_node_ids: string[];
}

export interface CodexProviderDeepSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  score: number;
  supporting_queries: string[];
  supporting_node_ids: string[];
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
    attempt_count: number;
    timed_out: boolean;
    duration_ms: number;
    error?: string | null;
  }>;
  results: CodexProviderDeepSearchResult[];
  sources: CodexProviderDeepSearchSource[];
  citations: Array<{ type: 'url_citation'; title: string; url: string }>;
  synthesis: {
    instructions: string;
    source_count: number;
    subquery_count: number;
    minimum_source_count: number | null;
    below_minimum_sources: boolean;
    citation_budget: number | null;
    citation_count: number;
    answer_shape: CodexProviderDeepSearchAnswerShape | null;
    no_supporting_evidence: boolean;
  };
  diagnostics: {
    planner_strategy: string | null;
    candidate_count: number | null;
    selected_subquery_count: number;
    discarded_subquery_count: number;
    failed_subquery_count: number;
    timed_out_subquery_count: number;
    retried_subquery_count: number;
    subquery_attempt_count: number;
    unresponsive_engine_count: number;
    source_count: number;
    multi_node_source_count: number;
    search_node_count: number;
    executed_subquery_count: number;
    total_result_count: number;
    max_subqueries: number;
    max_results_per_subquery: number;
    max_sources: number;
    max_subquery_attempts: number;
    subquery_timeout_ms: number | null;
    duration_ms: number;
    minimum_source_count: number | null;
    below_minimum_sources: boolean;
    citation_budget: number | null;
    citation_count: number;
    answer_shape: CodexProviderDeepSearchAnswerShape | null;
    no_supporting_evidence: boolean;
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
  subqueryTimeoutMs?: number | null;
  maxSubqueryAttempts?: number | null;
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
      const startedAt = now();
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
      const completedAt = now();
      return deepSearchResponseFromReferences({
        request: normalized,
        plan,
        graph,
        subqueries,
        references,
        startedAt,
        completedAt,
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
        plannerStrategy: content.diagnostics.planner_strategy,
        plannerCandidateCount: content.diagnostics.candidate_count,
        selectedSubqueryCount: content.diagnostics.selected_subquery_count,
        discardedSubqueryCount: content.diagnostics.discarded_subquery_count,
        failedSubqueryCount: content.diagnostics.failed_subquery_count,
        timedOutSubqueryCount: content.diagnostics.timed_out_subquery_count,
        retriedSubqueryCount: content.diagnostics.retried_subquery_count,
        subqueryAttemptCount: content.diagnostics.subquery_attempt_count,
        unresponsiveEngineCount: content.diagnostics.unresponsive_engine_count,
        searchNodeCount: content.diagnostics.search_node_count,
        multiNodeSourceCount: content.diagnostics.multi_node_source_count,
        executedSubqueryCount: content.diagnostics.executed_subquery_count,
        totalResultCount: content.diagnostics.total_result_count,
        maxSubqueries: content.diagnostics.max_subqueries,
        maxResultsPerSubquery: content.diagnostics.max_results_per_subquery,
        maxSources: content.diagnostics.max_sources,
        maxSubqueryAttempts: content.diagnostics.max_subquery_attempts,
        subqueryTimeoutMs: content.diagnostics.subquery_timeout_ms,
        durationMs: content.diagnostics.duration_ms,
        minimumSourceCount: content.diagnostics.minimum_source_count,
        belowMinimumSources: content.diagnostics.below_minimum_sources,
        citationBudget: content.diagnostics.citation_budget,
        citationCount: content.diagnostics.citation_count,
        answerShape: content.diagnostics.answer_shape,
        noSupportingEvidence: content.diagnostics.no_supporting_evidence,
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
      return await runDeepSearchSubquery({ search, node, request });
    }));
    results.push(...levelResults);
  }
  return results;
}

async function runDeepSearchSubquery({
  search,
  node,
  request,
}: {
  search: CodexProviderMetaSearchService;
  node: CodexProviderDeepSearchPlanNode;
  request: RequiredDeepSearchRequest;
}): Promise<CodexProviderDeepSearchSubqueryResult> {
  const startedAtMs = Date.now();
  const unresponsiveEngines: CodexProviderUnresponsiveEngine[] = [];
  let attempts = 0;
  let lastResponse: CodexProviderSearchResponse | null = null;
  let lastError: string | null = null;
  let timedOut = false;

  while (attempts < request.maxSubqueryAttempts) {
    attempts += 1;
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
        ...(request.subqueryTimeoutMs === null ? {} : { overallTimeoutMs: request.subqueryTimeoutMs }),
      });
      const responseUnresponsiveEngines = response.unresponsiveEngines ?? [];
      const responseTimedOut = hasTimeoutUnresponsiveEngine(responseUnresponsiveEngines);
      unresponsiveEngines.push(...responseUnresponsiveEngines);
      lastResponse = response;
      lastError = null;
      timedOut = timedOut || responseTimedOut;
      if (shouldRetrySubqueryResponse(response, responseTimedOut, request, attempts)) {
        continue;
      }
      return buildDeepSearchSubqueryResult({
        node,
        response,
        error: null,
        unresponsiveEngines,
        attempts,
        timedOut,
        startedAtMs,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      timedOut = timedOut || isTimeoutErrorMessage(lastError);
      if (attempts < request.maxSubqueryAttempts) {
        continue;
      }
    }
  }

  return buildDeepSearchSubqueryResult({
    node,
    response: lastResponse,
    error: lastError,
    unresponsiveEngines,
    attempts,
    timedOut,
    startedAtMs,
  });
}

function buildDeepSearchSubqueryResult({
  node,
  response,
  error,
  unresponsiveEngines,
  attempts,
  timedOut,
  startedAtMs,
}: {
  node: CodexProviderDeepSearchPlanNode;
  response: CodexProviderSearchResponse | null;
  error: string | null;
  unresponsiveEngines: CodexProviderUnresponsiveEngine[];
  attempts: number;
  timedOut: boolean;
  startedAtMs: number;
}): CodexProviderDeepSearchSubqueryResult {
  return {
    nodeId: node.id,
    question: node.question,
    query: node.query,
    response,
    error,
    unresponsiveEngines,
    attempts,
    timedOut,
    durationMs: Math.max(0, Date.now() - startedAtMs),
  };
}

function shouldRetrySubqueryResponse(
  response: CodexProviderSearchResponse,
  responseTimedOut: boolean,
  request: RequiredDeepSearchRequest,
  attempts: number,
): boolean {
  return attempts < request.maxSubqueryAttempts
    && responseTimedOut
    && response.results.length === 0;
}

function deepSearchResponseFromReferences({
  request,
  plan,
  graph,
  subqueries,
  references,
  startedAt,
  completedAt,
}: {
  request: RequiredDeepSearchRequest;
  plan: CodexProviderDeepSearchPlan;
  graph: CodexProviderDeepSearchGraph;
  subqueries: CodexProviderDeepSearchSubqueryResult[];
  references: CodexProviderDeepSearchReference[];
  startedAt: Date;
  completedAt: Date;
}): CodexProviderDeepSearchResponse {
  const searchNodeCount = graph.nodes.filter((node) => node.type === 'search').length;
  const unresponsiveEngines = subqueries.flatMap((subquery) => subqueryUnresponsiveEngines(subquery));
  const failedSubqueryCount = subqueries.filter((subquery) => subquery.error).length;
  const timedOutSubqueryCount = subqueries.filter((subquery) => subqueryTimedOut(subquery)).length;
  const retriedSubqueryCount = subqueries.filter((subquery) => subqueryAttempts(subquery) > 1).length;
  const subqueryAttemptCount = subqueries.reduce((sum, subquery) => sum + subqueryAttempts(subquery), 0);
  const totalResultCount = subqueries.reduce((sum, subquery) => sum + (subquery.response?.results.length ?? 0), 0);
  const multiNodeSourceCount = references.filter((reference) => reference.node_ids.length > 1).length;
  const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
  const noSupportingEvidence = references.length === 0;
  const belowMinimumSources = request.minSources !== null && references.length < request.minSources;
  const citationReferences = request.citationBudget === null
    ? references
    : references.slice(0, request.citationBudget);
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
      attempt_count: subqueryAttempts(subquery),
      timed_out: subqueryTimedOut(subquery),
      duration_ms: subqueryDurationMs(subquery),
      error: subquery.error ?? null,
    })),
    results: references.map((reference) => ({
      title: reference.title,
      url: reference.url,
      snippet: reference.snippet,
      source: reference.source,
      score: reference.score,
      supporting_queries: [...reference.supporting_queries],
      supporting_node_ids: [...reference.node_ids],
    })),
    sources: references.map((reference) => ({
      id: reference.id,
      title: reference.title,
      url: reference.url,
      source: reference.source,
      snippet: reference.snippet,
      supporting_queries: [...reference.supporting_queries],
      supporting_node_ids: [...reference.node_ids],
    })),
    citations: citationReferences.map((reference) => ({
      type: 'url_citation' as const,
      title: reference.title,
      url: reference.url,
    })),
    synthesis: {
      instructions: buildCodexProviderDeepSearchSynthesisInstructions(references, {
        minimumSourceCount: request.minSources,
        citationBudget: request.citationBudget,
        answerShape: request.answerShape,
      }),
      source_count: references.length,
      subquery_count: subqueries.length,
      minimum_source_count: request.minSources,
      below_minimum_sources: belowMinimumSources,
      citation_budget: request.citationBudget,
      citation_count: citationReferences.length,
      answer_shape: request.answerShape,
      no_supporting_evidence: noSupportingEvidence,
    },
    diagnostics: {
      planner_strategy: plan.diagnostics?.strategy ?? null,
      candidate_count: plan.diagnostics?.candidateCount ?? null,
      selected_subquery_count: plan.diagnostics?.selectedCount ?? searchNodeCount,
      discarded_subquery_count: plan.diagnostics?.discardedCount ?? 0,
      failed_subquery_count: failedSubqueryCount,
      timed_out_subquery_count: timedOutSubqueryCount,
      retried_subquery_count: retriedSubqueryCount,
      subquery_attempt_count: subqueryAttemptCount,
      unresponsive_engine_count: unresponsiveEngines.length,
      source_count: references.length,
      multi_node_source_count: multiNodeSourceCount,
      search_node_count: searchNodeCount,
      executed_subquery_count: subqueries.length,
      total_result_count: totalResultCount,
      max_subqueries: request.maxSubqueries,
      max_results_per_subquery: request.maxResultsPerSubquery,
      max_sources: request.maxSources,
      max_subquery_attempts: request.maxSubqueryAttempts,
      subquery_timeout_ms: request.subqueryTimeoutMs,
      duration_ms: durationMs,
      minimum_source_count: request.minSources,
      below_minimum_sources: belowMinimumSources,
      citation_budget: request.citationBudget,
      citation_count: citationReferences.length,
      answer_shape: request.answerShape,
      no_supporting_evidence: noSupportingEvidence,
    },
    retrieved_at: completedAt.toISOString(),
    external_web_access: request.externalWebAccess,
    unresponsive_engines: unresponsiveEngines,
  };
}

function subqueryUnresponsiveEngines(subquery: CodexProviderDeepSearchSubqueryResult): CodexProviderUnresponsiveEngine[] {
  return subquery.unresponsiveEngines ?? subquery.response?.unresponsiveEngines ?? [];
}

function subqueryAttempts(subquery: CodexProviderDeepSearchSubqueryResult): number {
  return Math.max(1, subquery.attempts ?? 1);
}

function subqueryTimedOut(subquery: CodexProviderDeepSearchSubqueryResult): boolean {
  return subquery.timedOut ?? hasTimeoutUnresponsiveEngine(subqueryUnresponsiveEngines(subquery));
}

function subqueryDurationMs(subquery: CodexProviderDeepSearchSubqueryResult): number {
  return Math.max(0, subquery.durationMs ?? 0);
}

function hasTimeoutUnresponsiveEngine(entries: CodexProviderUnresponsiveEngine[]): boolean {
  return entries.some((entry) => normalizeString(entry.code).toLowerCase() === 'timeout');
}

function isTimeoutErrorMessage(message: string): boolean {
  return /\btimeout\b|timed out|aborted/iu.test(message);
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
  minSources: number | null;
  citationBudget: number | null;
  answerShape: CodexProviderDeepSearchAnswerShape | null;
  subqueryTimeoutMs: number | null;
  maxSubqueryAttempts: number;
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
    minSources: optionalClampInteger(request.minSources, 1, 100),
    citationBudget: optionalClampInteger(request.citationBudget, 0, 100),
    answerShape: normalizeAnswerShape(request.answerShape),
    subqueryTimeoutMs: optionalClampInteger(request.subqueryTimeoutMs ?? options.subqueryTimeoutMs, 50, 120_000),
    maxSubqueryAttempts: clampInteger(request.maxSubqueryAttempts ?? options.maxSubqueryAttempts, 1, 3, 1),
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
    minSources: args.min_sources ?? args.minSources,
    citationBudget: args.citation_budget ?? args.citationBudget ?? args.max_citations ?? args.maxCitations,
    answerShape: args.answer_shape ?? args.answerShape ?? args.shape,
    subqueryTimeoutMs: args.subquery_timeout_ms ?? args.subqueryTimeoutMs ?? args.timeout_ms ?? args.timeoutMs,
    maxSubqueryAttempts: args.max_subquery_attempts ?? args.maxSubqueryAttempts ?? args.max_attempts ?? args.maxAttempts,
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

function normalizeAnswerShape(value: unknown): CodexProviderDeepSearchAnswerShape | null {
  const normalized = normalizeString(value).toLowerCase().replace(/[\s-]+/gu, '_');
  if (normalized === 'brief') {
    return 'brief';
  }
  if (normalized === 'evidence_table' || normalized === 'table') {
    return 'evidence_table';
  }
  if (normalized === 'research_memo' || normalized === 'memo') {
    return 'research_memo';
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

function optionalClampInteger(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return null;
  }
  return Math.min(max, Math.max(min, number));
}
