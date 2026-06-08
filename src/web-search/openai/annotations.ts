import type {
  JsonRecord,
} from '../../hosted_tool_executors.js';
import {
  normalizeWebSearchCitationSources,
  replaceWebSearchSourcePlaceholders,
  type CodexProviderWebSearchCitationSource,
} from './placeholders.js';

export function applyWebSearchCitationAnnotationsToResponsesOutput(
  response: JsonRecord,
  sources: CodexProviderWebSearchCitationSource[],
): void {
  if (sources.length === 0 || !Array.isArray(response.output)) {
    return;
  }
  for (const item of response.output) {
    if (!item || typeof item !== 'object' || item.type !== 'message' || !Array.isArray(item.content)) {
      continue;
    }
    for (const part of item.content) {
      if (!part || typeof part !== 'object' || part.type !== 'output_text' || typeof part.text !== 'string') {
        continue;
      }
      const replaced = replaceWebSearchSourcePlaceholders(part.text, sources);
      part.text = replaced.text;
      part.annotations = [
        ...normalizeArray(part.annotations),
        ...replaced.annotations.map((annotation) => ({
          type: 'url_citation',
          start_index: annotation.start_index,
          end_index: annotation.end_index,
          title: annotation.title,
          url: annotation.url,
        })),
      ];
    }
  }
}

export function collectWebSearchCitationSourcesFromPayloads(payloads: unknown[]): CodexProviderWebSearchCitationSource[] {
  const sources: CodexProviderWebSearchCitationSource[] = [];
  const seen = new Set<number>();
  for (const payload of payloads) {
    const payloadSources = normalizeWebSearchCitationSources((payload as JsonRecord | null)?.sources);
    const fallbackSources = payloadSources.length > 0
      ? payloadSources
      : normalizeWebSearchCitationSources((payload as JsonRecord | null)?.results);
    for (const source of fallbackSources) {
      if (seen.has(source.id)) {
        continue;
      }
      seen.add(source.id);
      sources.push(source);
    }
  }
  return sources;
}

function normalizeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}
