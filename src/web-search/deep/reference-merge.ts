import {
  canonicalSearchResultUrl,
} from '../metasearch/dedupe.js';
import type {
  CodexProviderMergedSearchResult,
  CodexProviderSearchResponse,
} from '../metasearch/index.js';

export interface CodexProviderDeepSearchSubqueryResult {
  nodeId: string;
  question: string;
  query: string;
  response: CodexProviderSearchResponse | null;
  error?: string | null;
}

export interface CodexProviderDeepSearchReference {
  id: number;
  title: string;
  url: string;
  snippet: string;
  source: string;
  score: number;
  supporting_queries: string[];
  node_ids: string[];
}

export type CodexProviderDeepSearchAnswerShape = 'brief' | 'evidence_table' | 'research_memo';

export interface CodexProviderDeepSearchReferenceMergeOptions {
  maxSources?: number | null;
}

export interface CodexProviderDeepSearchSynthesisInstructionOptions {
  minimumSourceCount?: number | null;
  citationBudget?: number | null;
  answerShape?: CodexProviderDeepSearchAnswerShape | null;
}

export function mergeCodexProviderDeepSearchReferences(
  subqueries: CodexProviderDeepSearchSubqueryResult[],
  options: CodexProviderDeepSearchReferenceMergeOptions = {},
): CodexProviderDeepSearchReference[] {
  const maxSources = clampInteger(options.maxSources, 1, 100, 20);
  const grouped = new Map<string, {
    results: CodexProviderMergedSearchResult[];
    queries: Set<string>;
    nodeIds: Set<string>;
  }>();
  for (const subquery of subqueries) {
    for (const result of subquery.response?.results ?? []) {
      const key = canonicalSearchResultUrl(result.url);
      const group = grouped.get(key) ?? {
        results: [],
        queries: new Set<string>(),
        nodeIds: new Set<string>(),
      };
      group.results.push(result);
      group.queries.add(subquery.query);
      group.nodeIds.add(subquery.nodeId);
      grouped.set(key, group);
    }
  }
  return [...grouped.values()]
    .map((group) => referenceFromGroup(group))
    .sort((left, right) => (
      right.score - left.score
      || left.url.localeCompare(right.url)
    ))
    .slice(0, maxSources)
    .map((reference, index) => ({
      ...reference,
      id: index + 1,
    }));
}

export function buildCodexProviderDeepSearchSynthesisInstructions(
  references: CodexProviderDeepSearchReference[],
  options: CodexProviderDeepSearchSynthesisInstructionOptions = {},
): string {
  const answerShape = normalizeAnswerShape(options.answerShape);
  const shapeInstruction = answerShapeInstruction(answerShape);
  if (references.length === 0) {
    return [
      'No supporting sources were found. State that the research graph did not find supporting web evidence, avoid citations, and do not infer factual claims beyond the query and subquery diagnostics.',
      shapeInstruction,
    ].filter(Boolean).join(' ');
  }
  const minimumSourceCount = normalizePositiveInteger(options.minimumSourceCount);
  const citationBudget = normalizeNonNegativeInteger(options.citationBudget);
  const clauses = [
    `Synthesize the deep search findings using the ${references.length} merged sources.`,
  ];
  if (citationBudget === 0) {
    clauses.push('Citation budget is 0. Do not include citation placeholders; summarize merged sources as uncited background only.');
  } else {
    clauses.push('Cite factual claims with [[source:N]] placeholders where N is the merged source id.');
    if (citationBudget !== null && citationBudget < references.length) {
      clauses.push(`Use no more than ${citationBudget} distinct cited sources and cite only source ids 1 through ${citationBudget}; use remaining merged sources only as uncited background.`);
    }
  }
  clauses.push('Prefer sources that support multiple subqueries when resolving conflicts.');
  if (shapeInstruction) {
    clauses.push(shapeInstruction);
  }
  if (minimumSourceCount !== null && references.length < minimumSourceCount) {
    clauses.push(`Only ${references.length} merged sources were found, below the requested minimum of ${minimumSourceCount}; state that evidence is limited and do not overstate confidence.`);
  }
  return clauses.join(' ');
}

function referenceFromGroup(group: {
  results: CodexProviderMergedSearchResult[];
  queries: Set<string>;
  nodeIds: Set<string>;
}): CodexProviderDeepSearchReference {
  const sorted = [...group.results].sort((left, right) => right.score - left.score);
  const primary = sorted[0];
  const engines = [...new Set(sorted.flatMap((result) => result.engines))].sort();
  return {
    id: 0,
    title: bestText(sorted.map((result) => result.title)) || primary.title,
    url: primary.url,
    snippet: bestText(sorted.map((result) => result.snippet)),
    source: engines.join(','),
    score: sorted.reduce((sum, result) => sum + result.score, 0)
      + (group.queries.size - 1) * 15
      + (engines.length - 1) * 8,
    supporting_queries: [...group.queries],
    node_ids: [...group.nodeIds].sort(),
  };
}

function bestText(values: string[]): string {
  return values
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] ?? '';
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function normalizePositiveInteger(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    return null;
  }
  return number;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    return null;
  }
  return number;
}

function normalizeAnswerShape(value: unknown): CodexProviderDeepSearchAnswerShape | null {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
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

function answerShapeInstruction(shape: CodexProviderDeepSearchAnswerShape | null): string {
  if (shape === 'brief') {
    return 'Answer shape: brief. Put the key conclusion first, then include only the most relevant cited evidence and caveats.';
  }
  if (shape === 'evidence_table') {
    return 'Answer shape: evidence_table. Prefer a compact evidence table with claim, cited source ids, and caveat columns before any short narrative.';
  }
  if (shape === 'research_memo') {
    return 'Answer shape: research_memo. Prefer a research memo with summary, evidence, conflicts or caveats, and follow-up questions.';
  }
  return '';
}
