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
  const candidates = buildSubqueryCandidates(normalizedQuery);
  const selected = dedupeStrings(candidates).slice(0, maxSubqueries);
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
  };
}

function buildSubqueryCandidates(query: string): string[] {
  const parts = splitQueryParts(query);
  if (parts.length > 1) {
    return [
      query,
      ...parts,
      `${query} overview`,
      `${query} evidence sources`,
    ];
  }
  if (/\b(vs\.?|versus|compare|comparison|difference|tradeoffs?)\b/iu.test(query)) {
    const compared = query
      .split(/\b(?:vs\.?|versus|and)\b/iu)
      .map(normalizeWhitespace)
      .filter((entry) => entry.length > 2);
    return [
      query,
      ...compared,
      `${query} comparison evidence`,
      `${query} tradeoffs`,
    ];
  }
  if (/\b(how|why|what|when|where|which)\b/iu.test(query)) {
    return [
      query,
      `${query} background`,
      `${query} current evidence`,
      `${query} limitations`,
    ];
  }
  return [
    query,
    `${query} overview`,
    `${query} evidence`,
    `${query} recent updates`,
  ];
}

function splitQueryParts(query: string): string[] {
  return query
    .split(/\s*(?:,|;|\band\b|\bor\b)\s*/iu)
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

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}
