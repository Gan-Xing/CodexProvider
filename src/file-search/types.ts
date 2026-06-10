import type {
  CodexProviderHostedToolDeltaEmitter,
  CodexProviderHostedToolExecutionRequest,
  CodexProviderHostedToolExecutionResult,
  CodexProviderHostedToolExecutor,
  JsonRecord,
} from '../hosted_tool_executors.js';

export type {
  CodexProviderHostedToolDeltaEmitter,
  CodexProviderHostedToolExecutionRequest,
  CodexProviderHostedToolExecutionResult,
  CodexProviderHostedToolExecutor,
  JsonRecord,
} from '../hosted_tool_executors.js';

export interface CodexProviderFileSearchExecutorOptions {
  roots?: string[] | null;
  sources?: CodexProviderFileSearchSourceInput[] | null;
  maxResults?: number | null;
  maxFilesScanned?: number | null;
  maxBytesPerFile?: number | null;
  maxPayloadBytes?: number | null;
  snippetLines?: number | null;
  includeContent?: boolean | null;
  followSymlinks?: boolean | null;
  ignoreDirectories?: string[] | null;
  ignoreExtensions?: string[] | null;
  pageTokenSecret?: string | null;
}

export type CodexProviderFileSearchSourceInput =
  | CodexProviderFileSearchSource
  | CodexProviderLocalFileSearchSourceOptions
  | CodexProviderLocalVectorFileSearchSourceOptions
  | CodexProviderMemoryFileSearchSourceOptions
  | CodexProviderSqliteFtsFileSearchSourceOptions
  | CodexProviderInMemoryVectorFileSearchSourceOptions
  | CodexProviderVectorStoreFileSearchSourceOptions
  | CodexProviderRemoteDocumentsFileSearchSourceOptions;

export interface CodexProviderFileSearchSource {
  name: string;
  type?: string | null;
  search(
    request: CodexProviderFileSearchSourceRequest,
  ): Promise<CodexProviderFileSearchSourceResult> | CodexProviderFileSearchSourceResult;
}

export interface CodexProviderFileSearchSourceRequest {
  query: string;
  terms: string[];
  pathGlob: string;
  vectorStoreIds: string[];
  filters: CodexProviderFileSearchFilter | null;
  rankingOptions: CodexProviderFileSearchRankingOptions;
  maxResults: number;
  pageSize: number;
  pageCursor: string | null;
  maxBytesPerFile: number;
  maxPayloadBytes: number;
  snippetLines: number;
  includeContent: boolean | null;
  emitDelta?: CodexProviderHostedToolDeltaEmitter | null;
  toolRequest: CodexProviderHostedToolExecutionRequest;
}

export interface CodexProviderFileSearchSourceResult {
  results: CodexProviderFileSearchSourceMatch[];
  nextPage?: string | null;
  hasMore?: boolean | null;
  scannedFiles?: number | null;
  skippedFiles?: number | null;
  metadata?: JsonRecord | null;
}

export interface CodexProviderVectorStoreFileSearchSourceOptions {
  type?: 'vector-store' | null;
  name?: string | null;
  store: CodexProviderVectorStoreAdapter;
}

export interface CodexProviderVectorStoreAdapter {
  search(
    request: CodexProviderVectorStoreSearchRequest,
  ): Promise<CodexProviderFileSearchSourceResult> | CodexProviderFileSearchSourceResult;
}

export interface CodexProviderVectorStoreSearchRequest {
  sourceName: string;
  query: string;
  terms: string[];
  pathGlob: string;
  vectorStoreIds: string[];
  filters: CodexProviderFileSearchFilter | null;
  rankingOptions: CodexProviderFileSearchRankingOptions;
  maxResults: number;
  pageSize: number;
  pageCursor: string | null;
  maxBytesPerFile: number;
  maxPayloadBytes: number;
  snippetLines: number;
  includeContent: boolean | null;
  toolRequest: CodexProviderHostedToolExecutionRequest;
}

export interface CodexProviderRemoteDocumentsFileSearchSourceOptions {
  type?: 'remote-documents' | null;
  name?: string | null;
  query: CodexProviderRemoteDocumentsQueryFunction;
  fetchDocument?: CodexProviderRemoteDocumentsFetchFunction | null;
  maxDocumentsScanned?: number | null;
  maxBytesPerDocument?: number | null;
  snippetLines?: number | null;
  includeContent?: boolean | null;
}

export type CodexProviderRemoteDocumentsQueryFunction = (
  request: CodexProviderRemoteDocumentsQueryRequest,
) => Promise<CodexProviderRemoteDocument[]> | CodexProviderRemoteDocument[];

