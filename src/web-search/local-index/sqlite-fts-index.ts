import type {
  CodexProviderLocalIndexDocument,
  CodexProviderLocalIndexSearchRequest,
  CodexProviderLocalIndexSearchResult,
  CodexProviderLocalIndexStats,
  CodexProviderLocalIndexStore,
} from './memory-index.js';

export interface CodexProviderSqliteFtsLocalIndexAdapter {
  upsert(document: CodexProviderLocalIndexDocument): void;
  delete(url: string): boolean;
  clear(): void;
  search(request: CodexProviderLocalIndexSearchRequest): CodexProviderLocalIndexSearchResult[];
  snapshotStats?(): CodexProviderLocalIndexStats;
}

export interface CodexProviderSqliteFtsLocalIndexOptions {
  adapter: CodexProviderSqliteFtsLocalIndexAdapter;
}

export function createCodexProviderSqliteFtsLocalIndex(
  options: CodexProviderSqliteFtsLocalIndexOptions,
): CodexProviderLocalIndexStore {
  if (!options.adapter || typeof options.adapter.search !== 'function') {
    throw new Error('SQLite FTS local web search index requires an adapter implementation.');
  }
  return new CodexProviderSqliteFtsLocalIndex(options.adapter);
}

class CodexProviderSqliteFtsLocalIndex implements CodexProviderLocalIndexStore {
  constructor(private readonly adapter: CodexProviderSqliteFtsLocalIndexAdapter) {}

  upsert(document: CodexProviderLocalIndexDocument): void {
    this.adapter.upsert(document);
  }

  upsertMany(documents: CodexProviderLocalIndexDocument[]): void {
    for (const document of documents) {
      this.upsert(document);
    }
  }

  delete(url: string): boolean {
    return this.adapter.delete(url);
  }

  clear(): void {
    this.adapter.clear();
  }

  search(request: CodexProviderLocalIndexSearchRequest): CodexProviderLocalIndexSearchResult[] {
    return this.adapter.search(request);
  }

  snapshotStats(): CodexProviderLocalIndexStats {
    return this.adapter.snapshotStats?.() ?? { entries: 0 };
  }
}
