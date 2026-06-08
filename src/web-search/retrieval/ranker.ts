import type {
  CodexProviderWebRetrievalChunk,
} from './chunker.js';

export interface CodexProviderWebRetrievalRankOptions {
  maxResults?: number | null;
}

export function rankCodexProviderWebRetrievalChunks(
  chunks: CodexProviderWebRetrievalChunk[],
  query: string,
  options: CodexProviderWebRetrievalRankOptions = {},
): CodexProviderWebRetrievalChunk[] {
  const terms = tokenize(query);
  const maxResults = normalizeMaxResults(options.maxResults, chunks.length);
  return chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(chunk, terms),
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.index - b.index)
    .slice(0, maxResults);
}

function scoreChunk(chunk: CodexProviderWebRetrievalChunk, terms: string[]): number {
  if (terms.length === 0) {
    return 1 / Math.max(1, chunk.index);
  }
  const text = tokenize(chunk.text);
  const title = tokenize(chunk.title);
  const url = tokenize(chunk.url);
  let score = 0;
  for (const term of terms) {
    score += countTerm(text, term);
    score += countTerm(title, term) * 2;
    score += countTerm(url, term) * 0.5;
  }
  return score + 1 / Math.max(1, chunk.index * 10);
}

function tokenize(value: string): string[] {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((term) => term.length >= 2);
}

function countTerm(values: string[], term: string): number {
  return values.reduce((count, value) => count + (value === term ? 1 : 0), 0);
}

function normalizeMaxResults(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }
  return Math.min(fallback, number);
}
