import type {
  ServerResponse,
} from 'node:http';
import type {
  JsonRecord,
} from './types.js';
import {
  normalizeArray,
  normalizeString,
} from './utils.js';

export function responsesObjectToSyntheticSseEvents(response: JsonRecord): JsonRecord[] {
  const events: JsonRecord[] = [];
  const responseId = normalizeString(response?.id) || `resp_${Date.now()}`;
  let sequence = 0;
  const withSequence = (event: JsonRecord): JsonRecord => ({
    ...event,
    sequence_number: sequence += 1,
  });
  events.push(withSequence({
    type: 'response.created',
    response: {
      ...response,
      output: [],
    },
  }));
  const output = normalizeArray(response?.output);
  for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    const item = output[outputIndex];
    const itemId = normalizeString(item?.id) || `${responseId}_item_${outputIndex}`;
    events.push(withSequence({
      type: 'response.output_item.added',
      output_index: outputIndex,
      item,
    }));
    if (item?.type === 'message') {
      appendSyntheticMessageContentEvents(events, withSequence, item, itemId, outputIndex);
    } else if (item?.type === 'function_call') {
      const argumentsText = normalizeString(item.arguments) || '{}';
      events.push(withSequence({
        type: 'response.function_call_arguments.delta',
        item_id: itemId,
        output_index: outputIndex,
        delta: argumentsText,
      }));
      events.push(withSequence({
        type: 'response.function_call_arguments.done',
        item_id: itemId,
        output_index: outputIndex,
        arguments: argumentsText,
      }));
    } else if (item?.type === 'custom_tool_call') {
      const input = normalizeString(item.input);
      if (input) {
        events.push(withSequence({
          type: 'response.custom_tool_call_input.delta',
          item_id: itemId,
          output_index: outputIndex,
          delta: input,
        }));
      }
      events.push(withSequence({
        type: 'response.custom_tool_call_input.done',
        item_id: itemId,
        output_index: outputIndex,
        input,
      }));
    }
    events.push(withSequence({
      type: 'response.output_item.done',
      output_index: outputIndex,
      item,
    }));
  }
  const completedType = response?.status === 'failed' ? 'response.failed' : 'response.completed';
  events.push(withSequence({
    type: completedType,
    response,
  }));
  return events;
}

export function buildAppendedOutputItemSseEvents(response: JsonRecord, startIndex: number): JsonRecord[] {
  const output = normalizeArray(response?.output);
  const events: JsonRecord[] = [];
  for (let outputIndex = startIndex; outputIndex < output.length; outputIndex += 1) {
    const item = output[outputIndex];
    events.push({
      type: 'response.output_item.added',
      output_index: outputIndex,
      item,
    });
    events.push({
      type: 'response.output_item.done',
      output_index: outputIndex,
      item,
    });
  }
  return events;
}

export function resequenceInsertedStreamEvents(insertedEvents: JsonRecord[], terminalEvent: JsonRecord): void {
  if (insertedEvents.length === 0) {
    return;
  }
  const terminalSequence = Number(terminalEvent.sequence_number);
  if (!Number.isInteger(terminalSequence) || terminalSequence < 1) {
    return;
  }
  for (let index = 0; index < insertedEvents.length; index += 1) {
    insertedEvents[index].sequence_number = terminalSequence + index;
  }
  terminalEvent.sequence_number = terminalSequence + insertedEvents.length;
}

function appendSyntheticMessageContentEvents(
  events: JsonRecord[],
  withSequence: (event: JsonRecord) => JsonRecord,
  item: JsonRecord,
  itemId: string,
  outputIndex: number,
): void {
  const content = normalizeArray(item.content);
  for (let contentIndex = 0; contentIndex < content.length; contentIndex += 1) {
    const part = content[contentIndex];
    events.push(withSequence({
      type: 'response.content_part.added',
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      part,
    }));
    const text = normalizeString(part?.text);
    if (text && normalizeString(part?.type) === 'output_text') {
      events.push(withSequence({
        type: 'response.output_text.delta',
        item_id: itemId,
        output_index: outputIndex,
        content_index: contentIndex,
        delta: text,
      }));
      events.push(withSequence({
        type: 'response.output_text.done',
        item_id: itemId,
        output_index: outputIndex,
        content_index: contentIndex,
        text,
      }));
    }
    events.push(withSequence({
      type: 'response.content_part.done',
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      part,
    }));
  }
}

export function formatResponsesSseEvent(event: JsonRecord): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function parseResponsesSseEventFrame(frame: string): JsonRecord | null {
  const lines = frame.split('\n');
  const eventLine = lines.find((line) => line.startsWith('event: '));
  const dataLines = lines
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6));
  if (!eventLine || dataLines.length === 0) {
    return null;
  }
  const data = dataLines.join('\n').trim();
  if (!data || data === '[DONE]') {
    return null;
  }
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : null;
  } catch {
    return null;
  }
}

export function ensureSseResponseHeaders(response: ServerResponse): void {
  if (response.headersSent) {
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
}
