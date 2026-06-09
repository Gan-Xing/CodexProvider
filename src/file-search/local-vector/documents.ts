import type {
  CandidateFile,
  CodexProviderLocalVectorIndexDocument,
  NormalizedLocalVectorFileSearchOptions,
} from '../types.js';
import {
  stableFileSearchFileId,
} from '../shared.js';
import {
  LOCAL_VECTOR_CHUNKER_VERSION,
  LOCAL_VECTOR_INDEX_VERSION,
} from './constants.js';
import {
  localVectorChunkingConfigHash,
} from './chunking.js';

export type LocalVectorDocumentFingerprint = Required<Pick<
  CodexProviderLocalVectorIndexDocument,
  | 'size'
  | 'mtimeMs'
  | 'contentHash'
  | 'embeddingModel'
  | 'indexVersion'
  | 'chunkerVersion'
  | 'chunkingConfigHash'
  | 'embeddingDimensions'
  | 'contentHashAlgorithm'
  | 'statFingerprint'
>>;

export function localVectorDocumentId(sourceName: string, candidate: CandidateFile): string {
  return stableFileSearchFileId(sourceName, `${candidate.root.path}:${candidate.relativePath}`);
}

export function createLocalVectorDocumentFingerprint({
  options,
  size,
  mtimeMs,
  contentHash,
  embeddingDimensions,
}: {
  options: NormalizedLocalVectorFileSearchOptions;
  size: number;
  mtimeMs: number;
  contentHash: string;
  embeddingDimensions: number;
}): LocalVectorDocumentFingerprint {
  return {
    size,
    mtimeMs,
    contentHash,
    embeddingModel: options.embeddingProvider.model,
    indexVersion: LOCAL_VECTOR_INDEX_VERSION,
    chunkerVersion: LOCAL_VECTOR_CHUNKER_VERSION,
    chunkingConfigHash: localVectorChunkingConfigHash(options.chunking),
    embeddingDimensions,
    contentHashAlgorithm: contentHash.split(':')[0] || 'unknown',
    statFingerprint: `${size}:${mtimeMs}`,
  };
}

export function localVectorDocumentMatchesFingerprint(
  document: CodexProviderLocalVectorIndexDocument,
  fingerprint: LocalVectorDocumentFingerprint,
): boolean {
  return (
    document.size === fingerprint.size
    && document.mtimeMs === fingerprint.mtimeMs
    && document.contentHash === fingerprint.contentHash
    && document.embeddingModel === fingerprint.embeddingModel
    && document.indexVersion === fingerprint.indexVersion
    && document.chunkerVersion === fingerprint.chunkerVersion
    && document.chunkingConfigHash === fingerprint.chunkingConfigHash
    && document.embeddingDimensions === fingerprint.embeddingDimensions
    && document.contentHashAlgorithm === fingerprint.contentHashAlgorithm
    && document.statFingerprint === fingerprint.statFingerprint
  );
}
