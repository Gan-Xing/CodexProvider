import {
  isCodexProviderAdapterEmulatedBuiltinToolType,
  normalizeCodexProviderBuiltinToolName,
} from '../../builtin-tools/index.js';
import type {
  NormalizedCodexProviderHostedToolDeclaration,
} from '../../hosted_tools.js';
import type {
  OpenAICompatibleProviderCapabilities,
} from '../../capabilities/thinking_policy.js';
import type {
  CodexProviderRequestAdjustment,
  JsonRecord,
} from './types.js';
import {
  normalizeArray,
  normalizePositiveNumber,
  normalizeString,
} from './utils.js';

export function summarizeRequestAdjustments({
  request,
  upstreamRequest,
  providerCapabilities,
  hostedTools = [],
}: {
  request: JsonRecord;
  upstreamRequest: JsonRecord;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  hostedTools?: NormalizedCodexProviderHostedToolDeclaration[];
}): CodexProviderRequestAdjustment[] {
  const adjustments: CodexProviderRequestAdjustment[] = [];
  const requestedModel = normalizeString(request?.model);
  const upstreamModel = normalizeString(upstreamRequest?.model);
  if (requestedModel && upstreamModel && requestedModel !== upstreamModel) {
    adjustments.push({
      kind: 'model_overridden',
      path: 'model',
      reason: 'payload_override',
      before: requestedModel,
      after: upstreamModel,
    });
  }

  const requestedMaxOutputTokens = normalizePositiveNumber(request?.max_output_tokens);
  const upstreamMaxTokens = normalizePositiveNumber(upstreamRequest?.max_tokens);
  if (
    requestedMaxOutputTokens !== null
    && upstreamMaxTokens !== null
    && upstreamMaxTokens < requestedMaxOutputTokens
  ) {
    adjustments.push({
      kind: 'max_output_tokens_capped',
      path: 'max_output_tokens',
      reason: 'model_limit',
      before: requestedMaxOutputTokens,
      after: upstreamMaxTokens,
    });
  }

  if (request?.parallel_tool_calls !== undefined && upstreamRequest?.parallel_tool_calls === undefined) {
    adjustments.push({
      kind: 'field_filtered',
      path: 'parallel_tool_calls',
      reason: 'payload_filter',
      before: request.parallel_tool_calls,
    });
  }

  if (request?.text?.format !== undefined && upstreamRequest?.response_format === undefined) {
    adjustments.push({
      kind: 'field_filtered',
      path: 'text.format',
      reason: 'payload_filter_or_unsupported_format',
      before: request.text.format,
    });
  }

  const requestedTools = normalizeArray(request?.tools);
  if (requestedTools.length > 0) {
    const requestedFunctionTools = requestedTools.filter((tool) => normalizeString(tool?.type) === 'function').length;
    const requestedBuiltinTools = requestedTools.filter((tool) => isBuiltinWebSearchToolType(tool?.type)).length;
    const upstreamTools = normalizeArray(upstreamRequest?.tools);
    const forwardedFunctionTools = upstreamTools.filter((tool) => normalizeString(tool?.type) === 'function').length;
    const forwardedBuiltinTools = upstreamTools.filter((tool) => isBuiltinWebSearchToolType(tool?.type)).length;
    const forwardedAdapterHostedBuiltinTools = upstreamTools
      .filter((tool) => isAdapterHostedBuiltinChatTool(tool, hostedTools))
      .length;

    if (requestedFunctionTools > forwardedFunctionTools) {
      adjustments.push({
        kind: 'tools_dropped',
        path: 'tools',
        reason: providerCapabilities?.supportsTools === false
          ? 'tool_calling_disabled'
          : 'unsupported_or_invalid_tools',
        requestedCount: requestedFunctionTools,
        forwardedCount: forwardedFunctionTools,
      });
    }
    if (requestedBuiltinTools > forwardedBuiltinTools + forwardedAdapterHostedBuiltinTools) {
      adjustments.push({
        kind: 'tools_dropped',
        path: 'tools',
        reason: providerCapabilities?.supportsBuiltinWebSearchTool === false
          ? 'builtin_web_search_unsupported'
          : 'unsupported_or_invalid_tools',
        requestedCount: requestedBuiltinTools,
        forwardedCount: forwardedBuiltinTools + forwardedAdapterHostedBuiltinTools,
      });
    }
  }

  if (request?.tool_choice !== undefined && upstreamRequest?.tool_choice === undefined) {
    adjustments.push({
      kind: 'tool_choice_dropped',
      path: 'tool_choice',
      reason: 'unsupported_or_filtered',
      before: request.tool_choice,
    });
  }

  const requestedParts = countRequestedInputParts(request?.input);
  const forwardedParts = countForwardedInputParts(upstreamRequest?.messages);
  const strategy = normalizeString(providerCapabilities?.multimodal?.unsupportedInputPartStrategy) || null;
  if (requestedParts.image > forwardedParts.image) {
    adjustments.push({
      kind: 'image_input_downgraded',
      path: 'input.image',
      reason: 'unsupported_input_part_strategy',
      requestedCount: requestedParts.image,
      forwardedCount: forwardedParts.image,
      strategy,
    });
  }
  if (requestedParts.file > forwardedParts.file) {
    adjustments.push({
      kind: 'file_input_downgraded',
      path: 'input.file',
      reason: 'unsupported_input_part_strategy',
      requestedCount: requestedParts.file,
      forwardedCount: forwardedParts.file,
      strategy,
    });
  }

  return adjustments;
}

function countRequestedInputParts(input: unknown): { image: number; file: number } {
  const counts = { image: 0, file: 0 };
  for (const item of normalizeArray(input)) {
    const contents = typeof item?.content === 'string' ? [] : normalizeArray(item?.content);
    for (const part of contents) {
      const type = normalizeString(part?.type);
      if (type === 'input_image' || type === 'image') {
        counts.image += 1;
      } else if (type === 'input_file' || type === 'file') {
        counts.file += 1;
      }
    }
  }
  return counts;
}

function countForwardedInputParts(messages: unknown): { image: number; file: number } {
  const counts = { image: 0, file: 0 };
  for (const message of normalizeArray(messages)) {
    if (typeof message?.content === 'string') {
      continue;
    }
    for (const part of normalizeArray(message?.content)) {
      const type = normalizeString(part?.type);
      if (type === 'image_url') {
        counts.image += 1;
      } else if (type === 'file') {
        counts.file += 1;
      }
    }
  }
  return counts;
}

function isBuiltinWebSearchToolType(type: unknown): boolean {
  return normalizeCodexProviderBuiltinToolName(type) === 'web_search';
}

function isAdapterHostedBuiltinChatTool(
  tool: unknown,
  hostedTools: NormalizedCodexProviderHostedToolDeclaration[],
): boolean {
  if (!tool || typeof tool !== 'object') {
    return false;
  }
  const record = tool as JsonRecord;
  if (normalizeString(record.type) !== 'function') {
    return false;
  }
  const functionName = normalizeString(record.function?.name);
  return Boolean(functionName && hostedTools.some((hostedTool) => (
    isCodexProviderAdapterEmulatedBuiltinToolType(hostedTool.name)
    && hostedTool.mode === 'adapter-emulated'
    && normalizeString(hostedTool.emulatedToolName || hostedTool.name) === functionName
  )));
}
