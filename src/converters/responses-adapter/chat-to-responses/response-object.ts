import type {
  JsonRecord,
} from '../types.js';
import {
  omitUndefined,
} from '../shared/json.js';

export function buildResponsesObject({
  responseId,
  createdAt,
  request,
  responseModel = null,
  status,
  output,
  usage,
  error = null,
}: {
  responseId: string;
  createdAt: number;
  request: JsonRecord;
  responseModel?: string | null;
  status: string;
  output: JsonRecord[];
  usage: JsonRecord | null;
  error?: JsonRecord | null;
}): JsonRecord {
  return omitUndefined({
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    error,
    incomplete_details: null,
    background: false,
    instructions: request?.instructions ?? null,
    max_output_tokens: request?.max_output_tokens ?? request?.max_tokens ?? null,
    max_tool_calls: request?.max_tool_calls ?? null,
    model: request?.model ?? responseModel ?? null,
    output,
    parallel_tool_calls: request?.parallel_tool_calls ?? true,
    previous_response_id: request?.previous_response_id ?? null,
    prompt_cache_key: request?.prompt_cache_key ?? null,
    reasoning: request?.reasoning ?? null,
    safety_identifier: request?.safety_identifier ?? null,
    service_tier: request?.service_tier ?? null,
    store: request?.store ?? false,
    temperature: request?.temperature,
    text: request?.text ?? { format: { type: 'text' } },
    tool_choice: request?.tool_choice ?? 'auto',
    tools: request?.tools ?? [],
    top_logprobs: request?.top_logprobs,
    top_p: request?.top_p,
    truncation: request?.truncation ?? 'disabled',
    user: request?.user ?? null,
    metadata: request?.metadata ?? null,
    usage,
  });
}
