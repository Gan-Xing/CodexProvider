import type {
  OpenAICompatiblePayloadRule,
  OpenAICompatibleProviderCapabilities,
} from '../../../capabilities/thinking_policy.js';
import type {
  JsonRecord,
} from '../types.js';
import {
  cloneJson,
  omitUndefined,
} from '../shared/json.js';
import {
  normalizeNumber,
} from '../shared/numbers.js';
import {
  normalizeString,
} from '../shared/strings.js';

export function inspectOpenAICompatiblePayloadCompatibility(
  {
    model,
    protocol,
    providerCapabilities,
  }: {
    model: string;
    protocol?: string | null;
    providerCapabilities: OpenAICompatibleProviderCapabilities | null | undefined;
  },
): {
  upstreamModel: string;
  filteredPaths: string[];
  maxOutputTokens: number | null;
} {
  const normalizedModel = normalizeString(model);
  const probe: JsonRecord = { model: normalizedModel };
  const filteredPaths = applyOpenAICompatiblePayloadRules(probe, {
    model: normalizedModel,
    protocol,
    providerCapabilities,
  });
  return {
    upstreamModel: normalizeString(probe.model) || normalizedModel,
    filteredPaths,
    maxOutputTokens: resolveModelMaxOutputTokens(providerCapabilities, normalizedModel),
  };
}

export function applyOpenAICompatiblePayloadCompatibility(
  chat: JsonRecord,
  {
    model,
    protocol,
    providerCapabilities,
  }: {
    model: string;
    protocol?: string | null;
    providerCapabilities: OpenAICompatibleProviderCapabilities | null | undefined;
  },
): JsonRecord {
  applyOpenAICompatiblePayloadRules(chat, {
    model,
    protocol,
    providerCapabilities,
  });
  const maxOutputTokens = resolveModelMaxOutputTokens(providerCapabilities, model);
  if (maxOutputTokens !== null && Number(chat.max_tokens) > maxOutputTokens) {
    chat.max_tokens = maxOutputTokens;
  }
  return omitUndefined(chat);
}

function applyOpenAICompatiblePayloadRules(
  target: JsonRecord,
  {
    model,
    protocol,
    providerCapabilities,
  }: {
    model: string;
    protocol?: string | null;
    providerCapabilities: OpenAICompatibleProviderCapabilities | null | undefined;
  },
): string[] {
  const payload = providerCapabilities?.payload;
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  for (const rule of payloadRuleList(payload, 'default')) {
    if (payloadRuleMatchesModel(rule, model, protocol)) {
      applyPayloadParams(target, rule.params, false, rule.root);
    }
  }
  for (const rule of payloadRuleList(payload, 'defaultRaw', 'default-raw')) {
    if (payloadRuleMatchesModel(rule, model, protocol)) {
      applyPayloadParams(target, rule.params, false, rule.root, true);
    }
  }
  for (const rule of payloadRuleList(payload, 'override')) {
    if (payloadRuleMatchesModel(rule, model, protocol)) {
      applyPayloadParams(target, rule.params, true, rule.root);
    }
  }
  for (const rule of payloadRuleList(payload, 'overrideRaw', 'override-raw')) {
    if (payloadRuleMatchesModel(rule, model, protocol)) {
      applyPayloadParams(target, rule.params, true, rule.root, true);
    }
  }

  const filteredPaths: string[] = [];
  for (const rule of payloadRuleList(payload, 'filter')) {
    if (!payloadRuleMatchesModel(rule, model, protocol)) {
      continue;
    }
    for (const path of payloadFilterPaths(rule)) {
      filteredPaths.push(path);
      deleteNestedPath(target, path);
    }
  }

  return [...new Set(filteredPaths)];
}

function payloadRuleList(
  payload: OpenAICompatibleProviderCapabilities['payload'],
  key: keyof NonNullable<OpenAICompatibleProviderCapabilities['payload']>,
  alternateKey?: string,
): OpenAICompatiblePayloadRule[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const primary = payload[key];
  if (Array.isArray(primary)) {
    return primary;
  }
  if (alternateKey) {
    const alternate = (payload as JsonRecord)[alternateKey];
    if (Array.isArray(alternate)) {
      return alternate;
    }
  }
  return [];
}

