import type {
  CodexProviderSearchCategory,
  CodexProviderSearchEngine,
  CodexProviderSearchResult,
} from '../metasearch/index.js';
import type {
  CodexProviderWebRetrievalCache,
  CodexProviderWebRetrievalCacheEntry,
  CodexProviderWebRetrievalCacheStats,
} from '../retrieval/index.js';
import type {
  CodexProviderLocalIndexDocument,
  CodexProviderLocalIndexStore,
} from './memory-index.js';

export interface CodexProviderLocalIndexSearchEngineOptions {
  index: CodexProviderLocalIndexStore;
  name?: string | null;
  displayName?: string | null;
  categories?: CodexProviderSearchCategory[] | null;
  priority?: number | null;
  maxResults?: number | null;
}

export interface CodexProviderLocalIndexingWebRetrievalCacheOptions {
  cache: CodexProviderWebRetrievalCache;
  index: CodexProviderLocalIndexStore;
  source?: string | null;
}

export function createCodexProviderLocalIndexSearchEngine(
  options: CodexProviderLocalIndexSearchEngineOptions,
): CodexProviderSearchEngine {
  const name = normalizeString(options.name) || 'local-index';
  const maxResults = clampInteger(options.maxResults, 1, 50, 10);
  return {
    name,
    displayName: normalizeString(options.displayName) || 'Local Web Index',
    categories: normalizeCategories(options.categories),
    priority: normalizeNumber(options.priority, 80),
    live: false,
    localIndex: true,
    search(request) {
      return options.index.search({
        query: request.query,
        maxResults: Math.min(maxResults, request.maxResults),
        allowedDomains: request.allowedDomains,
        blockedDomains: request.blockedDomains,
      }).map((result): CodexProviderSearchResult => ({
        type: 'web',
        engine: name,
        title: result.title,
        url: result.finalUrl || result.url,
        snippet: result.snippet,
        publishedAt: result.fetchedAt || null,
        rank: result.rank,
        score: result.score,
        raw: {
          local_index: true,
          content_type: result.contentType || null,
          source: result.source || null,
          metadata: result.metadata ?? null,
        },
      }));
    },
  };
}

export function createCodexProviderLocalIndexingWebRetrievalCache(
  options: CodexProviderLocalIndexingWebRetrievalCacheOptions,
): CodexProviderWebRetrievalCache {
  return new CodexProviderLocalIndexingWebRetrievalCache(options);
}

export function cacheEntryToLocalIndexDocument(
  entry: CodexProviderWebRetrievalCacheEntry,
  source = 'retrieval-cache',
): CodexProviderLocalIndexDocument {
  return {
    url: entry.url,
    finalUrl: entry.finalUrl,
    title: entry.title,
    text: entry.text,
    snippet: entry.text,
    contentType: entry.contentType,
    fetchedAt: entry.fetchedAt,
    source,
    metadata: {
      status: entry.status,
      bytes: entry.bytes,
      redirect_chain: [...entry.redirectChain],
    },
  };
}

class CodexProviderLocalIndexingWebRetrievalCache implements CodexProviderWebRetrievalCache {
  private readonly cache: CodexProviderWebRetrievalCache;
  private readonly index: CodexProviderLocalIndexStore;
  private readonly source: string;

  constructor(options: CodexProviderLocalIndexingWebRetrievalCacheOptions) {
    this.cache = options.cache;
    this.index = options.index;
    this.source = normalizeString(options.source) || 'retrieval-cache';
  }

  get(url: string): CodexProviderWebRetrievalCacheEntry | null {
    return this.cache.get(url);
  }

  set(url: string, entry: CodexProviderWebRetrievalCacheEntry): void {
    this.cache.set(url, entry);
    this.index.upsert(cacheEntryToLocalIndexDocument(entry, this.source));
  }

  delete(url: string): boolean {
    const deleted = this.cache.delete(url);
    const indexDeleted = this.index.delete(url);
    return deleted || indexDeleted;
  }

  clear(): void {
    this.cache.clear();
    this.index.clear();
  }

  snapshotStats(): CodexProviderWebRetrievalCacheStats {
    return this.cache.snapshotStats();
  }
}

function normalizeCategories(value: unknown): CodexProviderSearchCategory[] {
  const categories = Array.isArray(value)
    ? value.filter((entry): entry is CodexProviderSearchCategory => (
        entry === 'web'
        || entry === 'news'
        || entry === 'images'
        || entry === 'videos'
        || entry === 'it'
        || entry === 'science'
      ))
    : [];
  return categories.length > 0 ? [...new Set(categories)] : ['web'];
}

function normalizeNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
