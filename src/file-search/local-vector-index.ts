import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  CandidateFile,
  CodexProviderFileSearchSourceMatch,
  CodexProviderFileSearchSourceRequest,
  CodexProviderFileSearchSourceResult,
  CodexProviderLocalVectorIndexChunk,
  CodexProviderLocalVectorIndexDocument,
  CodexProviderLocalVectorIndexSearchChunksRequest,
  NormalizedLocalVectorFileSearchOptions,
} from './types.js';
import {
  cosineSimilarity,
  lexicalScoreForText,
  looksBinary,
  normalizeEmbeddingVector,
  normalizeFileSearchAttributes,
  pathMatchesGlob,
  stableContentHash,
  stableFileSearchFileId,
} from './shared.js';
import { collectCandidateFiles } from './sources/local-shared.js';
import {
  chunkLocalVectorText,
} from './local-vector/chunking.js';
import {
  createLocalVectorDocumentFingerprint,
  localVectorDocumentId,
  localVectorDocumentMatchesFingerprint,
} from './local-vector/documents.js';
import {
  embedSingleText,
  embedTextsInBatches,
} from './local-vector/embedding.js';
import {
  applyRrfScores,
  isRrfRanker,
  type LocalVectorScoredChunk,
} from './local-vector/ranking.js';

export function createCodexProviderLocalVectorIndex(
  options: NormalizedLocalVectorFileSearchOptions,
): CodexProviderLocalVectorIndex {
  return new CodexProviderLocalVectorIndex(options);
}

class CodexProviderLocalVectorIndex {
  constructor(private readonly options: NormalizedLocalVectorFileSearchOptions) {}

