import {
  normalizeCodexProviderBuiltinToolName,
} from '../../builtin-tools/index.js';
import {
  applyWebSearchCitationAnnotationsToResponsesOutput,
} from '../../web-search/openai/annotations.js';
import {
  buildCodexProviderWebSearchCallOutputItem,
} from '../../web-search/openai/web-search-call.js';
import type {
  CodexProviderWebSearchCitationSource,
} from '../../web-search/openai/placeholders.js';
import type {
  AdapterHostedToolExecutionRecord,
  JsonRecord,
} from './types.js';
import {
  normalizeArray,
  normalizeString,
  omitUndefined,
} from './utils.js';

export function appendHostedToolResultsToResponsesOutput({
  response,
  request,
  executions,
  exposeByDefault,
}: {
  response: JsonRecord;
  request: JsonRecord;
  executions: AdapterHostedToolExecutionRecord[];
  exposeByDefault: boolean;
}): void {
  if (executions.length === 0) {
    return;
  }
  const output = Array.isArray(response.output) ? response.output : [];
  const webSearchCitationSources: CodexProviderWebSearchCitationSource[] = [];
  for (const execution of executions) {
    const builtinToolName = normalizeCodexProviderBuiltinToolName(execution.toolName);
    if (
      builtinToolName === 'file_search'
      && shouldExposeFileSearchResults(request, exposeByDefault)
    ) {
      const results = extractFileSearchResultsFromHostedToolOutput(execution.content);
      if (results.length === 0) {
        continue;
      }
      output.push({
        id: `fs_${execution.callId}`,
        type: 'file_search_call',
        status: 'completed',
        call_id: execution.callId,
        queries: normalizeString(execution.arguments.query)
          ? [normalizeString(execution.arguments.query)]
          : [],
        results,
      });
    } else if (
      builtinToolName === 'image_generation'
      && shouldExposeImageGenerationResults(request, exposeByDefault)
    ) {
      const images = extractImageGenerationResultsFromHostedToolOutput(execution.content);
      if (images.length === 0) {
        continue;
      }
      output.push({
        id: `ig_${execution.callId}`,
        type: 'image_generation_call',
        status: 'completed',
        call_id: execution.callId,
        prompt: normalizeString(execution.arguments.prompt)
          || normalizeString(execution.arguments.input)
          || null,
        result: images,
      });
    } else if (builtinToolName === 'web_search') {
      const webSearchCall = buildCodexProviderWebSearchCallOutputItem({
        callId: execution.callId,
        arguments: execution.arguments,
        resultContent: execution.resultContent,
        resultContentText: execution.content,
        includeSources: shouldExposeWebSearchActionSources(request, exposeByDefault),
        includeResults: shouldExposeWebSearchResults(request, exposeByDefault),
      });
      output.push(webSearchCall.item);
      webSearchCitationSources.push(...webSearchCall.citationSources);
    }
  }
  response.output = output;
  applyWebSearchCitationAnnotationsToResponsesOutput(response, webSearchCitationSources);
}

function shouldExposeFileSearchResults(request: JsonRecord, exposeByDefault: boolean): boolean {
  if (exposeByDefault) {
    return true;
  }
  return normalizeArray(request?.include).some((entry) => normalizeString(entry) === 'file_search_call.results');
}

function shouldExposeImageGenerationResults(request: JsonRecord, exposeByDefault: boolean): boolean {
  if (exposeByDefault) {
    return true;
  }
  return normalizeArray(request?.include).some((entry) => {
    const normalized = normalizeString(entry);
    return normalized === 'image_generation_call.results'
      || normalized === 'image_generation_call.result';
  });
}

function shouldExposeWebSearchActionSources(request: JsonRecord, exposeByDefault: boolean): boolean {
  if (exposeByDefault) {
    return true;
  }
  return normalizeArray(request?.include).some((entry) => normalizeString(entry) === 'web_search_call.action.sources');
}

function shouldExposeWebSearchResults(request: JsonRecord, exposeByDefault: boolean): boolean {
  if (exposeByDefault) {
    return true;
  }
  return normalizeArray(request?.include).some((entry) => normalizeString(entry) === 'web_search_call.results');
}

function extractFileSearchResultsFromHostedToolOutput(content: string): JsonRecord[] {
  const parsed = parseJsonObject(content);
  const payload = parsed?.content && typeof parsed.content === 'object'
    ? parsed.content as JsonRecord
    : parsed;
  if (!payload) {
    return [];
  }
  const results = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.search_results)
      ? payload.search_results
      : [];
  return results
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => normalizeFileSearchCallResult(entry as JsonRecord));
}

function normalizeFileSearchCallResult(result: JsonRecord): JsonRecord {
  return omitUndefined({
    file_id: normalizeString(result.file_id) || null,
    filename: normalizeString(result.filename) || null,
    score: Number.isFinite(Number(result.score)) ? Number(result.score) : null,
    attributes: result.attributes && typeof result.attributes === 'object'
      ? result.attributes
      : {},
    content: Array.isArray(result.content)
      ? result.content.filter((entry) => entry && typeof entry === 'object')
      : [],
  });
}

function extractImageGenerationResultsFromHostedToolOutput(content: string): JsonRecord[] {
  const parsed = parseJsonObject(content);
  const payload = parsed?.content && typeof parsed.content === 'object'
    ? parsed.content as JsonRecord
    : parsed;
  if (!payload) {
    return [];
  }
  return normalizeArray(payload.images)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => normalizeImageGenerationCallResult(entry as JsonRecord))
    .filter((entry) => entry.b64_json || entry.url);
}

function normalizeImageGenerationCallResult(result: JsonRecord): JsonRecord {
  return omitUndefined({
    b64_json: normalizeString(result.b64_json) || null,
    url: normalizeString(result.url) || null,
    mime_type: normalizeString(result.mime_type) || null,
    revised_prompt: normalizeString(result.revised_prompt) || null,
  });
}

function parseJsonObject(value: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as JsonRecord : null;
  } catch {
    return null;
  }
}
