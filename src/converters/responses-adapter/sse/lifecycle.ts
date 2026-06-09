import type {
  JsonRecord,
  StreamState,
} from '../types.js';
import {
  buildResponsesObject,
} from '../chat-to-responses/response-object.js';
import {
  withSequence,
} from './state.js';

export function ensureStreamStarted(state: StreamState): JsonRecord[] {
  if (state.createdEmitted) {
    return [];
  }
  state.createdEmitted = true;
  const response = buildResponsesObject({
    responseId: state.responseId,
    createdAt: state.createdAt,
    request: state.request,
    responseModel: state.responseModel,
    status: 'in_progress',
    output: [],
    usage: null,
  });
  return [
    withSequence(state, {
      type: 'response.created',
      response,
    }),
    withSequence(state, {
      type: 'response.in_progress',
      response,
    }),
  ];
}
