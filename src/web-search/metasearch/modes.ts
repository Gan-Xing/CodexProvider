import type {
  CodexProviderSearchMode,
} from './types.js';

export const CODEX_PROVIDER_SEARCH_MODES: CodexProviderSearchMode[] = [
  'fast',
  'any',
  'balanced',
  'exhaustive',
];

export function normalizeCodexProviderSearchMode(
  value: unknown,
  fallback: CodexProviderSearchMode = 'balanced',
): CodexProviderSearchMode {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CODEX_PROVIDER_SEARCH_MODES.includes(normalized as CodexProviderSearchMode)
    ? normalized as CodexProviderSearchMode
    : fallback;
}
