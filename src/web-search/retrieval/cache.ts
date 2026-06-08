import {
  normalizeRetrievalUrlForCache,
} from './safety.js';

export interface CodexProviderWebRetrievalCacheEntry {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string;
  text: string;
  bytes: number;
  fetchedAt: string;
  redirectChain: string[];
}

export interface CodexProviderWebRetrievalCacheStats {
  hits: number;
  misses: number;
  entries: number;
}

export interface CodexProviderWebRetrievalCache {
  get(url: string): CodexProviderWebRetrievalCacheEntry | null;
  set(url: string, entry: CodexProviderWebRetrievalCacheEntry): void;
  delete(url: string): boolean;
  clear(): void;
  snapshotStats(): CodexProviderWebRetrievalCacheStats;
}

export interface CodexProviderMemoryWebRetrievalCacheOptions {
  ttlMs?: number | null;
  maxEntries?: number | null;
  now?: (() => number) | null;
}

interface StoredCacheEntry {
  entry: CodexProviderWebRetrievalCacheEntry;
  expiresAt: number | null;
}

export function createCodexProviderMemoryWebRetrievalCache(
  options: CodexProviderMemoryWebRetrievalCacheOptions = {},
): CodexProviderWebRetrievalCache {
  return new CodexProviderMemoryWebRetrievalCache(options);
}

class CodexProviderMemoryWebRetrievalCache implements CodexProviderWebRetrievalCache {
  private readonly ttlMs: number | null;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, StoredCacheEntry>();
  private hits = 0;
  private misses = 0;

  constructor(options: CodexProviderMemoryWebRetrievalCacheOptions) {
    this.ttlMs = normalizePositiveInteger(options.ttlMs);
    this.maxEntries = normalizePositiveInteger(options.maxEntries) ?? 1_000;
    this.now = options.now ?? (() => Date.now());
  }

  get(url: string): CodexProviderWebRetrievalCacheEntry | null {
    const key = cacheKey(url);
    const stored = this.entries.get(key);
    if (!stored || this.isExpired(stored)) {
      if (stored) {
        this.entries.delete(key);
      }
      this.misses += 1;
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, stored);
    this.hits += 1;
    return {
      ...stored.entry,
      redirectChain: [...stored.entry.redirectChain],
    };
  }

  set(url: string, entry: CodexProviderWebRetrievalCacheEntry): void {
    const key = cacheKey(url);
    this.entries.set(key, {
      entry: {
        ...entry,
        redirectChain: [...entry.redirectChain],
      },
      expiresAt: this.ttlMs === null ? null : this.now() + this.ttlMs,
    });
    this.evictOverflow();
  }

  delete(url: string): boolean {
    return this.entries.delete(cacheKey(url));
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }

  snapshotStats(): CodexProviderWebRetrievalCacheStats {
    this.removeExpiredEntries();
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
    };
  }

  private isExpired(stored: StoredCacheEntry): boolean {
    return stored.expiresAt !== null && stored.expiresAt <= this.now();
  }

  private removeExpiredEntries(): void {
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(key);
      }
    }
  }

  private evictOverflow(): void {
    this.removeExpiredEntries();
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }
}

function cacheKey(url: string): string {
  return normalizeRetrievalUrlForCache(url);
}

function normalizePositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
