import type {
  LocalVectorTextChunk,
  NormalizedLocalVectorChunkingOptions,
} from '../types.js';
import {
  stableContentHash,
} from '../shared.js';
import {
  LOCAL_VECTOR_CHUNKER_VERSION,
} from './constants.js';

export function localVectorChunkingConfigHash(options: NormalizedLocalVectorChunkingOptions): string {
  return stableContentHash(JSON.stringify({
    chunkerVersion: LOCAL_VECTOR_CHUNKER_VERSION,
    maxChars: options.maxChars,
    overlapChars: options.overlapChars,
    maxChunksPerFile: options.maxChunksPerFile,
  }));
}

export function chunkLocalVectorText(
  content: string,
  options: NormalizedLocalVectorChunkingOptions,
): LocalVectorTextChunk[] {
  const lines = content.split(/\r?\n/u);
  const chunks: LocalVectorTextChunk[] = [];
  let lineIndex = 0;
  while (lineIndex < lines.length && chunks.length < options.maxChunksPerFile) {
    const previousStartIndex = lineIndex;
    const startLine = lineIndex + 1;
    const selectedLines: string[] = [];
    let charCount = 0;
    while (lineIndex < lines.length) {
      const line = lines[lineIndex];
      const nextLength = charCount + line.length + (selectedLines.length > 0 ? 1 : 0);
      if (selectedLines.length > 0 && nextLength > options.maxChars) {
        break;
      }
      selectedLines.push(line);
      charCount = nextLength;
      lineIndex += 1;
      if (charCount >= options.maxChars) {
        break;
      }
    }
    if (selectedLines.length === 0) {
      const line = lines[lineIndex] ?? '';
      selectedLines.push(line.slice(0, options.maxChars));
      lineIndex += 1;
    }
    const endLine = Math.max(startLine, lineIndex);
    const text = selectedLines.join('\n').trim();
    if (text) {
      chunks.push({
        text,
        chunkIndex: chunks.length,
        startLine,
        endLine,
      });
    }
    if (options.overlapChars > 0 && lineIndex < lines.length) {
      const nextLineIndex = lineIndex;
      let overlapChars = 0;
      let overlapLineIndex = Math.max(0, lineIndex - 1);
      while (overlapLineIndex > 0 && overlapChars < options.overlapChars) {
        overlapChars += lines[overlapLineIndex].length + 1;
        overlapLineIndex -= 1;
      }
      lineIndex = Math.max(overlapLineIndex + 1, previousStartIndex + 1);
      if (lineIndex >= nextLineIndex) {
        lineIndex = nextLineIndex;
      }
    }
  }
  return chunks;
}
