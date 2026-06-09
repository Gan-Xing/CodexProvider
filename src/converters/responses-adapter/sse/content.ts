import crypto from 'node:crypto';
import type {
  JsonRecord,
  StreamState,
} from '../types.js';
import {
  cloneJson,
} from '../shared/json.js';
import {
  allocateOutputIndex,
  withSequence,
} from './state.js';

export function appendOutputTextDelta(state: StreamState, choiceIndex: number, delta: string): JsonRecord[] {
  const events: JsonRecord[] = [];
  const reasoningState = state.reasoningStates.get(choiceIndex);
  if (reasoningState && !reasoningState.done) {
    events.push(...finishReasoningState(state, choiceIndex));
  }
  const messageState = ensureMessageState(state, choiceIndex, events);
  messageState.text += delta;
  events.push(withSequence(state, {
    type: 'response.output_text.delta',
    item_id: messageState.id,
    output_index: messageState.outputIndex,
    content_index: 0,
    delta,
  }));
  return events;
}

export function appendReasoningDelta(state: StreamState, choiceIndex: number, delta: string): JsonRecord[] {
  const events: JsonRecord[] = [];
  let reasoningState = state.reasoningStates.get(choiceIndex);
  if (!reasoningState || reasoningState.done) {
    reasoningState = {
      id: `rs_${crypto.randomUUID()}`,
      outputIndex: allocateOutputIndex(state),
      text: '',
      added: false,
      partAdded: false,
      done: false,
    };
    state.reasoningStates.set(choiceIndex, reasoningState);
    state.output.push({
      id: reasoningState.id,
      type: 'reasoning',
      status: 'in_progress',
      reasoning_content: '',
      summary: [],
    });
  }
  if (!reasoningState.added) {
    reasoningState.added = true;
    events.push(withSequence(state, {
      type: 'response.output_item.added',
      output_index: reasoningState.outputIndex,
      item: cloneJson(state.output[reasoningState.outputIndex]),
    }));
  }
  if (!reasoningState.partAdded) {
    reasoningState.partAdded = true;
    events.push(withSequence(state, {
      type: 'response.reasoning_summary_part.added',
      item_id: reasoningState.id,
      output_index: reasoningState.outputIndex,
      summary_index: 0,
      part: {
        type: 'summary_text',
        text: '',
      },
    }));
  }
  reasoningState.text += delta;
  events.push(withSequence(state, {
    type: 'response.reasoning_summary_text.delta',
    item_id: reasoningState.id,
    output_index: reasoningState.outputIndex,
    summary_index: 0,
    delta,
  }));
  return events;
}

export function finishReasoningState(state: StreamState, choiceIndex: number): JsonRecord[] {
  const reasoningState = state.reasoningStates.get(choiceIndex);
  if (!reasoningState || reasoningState.done) {
    return [];
  }
  reasoningState.done = true;
  const summary = reasoningState.text
    ? [{
      type: 'summary_text',
      text: reasoningState.text,
    }]
    : [];
  const item = state.output[reasoningState.outputIndex];
  item.status = 'completed';
  item.reasoning_content = reasoningState.text;
  item.summary = summary;
  return [
    withSequence(state, {
      type: 'response.reasoning_summary_text.done',
      item_id: reasoningState.id,
      output_index: reasoningState.outputIndex,
      summary_index: 0,
      text: reasoningState.text,
    }),
    withSequence(state, {
      type: 'response.reasoning_summary_part.done',
      item_id: reasoningState.id,
      output_index: reasoningState.outputIndex,
      summary_index: 0,
      part: {
        type: 'summary_text',
        text: reasoningState.text,
      },
    }),
    withSequence(state, {
      type: 'response.output_item.done',
      output_index: reasoningState.outputIndex,
      item: cloneJson(item),
    }),
  ];
}

export function finishMessageState(state: StreamState, choiceIndex: number): JsonRecord[] {
  const messageState = state.messageStates.get(choiceIndex);
  if (!messageState || messageState.done) {
    return [];
  }
  messageState.done = true;
  const part = {
    type: 'output_text',
    text: messageState.text,
    annotations: [],
  };
  const item = state.output[messageState.outputIndex];
  item.status = 'completed';
  item.content = [part];
  return [
    withSequence(state, {
      type: 'response.output_text.done',
      item_id: messageState.id,
      output_index: messageState.outputIndex,
      content_index: 0,
      text: messageState.text,
    }),
    withSequence(state, {
      type: 'response.content_part.done',
      item_id: messageState.id,
      output_index: messageState.outputIndex,
      content_index: 0,
      part,
    }),
    withSequence(state, {
      type: 'response.output_item.done',
      output_index: messageState.outputIndex,
      item: cloneJson(item),
    }),
  ];
}

function ensureMessageState(state: StreamState, choiceIndex: number, events: JsonRecord[]) {
  let messageState = state.messageStates.get(choiceIndex);
  if (!messageState) {
    messageState = {
      id: `msg_${crypto.randomUUID()}`,
      outputIndex: allocateOutputIndex(state),
      text: '',
      added: false,
      contentAdded: false,
      done: false,
    };
    state.messageStates.set(choiceIndex, messageState);
    state.output.push({
      id: messageState.id,
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: [],
    });
  }
  if (!messageState.added) {
    messageState.added = true;
    events.push(withSequence(state, {
      type: 'response.output_item.added',
      output_index: messageState.outputIndex,
      item: cloneJson(state.output[messageState.outputIndex]),
    }));
  }
  if (!messageState.contentAdded) {
    messageState.contentAdded = true;
    events.push(withSequence(state, {
      type: 'response.content_part.added',
      item_id: messageState.id,
      output_index: messageState.outputIndex,
      content_index: 0,
      part: {
        type: 'output_text',
        text: '',
        annotations: [],
      },
    }));
  }
  return messageState;
}
