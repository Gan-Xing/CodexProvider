import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type {
  CodexProviderFileSearchChunk,
  CodexProviderFileSearchExecutorContent,
  CodexProviderFileSearchExecutorOptions,
  CodexProviderFileSearchFilter,
  CodexProviderFileSearchRankingOptions,
  CodexProviderFileSearchResult,
  CodexProviderFileSearchSource,
  CodexProviderFileSearchSourceInput,
  CodexProviderFileSearchSourceMatch,
  CodexProviderHostedToolExecutionRequest,
  CodexProviderHostedToolExecutionResult,
  CodexProviderHostedToolExecutor,
  CodexProviderInMemoryVectorFileSearchSourceOptions,
  CodexProviderLocalFileSearchSourceOptions,
  CodexProviderLocalVectorFileSearchSourceOptions,
  CodexProviderMemoryFileSearchSourceOptions,
  CodexProviderRemoteDocumentsFileSearchSourceOptions,
  CodexProviderSqliteFtsFileSearchSourceOptions,
  CodexProviderVectorStoreFileSearchSourceOptions,
  JsonRecord,
  NormalizedFileSearchOptions,
} from './types.js';
import {
  createCodexProviderInMemoryVectorFileSearchSource,
  createCodexProviderLocalFileSearchSource,
  createCodexProviderLocalVectorFileSearchSource,
  createCodexProviderMemoryFileSearchSource,
  createCodexProviderRemoteDocumentsFileSearchSource,
  createCodexProviderSqliteFtsFileSearchSource,
  createCodexProviderVectorStoreFileSearchSource,
} from './sources.js';
import {
  clampInteger,
  clampNumber,
  firstNonEmptyString,
  normalizeFileSearchAttributes,
  normalizeNonNegativeInteger,
  normalizePathGlob,
  normalizeRelativePath,
  normalizeString,
  normalizeStringArray,
  stableFileSearchFileId,
  tokenizeQuery,
} from './shared.js';

