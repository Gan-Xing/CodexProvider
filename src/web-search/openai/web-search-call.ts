import type {
  JsonRecord,
} from '../../hosted_tool_executors.js';
import {
  normalizeWebSearchCitationSources,
  type CodexProviderWebSearchCitationSource,
} from './placeholders.js';

export interface CodexProviderWebSearchCallBuildOptions {
  callId: string;
  arguments: JsonRecord;
  resultContent: unknown;
  resultContentText: string;
  includeSources: boolean;
  includeResults: boolean;
}

export interface CodexProviderWebSearchCallBuildResult {
  item: JsonRecord;
  payload: JsonRecord | null;
  citationSources: CodexProviderWebSearchCitationSource[];
}

export function buildCodexProviderWebSearchCallOutputItem(
  options: CodexProviderWebSearchCallBuildOptions,
): CodexProviderWebSearchCallBuildResult {
  const payload = normalizeWebSearchPayload(options.resultContent)
    ?? normalizeWebSearchPayload(parseJsonObject(options.resultContentText)?.content)
    ?? normalizeWebSearchPayload(parseJsonObject(options.resultContentText));
  const query = normalizeString(options.arguments.query)
    || normalizeString(options.arguments.q)
    || normalizeString(options.arguments.search_query)
    || normalizeString(options.arguments.input)
    || normalizeString(payload?.query);
  const sources = normalizeWebSearchSources(payload);
  const results = normalizeWebSearchResults(payload);
  const item = {
    id: `ws_${options.callId}`,
    type: 'web_search_call',
    status: 'completed',
    call_id: options.callId,
    action: {
      type: 'search',
      query: query || null,
      ...(options.includeSources && sources.length > 0 ? { sources } : {}),
    },
    ...(options.includeResults && results.length > 0 ? { results } : {}),
  };
  return {
    item,
    payload,
    citationSources: normalizeWebSearchCitationSources(sources.length > 0 ? sources : results),
  };
}

function normalizeWebSearchPayload(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as JsonRecord;
  if (Array.isArray(record.sources) || Array.isArray(record.results) || Array.isArray(record.citations)) {
    return record;
  }
  if (record.content && typeof record.content === 'object') {
    return normalizeWebSearchPayload(record.content);
  }
  return null;
}

function normalizeWebSearchSources(payload: JsonRecord | null): JsonRecord[] {
  const sources = normalizeArray(payload?.sources)
    .map((source, index) => normalizeWebSearchSource(source, index + 1))
    .filter(Boolean) as JsonRecord[];
  if (sources.length > 0) {
    return sources;
  }
  return normalizeWebSearchResults(payload)
    .map((result, index) => normalizeWebSearchSource(result, index + 1))
    .filter(Boolean) as JsonRecord[];
}

function normalizeWebSearchSource(value: unknown, fallbackId: number): JsonRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as JsonRecord;
  const url = normalizeString(record.url);
  if (!url) {
    return null;
  }
  return omitUndefined({
    id: normalizePositiveInteger(record.id ?? record.source_id) ?? fallbackId,
    title: normalizeString(record.title) || url,
    url,
    source: normalizeString(record.source) || undefined,
    snippet: normalizeString(record.snippet) || undefined,
  });
}

function normalizeWebSearchResults(payload: JsonRecord | null): JsonRecord[] {
  return normalizeArray(payload?.results)
    .map((result) => {
      if (!result || typeof result !== 'object') {
        return null;
      }
      const record = result as JsonRecord;
      const url = normalizeString(record.url);
      if (!url) {
        return null;
      }
      return omitUndefined({
        title: normalizeString(record.title) || url,
        url,
        snippet: normalizeString(record.snippet) || undefined,
        source: normalizeString(record.source) || undefined,
        published_at: normalizeString(record.publishedAt ?? record.published_at) || undefined,
        score: Number.isFinite(Number(record.score)) ? Number(record.score) : undefined,
      });
    })
    .filter(Boolean) as JsonRecord[];
}

function parseJsonObject(value: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : null;
  } catch {
    return null;
  }
}

function normalizeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function omitUndefined<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
