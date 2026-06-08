import {
  CODEX_PROVIDER_BUILTIN_TOOL_ALIASES,
  CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS,
} from './catalog.js';
import type {
  CodexProviderBuiltinToolDefinition,
  CodexProviderBuiltinToolName,
  JsonRecord,
} from './types.js';

export function normalizeCodexProviderBuiltinToolName(
  value: unknown,
): CodexProviderBuiltinToolName | null {
  const normalized = normalizeString(value);
  return CODEX_PROVIDER_BUILTIN_TOOL_ALIASES[normalized] ?? null;
}

export function getCodexProviderBuiltinToolDefinition(
  value: unknown,
): CodexProviderBuiltinToolDefinition | null {
  const name = normalizeCodexProviderBuiltinToolName(value);
  return name ? CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS[name] : null;
}

export function isCodexProviderBuiltinToolType(value: unknown): boolean {
  return Boolean(normalizeCodexProviderBuiltinToolName(value));
}

export function isCodexProviderAdapterEmulatedBuiltinToolType(value: unknown): boolean {
  return Boolean(getCodexProviderBuiltinToolDefinition(value)?.adapterEmulatedSupported);
}

export function isCodexProviderProviderNativeBuiltinToolType(value: unknown): boolean {
  return Boolean(getCodexProviderBuiltinToolDefinition(value)?.providerNativeSupported);
}

export function isCodexProviderUnsafeBuiltinToolType(value: unknown): boolean {
  return Boolean(getCodexProviderBuiltinToolDefinition(value)?.unsafeByDefault);
}

export function defaultCodexProviderBuiltinToolDescription(value: unknown): string {
  return getCodexProviderBuiltinToolDefinition(value)?.description
    ?? 'Execute an adapter-hosted built-in tool.';
}

export function codexProviderBuiltinToolParameters(value: unknown): JsonRecord {
  return getCodexProviderBuiltinToolDefinition(value)?.parameters
    ?? {
      type: 'object',
      properties: {},
      additionalProperties: true,
    };
}

export function defaultCodexProviderBuiltinEmulatedToolName(value: unknown): string {
  return getCodexProviderBuiltinToolDefinition(value)?.defaultEmulatedToolName
    ?? normalizeString(value);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