export function createCodexProviderFileSearchExecutor(
  options: CodexProviderFileSearchExecutorOptions,
): CodexProviderHostedToolExecutor {
  const normalizedOptions = normalizeFileSearchOptions(options);
  return async (
    request: CodexProviderHostedToolExecutionRequest,
  ): Promise<CodexProviderHostedToolExecutionResult> => {
    const query = fileSearchQueryFromRequest(request);
    if (!query) {
      throw new Error('file_search executor requires a non-empty query argument.');
    }
    const terms = tokenizeQuery(query);
    if (terms.length === 0) {
      throw new Error('file_search executor requires at least one searchable query term.');
    }
    const maxResults = fileSearchMaxResultsFromRequest(request, normalizedOptions.maxResults);
    const includeContent = typeof request.arguments.include_content === 'boolean'
      ? request.arguments.include_content
      : normalizedOptions.includeContent;
    const pathGlob = normalizePathGlob(request.arguments.path_glob);
    const vectorStoreIds = normalizeStringArray(request.arguments.vector_store_ids);
    const filters = normalizeFileSearchFilter(request.arguments.filters ?? request.arguments.attribute_filter);
    const rankingOptions = normalizeFileSearchRankingOptions(request.arguments.ranking_options);
    const searchSources = selectFileSearchSources(normalizedOptions.sources, vectorStoreIds);
    const pageFingerprint = createFileSearchPageFingerprint({
      query,
      pathGlob,
      vectorStoreIds,
      filters,
      rankingOptions,
      maxResults,
      includeContent,
    });
    const pageToken = fileSearchPageTokenFromRequest(request);
    const pageState = decodeFileSearchPageState(
      pageToken,
      pageFingerprint,
      normalizedOptions.pageTokenSecret,
    );
    const pageOffset = pageState.offset;
    const sourceCursors = pageState.sourceCursors;
    const hasActiveSourceCursor = Object.keys(sourceCursors).length > 0;
    const effectivePageOffset = hasActiveSourceCursor ? 0 : pageOffset;
    const sourceMaxResults = hasActiveSourceCursor
      ? maxResults
      : sourceMaxResultsForPage(pageOffset, maxResults);

    await request.emitDelta?.('searching sources', {
      sourceCount: searchSources.length,
      maxResults,
      pageOffset,
      vectorStoreIds,
    });

    const aggregatedResults: CodexProviderFileSearchSourceMatch[] = [];
    const nextSourceCursors: Record<string, string> = {};
    let sourceCursorHasMore = false;
    let scannedFiles = 0;
    let skippedFiles = 0;
    for (const source of searchSources) {
      const sourceType = normalizeSourceType(source);
      const sourcePageCursor = sourceCursors[source.name] ?? null;
      await request.emitDelta?.('searching source', {
        source: source.name,
        sourceType,
        pageCursor: sourcePageCursor,
      });
      const sourceResult = await source.search({
        query,
        terms,
        pathGlob,
        vectorStoreIds,
        filters,
        rankingOptions,
        maxResults: sourceMaxResults,
        pageSize: maxResults,
        pageCursor: sourcePageCursor,
        maxBytesPerFile: normalizedOptions.maxBytesPerFile,
        maxPayloadBytes: normalizedOptions.maxPayloadBytes,
        snippetLines: normalizedOptions.snippetLines,
        includeContent,
        emitDelta: request.emitDelta,
        toolRequest: request,
      });
      const sourceNextPage = normalizeString(sourceResult.nextPage);
      const sourceHasMore = sourceResult.hasMore === true || Boolean(sourceNextPage);
      if (sourceNextPage) {
        nextSourceCursors[source.name] = sourceNextPage;
      }
      if (sourceHasMore) {
        sourceCursorHasMore = true;
      }
      scannedFiles += normalizeNonNegativeInteger(sourceResult.scannedFiles);
      skippedFiles += normalizeNonNegativeInteger(sourceResult.skippedFiles);
      for (const result of sourceResult.results ?? []) {
        aggregatedResults.push(normalizeFileSearchResult(result, source, sourceType));
      }
    }

    const filteredResults = aggregatedResults.filter((result) => fileSearchResultMatchesFilter(result, filters));
    filteredResults.sort((left, right) => (
      right.score - left.score
      || String(left.source ?? '').localeCompare(String(right.source ?? ''))
      || left.path.localeCompare(right.path)
    ));
    const rankedResults = applyFileSearchRankingOptions(filteredResults, rankingOptions);
    const pagedResults = rankedResults.slice(effectivePageOffset);
    const limitedResults = limitResultsByPayload(
      pagedResults,
      maxResults,
      normalizedOptions.maxPayloadBytes,
    );
    const openAIResults = limitedResults.map((result) => toOpenAIFileSearchResult(result, rankedResults));
    const nextOffset = pageOffset + limitedResults.length;
    const hasMore = rankedResults.length > effectivePageOffset + limitedResults.length || sourceCursorHasMore;
    const provider = searchSources.length === 1
      ? normalizeSourceType(searchSources[0])
      : 'multi-source';
    return {
      content: {
        object: 'vector_store.search_results.page',
        query,
        search_query: query,
        provider,
        data: openAIResults,
        search_results: openAIResults,
        has_more: hasMore,
        next_page: hasMore
          ? encodeFileSearchPageToken(nextOffset, pageFingerprint, normalizedOptions.pageTokenSecret, nextSourceCursors)
          : null,
        vector_store_ids: vectorStoreIds,
        ranking_options: rankingOptions,
        sourceCount: searchSources.length,
        scannedFiles,
        skippedFiles,
      } satisfies CodexProviderFileSearchExecutorContent,
      metadata: {
        provider,
        sourceCount: searchSources.length,
        resultCount: limitedResults.length,
        pageOffset,
        sourceCursorCount: Object.keys(sourceCursors).length,
        scannedFiles,
        skippedFiles,
      },
    };
  };
}


function normalizeFileSearchOptions(
  options: CodexProviderFileSearchExecutorOptions,
): NormalizedFileSearchOptions {
  const sources = normalizeFileSearchSources(options);
  if (sources.length === 0) {
    throw new Error('file_search executor requires at least one source or explicit root.');
  }
  return {
    sources,
    maxResults: clampInteger(options.maxResults, 1, 50, 8),
    maxBytesPerFile: clampInteger(options.maxBytesPerFile, 1_024, 2 * 1024 * 1024, 256 * 1024),
    maxPayloadBytes: clampInteger(options.maxPayloadBytes, 1_024, 2 * 1024 * 1024, 128 * 1024),
    snippetLines: clampInteger(options.snippetLines, 1, 8, 2),
    includeContent: typeof options.includeContent === 'boolean' ? options.includeContent : null,
    pageTokenSecret: normalizeString(options.pageTokenSecret) || randomBytes(32).toString('base64url'),
  };
}

