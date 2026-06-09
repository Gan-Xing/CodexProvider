import {
  APPLY_PATCH_TOOL_NAME,
  applyPatchProxyToolName,
} from '../../apply_patch_proxy.js';
import {
  flattenNamespaceToolName,
} from '../../codex_tool_context.js';
import type {
  JsonRecord,
  ToolNameMap,
} from '../types.js';
import {
  normalizeArray,
} from './json.js';
import {
  normalizeString,
} from './strings.js';

export function buildToolNameMap(request: JsonRecord | null | undefined): ToolNameMap {
  const names = collectChatToolNamesForRequest(request);
  if (names.length === 0) {
    return new Map();
  }
  return buildShortNameMap(names);
}

function collectChatToolNamesForRequest(request: JsonRecord | null | undefined): string[] {
  const names: string[] = [];
  for (const tool of normalizeArray(request?.tools)) {
    if (typeof tool === 'string') {
      names.push(tool);
      continue;
    }
    if (!tool || typeof tool !== 'object') {
      continue;
    }
    const record = tool as JsonRecord;
    const type = normalizeString(record.type);
    if (type === 'function') {
      names.push(normalizeString(record.name) || normalizeString(record.function?.name));
      continue;
    }
    if (type === 'custom') {
      const name = normalizeString(record.name);
      if (name === APPLY_PATCH_TOOL_NAME) {
        names.push(
          applyPatchProxyToolName('add_file'),
          applyPatchProxyToolName('delete_file'),
          applyPatchProxyToolName('update_file'),
          applyPatchProxyToolName('replace_file'),
          applyPatchProxyToolName('batch'),
        );
      } else {
        names.push(name);
      }
      continue;
    }
    if (type === 'namespace') {
      const namespace = normalizeString(record.name);
      for (const child of normalizeArray(record.tools)) {
        if (normalizeString(child?.type) === 'function') {
          names.push(flattenNamespaceToolName(namespace, normalizeString(child?.name)));
        }
      }
      continue;
    }
    if (type === 'web_search' || type === 'local_shell' || type === 'computer_use') {
      names.push(normalizeString(record.name) || type);
    }
  }
  return names.filter(Boolean);
}

export function buildReverseToolNameMap(request: JsonRecord | null | undefined): ToolNameMap {
  const forward = buildToolNameMap(request);
  const reverse = new Map<string, string>();
  for (const [original, shortened] of forward.entries()) {
    reverse.set(shortened, original);
  }
  return reverse;
}

export function shortenToolName(name: string, toolNameMap: ToolNameMap): string {
  const normalized = normalizeString(name);
  if (!normalized) {
    return '';
  }
  return toolNameMap.get(normalized) ?? shortenNameIfNeeded(normalized);
}

export function restoreToolName(name: string, reverseToolNameMap: ToolNameMap): string {
  const normalized = normalizeString(name);
  if (!normalized) {
    return '';
  }
  return reverseToolNameMap.get(normalized) ?? normalized;
}

function shortenNameIfNeeded(name: string): string {
  const limit = 64;
  if (name.length <= limit) {
    return name;
  }
  if (name.startsWith('mcp__')) {
    const index = name.lastIndexOf('__');
    if (index > 0) {
      const candidate = `mcp__${name.slice(index + 2)}`;
      return candidate.length > limit ? candidate.slice(0, limit) : candidate;
    }
  }
  return name.slice(0, limit);
}

function buildShortNameMap(names: string[]): ToolNameMap {
  const limit = 64;
  const used = new Set<string>();
  const result = new Map<string, string>();

  const baseCandidate = (name: string) => {
    if (name.length <= limit) {
      return name;
    }
    if (name.startsWith('mcp__')) {
      const index = name.lastIndexOf('__');
      if (index > 0) {
        const candidate = `mcp__${name.slice(index + 2)}`;
        return candidate.length > limit ? candidate.slice(0, limit) : candidate;
      }
    }
    return name.slice(0, limit);
  };

  const makeUnique = (candidate: string) => {
    if (!used.has(candidate)) {
      return candidate;
    }
    for (let index = 1; ; index += 1) {
      const suffix = `_${index}`;
      const allowed = Math.max(0, limit - suffix.length);
      const unique = `${candidate.slice(0, allowed)}${suffix}`;
      if (!used.has(unique)) {
        return unique;
      }
    }
  };

  for (const name of names) {
    const normalized = normalizeString(name);
    if (!normalized || result.has(normalized)) {
      continue;
    }
    const shortened = makeUnique(baseCandidate(normalized));
    used.add(shortened);
    result.set(normalized, shortened);
  }

  return result;
}
