import type {
  CodexProviderToolStrategy,
} from './types.js';
import {
  defaultCodexProviderBuiltinEmulatedToolName,
  normalizeCodexProviderBuiltinToolName,
  type CodexProviderBuiltinToolName,
} from './builtin-tools/index.js';

export type CodexProviderHostedToolName =
  | CodexProviderBuiltinToolName
  | 'web_search_preview'
  | 'web_search_preview_2025_03_11'
  | 'computer_use'
  | 'computer_use_preview'
  | `custom:${string}`;

export type CodexProviderHostedToolMode =
  | 'provider-native'
  | 'adapter-emulated';

export interface CodexProviderHostedToolDeclaration {
  name: CodexProviderHostedToolName;
  mode: CodexProviderHostedToolMode;
  providerToolName?: string | null;
  emulatedToolName?: string | null;
  description?: string | null;
}

export interface NormalizedCodexProviderHostedToolDeclaration {
  name: CodexProviderHostedToolName;
  mode: CodexProviderHostedToolMode;
  providerToolName: string | null;
  emulatedToolName: string | null;
  description: string | null;
}

export function normalizeCodexProviderHostedTools(
  declarations: CodexProviderHostedToolDeclaration[] | null | undefined,
): NormalizedCodexProviderHostedToolDeclaration[] {
  if (!Array.isArray(declarations)) {
    return [];
  }
  return declarations.map((declaration) => normalizeHostedToolDeclaration(declaration));
}

export function assertHostedToolDeclarationsForStrategy(
  toolStrategy: CodexProviderToolStrategy,
  hostedTools: NormalizedCodexProviderHostedToolDeclaration[],
): void {
  if (toolStrategy === 'codex-local-first') {
    return;
  }
  if (hostedTools.length === 0) {
    throw new Error(`${toolStrategy} requires at least one explicit hosted tool declaration.`);
  }
  for (const hostedTool of hostedTools) {
    if (hostedTool.mode !== toolStrategy) {
      throw new Error(`Hosted tool ${hostedTool.name} declares ${hostedTool.mode}, but profile strategy is ${toolStrategy}.`);
    }
  }
}

function normalizeHostedToolDeclaration(
  declaration: CodexProviderHostedToolDeclaration,
): NormalizedCodexProviderHostedToolDeclaration {
  if (!declaration || typeof declaration !== 'object') {
    throw new Error('Hosted tool declaration must be an object.');
  }
  const name = normalizeHostedToolName(declaration.name);
  const mode = normalizeHostedToolMode(declaration.mode);
  const providerToolName = normalizeString(declaration.providerToolName) || (mode === 'provider-native' ? name : '');
  const emulatedToolName = normalizeString(declaration.emulatedToolName)
    || (mode === 'adapter-emulated' ? defaultHostedEmulatedToolName(name) : '');
  return {
    name,
    mode,
    providerToolName: providerToolName || null,
    emulatedToolName: emulatedToolName || null,
    description: normalizeString(declaration.description) || null,
  };
}

function normalizeHostedToolName(name: unknown): CodexProviderHostedToolName {
  const normalized = normalizeString(name);
  const builtinName = normalizeCodexProviderBuiltinToolName(normalized);
  if (builtinName) {
    return builtinName;
  }
  if (/^custom:[A-Za-z0-9_.-]+$/u.test(normalized)) {
    return normalized as `custom:${string}`;
  }
  throw new Error(`Unsupported hosted tool name: ${String(name)}`);
}

function defaultHostedEmulatedToolName(name: CodexProviderHostedToolName): string {
  return name.startsWith('custom:')
    ? name.slice('custom:'.length)
    : defaultCodexProviderBuiltinEmulatedToolName(name);
}

function normalizeHostedToolMode(mode: unknown): CodexProviderHostedToolMode {
  if (mode === 'provider-native' || mode === 'adapter-emulated') {
    return mode;
  }
  throw new Error(`Unsupported hosted tool mode: ${String(mode)}`);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
