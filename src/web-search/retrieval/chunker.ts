export interface CodexProviderWebRetrievalChunk {
  id: string;
  url: string;
  title: string;
  text: string;
  index: number;
  startOffset: number;
  endOffset: number;
  score?: number | null;
  metadata?: Record<string, any> | null;
}

export interface CodexProviderWebRetrievalChunkOptions {
  url: string;
  title?: string | null;
  text: string;
  maxChars?: number | null;
  overlapChars?: number | null;
  metadata?: Record<string, any> | null;
}

export function chunkCodexProviderWebRetrievalText(
  options: CodexProviderWebRetrievalChunkOptions,
): CodexProviderWebRetrievalChunk[] {
  const text = normalizeChunkText(options.text);
  if (!text) {
    return [];
  }
  const maxChars = clampInteger(options.maxChars, 200, 8_000, 1_200);
  const overlapChars = Math.min(clampInteger(options.overlapChars, 0, 1_000, 120), Math.floor(maxChars / 2));
  const chunks: CodexProviderWebRetrievalChunk[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + maxChars);
    const end = hardEnd === text.length ? hardEnd : findChunkBoundary(text, start, hardEnd);
    const chunkText = text.slice(start, end).trim();
    if (chunkText) {
      chunks.push({
        id: `${stableChunkPrefix(options.url)}:${chunks.length + 1}`,
        url: options.url,
        title: String(options.title ?? '').trim(),
        text: chunkText,
        index: chunks.length + 1,
        startOffset: start,
        endOffset: end,
        score: null,
        metadata: options.metadata ?? null,
      });
    }
    if (end >= text.length) {
      break;
    }
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}

function normalizeChunkText(value: string): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function findChunkBoundary(text: string, start: number, hardEnd: number): number {
  const windowStart = Math.max(start + Math.floor((hardEnd - start) * 0.65), start);
  const boundary = Math.max(
    text.lastIndexOf('. ', hardEnd),
    text.lastIndexOf('? ', hardEnd),
    text.lastIndexOf('! ', hardEnd),
    text.lastIndexOf('\n', hardEnd),
    text.lastIndexOf(' ', hardEnd),
  );
  return boundary > windowStart ? boundary + 1 : hardEnd;
}

function stableChunkPrefix(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = ((hash << 5) - hash + char.codePointAt(0)!) | 0;
  }
  return `web_${Math.abs(hash).toString(36)}`;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}
