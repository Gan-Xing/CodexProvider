import type {
  CodexProviderSearchEngine,
  CodexProviderSearchResult,
} from './types.js';

export function normalizeSearchEngineName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function assertValidSearchEngine(engine: CodexProviderSearchEngine): void {
  const name = normalizeSearchEngineName(engine?.name);
  if (!name) {
    throw new Error('Search engine requires a non-empty name.');
  }
  if (!Array.isArray(engine.categories) || engine.categories.length === 0) {
    throw new Error(`Search engine ${name} requires at least one category.`);
  }
  if (typeof engine.buildRequest !== 'function' || typeof engine.parseResponse !== 'function') {
    throw new Error(`Search engine ${name} requires buildRequest() and parseResponse().`);
  }
}

export function normalizeSearchEngineResult(
  result: Partial<CodexProviderSearchResult>,
  engineName: string,
  rank: number,
): CodexProviderSearchResult | null {
  const url = normalizeString(result.url);
  if (!url) {
    return null;
  }
  return {
    type: result.type ?? 'web',
    engine: normalizeString(result.engine) || engineName,
    title: normalizeString(result.title) || url,
    url,
    snippet: normalizeString(result.snippet),
    publishedAt: normalizeString(result.publishedAt) || null,
    thumbnail: normalizeString(result.thumbnail) || null,
    rank: Number.isFinite(Number(result.rank)) ? Number(result.rank) : rank,
    score: Number.isFinite(Number(result.score)) ? Number(result.score) : null,
    raw: result.raw,
  };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
