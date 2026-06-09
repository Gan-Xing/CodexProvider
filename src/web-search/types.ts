import type {
  CodexProviderHostedToolExecutionRequest,
  JsonRecord,
} from '../hosted_tool_executors.js';
import type {
  CodexProviderMetaSearchService,
  CodexProviderSearchEngine,
  CodexProviderSearchMode,
  CodexProviderSearchProcessor,
} from './metasearch/index.js';
import type {
  CodexProviderWebRetrievalFetcher,
} from './retrieval/index.js';

export type CodexProviderWebSearchProvider =
  | 'tavily'
  | 'brave'
  | 'serper';

export type CodexProviderWebSearchContextSize = 'low' | 'medium' | 'high';

export interface CodexProviderWebSearchExecutorOptions {
  search?: CodexProviderMetaSearchService | null;
  retrieval?: CodexProviderWebRetrievalFetcher | null;
  engines?: CodexProviderSearchEngine[] | null;
  processor?: CodexProviderSearchProcessor | null;
  mode?: CodexProviderSearchMode | null;
  fetchPages?: boolean | null;
  provider?: CodexProviderWebSearchProvider | null;
  apiKey?: string | null;
  endpoint?: string | null;
  fetchImpl?: typeof fetch;
  maxResults?: number | null;
  maxRetrievedPages?: number | null;
  maxChunks?: number | null;
  chunkChars?: number | null;
  chunkOverlapChars?: number | null;
  country?: string | null;
  language?: string | null;
  sources?: CodexProviderWebSearchSourceInput[] | null;
  now?: (() => Date) | null;
}

export type CodexProviderWebSearchSourceInput =
  | CodexProviderWebSearchSource
  | CodexProviderProviderWebSearchSourceOptions;

export interface CodexProviderProviderWebSearchSourceOptions {
  type?: 'provider' | null;
  provider: CodexProviderWebSearchProvider;
  apiKey: string;
  endpoint?: string | null;
  fetchImpl?: typeof fetch;
  maxResults?: number | null;
  country?: string | null;
  language?: string | null;
}

export interface CodexProviderWebSearchSource {
  name: string;
  type?: string | null;
  live?: boolean | null;
  search(
    request: CodexProviderWebSearchSourceRequest,
  ): Promise<CodexProviderWebSearchSourceResult> | CodexProviderWebSearchSourceResult;
}

export interface CodexProviderWebSearchSourceRequest {
  query: string;
  maxResults: number;
  searchContextSize: CodexProviderWebSearchContextSize;
  userLocation: JsonRecord | null;
  filters: CodexProviderWebSearchFilters | null;
  externalWebAccess: boolean;
  returnTokenBudget: number | null;
  toolRequest: CodexProviderHostedToolExecutionRequest;
}

export interface CodexProviderWebSearchFilters {
  allowedDomains: string[];
  blockedDomains: string[];
  raw: JsonRecord | null;
}

export interface CodexProviderWebSearchSourceResult {
  answer?: string | null;
  results: CodexProviderWebSearchResult[];
  sources?: CodexProviderWebSearchSourceReference[] | null;
  citations?: CodexProviderWebSearchCitation[] | null;
  metadata?: JsonRecord | null;
}

export interface CodexProviderWebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string | null;
  publishedAt?: string | null;
  score?: number | null;
}

export interface CodexProviderWebSearchSourceReference {
  title?: string | null;
  url: string;
  source?: string | null;
  snippet?: string | null;
}

export interface CodexProviderWebSearchCitation {
  type?: string | null;
  title?: string | null;
  url: string;
  start_index?: number | null;
  end_index?: number | null;
}

export interface CodexProviderWebSearchExecutorContent {
  query: string;
  provider: string;
  answer?: string | null;
  results: CodexProviderWebSearchResult[];
  sources?: CodexProviderWebSearchSourceReference[];
  citations?: CodexProviderWebSearchCitation[];
  retrieved_at: string;
  external_web_access: boolean;
  search_context_size: CodexProviderWebSearchContextSize;
  return_token_budget?: number | null;
}
