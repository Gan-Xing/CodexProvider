import {
  canonicalSearchResultUrl,
} from './dedupe.js';
import {
  scoreMergedSearchResult,
  scoreSearchResult,
} from './score.js';
import type {
  CodexProviderMergedSearchResult,
  CodexProviderSearchResult,
} from './types.js';

export function mergeSearchResults(
  results: CodexProviderSearchResult[],
  query: string,
): CodexProviderMergedSearchResult[] {
  const grouped = new Map<string, CodexProviderSearchResult[]>();
  for (const result of results) {
    const key = canonicalSearchResultUrl(result.url);
    const entries = grouped.get(key) ?? [];
    entries.push(result);
    grouped.set(key, entries);
  }

  const merged: CodexProviderMergedSearchResult[] = [];
  for (const entries of grouped.values()) {
    const sortedEntries = [...entries].sort((left, right) => (
      scoreSearchResult(right, query) - scoreSearchResult(left, query)
      || (left.rank ?? 100) - (right.rank ?? 100)
      || left.engine.localeCompare(right.engine)
    ));
    const primary = sortedEntries[0];
    const engines = [...new Set(sortedEntries.map((entry) => entry.engine))].sort();
    const engineRanks: Record<string, number> = {};
    for (const entry of sortedEntries) {
      engineRanks[entry.engine] = Math.min(engineRanks[entry.engine] ?? Number.POSITIVE_INFINITY, entry.rank ?? 100);
    }
    const candidate: CodexProviderMergedSearchResult = {
      title: bestText(sortedEntries.map((entry) => entry.title)) || primary.title,
      url: primary.url,
      snippet: bestText(sortedEntries.map((entry) => entry.snippet)),
      engines,
      engineRanks,
      score: sortedEntries.reduce((sum, entry) => sum + scoreSearchResult(entry, query), 0),
      publishedAt: firstNonEmpty(sortedEntries.map((entry) => entry.publishedAt)),
      thumbnail: firstNonEmpty(sortedEntries.map((entry) => entry.thumbnail)),
    };
    candidate.score = scoreMergedSearchResult(candidate, query);
    merged.push(candidate);
  }

  return merged.sort((left, right) => (
    right.score - left.score
    || left.url.localeCompare(right.url)
  ));
}

function bestText(values: Array<string | null | undefined>): string {
  return values
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] ?? '';
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  return values
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .find(Boolean) ?? null;
}
