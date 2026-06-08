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
  normalizeEngineNumber,
  normalizeEngineString,
} from './shared.js';

const DEFAULT_TAVILY_ENDPOINT = 'https://api.tavily.com/search';

export type CodexProviderTavilySearchDepth = 'basic' | 'advanced' | 'fast';

export interface CodexProviderTavilyApiEngineOptions {
  apiKey: string;
  endpoint?: string | null;
  maxResults?: number | null;
  searchDepth?: CodexProviderTavilySearchDepth | null;
  priority?: number | null;
  timeoutMs?: number | null;
}

export function createCodexProviderTavilyApiEngine(
  options: CodexProviderTavilyApiEngineOptions,
): CodexProviderSearchEngine {
  const apiKey = normalizeEngineApiKey(options.apiKey, 'tavily');
  const endpoint = normalizeEngineEndpoint(options.endpoint, DEFAULT_TAVILY_ENDPOINT);
  const maxResults = clampInteger(options.maxResults, 1, 20, 5);
  const searchDepth = normalizeTavilySearchDepth(options.searchDepth);
  return {
    name: 'tavily',
    displayName: 'Tavily API',
    categories: ['web', 'news'],
    supportsTimeRange: true,
    supportsLanguage: false,
    supportsRegion: false,
    supportsSafeSearch: false,
    priority: normalizeNumber(options.priority, 80),
    timeoutMs: clampInteger(options.timeoutMs, 1_000, 60_000, 8_000),
    live: true,
    buildRequest(request: CodexProviderSearchEngineRequest) {
      const body = {
        query: request.query,
        max_results: Math.min(maxResults, request.maxResults),
        search_depth: searchDepth,
        include_answer: true,
        ...(request.allowedDomains.length ? { include_domains: request.allowedDomains } : {}),
        ...(request.blockedDomains.length ? { exclude_domains: request.blockedDomains } : {}),
        ...(request.timeRange ? { time_range: request.timeRange } : {}),
      };
      return {
        url: endpoint,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      };
    },
    parseResponse(response) {
      const body = jsonRecordFromEngineResponse(response, 'tavily');
      return normalizeEngineArray(body.results)
        .map((result, index): CodexProviderSearchResult | null => {
          const url = normalizeEngineString(result?.url);
          if (!url) {
            return null;
          }
          return {
            type: 'web',
            engine: 'tavily',
            title: normalizeEngineString(result?.title) || url,
            url,
            snippet: normalizeEngineString(result?.content) || normalizeEngineString(result?.snippet),
            publishedAt: normalizeEngineString(result?.published_date) || null,
            rank: index + 1,
            score: normalizeEngineNumber(result?.score),
            raw: result,
          };
        })
        .filter(Boolean);
    },
  };
}

function normalizeTavilySearchDepth(value: unknown): CodexProviderTavilySearchDepth {
  const normalized = normalizeEngineString(value).toLowerCase();
  if (normalized === 'advanced' || normalized === 'fast') {
    return normalized;
  }
  return 'basic';
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