function normalizeFileSearchSources(
  options: CodexProviderFileSearchExecutorOptions,
): CodexProviderFileSearchSource[] {
  const sources: CodexProviderFileSearchSource[] = [];
  if (Array.isArray(options.sources)) {
    for (const source of options.sources) {
      sources.push(normalizeFileSearchSource(source));
    }
  }
  if (Array.isArray(options.roots) && options.roots.length > 0) {
    sources.push(createCodexProviderLocalFileSearchSource({
      roots: options.roots,
      maxFilesScanned: options.maxFilesScanned,
      maxBytesPerFile: options.maxBytesPerFile,
      snippetLines: options.snippetLines,
      includeContent: options.includeContent,
      followSymlinks: options.followSymlinks,
      ignoreDirectories: options.ignoreDirectories,
      ignoreExtensions: options.ignoreExtensions,
    }));
  }
  return sources;
}

function normalizeFileSearchSource(
  source: CodexProviderFileSearchSourceInput,
): CodexProviderFileSearchSource {
  if (source && typeof (source as CodexProviderFileSearchSource).search === 'function') {
    const adapter = source as CodexProviderFileSearchSource;
    const name = normalizeString(adapter.name);
    if (!name) {
      throw new Error('file_search source adapters require a non-empty name.');
    }
    return {
      ...adapter,
      name,
      type: normalizeString(adapter.type) || 'custom',
    };
  }
  if (
    source
    && Array.isArray((source as CodexProviderLocalVectorFileSearchSourceOptions).roots)
    && (source as CodexProviderLocalVectorFileSearchSourceOptions).embeddingProvider
  ) {
    return createCodexProviderLocalVectorFileSearchSource(source as CodexProviderLocalVectorFileSearchSourceOptions);
  }
  if (source && Array.isArray((source as CodexProviderLocalFileSearchSourceOptions).roots)) {
    return createCodexProviderLocalFileSearchSource(source as CodexProviderLocalFileSearchSourceOptions);
  }
  if (
    source
    && Array.isArray((source as CodexProviderInMemoryVectorFileSearchSourceOptions).documents)
    && (source as CodexProviderInMemoryVectorFileSearchSourceOptions).embeddingProvider
  ) {
    return createCodexProviderInMemoryVectorFileSearchSource(source as CodexProviderInMemoryVectorFileSearchSourceOptions);
  }
  if (
    source
    && normalizeString((source as CodexProviderVectorStoreFileSearchSourceOptions).type) === 'vector-store'
  ) {
    return createCodexProviderVectorStoreFileSearchSource(source as CodexProviderVectorStoreFileSearchSourceOptions);
  }
  if (
    source
    && normalizeString((source as CodexProviderRemoteDocumentsFileSearchSourceOptions).type) === 'remote-documents'
  ) {
    return createCodexProviderRemoteDocumentsFileSearchSource(source as CodexProviderRemoteDocumentsFileSearchSourceOptions);
  }
  if (source && Array.isArray((source as CodexProviderMemoryFileSearchSourceOptions).documents)) {
    return createCodexProviderMemoryFileSearchSource(source as CodexProviderMemoryFileSearchSourceOptions);
  }
  if (source && normalizeString((source as CodexProviderSqliteFtsFileSearchSourceOptions).table)) {
    return createCodexProviderSqliteFtsFileSearchSource(source as CodexProviderSqliteFtsFileSearchSourceOptions);
  }
  throw new Error('file_search sources must be source adapters, local-fs source options, local-vector source options, memory-documents source options, sqlite-fts source options, in-memory-vector source options, vector-store source options, or remote-documents source options.');
}


function fileSearchQueryFromRequest(request: CodexProviderHostedToolExecutionRequest): string {
  return firstNonEmptyString([
    request.arguments.query,
    request.arguments.q,
    request.arguments.search_query,
    request.arguments.input,
    request.rawArguments,
  ]);
}

function fileSearchMaxResultsFromRequest(
  request: CodexProviderHostedToolExecutionRequest,
  fallback: number,
): number {
  return clampInteger(
    request.arguments.max_num_results ?? request.arguments.max_results,
    1,
    50,
    fallback,
  );
}

