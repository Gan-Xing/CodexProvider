import {
  normalizeCodexProviderBuiltinToolName,
} from '../../builtin-tools/index.js';
import type {
  AdapterHostedToolExecutionRecord,
  JsonRecord,
} from './types.js';
import {
  normalizeArray,
  normalizeString,
  omitUndefined,
} from './utils.js';

export function appendDeferredToolsFromToolSearch(
  chatBody: JsonRecord,
  execution: AdapterHostedToolExecutionRecord,
): void {
  if (normalizeCodexProviderBuiltinToolName(execution.toolName) !== 'tool_search') {
    return;
  }
  const deferredTools = normalizeDeferredToolSearchChatTools(execution.resultContent);
  if (deferredTools.length === 0) {
    return;
  }
  const existingTools = Array.isArray(chatBody.tools) ? chatBody.tools : [];
  const existingNames = new Set(
    existingTools
      .map((tool) => normalizeString((tool as JsonRecord | null | undefined)?.function?.name))
      .filter(Boolean),
  );
  const nextTools = [...existingTools];
  for (const tool of deferredTools) {
    const name = normalizeString(tool.function?.name);
    if (!name || existingNames.has(name)) {
      continue;
    }
    existingNames.add(name);
    nextTools.push(tool);
  }
  chatBody.tools = nextTools;
  delete chatBody.tool_choice;
}

function normalizeDeferredToolSearchChatTools(value: unknown): JsonRecord[] {
  const payload = unwrapDeferredToolSearchPayload(value);
  if (!payload) {
    return [];
  }
  const tools = normalizeArray(payload.tools)
    .map((tool) => normalizeDeferredChatFunctionTool(tool))
    .filter(Boolean) as JsonRecord[];
  const namespaceTools = normalizeArray(payload.namespaces)
    .flatMap((namespace) => normalizeDeferredNamespaceChatFunctionTools(namespace));
  return dedupeDeferredChatFunctionTools([...tools, ...namespaceTools]);
}

function unwrapDeferredToolSearchPayload(value: unknown): JsonRecord | null {
  if (typeof value === 'string') {
    try {
      return unwrapDeferredToolSearchPayload(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as JsonRecord;
  if (Array.isArray(record.tools) || Array.isArray(record.namespaces)) {
    return record;
  }
  if (record.content && typeof record.content === 'object') {
    return unwrapDeferredToolSearchPayload(record.content);
  }
  return null;
}

function normalizeDeferredNamespaceChatFunctionTools(value: unknown): JsonRecord[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const namespace = value as JsonRecord;
  const namespaceName = normalizeString(namespace.name);
  return normalizeArray(namespace.tools)
    .map((tool) => normalizeDeferredChatFunctionTool(tool, namespaceName))
    .filter(Boolean) as JsonRecord[];
}

function normalizeDeferredChatFunctionTool(value: unknown, namespace = ''): JsonRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as JsonRecord;
  const functionRecord = record.function && typeof record.function === 'object'
    ? record.function as JsonRecord
    : record;
  const rawName = normalizeString(functionRecord.name ?? record.name);
  const name = namespace ? `${namespace}${rawName}` : rawName;
  if (!isValidDeferredChatFunctionName(name)) {
    return null;
  }
  return {
    type: 'function',
    function: omitUndefined({
      name,
      description: normalizeString(functionRecord.description ?? record.description) || undefined,
      parameters: normalizeDeferredToolParameters(functionRecord.parameters ?? record.parameters),
      strict: functionRecord.strict ?? record.strict,
    }),
  };
}

function normalizeDeferredToolParameters(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {
    type: 'object',
    properties: {},
    additionalProperties: true,
  };
}

function dedupeDeferredChatFunctionTools(tools: JsonRecord[]): JsonRecord[] {
  const seen = new Set<string>();
  const deduped: JsonRecord[] = [];
  for (const tool of tools) {
    const name = normalizeString(tool.function?.name);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    deduped.push(tool);
  }
  return deduped;
}

function isValidDeferredChatFunctionName(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/u.test(value);
}
