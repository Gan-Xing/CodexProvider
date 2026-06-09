import type {
  OpenAICompatibleProviderCapabilities,
} from '../../../capabilities/thinking_policy.js';
import type {
  JsonRecord,
} from '../types.js';
import {
  normalizeString,
} from '../shared/strings.js';

export function formatUnsupportedToolCallAsText(item: JsonRecord): string {
  const name = normalizeString(item?.name) || 'tool';
  const args = normalizeString(item?.arguments) || '{}';
  return `[Tool call omitted because this model does not support tools: ${name} ${args}]`;
}

export function formatUnsupportedCustomToolCallAsText(item: JsonRecord): string {
  const name = normalizeString(item?.name) || 'custom_tool';
  const input = normalizeString(item?.input) || '';
  return `[Custom tool call omitted because this model does not support tools: ${name} ${input}]`;
}

export function formatUnsupportedToolOutputAsText(item: JsonRecord): string {
  const callId = normalizeString(item?.call_id) || 'unknown';
  const output = normalizeString(item?.output) || '';
  return `[Tool output omitted because this model does not support tools: ${callId} ${output}]`;
}

export function unsupportedInputPartToText(
  part: JsonRecord,
  kind: 'image' | 'file',
  providerCapabilities: OpenAICompatibleProviderCapabilities | null | undefined,
): JsonRecord | null {
  const strategy = providerCapabilities?.multimodal?.unsupportedInputPartStrategy ?? 'text-placeholder';
  if (strategy === 'drop') {
    return null;
  }
  if (strategy === 'error') {
    throw new Error(`OpenAI-compatible provider does not support ${kind} input for this model.`);
  }
  const description = describeUnsupportedInputPart(part, kind);
  return {
    type: 'text',
    text: `[Unsupported ${kind} input omitted: ${description}]`,
  };
}

function describeUnsupportedInputPart(part: JsonRecord, kind: 'image' | 'file'): string {
  if (kind === 'image') {
    const imageUrl = normalizeString(part?.image_url) || normalizeString(part?.image_url?.url);
    if (imageUrl.startsWith('data:')) {
      return 'base64 image';
    }
    return imageUrl || 'image';
  }
  return normalizeString(part?.filename)
    || normalizeString(part?.file?.filename)
    || normalizeString(part?.file_id)
    || normalizeString(part?.file?.file_id)
    || normalizeString(part?.file_url)
    || normalizeString(part?.file?.file_url)
    || 'file';
}
