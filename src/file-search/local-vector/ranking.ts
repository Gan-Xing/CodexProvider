import type {
  CodexProviderLocalVectorIndexChunk,
} from '../types.js';

const LOCAL_VECTOR_RRF_K = 60;

export type LocalVectorScoredChunk = {
  chunk: CodexProviderLocalVectorIndexChunk;
  score: number;
  vectorScore: number;
  lexicalScore: number;
};

export function isRrfRanker(ranker: string): boolean {
  return ranker.toLowerCase() === 'rrf';
}

export function applyRrfScores(
  scoredChunks: LocalVectorScoredChunk[],
  vectorWeight: number,
  textWeight: number,
): void {
  const denseRanks = rankScoredChunks(
    scoredChunks.filter((entry) => entry.vectorScore > 0),
    (left, right) => right.vectorScore - left.vectorScore || compareChunkPath(left, right),
  );
  const lexicalRanks = rankScoredChunks(
    scoredChunks.filter((entry) => entry.lexicalScore > 0),
    (left, right) => right.lexicalScore - left.lexicalScore || compareChunkPath(left, right),
  );
  for (const entry of scoredChunks) {
    const denseRank = denseRanks.get(entry);
    const lexicalRank = lexicalRanks.get(entry);
    const denseScore = denseRank ? vectorWeight * (1 / (LOCAL_VECTOR_RRF_K + denseRank)) : 0;
    const lexicalScore = lexicalRank ? textWeight * (1 / (LOCAL_VECTOR_RRF_K + lexicalRank)) : 0;
    entry.score = (denseScore + lexicalScore) * 100;
  }
}

function rankScoredChunks(
  entries: LocalVectorScoredChunk[],
  compare: (left: LocalVectorScoredChunk, right: LocalVectorScoredChunk) => number,
): Map<LocalVectorScoredChunk, number> {
  const ranks = new Map<LocalVectorScoredChunk, number>();
  [...entries]
    .sort(compare)
    .forEach((entry, index) => {
      ranks.set(entry, index + 1);
    });
  return ranks;
}

function compareChunkPath(left: LocalVectorScoredChunk, right: LocalVectorScoredChunk): number {
  return (
    left.chunk.path.localeCompare(right.chunk.path)
    || left.chunk.chunkIndex - right.chunk.chunkIndex
  );
}
