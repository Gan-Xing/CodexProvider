import type {
  CodexProviderFileSearchSource,
  CodexProviderFileSearchSourceRequest,
  CodexProviderFileSearchSourceResult,
  CodexProviderLocalVectorFileSearchSourceOptions,
  NormalizedLocalVectorFileSearchOptions,
} from '../types.js';
import { createCodexProviderMemoryLocalVectorIndexStore } from '../stores.js';
import {
  clampInteger,
  clampNumber,
  normalizeString,
} from '../shared.js';
import { createCodexProviderLocalVectorIndex } from '../local-vector-index.js';
import {
  assertExplicitLocalFileSearchRoots,
  normalizeLocalFileSearchOptions,
} from './local-shared.js';

export function createCodexProviderLocalVectorFileSearchSource(
  options: CodexProviderLocalVectorFileSearchSourceOptions,
): CodexProviderFileSearchSource {
  assertExplicitLocalFileSearchRoots(options.roots);
  const normalizedOptionsPromise = normalizeLocalVectorFileSearchOptions(options);
  const indexPromise = normalizedOptionsPromise.then(createCodexProviderLocalVectorIndex);
  const sourceName = normalizeString(options.name) || 'local-vector';
  return {
    name: sourceName,
    type: 'local-vector',
    async search(request: CodexProviderFileSearchSourceRequest): Promise<CodexProviderFileSearchSourceResult> {
      const index = await indexPromise;
      return index.search(request);
    },
  };
}

async function normalizeLocalVectorFileSearchOptions(
  options: CodexProviderLocalVectorFileSearchSourceOptions,
): Promise<NormalizedLocalVectorFileSearchOptions> {
  const embeddingProvider = options.embeddingProvider;
  if (!embeddingProvider || typeof embeddingProvider.embed !== 'function') {
    throw new Error('local-vector file_search source requires an embedding provider.');
  }
  const {
    type: _type,
    embeddingProvider: _embeddingProvider,
    indexStore: _indexStore,
    chunking: _chunking,
    vectorWeight: _vectorWeight,
    textWeight: _textWeight,
    embeddingBatchSize: _embeddingBatchSize,
    ...localOptions
  } = options;
  const local = await normalizeLocalFileSearchOptions({
    ...localOptions,
    name: normalizeString(options.name) || 'local-vector',
  });
  const chunking = options.chunking && typeof options.chunking === 'object'
    ? options.chunking
    : {};
  return {
    local: {
      ...local,
      name: normalizeString(options.name) || 'local-vector',
    },
    name: normalizeString(options.name) || 'local-vector',
    type: 'local-vector',
    embeddingProvider,
    indexStore: options.indexStore ?? createCodexProviderMemoryLocalVectorIndexStore(),
    chunking: {
      maxChars: clampInteger(chunking.maxChars, 400, 12_000, 1_600),
      overlapChars: clampInteger(chunking.overlapChars, 0, 2_000, 200),
      maxChunksPerFile: clampInteger(chunking.maxChunksPerFile, 1, 2_000, 200),
    },
    vectorWeight: clampNumber(options.vectorWeight, 0, 1, 0.7),
    textWeight: clampNumber(options.textWeight, 0, 1, 0.3),
    embeddingBatchSize: clampInteger(options.embeddingBatchSize, 1, 256, 32),
  };
}
