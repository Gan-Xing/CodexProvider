import type {
  InlineThinkMode,
  InlineThinkState,
  JsonRecord,
  StreamState,
} from '../types.js';
import {
  splitLeadingThinkBlock,
} from '../chat-to-responses/reasoning.js';
import {
  appendOutputTextDelta,
  appendReasoningDelta,
  finishReasoningState,
} from './content.js';

const THINK_OPEN_TAG = '<think>';

export function appendMessageDelta(state: StreamState, choiceIndex: number, delta: string): JsonRecord[] {
  const inlineState = state.inlineThinkStates.get(choiceIndex);
  if (inlineState?.mode === 'text') {
    return appendOutputTextDelta(state, choiceIndex, delta);
  }

  const detector = inlineState ?? { mode: 'detecting' as InlineThinkMode, buffer: '' };
  state.inlineThinkStates.set(choiceIndex, detector);

  if (detector.mode === 'detecting') {
    detector.buffer += delta;
    const decision = leadingThinkPrefixDecision(detector.buffer);
    if (decision === 'need_more') {
      return [];
    }
    if (decision === 'reasoning') {
      detector.mode = 'reasoning';
      return drainCompleteInlineThink(state, choiceIndex, detector);
    }
    detector.mode = 'text';
    const text = detector.buffer;
    detector.buffer = '';
    return appendOutputTextDelta(state, choiceIndex, text);
  }

  detector.buffer += delta;
  return drainCompleteInlineThink(state, choiceIndex, detector);
}

export function flushInlineThinkAtBoundary(state: StreamState, choiceIndex: number): JsonRecord[] {
  const inlineState = state.inlineThinkStates.get(choiceIndex);
  if (!inlineState || inlineState.mode === 'text') {
    return [];
  }
  const events = drainCompleteInlineThink(state, choiceIndex, inlineState);
  if (events.length > 0) {
    return events;
  }
  const buffered = inlineState.buffer;
  const previousMode = inlineState.mode;
  inlineState.buffer = '';
  inlineState.mode = 'text';
  if (!buffered) {
    return [];
  }
  if (previousMode === 'reasoning' || buffered.trimStart().startsWith(THINK_OPEN_TAG)) {
    const reasoning = stripLeadingThinkOpenTag(buffered).trim();
    return reasoning
      ? [
        ...appendReasoningDelta(state, choiceIndex, reasoning),
        ...finishReasoningState(state, choiceIndex),
      ]
      : [];
  }
  return appendOutputTextDelta(state, choiceIndex, buffered);
}

function leadingThinkPrefixDecision(buffer: string): 'need_more' | 'reasoning' | 'text' {
  const afterWhitespace = buffer.trimStart();
  if (!afterWhitespace) {
    return 'need_more';
  }
  if (afterWhitespace.startsWith(THINK_OPEN_TAG)) {
    return 'reasoning';
  }
  if (THINK_OPEN_TAG.startsWith(afterWhitespace)) {
    return 'need_more';
  }
  return 'text';
}

function drainCompleteInlineThink(
  state: StreamState,
  choiceIndex: number,
  inlineState: InlineThinkState,
): JsonRecord[] {
  const split = splitLeadingThinkBlock(inlineState.buffer);
  if (!split) {
    return [];
  }
  inlineState.mode = 'text';
  inlineState.buffer = '';
  const events: JsonRecord[] = [];
  if (split.reasoning) {
    events.push(...appendReasoningDelta(state, choiceIndex, split.reasoning));
    events.push(...finishReasoningState(state, choiceIndex));
  }
  if (split.answer) {
    events.push(...appendOutputTextDelta(state, choiceIndex, split.answer));
  }
  return events;
}

function stripLeadingThinkOpenTag(text: string): string {
  const leadingWhitespaceLength = text.length - text.trimStart().length;
  const afterWhitespace = text.slice(leadingWhitespaceLength);
  return afterWhitespace.startsWith(THINK_OPEN_TAG)
    ? afterWhitespace.slice(THINK_OPEN_TAG.length)
    : text;
}
