import type {
  JsonRecord,
} from '../../hosted_tool_executors.js';
import {
  normalizeWebSearchCitationSources,
  replaceWebSearchSourcePlaceholders,
  type CodexProviderWebSearchCitationSource,
} from './placeholders.js';

export interface CodexProviderWebSearchCitationSummary {
  sourceCount: number;
  outputTextPartCount: number;
  placeholderCount: number;
  annotationCount: number;
  missingSourceCount: number;
}

export function applyWebSearchCitationAnnotationsToResponsesOutput(
  response: JsonRecord,
  sources: CodexProviderWebSearchCitationSource[],
): CodexProviderWebSearchCitationSummary {
  const summary: CodexProviderWebSearchCitationSummary = {
    sourceCount: sources.length,
    outputTextPartCount: 0,
    placeholderCount: 0,
    annotationCount: 0,
    missingSourceCount: 0,
  };
  if (sources.length === 0 || !Array.isArray(response.output)) {
    return summary;
  }
  for (const item of response.output) {
    if (!item || typeof item !== 'object' || item.type !== 'message' || !Array.isArray(item.content)) {
      continue;
    }
    for (const part of item.content) {
      if (!part || typeof part !== 'object' || part.type !== 'output_text' || typeof part.text !== 'string') {
        continue;
      }
      summary.outputTextPartCount += 1;
      const placeholderCount = countWebSearchSourcePlaceholders(part.text);
      const replaced = replaceWebSearchSourcePlaceholders(part.text, sources);
      summary.placeholderCount += placeholderCount;
      summary.annotationCount += replaced.annotations.length;
      summary.missingSourceCount += Math.max(0, placeholderCount - replaced.annotations.length);
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
  return summary;
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

function countWebSearchSourcePlaceholders(text: string): number {
  return [...text.matchAll(/\[\[source:(\d+)\]\]/giu)].length;
}