export type CodexProviderRemoteDocumentsFetchFunction = (
  request: CodexProviderRemoteDocumentsFetchRequest,
) => Promise<string | CodexProviderRemoteDocument | null> | string | CodexProviderRemoteDocument | null;

export interface CodexProviderRemoteDocumentsQueryRequest {
  sourceName: string;
  query: string;
  terms: string[];
  pathGlob: string;
  vectorStoreIds: string[];
  filters: CodexProviderFileSearchFilter | null;
  rankingOptions: CodexProviderFileSearchRankingOptions;
  maxResults: number;
  pageSize: number;
  pageCursor: string | null;
  includeContent: boolean | null;
  toolRequest: CodexProviderHostedToolExecutionRequest;
}

export interface CodexProviderRemoteDocumentsFetchRequest extends CodexProviderRemoteDocumentsQueryRequest {
  document: CodexProviderRemoteDocument;
}

export interface CodexProviderRemoteDocument {
  id: string;
  title?: string | null;
  uri?: string | null;
  path?: string | null;
  content?: string | null;
  snippet?: string | null;
  score?: number | null;
  metadata?: JsonRecord | null;
}

export interface CodexProviderLocalFileSearchSourceOptions {
  type?: 'local-fs' | null;
  name?: string | null;
  roots: string[];
  maxFilesScanned?: number | null;
  maxBytesPerFile?: number | null;
  snippetLines?: number | null;
  includeContent?: boolean | null;
  followSymlinks?: boolean | null;
  ignoreDirectories?: string[] | null;
  ignoreExtensions?: string[] | null;
}

export interface CodexProviderMemoryFileSearchSourceOptions {
  type?: 'memory-documents' | null;
  name?: string | null;
  documents: CodexProviderMemoryFileSearchDocument[];
  maxDocumentsScanned?: number | null;
  maxBytesPerDocument?: number | null;
  snippetLines?: number | null;
  includeContent?: boolean | null;
}

export interface CodexProviderMemoryFileSearchDocument {
  id: string;
  title?: string | null;
  uri?: string | null;
  path?: string | null;
  content: string;
  metadata?: JsonRecord | null;
}

export interface CodexProviderSqliteFtsFileSearchSourceOptions {
  type?: 'sqlite-fts' | null;
  name?: string | null;
  table: string;
  database?: CodexProviderSqliteFtsDatabase | null;
  query?: CodexProviderSqliteFtsQueryFunction | null;
  columns?: CodexProviderSqliteFtsColumns | null;
  metadataColumns?: string[] | null;
  maxRows?: number | null;
  maxBytesPerDocument?: number | null;
  snippetLines?: number | null;
  includeContent?: boolean | null;
}

export interface CodexProviderSqliteFtsDatabase {
  all(sql: string, params: unknown[]): Promise<JsonRecord[]> | JsonRecord[];
}

export type CodexProviderSqliteFtsQueryFunction = (
  request: CodexProviderSqliteFtsQueryRequest,
) => Promise<JsonRecord[]> | JsonRecord[];

export interface CodexProviderSqliteFtsQueryRequest {
  sql: string;
  params: unknown[];
  query: string;
  ftsQuery: string;
  pathGlob: string;
  maxResults: number;
  terms: string[];
}

export interface CodexProviderSqliteFtsColumns {
  id?: string | null;
  title?: string | null;
  uri?: string | null;
  path?: string | null;
  content?: string | null;
  score?: string | null;
}

export interface CodexProviderEmbeddingProvider {
  model: string;
  embed(
    input: string[],
    options?: CodexProviderEmbeddingProviderEmbedOptions,
  ): Promise<CodexProviderEmbeddingProviderResult> | CodexProviderEmbeddingProviderResult;
}

export interface CodexProviderEmbeddingProviderEmbedOptions {
  signal?: AbortSignal | null;
}

export interface CodexProviderEmbeddingProviderResult {
  model: string;
  embeddings: number[][];
  dimensions?: number | null;
}

export type CodexProviderEmbeddingsApiResponseParser = (body: JsonRecord) => number[][];

export interface CodexProviderEmbeddingsApiProviderOptions {
  apiKey?: string | null;
  model?: string | null;
  endpoint?: string | null;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string> | null;
  requestBody?: JsonRecord | null;
  responseParser?: CodexProviderEmbeddingsApiResponseParser | null;
}

export interface CodexProviderOpenRouterEmbeddingProviderOptions
  extends Omit<CodexProviderEmbeddingsApiProviderOptions, 'endpoint' | 'model'> {
  model?: string | null;
  endpoint?: string | null;
}

export interface CodexProviderLocalVectorChunkingOptions {
  maxChars?: number | null;
  overlapChars?: number | null;
  maxChunksPerFile?: number | null;
}