  async search(request: CodexProviderFileSearchSourceRequest): Promise<CodexProviderFileSearchSourceResult> {
    const maxResults = request.maxResults;
    const includeContent = typeof request.includeContent === 'boolean'
      ? request.includeContent
      : this.options.local.includeContent;
    const maxBytesPerFile = Math.min(request.maxBytesPerFile, this.options.local.maxBytesPerFile);

    await request.emitDelta?.('indexing local vector files', {
      source: this.options.name,
      roots: this.options.local.roots.map((root) => root.path),
      embeddingModel: this.options.embeddingProvider.model,
    });

    const candidates = await collectCandidateFiles(this.options.local, request.pathGlob);
    const staleDocumentIds = request.pathGlob
      ? []
      : await this.deleteStaleDocuments(candidates);
    if (staleDocumentIds.length > 0) {
      await request.emitDelta?.('local vector stale documents removed', {
        source: this.options.name,
        count: staleDocumentIds.length,
      });
    }

    let scannedFiles = 0;
    let skippedFiles = 0;
    let indexedFiles = 0;
    let cachedFiles = 0;
    const queryEmbedding = await embedSingleText(
      this.options.embeddingProvider,
      request.query,
      'local-vector query embedding',
    );
    const embeddingDimensions = queryEmbedding.length;
    if (embeddingDimensions === 0) {
      return {
        results: [],
        scannedFiles,
        skippedFiles,
        metadata: {
          provider: 'local-vector',
          source: this.options.name,
          indexedFiles,
          cachedFiles,
        },
      };
    }
    for (const candidate of candidates) {
      if (scannedFiles >= this.options.local.maxFilesScanned) {
        break;
      }
      scannedFiles += 1;
      const indexResult = await this.indexCandidate({
        candidate,
        maxBytesPerFile,
        embeddingDimensions,
      });
      if (indexResult.status === 'skipped') {
        skippedFiles += 1;
      } else if (indexResult.status === 'cached') {
        cachedFiles += 1;
        await request.emitDelta?.('local vector file cache hit', {
          source: this.options.name,
          path: candidate.relativePath,
        });
      } else {
        indexedFiles += 1;
        await request.emitDelta?.('local vector file indexed', {
          source: this.options.name,
          path: candidate.relativePath,
          chunkCount: indexResult.chunkCount,
        });
      }
    }

    await request.emitDelta?.('querying local vector index', {
      source: this.options.name,
      embeddingModel: this.options.embeddingProvider.model,
      indexedFiles,
      cachedFiles,
      maxResults,
    });

    const textWeight = request.rankingOptions.hybridSearch?.textWeight ?? this.options.textWeight;
    const vectorWeight = request.rankingOptions.hybridSearch?.embeddingWeight ?? this.options.vectorWeight;
    const chunks = await this.searchChunks({
      sourceName: this.options.name,
      query: request.query,
      terms: request.terms,
      pathGlob: request.pathGlob,
      queryEmbedding,
      maxResults,
      rankingOptions: request.rankingOptions,
    });
    const scoredChunks: LocalVectorScoredChunk[] = [];
    for (const chunk of chunks) {
      if (request.pathGlob && !pathMatchesGlob(chunk.path, request.pathGlob)) {
        continue;
      }
      if (chunk.embedding.length !== queryEmbedding.length) {
        continue;
      }
      const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
      const lexicalScore = lexicalScoreForText({
        title: chunk.title,
        path: chunk.path,
        content: chunk.text,
        terms: request.terms,
      });
      if (vectorScore <= 0 && lexicalScore <= 0) {
        continue;
      }
      const normalizedLexicalScore = Math.min(1, lexicalScore / 40);
      scoredChunks.push({
        chunk,
        score: 0,
        vectorScore,
        lexicalScore: normalizedLexicalScore,
      });
    }

    if (isRrfRanker(request.rankingOptions.ranker)) {
      applyRrfScores(scoredChunks, vectorWeight, textWeight);
    } else {
      for (const entry of scoredChunks) {
        entry.score = (entry.vectorScore * vectorWeight * 100) + (entry.lexicalScore * textWeight * 100);
      }
    }

    const groupedResults = new Map<string, {
      chunkScores: LocalVectorScoredChunk[];
      maxVectorScore: number;
      maxLexicalScore: number;
      score: number;
    }>();
    for (const scoredChunk of scoredChunks) {
      if (scoredChunk.score <= 0) {
        continue;
      }
      const chunk = scoredChunk.chunk;
      const entry = groupedResults.get(chunk.documentId) ?? {
        chunkScores: [],
        maxVectorScore: 0,
        maxLexicalScore: 0,
        score: 0,
      };
      entry.chunkScores.push(scoredChunk);
      entry.score = Math.max(entry.score, scoredChunk.score);
      entry.maxVectorScore = Math.max(entry.maxVectorScore, scoredChunk.vectorScore);
      entry.maxLexicalScore = Math.max(entry.maxLexicalScore, scoredChunk.lexicalScore);
      groupedResults.set(chunk.documentId, entry);
    }

    const results: CodexProviderFileSearchSourceMatch[] = [];
    for (const entry of groupedResults.values()) {
      entry.chunkScores.sort((left, right) => right.score - left.score || left.chunk.chunkIndex - right.chunk.chunkIndex);
      const bestChunk = entry.chunkScores[0]?.chunk;
      if (!bestChunk || entry.score <= 0) {
        continue;
      }
      const content = includeContent
        ? entry.chunkScores.slice(0, 4).map(({ chunk }) => ({
          type: 'text' as const,
          text: chunk.text.slice(0, 1_500),
          line: chunk.startLine,
          start_line: chunk.startLine,
          end_line: chunk.endLine,
        }))
        : [];
      results.push({
        file_id: stableFileSearchFileId(this.options.name, bestChunk.path),
        filename: bestChunk.filename,
        title: bestChunk.title,
        uri: bestChunk.uri,
        path: bestChunk.path,
        root: bestChunk.root,
        source: this.options.name,
        sourceType: 'local-vector',
        score: entry.score,
        attributes: normalizeFileSearchAttributes({
          ...(bestChunk.metadata && typeof bestChunk.metadata === 'object' ? bestChunk.metadata : {}),
          filename: bestChunk.filename,
          path: bestChunk.path,
          root: bestChunk.root,
          source: this.options.name,
          source_type: 'local-vector',
          embedding_model: this.options.embeddingProvider.model,
          vector_score: Number(entry.maxVectorScore.toFixed(6)),
          lexical_score: Number(entry.maxLexicalScore.toFixed(6)),
          chunk_count: entry.chunkScores.length,
        }),
        content,
      });
      await request.emitDelta?.('local vector chunk matched', {
        source: this.options.name,
        path: bestChunk.path,
        score: entry.score,
        resultCount: results.length,
      });
    }

    results.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
    return {
      results: results.slice(0, maxResults),
      scannedFiles,
      skippedFiles,
      metadata: {
        provider: 'local-vector',
        source: this.options.name,
        embeddingModel: this.options.embeddingProvider.model,
        indexedFiles,
        cachedFiles,
        chunkCount: chunks.length,
      },
    };
  }

