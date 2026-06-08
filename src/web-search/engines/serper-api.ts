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

const DEFAULT_SERPER_ENDPOINT = 'https://google.serper.dev/search';

export interface CodexProviderSerperApiEngineOptions {
  apiKey: string;
  endpoint?: string | null;
  maxResults?: number | null;
  country?: string | null;
  language?: string | null;
  priority?: number | null;
  timeoutMs?: number | null;
}

export function createCodexProviderSerperApiEngine(
  options: CodexProviderSerperApiEngineOptions,
): CodexProviderSearchEngine {
  const apiKey = normalizeEngineApiKey(options.apiKey, 'serper');
  const endpoint = normalizeEngineEndpoint(options.endpoint, DEFAULT_SERPER_ENDPOINT);
  const maxResults = clampInteger(options.maxResults, 1, 20, 5);
  const country = normalizeEngineRegion(options.country);
  const language = normalizeEngineLanguage(options.language);
  return {
    name: 'serper',
    displayName: 'Serper API',
    categories: ['web', 'news'],
    supportsLanguage: true,
    supportsRegion: true,
    priority: normalizeNumber(options.priority, 85),
    timeoutMs: clampInteger(options.timeoutMs, 1_000, 60_000, 8_000),
    live: true,
    buildRequest(request: CodexProviderSearchEngineRequest) {
      const requestRegion = normalizeEngineRegion(request.region);
      const requestLanguage = normalizeEngineLanguage(request.language);
      return {
        url: endpoint,
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: request.query,
          num: Math.min(maxResults, request.maxResults),
          ...(country || requestRegion ? { gl: country || requestRegion } : {}),
          ...(language || requestLanguage ? { hl: language || requestLanguage } : {}),
        }),
      };
    },
    parseResponse(response) {
      const body = jsonRecordFromEngineResponse(response, 'serper');
      const results: CodexProviderSearchResult[] = [];
      const answer = normalizeEngineString(body.answerBox?.answer)
        || normalizeEngineString(body.knowledgeGraph?.description);
      if (answer) {
        const answerUrl = normalizeEngineString(body.answerBox?.link)
          || normalizeEngineString(body.knowledgeGraph?.website);
        if (answerUrl) {
          results.push({
            type: 'answer',
            engine: 'serper',
            title: normalizeEngineString(body.answerBox?.title)
              || normalizeEngineString(body.knowledgeGraph?.title)
              || answerUrl,
            url: answerUrl,
            snippet: answer,
            rank: 0,
            score: 1,
            raw: body.answerBox ?? body.knowledgeGraph,
          });
        }
      }
      results.push(...normalizeEngineArray(body.organic)
        .map((result, index): CodexProviderSearchResult | null => {
          const url = normalizeEngineString(result?.link);
          if (!url) {
            return null;
          }
          return {
            type: 'web',
            engine: 'serper',
            title: normalizeEngineString(result?.title) || url,
            url,
            snippet: normalizeEngineString(result?.snippet),
            publishedAt: normalizeEngineString(result?.date) || null,
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
