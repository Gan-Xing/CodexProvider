export type JsonRecord = Record<string, any>;

export type CodexProviderSearchMode =
  | 'fast'
  | 'any'
  | 'balanced'
  | 'exhaustive';

export type CodexProviderSearchCategory =
  | 'web'
  | 'news'
  | 'images'
  | 'videos'
  | 'it'
  | 'science';

export type CodexProviderSearchResultType =
  | 'web'
  | 'news'
  | 'image'
  | 'video'
  | 'answer';

export type CodexProviderSafeSearchMode = 'off' | 'moderate' | 'strict';
export type CodexProviderSearchTimeRange = 'day' | 'week' | 'month' | 'year';

export interface CodexProviderSearchRequest {
  query: string;
  engines?: string[] | null;
  mode?: CodexProviderSearchMode | null;
  category?: CodexProviderSearchCategory | null;
  language?: string | null;
  region?: string | null;
  page?: number | null;
  safeSearch?: CodexProviderSafeSearchMode | null;
  timeRange?: CodexProviderSearchTimeRange | null;
  maxResults?: number | null;
  allowedDomains?: string[] | null;
  blockedDomains?: string[] | null;
  externalWebAccess?: boolean | null;
  maxEngineConcurrency?: number | null;
  minFastModeResults?: number | null;
  overallTimeoutMs?: number | null;
}

export interface CodexProviderSearchEngineRequest extends Required<Pick<CodexProviderSearchRequest, 'query'>> {
  category: CodexProviderSearchCategory;
  language: string | null;
  region: string | null;
  page: number;
  safeSearch: CodexProviderSafeSearchMode | null;
  timeRange: CodexProviderSearchTimeRange | null;
  maxResults: number;
  allowedDomains: string[];
  blockedDomains: string[];
  externalWebAccess: boolean;
  signal?: AbortSignal | null;
  rawRequest: CodexProviderSearchRequest;
}

export interface CodexProviderEngineHttpRequest {
  url: string;
  method?: string | null;
  headers?: Record<string, string> | null;
  body?: string | ArrayBuffer | Uint8Array | null;
  timeoutMs?: number | null;
  maxResponseBytes?: number | null;
  maxRedirects?: number | null;
}

export interface CodexProviderEngineHttpResponse {
  status: number;
  ok: boolean;
  url: string;
  headers: Record<string, string>;
  text: string;
  json?: unknown;
}

export interface CodexProviderSearchEngine {
  name: string;
  displayName?: string;
  categories: CodexProviderSearchCategory[];
  supportsPaging?: boolean;
  supportsTimeRange?: boolean;
  supportsSafeSearch?: boolean;
  supportsLanguage?: boolean;
  supportsRegion?: boolean;
  priority?: number;
  timeoutMs?: number;
  live?: boolean;
  buildRequest?(
    request: CodexProviderSearchEngineRequest,
  ): Promise<CodexProviderEngineHttpRequest> | CodexProviderEngineHttpRequest;
  parseResponse?(
    response: CodexProviderEngineHttpResponse,
    request: CodexProviderSearchEngineRequest,
  ): Promise<CodexProviderSearchResult[]> | CodexProviderSearchResult[];
  search?(
    request: CodexProviderSearchEngineRequest,
  ): Promise<CodexProviderSearchResult[]> | CodexProviderSearchResult[];
}

export interface CodexProviderSearchProcessor {
  search(
    engine: CodexProviderSearchEngine,
    request: CodexProviderSearchEngineRequest,
  ): Promise<CodexProviderEngineSearchOutcome>;
}

export interface CodexProviderSearchEngineError {
  code: string;
  message: string;
  status?: number | null;
  retryable?: boolean | null;
}

export interface CodexProviderEngineSearchOutcome {
  engine: string;
  ok: boolean;
  durationMs: number;
  results: CodexProviderSearchResult[];
  error?: CodexProviderSearchEngineError | null;
}

export interface CodexProviderSearchResult {
  type: CodexProviderSearchResultType;
  engine: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string | null;
  thumbnail?: string | null;
  rank?: number | null;
  score?: number | null;
  raw?: unknown;
}

export interface CodexProviderMergedSearchResult {
  title: string;
  url: string;
  snippet: string;
  engines: string[];
  engineRanks: Record<string, number>;
  score: number;
  publishedAt?: string | null;
  thumbnail?: string | null;
}

export interface CodexProviderUnresponsiveEngine {
  engine: string;
  code: string;
  message: string;
  durationMs?: number | null;
  suspendedUntil?: string | null;
}

export interface CodexProviderSearchResponse {
  query: string;
  mode: CodexProviderSearchMode;
  results: CodexProviderMergedSearchResult[];
  unresponsiveEngines: CodexProviderUnresponsiveEngine[];
  timings: Record<string, number>;
  searchedAt: string;
}

export interface CodexProviderMetaSearchService {
  search(request: CodexProviderSearchRequest): Promise<CodexProviderSearchResponse>;
}

export interface CodexProviderMetaSearchServiceOptions {
  engines?: CodexProviderSearchEngine[] | null;
  registry?: CodexProviderSearchEngineRegistry | null;
  processor?: CodexProviderSearchProcessor | null;
  engineState?: CodexProviderSearchEngineState | null;
  mode?: CodexProviderSearchMode | null;
  maxResults?: number | null;
  maxEngineConcurrency?: number | null;
  minFastModeResults?: number | null;
  overallTimeoutMs?: number | null;
  failureThreshold?: number | null;
  suspensionMs?: number | null;
  now?: (() => Date) | null;
}

export interface CodexProviderSearchEngineRegistry {
  register(engine: CodexProviderSearchEngine): this;
  has(name: string): boolean;
  get(name: string): CodexProviderSearchEngine | null;
  list(): CodexProviderSearchEngine[];
}

export interface CodexProviderSearchEngineStateSnapshot {
  name: string;
  consecutiveFailures: number;
  suspendedUntil: string | null;
}

export interface CodexProviderSearchEngineState {
  isSuspended(engineName: string, now?: Date): boolean;
  suspendedUntil(engineName: string): Date | null;
  recordSuccess(engineName: string): void;
  recordFailure(engineName: string, now?: Date): void;
  snapshot(): CodexProviderSearchEngineStateSnapshot[];
}
