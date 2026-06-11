import type {
  JsonRecord,
} from './types.js';
import {
  normalizeArray,
  normalizeString,
} from './utils.js';

export interface StreamingToolCallAccumulator {
  toolCallsByKey: Map<string, JsonRecord>;
  sawToolCallDelta: boolean;
}

export function parseChatStreamData(data: string): JsonRecord | null {
  const trimmed = normalizeString(data);
  if (!trimmed || trimmed === '[DONE]') {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as JsonRecord;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function collectStreamingToolCallDeltas(
  chunk: JsonRecord,
  accumulator: StreamingToolCallAccumulator,
): void {
  for (const choice of normalizeArray(chunk?.choices)) {
    const choiceIndex = normalizeStreamIndex(choice?.index, 0);
    for (const toolCallDelta of normalizeArray(choice?.delta?.tool_calls)) {
      accumulator.sawToolCallDelta = true;
      const toolIndex = normalizeStreamIndex(toolCallDelta?.index, 0);
      const key = `${choiceIndex}:${toolIndex}`;
      const existing = accumulator.toolCallsByKey.get(key) ?? {
        id: '',
        type: 'function',
        function: {
          name: '',
          arguments: '',
        },
      };
      const id = normalizeString(toolCallDelta?.id);
      if (id) {
        existing.id = id;
      }
      const type = normalizeString(toolCallDelta?.type);
      if (type) {
        existing.type = type;
      }
      const functionName = normalizeString(toolCallDelta?.function?.name);
      if (functionName) {
        existing.function.name += functionName;
      }
      const functionArguments = typeof toolCallDelta?.function?.arguments === 'string'
        ? toolCallDelta.function.arguments
        : '';
      if (functionArguments) {
        existing.function.arguments += functionArguments;
      }
      accumulator.toolCallsByKey.set(key, existing);
    }
  }
  for (const [key, toolCall] of accumulator.toolCallsByKey.entries()) {
    if (!normalizeString(toolCall.id)) {
      toolCall.id = `call_${key.replace(/[^A-Za-z0-9_-]/gu, '_')}`;
    }
  }
}

export function chatStreamChunkHasAssistantText(chunk: JsonRecord): boolean {
  for (const choice of normalizeArray(chunk?.choices)) {
    const delta = choice?.delta;
    if (typeof delta?.content === 'string' && delta.content.length > 0) {
      return true;
    }
    if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      return true;
    }
    if (typeof delta?.reasoning === 'string' && delta.reasoning.length > 0) {
      return true;
    }
  }
  return false;
}

export function chatStreamChunkFinishedToolCalls(chunk: JsonRecord): boolean {
  return normalizeArray(chunk?.choices).some((choice) => normalizeString(choice?.finish_reason) === 'tool_calls');
}

export function chatStreamChunkHasFinishReason(chunk: JsonRecord): boolean {
  return normalizeArray(chunk?.choices).some((choice) => Boolean(normalizeString(choice?.finish_reason)));
}

function normalizeStreamIndex(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export async function* chainSseDataLines(
  bufferedChunks: string[],
  remaining: AsyncIterable<string>,
): AsyncGenerator<string> {
  for (const chunk of bufferedChunks) {
    yield chunk;
  }
  for await (const chunk of remaining) {
    yield chunk;
  }
}

export function asyncIteratorToIterable<T>(iterator: AsyncIterator<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
}

export async function drainAsyncIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      return;
    }
  }
}

export async function* emptyAsyncIterable<T>(): AsyncGenerator<T> {}

export async function* readSseDataLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let splitIndex = findSseFrameBoundary(buffer);
      while (splitIndex >= 0) {
        const frame = buffer.slice(0, splitIndex);
        buffer = buffer.slice(buffer[splitIndex] === '\r' ? splitIndex + 4 : splitIndex + 2);
        const data = extractSseData(frame);
        if (data !== null) {
          yield data;
        }
        splitIndex = findSseFrameBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    const data = extractSseData(buffer);
    if (data !== null) {
      yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

function findSseFrameBoundary(buffer: string): number {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf < 0) {
    return crlf;
  }
  if (crlf < 0) {
    return lf;
  }
  return Math.min(lf, crlf);
}

function extractSseData(frame: string): string | null {
  const lines = frame.split(/\r?\n/u);
  const eventName = lines
    .find((line) => line.startsWith('event:'))
    ?.slice(6)
    .trim();
  const dataLines = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) {
    return null;
  }
  const data = dataLines.join('\n');
  if (eventName === 'error' && data.trim() !== '[DONE]') {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify({
          type: 'error',
          ...parsed,
        });
      }
    } catch {
      // Fall through to a normalized top-level error payload below.
    }
    return JSON.stringify({
      type: 'error',
      message: data,
    });
  }
  return data;
}
