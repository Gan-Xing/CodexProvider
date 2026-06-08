import type {
  CodexProviderSearchEngine,
  CodexProviderSearchEngineRequest,
  CodexProviderSearchResult,
} from '../metasearch/index.js';
import {
  jsonRecordFromEngineResponse,
  normalizeEngineApiKey,
  normalizeEngineArray,
  normalizeEngineEndpoint,
  normalizeEngineLanguage,
  normalizeEngineNumber,
  normalizeEngineRegion,
  normalizeEngineString,
} from './shared.js';

const DEFAULT_BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export interface CodexProviderBraveApiEngineOptions {
  apiKey: string;
  endpoint?: string | null;
  maxResults?: number | null;
  country?: string | null;
  language?: string | null;
  priority?: number | null;
  timeoutMs?: number | null;
}

export function createCodexProviderBraveApiEngine(
  options: CodexProviderBraveApiEngineOptions,
): CodexProviderSearchEngine {
  const apiKey = normalizeEngineApiKey(options.apiKey, 'brave');
  const endpoint = normalizeEngineEndpoint(options.endpoint, DEFAULT_BRAVE_ENDPOINT);
  const maxResults = clampInteger(options.maxResults, 1, 20, 5);
  const country = normalizeEngineRegion(options.country);
  const language = normalizeEngineLanguage(options.language);
  return {
    name: 'brave',
    displayName: 'Brave Search API',
    categories: ['web', 'news', 'images', 'videos'],
    supportsPaging: false,
    supportsLanguage: true,
    supportsRegion: true,
    supportsSafeSearch: true,
    priority: normalizeNumber(options.priority, 90),
    timeoutMs: clampInteger(options.timeoutMs, 1_000, 60_000, 8_000),
    live: true,
    buildRequest(request: CodexProviderSearchEngineRequest) {
      const url = new URL(endpoint);
      url.searchParams.set('q', request.query);
      url.searchParams.set('count', String(Math.min(maxResults, request.maxResults)));
      const requestRegion = normalizeEngineRegion(request.region);
      const requestLanguage = normalizeEngineLanguage(request.language);
      if (country || requestRegion) {
        url.searchParams.set('country', (country || requestRegion).toUpperCase());
      }
      if (language || requestLanguage) {
        url.searchParams.set('search_lang', language || requestLanguage);
      }
      if (request.safeSearch) {
        url.searchParams.set('safesearch', braveSafeSearchValue(request.safeSearch));
      }
      return {
        url: url.toString(),
        method: 'GET',
        headers: {
          'X-Subscription-Token': apiKey,
          Accept: 'application/json',
        },
      };
    },
    parseResponse(response) {
      const body = jsonRecordFromEngineResponse(response, 'brave');
      return normalizeEngineArray(body.web?.results)
        .map((result, index): CodexProviderSearchResult | null => {
          const url = normalizeEngineString(result?.url);
          if (!url) {
            return null;
          }
          return {
            type: 'web',
            engine: 'brave',
            title: normalizeEngineString(result?.title) || url,
            url,
            snippet: normalizeEngineString(result?.description) || normalizeEngineString(result?.snippet),
            publishedAt: normalizeEngineString(result?.page_age) || normalizeEngineString(result?.age) || null,
            thumbnail: normalizeEngineString(result?.thumbnail?.src) || null,
            rank: index + 1,
            score: normalizeEngineNumber(result?.score),
            raw: result,
          };
        })
        .filter(Boolean);
    },
  };
}

function braveSafeSearchValue(value: string): string {
  if (value === 'strict') {
    return 'strict';
  }
  if (value === 'off') {
    return 'off';
  }
  return 'moderate';
}

function normalizeNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}
