import type {
  CodexProviderSearchEngine,
  CodexProviderSearchEngineRequest,
  CodexProviderSearchResult,
} from '../metasearch/index.js';
import {
  jsonRecordFromEngineResponse,
  normalizeEngineArray,
  normalizeEngineLanguage,
  normalizeEngineRegion,
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

export interface CodexProviderOpenSerpEndpointEngineOptions extends CodexProviderEndpointSearchEngineOptions {
  engine?: string | null;
}

export function createCodexProviderOpenSerpEndpointEngine(
  options: CodexProviderOpenSerpEndpointEngineOptions,
): CodexProviderSearchEngine {
  const openSerpEngine = normalizeOpenSerpEngine(options.engine);
  const endpoint = appendEndpointPath(
    normalizeEndpointEngineEndpoint(options.endpoint, 'openserp'),
    openSerpEngine === 'mega' ? '/mega/search' : `/${openSerpEngine}/search`,
  );
  const maxResults = clampEndpointEngineInteger(options.maxResults, 1, 100, 10);
  return {
    name: 'openserp',
    displayName: 'OpenSERP Endpoint',
    categories: ['web', 'news', 'images', 'videos'],
    supportsPaging: true,
    supportsTimeRange: false,
    supportsSafeSearch: false,
    supportsLanguage: true,
    supportsRegion: true,
    priority: normalizeEndpointEngineNumber(options.priority, 60),
    timeoutMs: clampEndpointEngineInteger(options.timeoutMs, 1_000, 60_000, 8_000),
    live: true,
    buildRequest(request: CodexProviderSearchEngineRequest) {
      const url = new URL(endpoint);
      const limit = Math.min(maxResults, request.maxResults);
      const language = normalizeEngineLanguage(options.language) || normalizeEngineLanguage(request.language);
      const region = normalizeEngineRegion(options.region) || normalizeEngineRegion(request.region);
      url.searchParams.set('text', request.query);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('start', String(Math.max(0, (request.page - 1) * limit)));
      if (language) {
        url.searchParams.set('lang', language.toUpperCase());
      }
      if (region) {
        url.searchParams.set('region', region.toUpperCase());
      }
      if (request.allowedDomains.length === 1) {
        url.searchParams.set('site', request.allowedDomains[0]);
      }
      return {
        url: url.toString(),
        method: 'GET',
        headers: endpointJsonHeaders(options),
      };
    },
    parseResponse(response) {
      const body = jsonRecordFromEngineResponse(response, 'openserp');
      assertEndpointJsonResponseOk(body, 'openserp');
      return [
        ...normalizeOpenSerpFeatures(body.serp_features),
        ...normalizeEngineArray(body.results)
          .slice(0, maxResults)
          .map((result, index): CodexProviderSearchResult | null => {
            const url = endpointString(result?.url) || endpointString(result?.URL);
            if (!url) {
              return null;
            }
            const rank = endpointNumber(result?.rank)
              ?? endpointNumber(result?.Rank)
              ?? endpointNumber(result?.position?.absolute)
              ?? index + 1;
            return {
              type: endpointResultType(result?.type),
              engine: 'openserp',
              title: endpointString(result?.title) || endpointString(result?.Title) || url,
              url,
              snippet: endpointString(result?.snippet)
                || endpointString(result?.description)
                || endpointString(result?.Description),
              publishedAt: endpointString(result?.published_at)
                || endpointString(result?.publishedAt)
                || endpointString(result?.date)
                || null,
              thumbnail: endpointString(result?.thumbnail) || endpointString(result?.image) || null,
              rank,
              score: endpointNumber(result?.score),
              raw: result,
            };
          })
          .filter(Boolean),
      ];
    },
  };
}

function normalizeOpenSerpFeatures(value: unknown): CodexProviderSearchResult[] {
  return normalizeEngineArray(value)
    .map((feature, index): CodexProviderSearchResult | null => {
      const links = normalizeEngineArray(feature?.links);
      const firstLink = links[0];
      const url = endpointString(firstLink?.url) || endpointString(feature?.url);
      const text = endpointString(feature?.text) || endpointString(feature?.snippet);
      if (!url || !text) {
        return null;
      }
      return {
        type: endpointResultType(feature?.type),
        engine: 'openserp',
        title: endpointString(firstLink?.title) || endpointString(feature?.title) || url,
        url,
        snippet: text,
        rank: index,
        score: endpointNumber(feature?.confidence),
        raw: feature,
      };
    })
    .filter(Boolean);
}

function normalizeOpenSerpEngine(value: unknown): string {
  const normalized = endpointString(value).toLowerCase();
  if (
    normalized === 'google'
    || normalized === 'yandex'
    || normalized === 'baidu'
    || normalized === 'bing'
    || normalized === 'duck'
    || normalized === 'ecosia'
    || normalized === 'mega'
  ) {
    return normalized;
  }
  return 'google';
}
