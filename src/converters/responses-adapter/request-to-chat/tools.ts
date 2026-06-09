import type {
  OpenAICompatibleProviderCapabilities,
} from '../../../capabilities/thinking_policy.js';
import type {
  NormalizedCodexProviderHostedToolDeclaration,
} from '../../../hosted_tools.js';
import {
  codexProviderBuiltinToolParameters,
  defaultCodexProviderBuiltinToolDescription,
  isCodexProviderAdapterEmulatedBuiltinToolType,
  normalizeCodexProviderBuiltinToolName,
} from '../../../builtin-tools/index.js';
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

export function supportsToolCalling(
  providerCapabilities: OpenAICompatibleProviderCapabilities | null | undefined,
): boolean {
  return providerCapabilities?.supportsTools !== false;
}

export function convertResponsesToolToChatTool(
  tool: JsonRecord,
  providerKind?: string | null,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null = null,
  toolNameMap: ToolNameMap = new Map(),
  builtinWebSearchTransport: 'openai_tool' | 'chat_enable_search' = 'openai_tool',
  adapterEmulatedHostedTools: AdapterEmulatedHostedToolMap = new Map(),
): JsonRecord | null {
  if (!tool || typeof tool !== 'object') {
    return null;
  }
  const type = normalizeString(tool.type);
  const adapterHostedTool = adapterEmulatedHostedTools.get(normalizeAdapterHostedToolBuiltinType(type));
  if (isAdapterHostedBuiltinToolType(type) && adapterHostedTool) {
    return buildAdapterEmulatedHostedChatTool(tool, adapterHostedTool);
  }
  const normalizedBuiltinType = normalizeBuiltinToolType(
    type,
    providerKind,
    providerCapabilities,
    builtinWebSearchTransport,
  );
  if (normalizedBuiltinType) {
    return omitUndefined({
      ...tool,
      type: normalizedBuiltinType,
    });
  }
  if (type !== 'function') {
    return null;
  }
  return {
    type: 'function',
    function: omitUndefined({
      name: shortenToolName(normalizeString(tool.name), toolNameMap),
      description: normalizeString(tool.description),
      parameters: tool.parameters ?? {},
      strict: tool.strict,
    }),
  };
}

export function convertResponsesTextFormatToChatResponseFormat(textConfig: unknown): JsonRecord | null {
  if (!textConfig || typeof textConfig !== 'object') {
    return null;
  }
  const format = (textConfig as JsonRecord).format;
  if (!format || typeof format !== 'object') {
    return null;
  }
  const type = normalizeString((format as JsonRecord).type);
  if (type === 'text') {
    return { type: 'text' };
  }
  if (type === 'json_schema') {
    const schema = (format as JsonRecord).schema;
    return omitUndefined({
      type: 'json_schema',
      json_schema: omitUndefined({
        name: normalizeString((format as JsonRecord).name) || 'response',
        strict: (format as JsonRecord).strict,
        schema: schema ?? {},
      }),
    });
  }
  return null;
}

export function normalizeBuiltinToolType(
  type: unknown,
  providerKind?: string | null,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null = null,
  builtinWebSearchTransport: 'openai_tool' | 'chat_enable_search' = 'openai_tool',
): string {
  if (builtinWebSearchTransport === 'chat_enable_search') {
    return '';
  }
  if (!supportsBuiltinWebSearchTool(providerKind, providerCapabilities)) {
    return '';
  }
  switch (normalizeString(type)) {
    case 'web_search':
    case 'web_search_preview':
    case 'web_search_preview_2025_03_11':
      return 'web_search';
    default:
      return '';
  }
}

export function convertResponsesBuiltinToolToChatTool(
  tool: JsonRecord,
  providerKind?: string | null,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null = null,
  builtinWebSearchTransport: 'openai_tool' | 'chat_enable_search' = 'openai_tool',
  adapterEmulatedHostedTools: AdapterEmulatedHostedToolMap = new Map(),
): JsonRecord | null {
  if (!tool || typeof tool !== 'object') {
    return null;
  }
  const adapterHostedTool = adapterEmulatedHostedTools.get(normalizeAdapterHostedToolBuiltinType(tool.type));
  if (isAdapterHostedBuiltinToolType(tool.type) && adapterHostedTool) {
    return buildAdapterEmulatedHostedChatTool(tool, adapterHostedTool);
  }
  const normalizedBuiltinType = normalizeBuiltinToolType(
    tool.type,
    providerKind,
    providerCapabilities,
    builtinWebSearchTransport,
  );
  return normalizedBuiltinType
    ? omitUndefined({
      ...tool,
      type: normalizedBuiltinType,
    })
    : null;
}