  private async indexCandidate({
    candidate,
    maxBytesPerFile,
    embeddingDimensions,
  }: {
    candidate: CandidateFile;
    maxBytesPerFile: number;
    embeddingDimensions: number;
  }): Promise<{ status: 'cached' | 'indexed' | 'skipped'; chunkCount: number }> {
    const stat = await fs.stat(candidate.absolutePath).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > maxBytesPerFile) {
      return { status: 'skipped', chunkCount: 0 };
    }
    const documentId = localVectorDocumentId(this.options.name, candidate);
    const existingDocument = await this.options.indexStore.getDocument(documentId);
    const content = await fs.readFile(candidate.absolutePath, 'utf8').catch(() => null);
    if (!content || looksBinary(content)) {
      return { status: 'skipped', chunkCount: 0 };
    }
    const contentHash = stableContentHash(content);
    const fingerprint = createLocalVectorDocumentFingerprint({
      options: this.options,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      contentHash,
      embeddingDimensions,
    });
    if (
      existingDocument
      && localVectorDocumentMatchesFingerprint(existingDocument, fingerprint)
    ) {
      return { status: 'cached', chunkCount: 0 };
    }
    const textChunks = chunkLocalVectorText(content, this.options.chunking);
    if (textChunks.length === 0) {
      return { status: 'skipped', chunkCount: 0 };
    }
    const embeddings = await embedTextsInBatches(
      this.options.embeddingProvider,
      textChunks.map((chunk) => [
        candidate.relativePath,
        chunk.text,
      ].join('\n\n')),
      this.options.embeddingBatchSize,
      embeddingDimensions,
    );
    const filename = path.basename(candidate.relativePath) || candidate.relativePath;
    const document: CodexProviderLocalVectorIndexDocument = {
      id: documentId,
      sourceName: this.options.name,
      root: candidate.root.path,
      path: candidate.relativePath,
      uri: pathToFileURL(candidate.absolutePath).toString(),
      title: candidate.relativePath,
      filename,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      contentHash,
      embeddingModel: this.options.embeddingProvider.model,
      indexVersion: fingerprint.indexVersion,
      chunkerVersion: fingerprint.chunkerVersion,
      chunkingConfigHash: fingerprint.chunkingConfigHash,
      embeddingDimensions: fingerprint.embeddingDimensions,
      contentHashAlgorithm: fingerprint.contentHashAlgorithm,
      statFingerprint: fingerprint.statFingerprint,
      updatedAt: new Date().toISOString(),
    };
    const chunks: CodexProviderLocalVectorIndexChunk[] = [];
    for (let index = 0; index < textChunks.length; index += 1) {
      const embedding = normalizeEmbeddingVector(embeddings[index]);
      if (embedding.length === 0) {
        continue;
      }
      const textChunk = textChunks[index];
      chunks.push({
        id: stableFileSearchFileId(this.options.name, `${documentId}:${textChunk.chunkIndex}`),
        documentId,
        sourceName: this.options.name,
        root: candidate.root.path,
        path: candidate.relativePath,
        uri: document.uri,
        title: document.title,
        filename,
        text: textChunk.text,
        chunkIndex: textChunk.chunkIndex,
        startLine: textChunk.startLine,
        endLine: textChunk.endLine,
        embedding,
        metadata: {
          root: candidate.root.path,
          path: candidate.relativePath,
          filename,
          content_hash: contentHash,
          embedding_model: this.options.embeddingProvider.model,
          index_version: fingerprint.indexVersion,
          chunker_version: fingerprint.chunkerVersion,
          chunking_config_hash: fingerprint.chunkingConfigHash,
          embedding_dimensions: fingerprint.embeddingDimensions,
          content_hash_algorithm: fingerprint.contentHashAlgorithm,
          stat_fingerprint: fingerprint.statFingerprint,
        },
      });
    }
    if (chunks.length === 0) {
      return { status: 'skipped', chunkCount: 0 };
    }
    await this.options.indexStore.upsertDocument(document, chunks);
    return { status: 'indexed', chunkCount: chunks.length };
  }

  private async deleteStaleDocuments(candidates: CandidateFile[]): Promise<string[]> {
    const candidateIds = new Set(candidates.map((candidate) => localVectorDocumentId(this.options.name, candidate)));
    if (this.options.indexStore.deleteStaleDocuments) {
      return this.options.indexStore.deleteStaleDocuments(this.options.name, [...candidateIds]);
    }
    if (!this.options.indexStore.deleteDocuments) {
      return [];
    }
    const documentIds = this.options.indexStore.listDocuments
      ? (await this.options.indexStore.listDocuments(this.options.name)).map((document) => document.id)
      : [...new Set((await this.options.indexStore.listChunks(this.options.name)).map((chunk) => chunk.documentId))];
    const staleIds = [...new Set(documentIds)]
      .filter((documentId) => !candidateIds.has(documentId));
    if (staleIds.length > 0) {
      await this.options.indexStore.deleteDocuments(staleIds);
    }
    return staleIds;
  }

  private async searchChunks(
    request: CodexProviderLocalVectorIndexSearchChunksRequest,
  ): Promise<CodexProviderLocalVectorIndexChunk[]> {
    if (this.options.indexStore.searchChunks) {
      return this.options.indexStore.searchChunks(request);
    }
    return this.options.indexStore.listChunks(request.sourceName);
  }
}
