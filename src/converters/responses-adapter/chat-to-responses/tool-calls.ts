import crypto from 'node:crypto';
import {
  type CodexToolContext,
  customToolSpec,
  isCustomToolProxy,
  openaiNameForFunctionTool,
  originalCustomToolName,
} from '../../codex_tool_context.js';
import {
  reconstructApplyPatchInput,
  reconstructCustomToolCallInput,
} from '../../apply_patch_proxy.js';
import type {
  JsonRecord,
  ToolNameMap,
} from '../types.js';
import {
  omitUndefined,
} from '../shared/json.js';
import {
  buildFunctionCallItemId,
} from '../shared/ids.js';
import {
  normalizeString,
} from '../shared/strings.js';
import {
  restoreToolName,
} from '../shared/tool-names.js';

export function chatToolCallToResponseOutputItem(
  toolCall: JsonRecord,
  reverseToolNameMap: ToolNameMap,
  toolContext: CodexToolContext,
): JsonRecord {
  const callId = normalizeString(toolCall?.id) || `call_${crypto.randomUUID()}`;
  const upstreamName = restoreToolName(normalizeString(toolCall?.function?.name) || 'tool', reverseToolNameMap);
  const argumentsText = normalizeString(toolCall?.function?.arguments) || '';

  if (isCustomToolProxy(toolContext, upstreamName)) {
    const spec = customToolSpec(toolContext, upstreamName);
    const input = spec?.kind === 'apply_patch'
      ? reconstructApplyPatchInput(spec.proxyAction, argumentsText)
      : reconstructCustomToolCallInput(argumentsText);
    return {
      id: `ctc_${callId}`,
      type: 'custom_tool_call',
      status: 'completed',
      call_id: callId,
      name: originalCustomToolName(toolContext, upstreamName),
      input,
    };
  }

  const restored = openaiNameForFunctionTool(toolContext, upstreamName);
  return omitUndefined({
    id: buildFunctionCallItemId(callId),
    type: 'function_call',
    status: 'completed',
    call_id: callId,
    name: restored.name,
    namespace: restored.namespace || undefined,
    arguments: argumentsText,
  });
}