export function resolveAdapterEmulatedHostedTools(
  hostedTools: NormalizedCodexProviderHostedToolDeclaration[] | null | undefined,
): AdapterEmulatedHostedToolMap {
  const resolved: AdapterEmulatedHostedToolMap = new Map();
  if (!Array.isArray(hostedTools)) {
    return resolved;
  }
  for (const tool of hostedTools) {
    if (
      tool?.mode !== 'adapter-emulated'
      || !normalizeString(tool.emulatedToolName || tool.name)
      || !isAdapterHostedBuiltinToolType(tool.name)
    ) {
      continue;
    }
    resolved.set(tool.name, tool);
  }
  return resolved;
}

function buildAdapterEmulatedHostedChatTool(
  tool: JsonRecord,
  declaration: NormalizedCodexProviderHostedToolDeclaration,
): JsonRecord {
  const emulatedToolName = normalizeString(declaration.emulatedToolName) || declaration.name;
  return {
    type: 'function',
    function: omitUndefined({
      name: emulatedToolName,
      description: normalizeString(declaration.description)
        || normalizeString(tool.description)
        || defaultAdapterHostedToolDescription(declaration.name),
      parameters: adapterHostedToolParameters(declaration.name),
    }),
  };
}

function defaultAdapterHostedToolDescription(name: string): string {
  return defaultCodexProviderBuiltinToolDescription(name);
}

function adapterHostedToolParameters(name: string): JsonRecord {
  return codexProviderBuiltinToolParameters(name);
}

export function buildForcedFunctionToolChoice(functionName: string): JsonRecord {
  return {
    type: 'function',
    function: {
      name: functionName,
    },
  };
}

export function isBuiltinToolType(type: unknown): boolean {
  const normalizedName = normalizeCodexProviderBuiltinToolName(type);
  return normalizedName === 'web_search' || normalizedName === 'file_search';
}

export function isAdapterHostedBuiltinToolType(type: unknown): boolean {
  return isCodexProviderAdapterEmulatedBuiltinToolType(type);
}

export function normalizeAdapterHostedToolBuiltinType(type: unknown): string {
  return normalizeCodexProviderBuiltinToolName(type) ?? normalizeString(type);
}

function supportsBuiltinWebSearchTool(
  providerKind?: string | null,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null = null,
): boolean {
  void providerKind;
  if (providerCapabilities?.supportsBuiltinWebSearchTool !== undefined) {
    return Boolean(providerCapabilities.supportsBuiltinWebSearchTool);
  }
  return true;
}

export function resolveBuiltinWebSearchTransport(
  providerCapabilities: OpenAICompatibleProviderCapabilities | null,
): 'openai_tool' | 'chat_enable_search' {
  return providerCapabilities?.builtinWebSearchTransport === 'chat_enable_search'
    ? 'chat_enable_search'
    : 'openai_tool';
}

export function requestUsesBuiltinWebSearch(request: JsonRecord): boolean {
  if (normalizeArray(request?.tools).some((tool) => isBuiltinWebSearchToolType(tool?.type))) {
    return true;
  }
  const toolChoice = request?.tool_choice;
  if (typeof toolChoice === 'string') {
    return isBuiltinWebSearchToolType(toolChoice);
  }
  if (toolChoice && typeof toolChoice === 'object') {
    if (isBuiltinWebSearchToolType((toolChoice as JsonRecord).type)) {
      return true;
    }
    if (normalizeString((toolChoice as JsonRecord).type) === 'allowed_tools') {
      return normalizeArray((toolChoice as JsonRecord).tools).some((tool) => isBuiltinWebSearchToolType(tool?.type));
    }
  }
  return false;
}

function isBuiltinWebSearchToolType(type: unknown): boolean {
  return normalizeCodexProviderBuiltinToolName(type) === 'web_search';
}
