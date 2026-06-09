import type {
  CodexProviderHostedToolExecutionRequest,
  CodexProviderHostedToolExecutionResult,
  CodexProviderHostedToolExecutor,
} from '../hosted_tool_executors.js';
import {
  dedupeWebSearchCitations,
  dedupeWebSearchSources,
  normalizeWebSearchCitation,
  normalizeWebSearchRequest,
  normalizeWebSearchResult,
  normalizeWebSearchSourceReference,
  normalizeWebSearchSources,
  webSearchResultMatchesFilters,
  webSearchUrlMatchesFilters,
} from './executor-normalization.js';
import {
  normalizeString,
} from './executor-utils.js';
import type {
  CodexProviderWebSearchCitation,
  CodexProviderWebSearchExecutorContent,
  CodexProviderWebSearchExecutorOptions,
  CodexProviderWebSearchResult,
  CodexProviderWebSearchSourceReference,
} from './types.js';

export function createLegacyCodexProviderWebSearchExecutor(
  options: CodexProviderWebSearchExecutorOptions,
): CodexProviderHostedToolExecutor {
  const sources = normalizeWebSearchSources(options);
  if (sources.length === 0) {
    throw new Error('web_search executor requires at least one source or provider API key.');
  }
  return async (request: CodexProviderHostedToolExecutionRequest): Promise<CodexProviderHostedToolExecutionResult> => {
    const normalizedRequest = normalizeWebSearchRequest(request, options.maxResults);
    if (!normalizedRequest.query) {
      throw new Error('web_search executor requires a non-empty query argument.');
    }
    const liveSources = sources.filter((source) => source.live !== false);
    const cacheSources = sources.filter((source) => source.live === false);
    const searchableSources = normalizedRequest.externalWebAccess ? sources : cacheSources;
    if (!normalizedRequest.externalWebAccess && liveSources.length > 0 && searchableSources.length === 0) {
      throw new Error('web_search external_web_access=false requires a cache/offline source; live providers were not called.');
    }

    const aggregatedResults: CodexProviderWebSearchResult[] = [];
    const aggregatedSources: CodexProviderWebSearchSourceReference[] = [];
    const aggregatedCitations: CodexProviderWebSearchCitation[] = [];
    const answers: string[] = [];
    for (const source of searchableSources) {
      const result = await source.search({
        ...normalizedRequest,
        toolRequest: request,
      });
      if (normalizeString(result.answer)) {
        answers.push(normalizeString(result.answer));
      }
      for (const entry of result.results ?? []) {
        const normalized = normalizeWebSearchResult(entry, source.name);
        if (normalized && webSearchResultMatchesFilters(normalized, normalizedRequest.filters)) {
          aggregatedResults.push(normalized);
        }
      }
      for (const entry of result.sources ?? []) {
        const normalized = normalizeWebSearchSourceReference(entry, source.name);
        if (normalized && webSearchUrlMatchesFilters(normalized.url, normalizedRequest.filters)) {
          aggregatedSources.push(normalized);
        }
      }
      for (const entry of result.citations ?? []) {
        const normalized = normalizeWebSearchCitation(entry);
        if (normalized && webSearchUrlMatchesFilters(normalized.url, normalizedRequest.filters)) {
          aggregatedCitations.push(normalized);
        }
      }
    }

    const limitedResults = aggregatedResults.slice(0, normalizedRequest.maxResults);
    const sourcesFromResults = limitedResults.map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      source: result.source ?? null,
    }));
    return {
      content: {
        query: normalizedRequest.query,
        provider: searchableSources.length === 1 ? searchableSources[0].name : 'multi-source',
        answer: answers[0] ?? null,
        results: limitedResults,
        sources: dedupeWebSearchSources([...aggregatedSources, ...sourcesFromResults]),
        citations: dedupeWebSearchCitations(aggregatedCitations),
        retrieved_at: new Date().toISOString(),
        external_web_access: normalizedRequest.externalWebAccess,
        search_context_size: normalizedRequest.searchContextSize,
        return_token_budget: normalizedRequest.returnTokenBudget,
      } satisfies CodexProviderWebSearchExecutorContent,
      metadata: {
        provider: searchableSources.length === 1 ? searchableSources[0].name : 'multi-source',
        sourceCount: searchableSources.length,
        resultCount: limitedResults.length,
        externalWebAccess: normalizedRequest.externalWebAccess,
        searchContextSize: normalizedRequest.searchContextSize,
        returnTokenBudget: normalizedRequest.returnTokenBudget,
      },
    };
  };
}
