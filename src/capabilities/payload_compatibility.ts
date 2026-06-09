import type {
  JsonRecord,
  OpenAICompatiblePayloadCompatibility,
  OpenAICompatiblePayloadRule,
} from './thinking_policy.js';
import {
  normalizeString,
} from './thinking_policy_utils.js';

export function stripThinkingConfig(target: JsonRecord, paths: string[]): JsonRecord {
  for (const path of paths) {
    deleteNestedPath(target, path);
  }
  return target;
}

export function applyPayloadParams(target: JsonRecord, params: Record<string, unknown> | undefined): void {
  if (!params || typeof params !== 'object') {
    return;
  }
  for (const [path, value] of Object.entries(params)) {
    if (!path || value === undefined) {
      continue;
    }
    setNestedPath(target, path, cloneJson(value));
  }
}

export function mergePayloadCompatibility(
  previous: OpenAICompatiblePayloadCompatibility | null | undefined,
  next: OpenAICompatiblePayloadCompatibility,
): OpenAICompatiblePayloadCompatibility {
  const nextRecord = next as Record<string, unknown>;
  return {
    default: [...(previous?.default ?? []), ...(Array.isArray(next.default) ? next.default : [])],
    defaultRaw: [
      ...(previous?.defaultRaw ?? []),
      ...(Array.isArray(next.defaultRaw) ? next.defaultRaw : []),
      ...(Array.isArray(nextRecord['default-raw']) ? nextRecord['default-raw'] as OpenAICompatiblePayloadRule[] : []),
    ],
    override: [...(previous?.override ?? []), ...(Array.isArray(next.override) ? next.override : [])],
    overrideRaw: [
      ...(previous?.overrideRaw ?? []),
      ...(Array.isArray(next.overrideRaw) ? next.overrideRaw : []),
      ...(Array.isArray(nextRecord['override-raw']) ? nextRecord['override-raw'] as OpenAICompatiblePayloadRule[] : []),
    ],
    filter: [...(previous?.filter ?? []), ...(Array.isArray(next.filter) ? next.filter : [])],
  };
}

export function normalizePayloadParams(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return { ...(value as Record<string, unknown>) };
}

export function normalizeRetryStatuses(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const statuses = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 100 && entry <= 599);
  return statuses.length > 0 ? [...new Set(statuses)] : null;
}

export function normalizeBuiltinWebSearchTransport(
  value: unknown,
): 'openai_tool' | 'chat_enable_search' | undefined {
  const normalized = normalizeString(value);
  switch (normalized) {
    case 'openai_tool':
    case 'chat_enable_search':
      return normalized;
    default:
      return undefined;
  }
}

function deleteNestedPath(target: JsonRecord, path: string) {
  if (!target || typeof target !== 'object') {
    return;
  }
  const segments = String(path ?? '')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return;
  }
  let current: any = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!current || typeof current !== 'object') {
      return;
    }
    current = current[segment];
  }
  if (!current || typeof current !== 'object') {
    return;
  }
  delete current[segments.at(-1) as string];
}

export function setNestedPath(target: JsonRecord, path: string, value: unknown) {
  const segments = String(path ?? '')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return;
  }
  let current: any = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[segments.at(-1) as string] = value;
}

function cloneJson<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