function fileSearchPageTokenFromRequest(
  request: CodexProviderHostedToolExecutionRequest,
): string | null {
  const token = normalizeString(
    request.arguments.page_token
    ?? request.arguments.page
    ?? request.arguments.after
    ?? request.arguments.next_page,
  );
  if (!token) {
    return null;
  }
  if (token.length > 2_048) {
    throw new Error('file_search page token is too long.');
  }
  return token;
}

function sourceMaxResultsForPage(pageOffset: number, maxResults: number): number {
  return Math.min(pageOffset + maxResults + 1, 10_000);
}

const FILE_SEARCH_PAGE_TOKEN_PREFIX = 'fsp_v2.';

interface FileSearchPageState {
  offset: number;
  sourceCursors: Record<string, string>;
}

function decodeFileSearchPageState(
  token: string | null,
  fingerprint: string,
  pageTokenSecret: string,
): FileSearchPageState {
  if (!token) {
    return {
      offset: 0,
      sourceCursors: {},
    };
  }
  if (!token.startsWith(FILE_SEARCH_PAGE_TOKEN_PREFIX)) {
    throw new Error('file_search page token is invalid.');
  }
  const tokenBody = token.slice(FILE_SEARCH_PAGE_TOKEN_PREFIX.length);
  const [encodedPayload, signature, extra] = tokenBody.split('.');
  if (!encodedPayload || !signature || extra !== undefined) {
    throw new Error('file_search page token is invalid.');
  }
  const expectedSignature = signFileSearchPageTokenPayload(encodedPayload, pageTokenSecret);
  if (!fileSearchPageTokenSignatureMatches(signature, expectedSignature)) {
    throw new Error('file_search page token is invalid.');
  }
  let parsed: JsonRecord;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as JsonRecord;
  } catch {
    throw new Error('file_search page token is invalid.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('file_search page token is invalid.');
  }
  if (parsed.v !== 2 || parsed.fingerprint !== fingerprint) {
    throw new Error('file_search page token does not match the current request.');
  }
  const offset = Number(parsed.offset);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
    throw new Error('file_search page token is invalid.');
  }
  return {
    offset,
    sourceCursors: normalizeFileSearchSourceCursors(parsed.sourceCursors),
  };
}

function encodeFileSearchPageToken(
  offset: number,
  fingerprint: string,
  pageTokenSecret: string,
  sourceCursors: Record<string, string> = {},
): string {
  const normalizedSourceCursors = normalizeFileSearchSourceCursors(sourceCursors);
  const encodedPayload = Buffer.from(JSON.stringify({
    v: 2,
    offset,
    fingerprint,
    ...(Object.keys(normalizedSourceCursors).length > 0 ? { sourceCursors: normalizedSourceCursors } : {}),
  }), 'utf8').toString('base64url');
  const signature = signFileSearchPageTokenPayload(encodedPayload, pageTokenSecret);
  return `${FILE_SEARCH_PAGE_TOKEN_PREFIX}${encodedPayload}.${signature}`;
}

function normalizeFileSearchSourceCursors(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const cursors: Record<string, string> = {};
  for (const [sourceName, cursor] of Object.entries(value as JsonRecord)) {
    const normalizedSourceName = normalizeString(sourceName);
    const normalizedCursor = normalizeString(cursor);
    if (!normalizedSourceName || !normalizedCursor || normalizedCursor.length > 1_024) {
      continue;
    }
    cursors[normalizedSourceName] = normalizedCursor;
  }
  return cursors;
}

function signFileSearchPageTokenPayload(encodedPayload: string, pageTokenSecret: string): string {
  return createHmac('sha256', pageTokenSecret)
    .update(encodedPayload)
    .digest('base64url');
}

function fileSearchPageTokenSignatureMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function createFileSearchPageFingerprint(input: JsonRecord): string {
  return createHash('sha256')
    .update(stableJsonStringify(input))
    .digest('base64url');
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as JsonRecord;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function selectFileSearchSources(
  sources: CodexProviderFileSearchSource[],
  vectorStoreIds: string[],
): CodexProviderFileSearchSource[] {
  if (vectorStoreIds.length === 0) {
    return sources;
  }
  const allowed = new Set(vectorStoreIds.map((entry) => entry.toLowerCase()));
  return sources.filter((source) => allowed.has(source.name.toLowerCase()));
}

function normalizeFileSearchRankingOptions(value: unknown): CodexProviderFileSearchRankingOptions {
  const record = value && typeof value === 'object' ? value as JsonRecord : {};
  const hybridSearch = record.hybrid_search && typeof record.hybrid_search === 'object'
    ? record.hybrid_search as JsonRecord
    : null;
  return {
    ranker: normalizeString(record.ranker) || 'auto',
    scoreThreshold: clampNumber(record.score_threshold, 0, 1, 0),
    hybridSearch: hybridSearch
      ? {
        embeddingWeight: clampNumber(
          hybridSearch.embedding_weight ?? hybridSearch.rrf_embedding_weight,
          0,
          1,
          0.5,
        ),
        textWeight: clampNumber(
          hybridSearch.text_weight ?? hybridSearch.rrf_text_weight,
          0,
          1,
          0.5,
        ),
      }
      : null,
  };
}

function normalizeFileSearchFilter(value: unknown): CodexProviderFileSearchFilter | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as JsonRecord;
  const type = normalizeString(record.type).toLowerCase();
  if ((type === 'and' || type === 'or') && Array.isArray(record.filters)) {
    const filters = record.filters.map(normalizeFileSearchFilter).filter(Boolean) as CodexProviderFileSearchFilter[];
    return filters.length > 0 ? { type, filters } : null;
  }
  if (['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin'].includes(type)) {
    const key = normalizeString(record.key ?? record.property);
    if (!key) {
      return null;
    }
    return {
      type: type as 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin',
      key: normalizeString(record.key) || null,
      property: normalizeString(record.property) || null,
      value: record.value,
    };
  }
  return null;
}

function fileSearchResultMatchesFilter(
  result: CodexProviderFileSearchSourceMatch,
  filter: CodexProviderFileSearchFilter | null,
): boolean {
  if (!filter) {
    return true;
  }
  if (filter.type === 'and') {
    return filter.filters.every((entry) => fileSearchResultMatchesFilter(result, entry));
  }
  if (filter.type === 'or') {
    return filter.filters.some((entry) => fileSearchResultMatchesFilter(result, entry));
  }
  const comparisonFilter = filter as Extract<CodexProviderFileSearchFilter, { value: unknown }>;
  const key = normalizeString(comparisonFilter.key ?? comparisonFilter.property);
  const actual = fileSearchResultAttributeValue(result, key);
  if (actual === undefined) {
    return comparisonFilter.type === 'ne' || comparisonFilter.type === 'nin';
  }
  switch (comparisonFilter.type) {
    case 'eq':
      return filterValueMatches(actual, comparisonFilter.value);
    case 'ne':
      return !filterValueMatches(actual, comparisonFilter.value);
    case 'gt':
      return compareFilterValues(actual, comparisonFilter.value) > 0;
    case 'gte':
      return compareFilterValues(actual, comparisonFilter.value) >= 0;
    case 'lt':
      return compareFilterValues(actual, comparisonFilter.value) < 0;
    case 'lte':
      return compareFilterValues(actual, comparisonFilter.value) <= 0;
    case 'in':
      return Array.isArray(comparisonFilter.value)
        ? comparisonFilter.value.some((value) => filterValueMatches(actual, value))
        : false;
    case 'nin':
      return Array.isArray(comparisonFilter.value)
        ? !comparisonFilter.value.some((value) => filterValueMatches(actual, value))
        : true;
    default:
      return true;
  }
}

function filterValueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    return actual.some((entry) => filterValueMatches(entry, expected));
  }
  if (Array.isArray(expected)) {
    return expected.some((entry) => filterValueMatches(actual, entry));
  }
  return compareFilterValues(actual, expected) === 0;
}

function fileSearchResultAttributeValue(result: CodexProviderFileSearchSourceMatch, key: string): unknown {
  const attributes = result.attributes && typeof result.attributes === 'object'
    ? result.attributes
    : {};
  switch (key) {
    case 'file_id':
      return result.file_id;
    case 'filename':
      return result.filename;
    case 'path':
      return result.path;
    case 'source':
      return result.source;
    case 'source_type':
    case 'sourceType':
      return result.sourceType;
    default:
      return attributes[key];
  }
}

function compareFilterValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' || typeof right === 'number') {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
      return String(left ?? '').localeCompare(String(right ?? ''));
    }
    return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
  }
  const leftString = String(left ?? '');
  const rightString = String(right ?? '');
  return leftString === rightString ? 0 : leftString.localeCompare(rightString);
}

