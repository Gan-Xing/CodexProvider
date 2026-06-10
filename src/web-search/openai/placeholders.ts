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
  const replacements: Array<{
    marker: string;
    source: CodexProviderWebSearchCitationSource;
    token: string;
  }> = [];
  let normalizedText = '';
  let cursor = 0;
  for (const match of text.matchAll(/\[\[source:(\d+)\]\]/giu)) {
    const index = match.index ?? cursor;
    normalizedText = appendTextSegment(normalizedText, text.slice(cursor, index));
    cursor = index + match[0].length;
    const sourceId = Number(match[1]);
    const source = sourceById.get(sourceId);
    if (!source) {
      continue;
    }
    const token = `\uE000${replacements.length}\uE001`;
    normalizedText = appendCitationToken(normalizedText, token);
    replacements.push({
      marker: `[${source.id}]`,
      source,
      token,
    });
  }
  normalizedText = appendTextSegment(normalizedText, text.slice(cursor)).replace(/\s{2,}/gu, ' ').trim();
  return replaceCitationTokens(normalizedText, replacements);
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

function appendTextSegment(text: string, segment: string): string {
  if (!segment) {
    return text;
  }
  if (text.endsWith('\uE001') && !/^\s|^[,.;:!?。！？、，；：）)\]}]/u.test(segment)) {
    return `${text} ${segment}`;
  }
  return `${text}${segment}`;
}

function appendCitationToken(text: string, token: string): string {
  const previous = text.at(-1) ?? '';
  if (text.length === 0 || /\s/u.test(previous) || /[。！？、，；：]/u.test(previous)) {
    return `${text}${token}`;
  }
  return `${text} ${token}`;
}

function replaceCitationTokens(
  text: string,
  replacements: Array<{
    marker: string;
    source: CodexProviderWebSearchCitationSource;
    token: string;
  }>,
): {
  text: string;
  annotations: CodexProviderWebSearchCitationAnnotation[];
} {
  const annotations: CodexProviderWebSearchCitationAnnotation[] = [];
  let replacedText = text;
  for (const replacement of replacements) {
    const startIndex = replacedText.indexOf(replacement.token);
    if (startIndex < 0) {
      continue;
    }
    replacedText = `${replacedText.slice(0, startIndex)}${replacement.marker}${replacedText.slice(startIndex + replacement.token.length)}`;
    annotations.push({
      type: 'url_citation',
      start_index: startIndex,
      end_index: startIndex + replacement.marker.length,
      title: replacement.source.title,
      url: replacement.source.url,
      source_id: replacement.source.id,
    });
  }
  return {
    text: replacedText,
    annotations,
  };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
