import type {
  JsonRecord,
  ResponsesSseTranslateOptions,
} from '../types.js';
import {
  normalizeUnknownErrorObject,
} from '../shared/errors.js';
import {
  failStreamState,
  finishStreamState,
} from './finish.js';
import {
  formatSseEvent,
} from './format.js';
import {
  translateChatCompletionStreamData,
} from './parser.js';
import {
  createStreamState,
} from './state.js';

export function translateChatCompletionsSseToResponsesEvents(
  chunks: Iterable<string>,
  options: ResponsesSseTranslateOptions = {},
): JsonRecord[] {
  const state = createStreamState(options);
  const traceEvent = typeof options.traceEvent === 'function' ? options.traceEvent : null;
  const events: JsonRecord[] = [];
  for (const chunk of chunks) {
    for (const event of translateChatCompletionStreamData(chunk, state)) {
      traceEvent?.(event);
      events.push(event);
    }
  }
  for (const event of finishStreamState(state)) {
    traceEvent?.(event);
    events.push(event);
  }
  return events;
}

export async function* translateChatCompletionsSseStreamToResponsesSse(
  chunks: AsyncIterable<string>,
  options: ResponsesSseTranslateOptions = {},
): AsyncGenerator<string> {
  const state = createStreamState(options);
  const traceEvent = typeof options.traceEvent === 'function' ? options.traceEvent : null;
  try {
    for await (const chunk of chunks) {
      for (const event of translateChatCompletionStreamData(chunk, state)) {
        traceEvent?.(event);
        yield formatSseEvent(event);
      }
    }
    for (const event of finishStreamState(state)) {
      traceEvent?.(event);
      yield formatSseEvent(event);
    }
  } catch (error) {
    for (const event of failStreamState(state, normalizeUnknownErrorObject(error))) {
      traceEvent?.(event);
      yield formatSseEvent(event);
    }
  }
  yield 'data: [DONE]\n\n';
}
