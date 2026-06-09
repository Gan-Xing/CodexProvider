import type {
  CodexProviderEmbeddingProvider,
  CodexProviderEmbeddingProviderResult,
} from '../types.js';
import {
  normalizeEmbeddingVector,
} from '../shared.js';

export async function embedTextsInBatches(
  embeddingProvider: CodexProviderEmbeddingProvider,
  texts: string[],
  batchSize: number,
  expectedDimensions: number,
): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = texts.slice(index, index + batchSize);
    const result = await embeddingProvider.embed(batch);
    embeddings.push(...normalizeEmbeddingResult({
      result,
      expectedCount: batch.length,
      expectedDimensions,
      context: 'local-vector chunk embedding',
    }));
  }
  return embeddings;
}

export async function embedSingleText(
  embeddingProvider: CodexProviderEmbeddingProvider,
  text: string,
  context: string,
): Promise<number[]> {
  const result = await embeddingProvider.embed([text]);
  return normalizeEmbeddingResult({
    result,
    expectedCount: 1,
    expectedDimensions: null,
    context,
  })[0];
}

function normalizeEmbeddingResult({
  result,
  expectedCount,
  expectedDimensions,
  context,
}: {
  result: CodexProviderEmbeddingProviderResult;
  expectedCount: number;
  expectedDimensions: number | null;
  context: string;
}): number[][] {
  if (!Array.isArray(result.embeddings)) {
    throw new Error(`${context} provider must return an embeddings array.`);
  }
  if (result.embeddings.length !== expectedCount) {
    throw new Error(`${context} provider returned ${result.embeddings.length} embeddings for ${expectedCount} inputs.`);
  }
  const embeddings = result.embeddings.map((embedding, index) => {
    const normalized = normalizeEmbeddingVector(embedding);
    if (normalized.length === 0) {
      throw new Error(`${context} provider returned an empty embedding at index ${index}.`);
    }
    return normalized;
  });
  const dimensions = expectedDimensions ?? embeddings[0]?.length ?? 0;
  for (const [index, embedding] of embeddings.entries()) {
    if (embedding.length !== dimensions) {
      throw new Error(`${context} provider returned embedding dimension ${embedding.length} at index ${index}; expected ${dimensions}.`);
    }
  }
  if (Number.isFinite(Number(result.dimensions)) && Number(result.dimensions) > 0 && Number(result.dimensions) !== dimensions) {
    throw new Error(`${context} provider reported dimensions ${result.dimensions}; expected ${dimensions}.`);
  }
  return embeddings;
}
