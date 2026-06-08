import type {
  CodexProviderHostedToolName,
} from './hosted_tools.js';
import {
  normalizeCodexProviderBuiltinToolName,
} from './builtin-tools/index.js';

export type JsonRecord = Record<string, any>;

export interface CodexProviderHostedToolExecutionRequest {
  toolName: CodexProviderHostedToolName;
  emulatedToolName: string;
  callId: string;
  arguments: JsonRecord;
  rawArguments: string;
  model: string | null;
  providerKind: string | null;
  providerName: string | null;
  emitDelta?: CodexProviderHostedToolDeltaEmitter | null;
}

export interface CodexProviderHostedToolExecutionResult {
  content: unknown;
  metadata?: JsonRecord | null;
}

export type CodexProviderHostedToolDeltaEmitter = (
  delta: unknown,
  metadata?: JsonRecord | null,
) => void | Promise<void>;

export type CodexProviderHostedToolExecutor = (
  request: CodexProviderHostedToolExecutionRequest,
) => CodexProviderHostedToolExecutionResult | Promise<CodexProviderHostedToolExecutionResult>;

export interface CodexProviderHostedToolExecutorRegistration {
  toolName: CodexProviderHostedToolName;
  executor: CodexProviderHostedToolExecutor;
}

export type CodexProviderHostedToolExecutorRegistryInput =
  | CodexProviderHostedToolExecutorRegistry
  | CodexProviderHostedToolExecutorRegistration[]
  | Record<string, CodexProviderHostedToolExecutor>
  | null
  | undefined;

export class CodexProviderHostedToolExecutorRegistry {
  private readonly executors = new Map<string, CodexProviderHostedToolExecutor>();

  register(
    toolName: CodexProviderHostedToolName,
    executor: CodexProviderHostedToolExecutor,
  ): this {
    const normalizedName = normalizeHostedToolExecutorName(toolName);
    if (!normalizedName) {
      throw new Error(`Invalid hosted tool executor name: ${String(toolName)}`);
    }
    if (typeof executor !== 'function') {
      throw new Error(`Hosted tool executor for ${normalizedName} must be a function.`);
    }
    this.executors.set(normalizedName, executor);
    return this;
  }

  has(toolName: CodexProviderHostedToolName): boolean {
    return this.executors.has(normalizeHostedToolExecutorName(toolName));
  }

  get(toolName: CodexProviderHostedToolName): CodexProviderHostedToolExecutor | null {
    return this.executors.get(normalizeHostedToolExecutorName(toolName)) ?? null;
  }

  async execute(
    request: CodexProviderHostedToolExecutionRequest,
  ): Promise<CodexProviderHostedToolExecutionResult> {
    const executor = this.get(request.toolName);
    if (!executor) {
      throw new Error(`No hosted tool executor registered for ${request.toolName}.`);
    }
    return normalizeHostedToolExecutionResult(await executor(request));
  }
}

export function createCodexProviderHostedToolExecutorRegistry(
  input: CodexProviderHostedToolExecutorRegistryInput = null,
): CodexProviderHostedToolExecutorRegistry {
  if (input instanceof CodexProviderHostedToolExecutorRegistry) {
    return input;
  }
  const registry = new CodexProviderHostedToolExecutorRegistry();
  if (!input) {
    return registry;
  }
  if (Array.isArray(input)) {
    for (const registration of input) {
      registry.register(registration.toolName, registration.executor);
    }
    return registry;
  }
  if (typeof input === 'object') {
    for (const [toolName, executor] of Object.entries(input)) {
      registry.register(toolName as CodexProviderHostedToolName, executor);
    }
  }
  return registry;
}

export function formatCodexProviderHostedToolExecutionResult(
  result: CodexProviderHostedToolExecutionResult,
): string {
  const normalized = normalizeHostedToolExecutionResult(result);
  if (typeof normalized.content === 'string') {
    return normalized.content;
  }
  return JSON.stringify({
    content: normalized.content ?? null,
    metadata: normalized.metadata ?? undefined,
  });
}

function normalizeHostedToolExecutionResult(value: unknown): CodexProviderHostedToolExecutionResult {
  if (value && typeof value === 'object' && 'content' in (value as JsonRecord)) {
    const record = value as JsonRecord;
    return {
      content: record.content,
      metadata: record.metadata && typeof record.metadata === 'object'
        ? record.metadata
        : null,
    };
  }
  return {
    content: value ?? null,
    metadata: null,
  };
}

function normalizeHostedToolExecutorName(value: unknown): CodexProviderHostedToolName {
  const raw = String(value ?? '').trim();
  return (normalizeCodexProviderBuiltinToolName(raw) ?? raw) as CodexProviderHostedToolName;
}