function applyFileSearchRankingOptions(
  results: CodexProviderFileSearchSourceMatch[],
  rankingOptions: CodexProviderFileSearchRankingOptions,
): CodexProviderFileSearchSourceMatch[] {
  if (rankingOptions.scoreThreshold <= 0 || results.length === 0) {
    return results;
  }
  const maxScore = Math.max(...results.map((result) => result.score), 0);
  if (maxScore <= 0) {
    return [];
  }
  return results.filter((result) => result.score / maxScore >= rankingOptions.scoreThreshold);
}

function toOpenAIFileSearchResult(
  result: CodexProviderFileSearchSourceMatch,
  rankedResults: CodexProviderFileSearchSourceMatch[],
): CodexProviderFileSearchResult {
  return {
    file_id: normalizeString(result.file_id) || stableFileSearchFileId(result.source ?? 'file_search', result.path),
    filename: normalizeString(result.filename) || path.basename(result.path) || result.title,
    score: normalizeOpenAIFileSearchScore(result, rankedResults),
    attributes: normalizeFileSearchAttributes(result.attributes),
    content: Array.isArray(result.content)
      ? result.content.map(normalizeFileSearchChunk).filter(Boolean) as CodexProviderFileSearchChunk[]
      : [],
  };
}

function normalizeOpenAIFileSearchScore(
  result: CodexProviderFileSearchSourceMatch,
  rankedResults: CodexProviderFileSearchSourceMatch[],
): number {
  const maxScore = Math.max(...rankedResults.map((entry) => entry.score), 0);
  if (maxScore <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, Number((result.score / maxScore).toFixed(6))));
}

function normalizeFileSearchChunk(value: CodexProviderFileSearchChunk): CodexProviderFileSearchChunk | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const text = normalizeString(value.text);
  if (!text) {
    return null;
  }
  return {
    type: 'text',
    text,
    line: value.line ?? null,
    start_line: value.start_line ?? value.line ?? null,
    end_line: value.end_line ?? value.line ?? null,
  };
}


function normalizeSourceType(source: CodexProviderFileSearchSource): string {
  return normalizeString(source.type) || 'custom';
}

function normalizeFileSearchResult(
  result: CodexProviderFileSearchSourceMatch,
  source: CodexProviderFileSearchSource,
  sourceType: string,
): CodexProviderFileSearchSourceMatch {
  const normalizedPath = normalizeString(result.path) || normalizeString(result.title);
  const normalizedTitle = normalizeString(result.title) || normalizedPath || source.name;
  const filename = normalizeString(result.filename) || path.basename(normalizedPath) || normalizedTitle;
  const sourceName = normalizeString(result.source) || source.name;
  const normalizedSourceType = normalizeString(result.sourceType) || sourceType;
  const content = Array.isArray(result.content)
    ? result.content.map(normalizeFileSearchChunk).filter(Boolean) as CodexProviderFileSearchChunk[]
    : [];
  const attributes = normalizeFileSearchAttributes({
    ...(result.attributes && typeof result.attributes === 'object' ? result.attributes : {}),
    filename,
    path: normalizedPath,
    source: sourceName,
    source_type: normalizedSourceType,
    ...(result.root ? { root: result.root } : {}),
  });
  return {
    file_id: normalizeString(result.file_id) || stableFileSearchFileId(sourceName, normalizedPath || normalizedTitle),
    filename,
    title: normalizedTitle,
    uri: normalizeString(result.uri),
    path: normalizedPath,
    root: result.root ?? null,
    source: sourceName,
    sourceType: normalizedSourceType,
    score: Number.isFinite(Number(result.score)) ? Number(result.score) : 0,
    attributes,
    content,
  };
}

function limitResultsByPayload(
  results: CodexProviderFileSearchSourceMatch[],
  maxResults: number,
  maxPayloadBytes: number,
): CodexProviderFileSearchSourceMatch[] {
  const limited: CodexProviderFileSearchSourceMatch[] = [];
  let payloadBytes = 0;
  for (const result of results) {
    if (limited.length >= maxResults) {
      break;
    }
    const resultBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
    if (limited.length > 0 && payloadBytes + resultBytes > maxPayloadBytes) {
      break;
    }
    limited.push(result);
    payloadBytes += resultBytes;
  }
  return limited;
}