export interface CodexProviderLocalVectorFileSearchSourceOptions
  extends Omit<CodexProviderLocalFileSearchSourceOptions, 'type'> {
  type?: 'local-vector' | null;
  embeddingProvider: CodexProviderEmbeddingProvider;
  indexStore?: CodexProviderLocalVectorIndexStore | null;
  chunking?: CodexProviderLocalVectorChunkingOptions | null;
  vectorWeight?: number | null;
  textWeight?: number | null;
  embeddingBatchSize?: number | null;
}

export interface CodexProviderLocalVectorIndexDocument {
  id: string;
  sourceName: string;
  root: string;
  path: string;
  uri: string;
  title: string;
  filename: string;
  size: number;
  mtimeMs: number;
  contentHash: string;
  embeddingModel: string;
  indexVersion?: string | null;
  chunkerVersion?: string | null;
  chunkingConfigHash?: string | null;
  embeddingDimensions?: number | null;
  contentHashAlgorithm?: string | null;
  statFingerprint?: string | null;
  updatedAt: string;
}

export interface CodexProviderLocalVectorIndexChunk {
  id: string;
  documentId: string;
  sourceName: string;
  root: string;
  path: string;
  uri: string;
  title: string;
  filename: string;
  text: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  embedding: number[];
  metadata?: JsonRecord | null;
}

export interface CodexProviderLocalVectorIndexSearchChunksRequest {
  sourceName: string;
  query: string;
  terms: string[];
  pathGlob: string;
  queryEmbedding: number[];
  maxResults: number;
  rankingOptions: CodexProviderFileSearchRankingOptions;
}

export interface CodexProviderLocalVectorIndexStore {
  getDocument(
    id: string,
  ): Promise<CodexProviderLocalVectorIndexDocument | null> | CodexProviderLocalVectorIndexDocument | null;
  upsertDocument(
    document: CodexProviderLocalVectorIndexDocument,
    chunks: CodexProviderLocalVectorIndexChunk[],
  ): Promise<void> | void;
  listChunks(
    sourceName: string,
  ): Promise<CodexProviderLocalVectorIndexChunk[]> | CodexProviderLocalVectorIndexChunk[];
  listDocuments?(
    sourceName: string,
  ): Promise<CodexProviderLocalVectorIndexDocument[]> | CodexProviderLocalVectorIndexDocument[];
  searchChunks?(
    request: CodexProviderLocalVectorIndexSearchChunksRequest,
  ): Promise<CodexProviderLocalVectorIndexChunk[]> | CodexProviderLocalVectorIndexChunk[];
  deleteDocuments?(ids: string[]): Promise<void> | void;
  deleteStaleDocuments?(sourceName: string, liveDocumentIds: string[]): Promise<string[]> | string[];
}

export interface CodexProviderSqliteLocalVectorIndexStoreDatabase {
  all(sql: string, params?: unknown[]): Promise<JsonRecord[]> | JsonRecord[];
  run(sql: string, params?: unknown[]): Promise<unknown> | unknown;
}

export interface CodexProviderSqliteLocalVectorIndexStoreQueryRequest {
  operation: 'all' | 'run';
  sql: string;
  params: unknown[];
}

export type CodexProviderSqliteLocalVectorIndexStoreQueryFunction = (
  request: CodexProviderSqliteLocalVectorIndexStoreQueryRequest,
) => Promise<unknown> | unknown;

export interface CodexProviderSqliteLocalVectorIndexStoreOptions {
  database?: CodexProviderSqliteLocalVectorIndexStoreDatabase | null;
  query?: CodexProviderSqliteLocalVectorIndexStoreQueryFunction | null;
  tablePrefix?: string | null;
  initializeSchema?: boolean | null;
}

export interface CodexProviderInMemoryVectorFileSearchSourceOptions {
  type?: 'in-memory-vector' | null;
  name?: string | null;
  documents: CodexProviderMemoryFileSearchDocument[];
  embeddingProvider: CodexProviderEmbeddingProvider;
  maxDocumentsScanned?: number | null;
  maxBytesPerDocument?: number | null;
  snippetLines?: number | null;
  includeContent?: boolean | null;
  vectorWeight?: number | null;
  textWeight?: number | null;
}

export interface CodexProviderFileSearchSourceMatch {
  file_id?: string | null;
  filename?: string | null;
  title: string;
  uri: string;
  path: string;
  root?: string | null;
  source?: string | null;
  sourceType?: string | null;
  score: number;
  attributes?: JsonRecord | null;
  content?: CodexProviderFileSearchChunk[] | null;
}

export interface CodexProviderFileSearchDocument {
  file_id: string;
  filename: string;
  title: string;
  uri: string;
  path: string;
  root?: string | null;
  source?: string | null;
  sourceType?: string | null;
  attributes: JsonRecord;
}

