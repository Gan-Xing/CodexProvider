import type {
  CodexProviderHostedToolExecutionRequest,
  CodexProviderHostedToolExecutionResult,
  CodexProviderHostedToolExecutor,
  JsonRecord,
} from './hosted_tool_executors.js';

export interface CodexProviderToolSearchExecutorOptions {
  tools?: JsonRecord[] | null;
  namespaces?: JsonRecord[] | null;
  maxResults?: number | null;
  search?: CodexProviderToolSearchResolver | null;
}

export interface CodexProviderToolSearchRequest {
  query: string;
  goal: string;
  maxResults: number;
  availableTools: JsonRecord[];
  availableNamespaces: JsonRecord[];
  toolRequest: CodexProviderHostedToolExecutionRequest;
}

export interface CodexProviderToolSearchResult {
  tools?: JsonRecord[] | null;
  namespaces?: JsonRecord[] | null;
  metadata?: JsonRecord | null;
}

export type CodexProviderToolSearchResolver = (
  request: CodexProviderToolSearchRequest,
) => CodexProviderToolSearchResult | Promise<CodexProviderToolSearchResult>;

export interface CodexProviderToolSearchExecutorContent {
  query: string;
  goal: string;
  tools: JsonRecord[];
  namespaces: JsonRecord[];
  returned_at: string;
}

export function createCodexProviderToolSearchExecutor(
  options: CodexProviderToolSearchExecutorOptions = {},
): CodexProviderHostedToolExecutor {
  const configuredTools = normalizeToolSearchTools(options.tools);
  const configuredNamespaces = normalizeToolSearchNamespaces(options.namespaces);
  const maxResults = clampInteger(options.maxResults, 1, 100, 20);
  const resolver = typeof options.search === 'function' ? options.search : null;

  return async (
    request: CodexProviderHostedToolExecutionRequest,
  ): Promise<CodexProviderHostedToolExecutionResult> => {
    const normalizedRequest = normalizeToolSearchRequest(
      request,
      configuredTools,
      configuredNamespaces,
      maxResults,
    );
    const result = resolver
      ? await resolver(normalizedRequest)
      : searchStaticToolDefinitions(normalizedRequest);
    const tools = normalizeToolSearchTools(result.tools)
      .slice(0, normalizedRequest.maxResults);
    const namespaces = normalizeToolSearchNamespaces(result.namespaces);

    return {
      content: {
        query: normalizedRequest.query,
        goal: normalizedRequest.goal,
        tools,
        namespaces,
        returned_at: new Date().toISOString(),
      } satisfies CodexProviderToolSearchExecutorContent,
      metadata: {
        toolCount: tools.length,
        namespaceCount: namespaces.length,
        ...(result.metadata && typeof result.metadata === 'object' ? result.metadata : {}),
      },
    };
  };
}

function normalizeToolSearchRequest(
  request: CodexProviderHostedToolExecutionRequest,
  configuredTools: JsonRecord[],
  configuredNamespaces: JsonRecord[],
  fallbackMaxResults: number,
): CodexProviderToolSearchRequest {
  const args = request.arguments ?? {};
  return {
    query: firstNonEmptyString([args.query, args.q, args.search_query, args.input]),
    goal: firstNonEmptyString([args.goal, args.task, args.objective]),
    maxResults: clampInteger(
      args.max_results ?? args.max_num_results ?? args.limit,
      1,
      100,
      fallbackMaxResults,
    ),
    availableTools: [
      ...configuredTools,
      ...normalizeToolSearchTools(args.availableTools ?? args.available_tools ?? args.tools),
    ],
    availableNamespaces: [
      ...configuredNamespaces,
      ...normalizeToolSearchNamespaces(args.availableNamespaces ?? args.available_namespaces ?? args.namespaces),
    ],
    toolRequest: request,
  };
}

function searchStaticToolDefinitions(
  request: CodexProviderToolSearchRequest,
): CodexProviderToolSearchResult {
  const searchText = `${request.query} ${request.goal}`.trim().toLowerCase();
  const directTools = request.availableTools
    .filter((tool) => toolMatchesSearchText(tool, searchText))
    .slice(0, request.maxResults);
  const namespaces = request.availableNamespaces
    .map((namespace) => filterNamespaceTools(namespace, searchText, request.maxResults))
    .filter(Boolean) as JsonRecord[];
  return {
    tools: directTools,
    namespaces,
  };
}

function filterNamespaceTools(namespace: JsonRecord, searchText: string, maxResults: number): JsonRecord | null {
  const namespaceName = normalizeString(namespace.name);
  const namespaceDescription = normalizeString(namespace.description);
  const namespaceMatches = textMatchesSearchText(`${namespaceName} ${namespaceDescription}`, searchText);
  const tools = normalizeToolSearchTools(namespace.tools)
    .filter((tool) => namespaceMatches || toolMatchesSearchText(tool, searchText))
    .slice(0, maxResults);
  if (tools.length === 0) {
    return null;
  }
  return {
    type: 'namespace',
    name: namespaceName,
    description: namespaceDescription || undefined,
    tools,
  };
}

function normalizeToolSearchTools(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeToolSearchTool)
    .filter(Boolean) as JsonRecord[];
}

function normalizeToolSearchTool(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as JsonRecord;
  if (normalizeString(record.type) === 'namespace') {
    return null;
  }
  const functionRecord = record.function && typeof record.function === 'object'
    ? record.function as JsonRecord
    : record;
  const name = normalizeString(functionRecord.name ?? record.name);
  if (!isValidChatFunctionName(name)) {
    return null;
  }
  return {
    type: 'function',
    function: omitUndefined({
      name,
      description: normalizeString(functionRecord.description ?? record.description) || undefined,
      parameters: normalizeParameters(functionRecord.parameters ?? record.parameters),
      strict: functionRecord.strict ?? record.strict,
    }),
  };
}

function normalizeToolSearchNamespaces(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeToolSearchNamespace)
    .filter(Boolean) as JsonRecord[];
}

function normalizeToolSearchNamespace(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as JsonRecord;
  const name = normalizeString(record.name);
  if (!isValidChatFunctionName(name)) {
    return null;
  }
  const tools = normalizeToolSearchTools(record.tools);
  if (tools.length === 0) {
    return null;
  }
  return {
    type: 'namespace',
    name,
    description: normalizeString(record.description) || undefined,
    tools,
  };
}

function toolMatchesSearchText(tool: JsonRecord, searchText: string): boolean {
  const functionRecord = tool.function && typeof tool.function === 'object'
    ? tool.function as JsonRecord
    : tool;
  return textMatchesSearchText([
    normalizeString(functionRecord.name),
    normalizeString(functionRecord.description),
    JSON.stringify(functionRecord.parameters ?? {}),
  ].join(' '), searchText);
}

function textMatchesSearchText(value: string, searchText: string): boolean {
  if (!searchText) {
    return true;
  }
  const haystack = value.toLowerCase();
  return searchText
    .split(/\s+/u)
    .filter(Boolean)
    .some((term) => haystack.includes(term));
}

function normalizeParameters(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {
    type: 'object',
    properties: {},
    additionalProperties: true,
  };
}

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidChatFunctionName(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/u.test(value);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function omitUndefined<T extends JsonRecord>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as T;
}
