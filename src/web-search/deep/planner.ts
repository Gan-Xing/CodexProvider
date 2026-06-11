export interface CodexProviderDeepSearchPlanNode {
  id: string;
  type: 'root' | 'search';
  question: string;
  query: string;
  dependsOn: string[];
}

export interface CodexProviderDeepSearchPlan {
  query: string;
  nodes: CodexProviderDeepSearchPlanNode[];
  diagnostics?: CodexProviderDeepSearchPlanDiagnostics;
}

export interface CodexProviderDeepSearchPlanDiagnostics {
  strategy: 'heuristic';
  candidateCount: number;
  selectedCount: number;
  discardedCount: number;
  maxSubqueries: number;
  selectedQueries: string[];
  discardedQueries: string[];
}

export interface CodexProviderDeepSearchPlannerOptions {
  maxSubqueries?: number | null;
}

export interface CodexProviderDeepSearchPlanner {
  plan(
    query: string,
    options?: CodexProviderDeepSearchPlannerOptions,
  ): CodexProviderDeepSearchPlan | Promise<CodexProviderDeepSearchPlan>;
}

export function createCodexProviderHeuristicDeepSearchPlanner(
  defaults: CodexProviderDeepSearchPlannerOptions = {},
): CodexProviderDeepSearchPlanner {
  return {
    plan(query, options = {}) {
      return planCodexProviderDeepSearchQuery(query, {
        maxSubqueries: options.maxSubqueries ?? defaults.maxSubqueries,
      });
    },
  };
}

export function planCodexProviderDeepSearchQuery(
  query: string,
  options: CodexProviderDeepSearchPlannerOptions = {},
): CodexProviderDeepSearchPlan {
  const normalizedQuery = normalizeWhitespace(query);
  if (!normalizedQuery) {
    throw new Error('Deep search requires a non-empty query.');
  }
  const maxSubqueries = clampInteger(options.maxSubqueries, 1, 12, 4);
  const candidates = dedupeStrings(buildSubqueryCandidates(normalizedQuery));
  const selected = candidates.slice(0, maxSubqueries);
  const discarded = candidates.slice(maxSubqueries);
  const root: CodexProviderDeepSearchPlanNode = {
    id: 'root',
    type: 'root',
    question: normalizedQuery,
    query: normalizedQuery,
    dependsOn: [],
  };
  const searchNodes = selected.map((subquery, index): CodexProviderDeepSearchPlanNode => ({
    id: `q${index + 1}`,
    type: 'search',
    question: subquery,
    query: subquery,
    dependsOn: ['root'],
  }));
  return {
    query: normalizedQuery,
    nodes: [
      root,
      ...searchNodes,
    ],
    diagnostics: {
      strategy: 'heuristic',
      candidateCount: candidates.length,
      selectedCount: selected.length,
      discardedCount: discarded.length,
      maxSubqueries,
      selectedQueries: [...selected],
      discardedQueries: [...discarded],
    },
  };
}

function buildSubqueryCandidates(query: string): string[] {
  if (isComparisonQuery(query)) {
    const compared = query
      .split(/\b(?:vs\.?|versus|and)\b|(?:与|和|及|对比|相比)/iu)
      .map(normalizeComparisonPart)
      .filter((entry) => entry.length > 2);
    return [
      query,
      ...compared,
      suffixQuery(query, 'comparison evidence', '对比证据'),
      suffixQuery(query, 'tradeoffs', '取舍'),
    ];
  }
  const parts = splitQueryParts(query);
  if (parts.length > 1) {
    return [
      query,
      ...parts,
      suffixQuery(query, 'overview', '概览'),
      suffixQuery(query, 'evidence sources', '证据来源'),
    ];
  }
  if (isQuestionQuery(query)) {
    return [
      query,
      suffixQuery(query, 'background', '背景'),
      suffixQuery(query, 'current evidence', '当前证据'),
      suffixQuery(query, 'limitations', '限制'),
    ];
  }
  return [
    query,
    suffixQuery(query, 'overview', '概览'),
    suffixQuery(query, 'evidence', '证据'),
    suffixQuery(query, 'recent updates', '最新进展'),
  ];
}

function splitQueryParts(query: string): string[] {
  return query
    .split(/\s*(?:,|;|，|；|\band\b|\bor\b|和|与|及|或)\s*/iu)
    .map(normalizeWhitespace)
    .filter((entry) => entry.length >= 4 && entry.toLowerCase() !== query.toLowerCase());
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function normalizeWhitespace(value: string): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function normalizeComparisonPart(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^(?:compare|comparison|比较|对比)\s*/iu, '')
    .replace(/\s*(?:difference|differences|tradeoffs?|(?:的)?(?:差异|区别))$/iu, '')
    .trim();
}

function isComparisonQuery(query: string): boolean {
  return /\b(vs\.?|versus|compare|comparison|difference|tradeoffs?)\b/iu.test(query)
    || /(?:比较|对比|差异|区别|取舍)/u.test(query);
}

function isQuestionQuery(query: string): boolean {
  return /\b(how|why|what|when|where|which)\b/iu.test(query)
    || /(?:如何|为什么|为何|什么|哪些|哪个|是否|何时|哪里)/u.test(query);
}

function suffixQuery(query: string, englishSuffix: string, cjkSuffix: string): string {
  return `${query} ${containsCjk(query) ? cjkSuffix : englishSuffix}`;
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}
