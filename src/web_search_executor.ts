import type {
  CodexProviderHostedToolExecutionRequest,
  CodexProviderHostedToolExecutionResult,
  CodexProviderHostedToolExecutor,
} from './hosted_tool_executors.js';
import {
  createCodexProviderOpenAiWebSearchExecutor,
} from './web-search/openai/executor.js';
import {
  normalizeString,
} from './web-search/executor-utils.js';
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
} from './web-search/executor-normalization.js';
import type {
  CodexProviderWebSearchCitation,
  CodexProviderWebSearchExecutorContent,
  CodexProviderWebSearchExecutorOptions,
  CodexProviderWebSearchResult,
  CodexProviderWebSearchSourceReference,
} from './web-search/types.js';

export type {
  CodexProviderProviderWebSearchSourceOptions,
  CodexProviderWebSearchCitation,
  CodexProviderWebSearchContextSize,
  CodexProviderWebSearchExecutorContent,
  CodexProviderWebSearchExecutorOptions,
  CodexProviderWebSearchFilters,
  CodexProviderWebSearchProvider,
  CodexProviderWebSearchResult,
  CodexProviderWebSearchSource,
  CodexProviderWebSearchSourceInput,
  CodexProviderWebSearchSourceReference,
  CodexProviderWebSearchSourceRequest,
  CodexProviderWebSearchSourceResult,
} from './web-search/types.js';

export {
  createCodexProviderProviderWebSearchSource,
} from './web-search/provider-source.js';

export function createCodexProviderWebSearchExecutor(
  options: CodexProviderWebSearchExecutorOptions,
): CodexProviderHostedToolExecutor {
  if (shouldUseOpenAiWebSearchExecutor(options)) {
    return createCodexProviderOpenAiWebSearchExecutor(options);
  }
  return createLegacyCodexProviderWebSearchExecutor(options);
}

function shouldUseOpenAiWebSearchExecutor(options: CodexProviderWebSearchExecutorOptions): boolean {
  return Boolean(
    options.search
    || options.retrieval
    || (Array.isArray(options.engines) && options.engines.length > 0),
  );
}

function createLegacyCodexProviderWebSearchExecutor(
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