function applyPayloadParams(
  target: JsonRecord,
  params: Record<string, unknown> | string[] | undefined,
  overwrite: boolean,
  root?: string | null,
  raw = false,
): void {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return;
  }
  for (const [path, value] of Object.entries(params)) {
    if (!path || value === undefined) {
      continue;
    }
    const fullPath = buildPayloadPath(root, path);
    if (!fullPath) {
      continue;
    }
    if (!overwrite && getNestedPath(target, fullPath) !== undefined) {
      continue;
    }
    const nextValue = raw ? normalizeRawPayloadValue(value) : cloneJson(value);
    if (nextValue === undefined) {
      continue;
    }
    setNestedPath(target, fullPath, nextValue);
  }
}

function payloadFilterPaths(rule: OpenAICompatiblePayloadRule): string[] {
  const rawPaths = Array.isArray(rule.paths)
    ? rule.paths
    : Array.isArray(rule.params)
      ? rule.params
      : [];
  return rawPaths
    .map((path) => buildPayloadPath(rule.root, path))
    .filter(Boolean);
}

function payloadRuleMatchesModel(
  rule: OpenAICompatiblePayloadRule,
  model: string,
  protocol?: string | null,
): boolean {
  const patterns = Array.isArray(rule.models)
    ? rule.models.map((entry) => payloadModelRulePattern(entry, protocol)).filter(Boolean)
    : [];
  if (patterns.length === 0) {
    return true;
  }
  const normalizedModel = normalizeString(model).toLowerCase();
  return patterns.some((pattern) => matchesModelPattern(normalizedModel, pattern));
}

function payloadModelRulePattern(entry: unknown, protocol?: string | null): string {
  if (typeof entry === 'string') {
    return normalizeString(entry);
  }
  if (!entry || typeof entry !== 'object') {
    return '';
  }
  const record = entry as JsonRecord;
  const expectedProtocol = normalizeString(record.protocol).toLowerCase();
  const actualProtocol = normalizeString(protocol).toLowerCase();
  if (expectedProtocol && actualProtocol && expectedProtocol !== actualProtocol) {
    return '';
  }
  return normalizeString(record.name);
}

function buildPayloadPath(root: unknown, path: unknown): string {
  const normalizedRoot = normalizeString(root);
  let normalizedPath = normalizeString(path);
  if (!normalizedRoot) {
    return normalizedPath;
  }
  if (!normalizedPath) {
    return normalizedRoot;
  }
  if (normalizedPath.startsWith('.')) {
    normalizedPath = normalizedPath.slice(1);
  }
  return `${normalizedRoot}.${normalizedPath}`;
}

function normalizeRawPayloadValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return cloneJson(value);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function matchesModelPattern(normalizedModel: string, pattern: string): boolean {
  const normalizedPattern = normalizeString(pattern).toLowerCase();
  if (!normalizedPattern || normalizedPattern === '*') {
    return true;
  }
  if (!normalizedPattern.includes('*')) {
    return normalizedModel === normalizedPattern;
  }
  const escaped = normalizedPattern
    .split('*')
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'u').test(normalizedModel);
}

function resolveModelMaxOutputTokens(
  providerCapabilities: OpenAICompatibleProviderCapabilities | null | undefined,
  model: string,
): number | null {
  const normalizedModel = normalizeString(model).toLowerCase();
  const catalog = providerCapabilities?.modelCapabilities;
  if (!catalog || typeof catalog !== 'object' || !normalizedModel) {
    return null;
  }
  for (const [key, value] of Object.entries(catalog)) {
    if (normalizeString(key).toLowerCase() !== normalizedModel || !value || typeof value !== 'object') {
      continue;
    }
    const maxOutputTokens = normalizeNumber((value as JsonRecord).maxOutputTokens);
    return maxOutputTokens !== null && maxOutputTokens > 0 ? maxOutputTokens : null;
  }
  return null;
}

function getNestedPath(target: JsonRecord, path: string): unknown {
  const segments = normalizePathSegments(path);
  let current: any = target;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setNestedPath(target: JsonRecord, path: string, value: unknown): void {
  const segments = normalizePathSegments(path);
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

function deleteNestedPath(target: JsonRecord, path: string): void {
  const segments = normalizePathSegments(path);
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
  if (current && typeof current === 'object') {
    delete current[segments.at(-1) as string];
  }
}

function normalizePathSegments(path: string): string[] {
  return String(path ?? '')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
}
