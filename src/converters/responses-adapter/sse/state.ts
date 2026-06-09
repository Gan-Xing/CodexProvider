import crypto from 'node:crypto';
import {
  resolveOpenAICompatibleProviderCapabilitiesForModel,
} from '../../../capabilities/thinking_policy.js';
import {
  buildCodexToolContext,
} from '../../codex_tool_context.js';
import type {
  JsonRecord,
  ResponsesSseTranslateOptions,
  StreamState,
} from '../types.js';
import {
  normalizeNumber,
} from '../shared/numbers.js';
import {
  normalizeString,
} from '../shared/strings.js';
import {
  buildReverseToolNameMap,
} from '../shared/tool-names.js';

export function createStreamState(options: ResponsesSseTranslateOptions): StreamState {
  return {
    responseId: normalizeString(options.responseId) || `resp_${crypto.randomUUID()}`,
    createdAt: normalizeNumber(options.createdAt) ?? Math.floor(Date.now() / 1000),
    responseModel: normalizeString(options.request?.model) || null,
    sequence: 0,
    request: options.request ?? {},
    output: [],
    nextOutputIndex: 0,
    messageStates: new Map(),
    inlineThinkStates: new Map(),
    reasoningStates: new Map(),
    toolCalls: new Map(),
    createdEmitted: false,
    terminalEmitted: false,
    failedError: null,
    usage: null,
    providerCapabilities: resolveOpenAICompatibleProviderCapabilitiesForModel(
      options.providerCapabilities,
      normalizeString(options.request?.model) || null,
    ),
    reverseToolNameMap: buildReverseToolNameMap(options.request ?? {}),
    toolContext: buildCodexToolContext(options.request?.tools),
  };
}

export function allocateOutputIndex(state: StreamState): number {
  const index = state.nextOutputIndex;
  state.nextOutputIndex += 1;
  return index;
}

export function withSequence(state: StreamState, payload: JsonRecord): JsonRecord {
  const next = {
    ...payload,
    sequence_number: state.sequence,
  };
  state.sequence += 1;
  return next;
}
