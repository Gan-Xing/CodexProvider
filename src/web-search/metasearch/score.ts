import type {
  CodexProviderMergedSearchResult,
  CodexProviderSearchResult,
} from './types.js';
import {
  tokenizeSearchText,
} from '../../search-tokenizer.js';

export function scoreSearchResult(
  result: CodexProviderSearchResult,
  query: string,
): number {
  const rank = normalizePositiveNumber(result.rank) ?? 100;
  const upstreamScore = normalizePositiveNumber(result.score) ?? 0;
  const queryTerms = tokenizeSearchText(query);
  const normalizedTitle = normalizedComparableText(result.title);
  const titleOverlap = overlapScore(tokenizeSearchText(result.title), queryTerms);
  const snippetOverlap = overlapScore(tokenizeSearchText(result.snippet), queryTerms);
  const allTitleTermsBoost = queryTerms.length > 0 && queryTerms.every((term) => normalizedTitle.includes(term))
    ? 18
    : 0;
  const exactTitleBoost = normalizedTitle === normalizedComparableText(query)
    ? 32
    : 0;
  const exactBoost = query && `${result.title} ${result.snippet}`.toLowerCase().includes(query.toLowerCase())
    ? 8
    : 0;
  return roundScore(
    (100 / (rank + 1))
    + Math.min(40, upstreamScore * 10)
    + (titleOverlap * 24)
    + (snippetOverlap * 12)
    + allTitleTermsBoost
    + exactTitleBoost
    + exactBoost,
  );
}

export function scoreMergedSearchResult(
  result: CodexProviderMergedSearchResult,
  query: string,
): number {
  const votes = result.engines.length;
  const rankScore = Object.values(result.engineRanks)
    .reduce((sum, rank) => sum + (100 / ((normalizePositiveNumber(rank) ?? 100) + 1)), 0);
  const queryTerms = tokenizeSearchText(query);
  const titleOverlap = overlapScore(tokenizeSearchText(result.title), queryTerms);
  const snippetOverlap = overlapScore(tokenizeSearchText(result.snippet), queryTerms);
  return roundScore(
    result.score
    + rankScore
    + (votes > 1 ? (votes - 1) * 18 : 0)
    + (titleOverlap * 18)
    + (snippetOverlap * 8),
  );
}

export { tokenizeSearchText };

function overlapScore(values: string[], queryTerms: string[]): number {
  if (values.length === 0 || queryTerms.length === 0) {
    return 0;
  }
  const valueSet = new Set(values);
  const matches = queryTerms.filter((term) => valueSet.has(term)).length;
  return matches / queryTerms.length;
}

function normalizePositiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizedComparableText(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}
