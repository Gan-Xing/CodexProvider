import type {
  CodexProviderSearchCategory,
  CodexProviderSearchEngine,
  CodexProviderSearchEngineRequest,
  CodexProviderSearchResult,
} from '../metasearch/index.js';
import {
  jsonRecordFromEngineResponse,
  normalizeEngineArray,
  normalizeEngineLanguage,
  normalizeEngineString,
} from './shared.js';
import {
  appendEndpointPath,
  assertEndpointJsonResponseOk,
  clampEndpointEngineInteger,
  endpointJsonHeaders,
  endpointNumber,
  endpointResultType,
  endpointString,
  normalizeEndpointEngineEndpoint,
  normalizeEndpointEngineNumber,
  type CodexProviderEndpointSearchEngineOptions,
} from './endpoint-shared.js';

const SEARXNG_SEARCH_PATH = '/search';

export function createCodexProviderSearxngEndpointEngine(
  options: CodexProviderEndpointSearchEngineOptions,
): CodexProviderSearchEngine {
  const endpoint = appendEndpointPath(
    normalizeEndpointEngineEndpoint(options.endpoint, 'searxng'),
    SEARXNG_SEARCH_PATH,
  );
  const maxResults = clampEndpointEngineInteger(options.maxResults, 1, 50, 10);
  return {
    name: 'searxng',
    displayName: 'SearXNG Endpoint',
    categories: ['web', 'news', 'images', 'videos', 'it', 'science'],
    supportsPaging: true,
    supportsTimeRange: true,
    supportsSafeSearch: true,
    supportsLanguage: true,
    supportsRegion: false,
    priority: normalizeEndpointEngineNumber(options.priority, 65),
    timeoutMs: clampEndpointEngineInteger(options.timeoutMs, 1_000, 60_000, 8_000),
    live: true,
    buildRequest(request: CodexProviderSearchEngineRequest) {
      const url = new URL(endpoint);
      const language = normalizeEngineLanguage(options.language) || normalizeEngineLanguage(request.language);
      url.searchParams.set('q', request.query);
      url.searchParams.set('format', 'json');
      url.searchParams.set('categories', searxngCategory(request.category));
      url.searchParams.set('pageno', String(Math.max(1, request.page)));
      if (language) {
        url.searchParams.set('language', language);
      }
      if (request.safeSearch) {
        url.searchParams.set('safesearch', searxngSafeSearch(request.safeSearch));
      }
      if (request.timeRange) {
        url.searchParams.set('time_range', request.timeRange);
      }
      return {
        url: url.toString(),
        method: 'GET',
        headers: endpointJsonHeaders(options),
      };
    },
    parseResponse(response) {
      const body = jsonRecordFromEngineResponse(response, 'searxng');
      assertEndpointJsonResponseOk(body, 'searxng');
      return [
        ...normalizeSearxngAnswers(body.answers),
        ...normalizeEngineArray(body.results)
          .slice(0, maxResults)
          .map((result, index): CodexProviderSearchResult | null => {
            const url = endpointString(result?.url);
            if (!url) {
              return null;
            }
            return {
              type: endpointResultType(result?.category),
              engine: 'searxng',
              title: endpointString(result?.title) || url,
              url,
              snippet: endpointString(result?.content) || endpointString(result?.snippet),
              publishedAt: endpointString(result?.publishedDate)
                || endpointString(result?.published_date)
                || endpointString(result?.date)
                || null,
              thumbnail: endpointString(result?.thumbnail) || endpointString(result?.img_src) || null,
              rank: index + 1,
              score: endpointNumber(result?.score),
              raw: result,
            };
          })
          .filter(Boolean),
      ];
    },
  };
}

function normalizeSearxngAnswers(value: unknown): CodexProviderSearchResult[] {
  return normalizeEngineArray(value)
    .map((answer, index): CodexProviderSearchResult | null => {
      const url = endpointString(answer?.url) || endpointString(answer?.source);
      if (!url) {
        return null;
      }
      const text = endpointString(answer?.answer)
        || endpointString(answer?.content)
        || endpointString(answer?.text);
      return {
        type: 'answer',
        engine: 'searxng',
        title: endpointString(answer?.title) || url,
        url,
        snippet: text,
        rank: index,
        score: 1,
        raw: answer,
      };
    })
    .filter(Boolean);
}

function searxngCategory(value: CodexProviderSearchCategory): string {
  if (value === 'web') {
    return 'general';
  }
  return value;
}

function searxngSafeSearch(value: string): string {
  if (value === 'strict') {
    return '2';
  }
  if (value === 'moderate') {
    return '1';
  }
  return '0';
}
