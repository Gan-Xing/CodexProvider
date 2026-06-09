import type {
  OpenAICompatibleProviderCapabilities,
} from '../../../capabilities/thinking_policy.js';
import {
  APPLY_PATCH_TOOL_NAME,
  applyPatchProxyToolName,
} from '../../apply_patch_proxy.js';
import {
  flattenNamespaceToolName,
} from '../../codex_tool_context.js';
import type {
  AdapterEmulatedHostedToolMap,
  JsonRecord,
  ToolNameMap,
} from '../types.js';
import {
  normalizeArray,
  omitUndefined,
} from '../shared/json.js';
import {
  normalizeString,
} from '../shared/strings.js';
import {
  shortenToolName,
} from '../shared/tool-names.js';
import {
  buildForcedFunctionToolChoice,
  convertResponsesToolToChatTool,
  isAdapterHostedBuiltinToolType,
  isBuiltinToolType,
  normalizeAdapterHostedToolBuiltinType,
  normalizeBuiltinToolType,
} from './tools.js';

export function convertResponsesToolChoiceToChatToolChoice(
  toolChoice: unknown,
  providerKind?: string | null,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null = null,
  toolNameMap: ToolNameMap = new Map(),
  builtinWebSearchTransport: 'openai_tool' | 'chat_enable_search' = 'openai_tool',
  adapterEmulatedHostedTools: AdapterEmulatedHostedToolMap = new Map(),
): unknown {
  if (typeof toolChoice === 'string') {
    const adapterHostedTool = adapterEmulatedHostedTools.get(normalizeAdapterHostedToolBuiltinType(toolChoice));
    if (isAdapterHostedBuiltinToolType(toolChoice) && adapterHostedTool) {
      return buildForcedFunctionToolChoice(adapterHostedTool.emulatedToolName || adapterHostedTool.name);
    }
    const normalizedBuiltinType = normalizeBuiltinToolType(
      toolChoice,
      providerKind,
      providerCapabilities,
      builtinWebSearchTransport,
    );
    if (normalizedBuiltinType) {
      return normalizedBuiltinType;
    }
    if (isBuiltinToolType(toolChoice)) {
      return undefined;
    }
    return toolChoice;
  }
  if (!toolChoice || typeof toolChoice !== 'object') {
    return toolChoice;
  }

  const record = { ...(toolChoice as JsonRecord) };
  const rawType = normalizeString(record.type);
  const adapterHostedTool = adapterEmulatedHostedTools.get(normalizeAdapterHostedToolBuiltinType(rawType));
  if (isAdapterHostedBuiltinToolType(rawType) && adapterHostedTool) {
    return buildForcedFunctionToolChoice(adapterHostedTool.emulatedToolName || adapterHostedTool.name);
  }
  const normalizedType = normalizeBuiltinToolType(
    rawType,
    providerKind,
    providerCapabilities,
    builtinWebSearchTransport,
  );
  if (normalizedType) {
    record.type = normalizedType;
    return omitUndefined(record);
  }
  if (isBuiltinToolType(rawType)) {
    return undefined;
  }
  if (rawType === 'function') {
    const functionName = shortenToolName(
      flattenNamespaceToolName(
        normalizeString(record.namespace) || normalizeString(record.function?.namespace),
        normalizeString(record.name) || normalizeString(record.function?.name),
      ),
      toolNameMap,
    );
    if (!functionName) {
      return undefined;
    }
    return {
      type: 'function',
      function: {
        name: functionName,
      },
    };
  }

  if (rawType === 'custom') {
    const customName = normalizeString(record.name) || normalizeString(record.custom?.name);
    const functionName = shortenToolName(
      customName === APPLY_PATCH_TOOL_NAME
        ? applyPatchProxyToolName('batch')
        : customName,
      toolNameMap,
    );
    if (!functionName) {
      return undefined;
    }
    return {
      type: 'function',
      function: {
        name: functionName,
      },
    };
  }

  if (rawType === 'allowed_tools') {
    record.tools = normalizeArray(record.tools)
      .map((tool) => convertResponsesToolToChatTool(
        tool,
        providerKind,
        providerCapabilities,
        toolNameMap,
        builtinWebSearchTransport,
        adapterEmulatedHostedTools,
      ))
      .filter(Boolean);
    if (record.tools.length === 0) {
      return undefined;
    }
  }
  return omitUndefined(record);
}