export interface CodexProviderFileSearchChunk {
  type: 'text';
  text: string;
  line?: number | null;
  start_line?: number | null;
  end_line?: number | null;
}

export interface CodexProviderFileSearchResult {
  file_id: string;
  filename: string;
  score: number;
  attributes: JsonRecord;
  content: CodexProviderFileSearchChunk[];
}

export type CodexProviderFileSearchFilter =
  | {
    type: 'and' | 'or';
    filters: CodexProviderFileSearchFilter[];
  }
  | {
    type: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin';
    key?: string | null;
    property?: string | null;
    value: unknown;
  };

export interface CodexProviderFileSearchRankingOptions {
  ranker: string;
  scoreThreshold: number;
  hybridSearch: {
    embeddingWeight: number;
    textWeight: number;
  } | null;
}

export interface CodexProviderFileSearchExecutorContent {
  object: 'vector_store.search_results.page';
  query: string;
  search_query: string;
  provider: string;
  data: CodexProviderFileSearchResult[];
  search_results: CodexProviderFileSearchResult[];
  has_more: boolean;
  next_page: string | null;
  vector_store_ids: string[];
  ranking_options: CodexProviderFileSearchRankingOptions;
  sourceCount: number;
  scannedFiles: number;
  skippedFiles: number;
}

export interface NormalizedFileSearchOptions {
  sources: CodexProviderFileSearchSource[];
  maxResults: number;
  maxBytesPerFile: number;
  maxPayloadBytes: number;
  snippetLines: number;
  includeContent: boolean | null;
  pageTokenSecret: string;
}

export interface NormalizedRemoteDocumentsFileSearchOptions {
  name: string;
  type: 'remote-documents';
  query: CodexProviderRemoteDocumentsQueryFunction;
  fetchDocument: CodexProviderRemoteDocumentsFetchFunction | null;
  maxDocumentsScanned: number;
  maxBytesPerDocument: number;
  snippetLines: number;
  includeContent: boolean;
}

export interface NormalizedLocalFileSearchOptions {
  name: string;
  type: 'local-fs';
  roots: LocalFileSearchRoot[];
  maxFilesScanned: number;
  maxBytesPerFile: number;
  snippetLines: number;
  includeContent: boolean;
  followSymlinks: boolean;
  ignoreDirectories: Set<string>;
  ignoreExtensions: Set<string>;
}

export interface NormalizedMemoryFileSearchOptions {
  name: string;
  type: 'memory-documents';
  documents: NormalizedMemoryFileSearchDocument[];
  maxDocumentsScanned: number;
  maxBytesPerDocument: number;
  snippetLines: number;
  includeContent: boolean;
}

export interface NormalizedMemoryFileSearchDocument {
  id: string;
  title: string;
  uri: string;
  path: string;
  content: string;
  metadata: JsonRecord | null;
}

export interface NormalizedSqliteFtsFileSearchOptions {
  name: string;
  type: 'sqlite-fts';
  table: string;
  tableMatchTarget: string;
  query: CodexProviderSqliteFtsQueryFunction;
  columns: Required<CodexProviderSqliteFtsColumns>;
  metadataColumns: string[];
  maxRows: number;
  maxBytesPerDocument: number;
  snippetLines: number;
  includeContent: boolean;
}

export interface NormalizedInMemoryVectorFileSearchOptions {
  name: string;
  type: 'in-memory-vector';
  documents: NormalizedMemoryFileSearchDocument[];
  embeddingProvider: CodexProviderEmbeddingProvider;
  maxDocumentsScanned: number;
  maxBytesPerDocument: number;
  snippetLines: number;
  includeContent: boolean;
  vectorWeight: number;
  textWeight: number;
}

export interface NormalizedLocalVectorFileSearchOptions {
  local: NormalizedLocalFileSearchOptions;
  name: string;
  type: 'local-vector';
  embeddingProvider: CodexProviderEmbeddingProvider;
  indexStore: CodexProviderLocalVectorIndexStore;
  chunking: NormalizedLocalVectorChunkingOptions;
  vectorWeight: number;
  textWeight: number;
  embeddingBatchSize: number;
}

export interface NormalizedLocalVectorChunkingOptions {
  maxChars: number;
  overlapChars: number;
  maxChunksPerFile: number;
}

export interface EmbeddedMemoryFileSearchDocument {
  document: NormalizedMemoryFileSearchDocument;
  embedding: number[];
}

export interface LocalVectorTextChunk {
  text: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
}

export interface LocalFileSearchRoot {
  path: string;
  realPath: string;
}

export interface CandidateFile {
  root: LocalFileSearchRoot;
  absolutePath: string;
  relativePath: string;
}
