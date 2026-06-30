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

const DEFAULT_SERPAPI_ENDPOINT = 'https://serpapi.com/search.json';

export interface CodexProviderSerpApiEngineOptions {
  apiKey: string;
  endpoint?: string | null;
  engine?: string | null;
  maxResults?: number | null;
  country?: string | null;
  language?: string | null;
  priority?: number | null;
  timeoutMs?: number | null;
}

export function createCodexProviderSerpApiEngine(
  options: CodexProviderSerpApiEngineOptions,
): CodexProviderSearchEngine {
  const apiKey = normalizeEngineApiKey(options.apiKey, 'serpapi');
  const endpoint = normalizeEngineEndpoint(options.endpoint, DEFAULT_SERPAPI_ENDPOINT);
  const engine = normalizeEngineString(options.engine) || 'google';
  const maxResults = clampInteger(options.maxResults, 1, 20, 5);
  const country = normalizeEngineRegion(options.country);
  const language = normalizeEngineLanguage(options.language);
  return {
    name: 'serpapi',
    displayName: 'SerpApi',
    categories: ['web', 'news'],
    supportsPaging: true,
    supportsLanguage: true,
    supportsRegion: true,
    supportsSafeSearch: true,
    priority: normalizeNumber(options.priority, 82),
    timeoutMs: clampInteger(options.timeoutMs, 1_000, 60_000, 8_000),
    live: true,
    buildRequest(request: CodexProviderSearchEngineRequest) {
      const requestRegion = normalizeEngineRegion(request.region);
      const requestLanguage = normalizeEngineLanguage(request.language);
      const url = new URL(endpoint);
      url.searchParams.set('engine', engine);
      url.searchParams.set('q', request.query);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('num', String(Math.min(maxResults, request.maxResults)));
      if (request.page > 1) {
        url.searchParams.set('start', String((request.page - 1) * Math.min(maxResults, request.maxResults)));
      }
      if (country || requestRegion) {
        url.searchParams.set('gl', country || requestRegion);
      }
      if (language || requestLanguage) {
        url.searchParams.set('hl', language || requestLanguage);
      }
      if (request.safeSearch) {
        url.searchParams.set('safe', serpApiSafeSearchValue(request.safeSearch));
      }
      return {
        url: url.toString(),
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      };
    },
    parseResponse(response) {
      const body = jsonRecordFromEngineResponse(response, 'serpapi');
      const results: CodexProviderSearchResult[] = [];
      const answer = normalizeEngineString(body.answer_box?.answer)
        || normalizeEngineString(body.answer_box?.snippet)
        || normalizeEngineString(body.knowledge_graph?.description);
      if (answer) {
        const answerUrl = normalizeEngineString(body.answer_box?.link)
          || normalizeEngineString(body.knowledge_graph?.website)
          || normalizeEngineString(body.knowledge_graph?.source?.link);
        if (answerUrl) {
          results.push({
            type: 'answer',
            engine: 'serpapi',
            title: normalizeEngineString(body.answer_box?.title)
              || normalizeEngineString(body.knowledge_graph?.title)
              || answerUrl,
            url: answerUrl,
            snippet: answer,
            rank: 0,
            score: 1,
            raw: body.answer_box ?? body.knowledge_graph,
          });
        }
      }
      results.push(...normalizeEngineArray(body.organic_results)
        .map((result, index): CodexProviderSearchResult | null => {
          const url = normalizeEngineString(result?.link);
          if (!url) {
            return null;
          }
          return {
            type: 'web',
            engine: 'serpapi',
            title: normalizeEngineString(result?.title) || url,
            url,
            snippet: normalizeEngineString(result?.snippet),
            publishedAt: normalizeEngineString(result?.date) || null,
            thumbnail: normalizeEngineString(result?.thumbnail) || null,
            rank: normalizeEngineNumber(result?.position) ?? index + 1,
            score: normalizeEngineNumber(result?.position),
            raw: result,
          };
        })
        .filter(Boolean));
      return results;
    },
  };
}

function serpApiSafeSearchValue(value: string): string {
  if (value === 'off') {
    return 'off';
  }
  return 'active';
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
