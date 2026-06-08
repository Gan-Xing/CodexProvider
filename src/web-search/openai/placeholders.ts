import type {
  JsonRecord,
} from '../../hosted_tool_executors.js';

export interface CodexProviderWebSearchCitationSource {
  id: number;
  title: string;
  url: string;
}

export interface CodexProviderWebSearchCitationAnnotation {
  type: 'url_citation';
  start_index: number;
  end_index: number;
  title: string;
  url: string;
  source_id: number;
}

export function replaceWebSearchSourcePlaceholders(
  text: string,
  sources: CodexProviderWebSearchCitationSource[],
): {
  text: string;
  annotations: CodexProviderWebSearchCitationAnnotation[];
} {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const annotations: CodexProviderWebSearchCitationAnnotation[] = [];
  let normalizedText = '';
  let cursor = 0;
  for (const match of text.matchAll(/\[\[source:(\d+)\]\]/giu)) {
    const index = match.index ?? cursor;
    normalizedText += text.slice(cursor, index);
    cursor = index + match[0].length;
    const sourceId = Number(match[1]);
    const source = sourceById.get(sourceId);
    if (!source) {
      continue;
    }
    const endIndex = normalizedText.replace(/\s+$/u, '').length;
    const startIndex = findCitationSpanStart(normalizedText, endIndex);
    annotations.push({
      type: 'url_citation',
      start_index: startIndex,
      end_index: endIndex,
      title: source.title,
      url: source.url,
      source_id: source.id,
    });
  }
  normalizedText += text.slice(cursor);
  return {
    text: normalizedText.replace(/\s{2,}/gu, ' ').trim(),
    annotations: annotations.filter((annotation) => annotation.end_index >= annotation.start_index),
  };
}

export function normalizeWebSearchCitationSources(value: unknown): CodexProviderWebSearchCitationSource[] {
  const sources = Array.isArray(value) ? value : [];
  return sources
    .map((source, index): CodexProviderWebSearchCitationSource | null => {
      if (!source || typeof source !== 'object') {
        return null;
      }
      const record = source as JsonRecord;
      const url = normalizeString(record.url);
      if (!url) {
        return null;
      }
      return {
        id: normalizePositiveInteger(record.id ?? record.source_id) ?? index + 1,
        title: normalizeString(record.title) || url,
        url,
      };
    })
    .filter(Boolean);
}

function findCitationSpanStart(text: string, endIndex: number): number {
  if (endIndex <= 0) {
    return 0;
  }
  const before = text.slice(0, endIndex);
  const sentenceBoundary = Math.max(
    before.lastIndexOf('. '),
    before.lastIndexOf('! '),
    before.lastIndexOf('? '),
    before.lastIndexOf('\n'),
  );
  if (sentenceBoundary >= 0 && sentenceBoundary + 2 < endIndex) {
    return skipLeadingWhitespace(text, sentenceBoundary + 2, endIndex);
  }
  const wordBoundary = before.search(/\S[^\s]*$/u);
  return wordBoundary >= 0 ? wordBoundary : 0;
}

function skipLeadingWhitespace(text: string, startIndex: number, endIndex: number): number {
  let index = startIndex;
  while (index < endIndex && /\s/u.test(text[index])) {
    index += 1;
  }
  return index;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
