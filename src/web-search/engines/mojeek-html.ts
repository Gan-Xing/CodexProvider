import type {
  CodexProviderSearchEngine,
} from '../metasearch/index.js';
import {
  buildHtmlSearchGetRequest,
  clampHtmlEngineInteger,
  normalizeHtmlEngineEndpoint,
  normalizeHtmlEngineNumber,
  parseHtmlSearchResults,
  type CodexProviderHtmlSearchEngineOptions,
} from './html-shared.js';

const DEFAULT_MOJEEK_HTML_ENDPOINT = 'https://www.mojeek.com/search';

export function createCodexProviderMojeekHtmlEngine(
  options: CodexProviderHtmlSearchEngineOptions = {},
): CodexProviderSearchEngine {
  const endpoint = normalizeHtmlEngineEndpoint(options.endpoint, DEFAULT_MOJEEK_HTML_ENDPOINT);
  const maxResults = clampHtmlEngineInteger(options.maxResults, 1, 20, 10);
  return {
    name: 'mojeek-html',
    displayName: 'Mojeek HTML',
    categories: ['web'],
    supportsLanguage: false,
    supportsRegion: true,
    supportsSafeSearch: false,
    priority: normalizeHtmlEngineNumber(options.priority, 35),
    timeoutMs: clampHtmlEngineInteger(options.timeoutMs, 1_000, 60_000, 8_000),
    live: true,
    buildRequest(request) {
      return buildHtmlSearchGetRequest({
        endpoint,
        request,
        maxResults,
        region: options.region,
        regionParam: 'reg',
      });
    },
    parseResponse(response) {
      return parseHtmlSearchResults(response.text, {
        engine: 'mojeek-html',
        resultBlockPattern: /<li[^>]+class=["'][^"']*\b(?:result|r)\b[^"']*["'][^>]*>[\s\S]*?<\/li>/giu,
        titlePattern: /<a(?=[^>]*class=["'][^"']*\b(?:title|ob)\b[^"']*["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>|<h2[^>]*>\s*<a(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/iu,
        fallbackTitlePattern: /<a(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/iu,
        snippetPattern: /<p(?=[^>]*class=["'][^"']*\b(?:s|snippet)\b[^"']*["'])[^>]*>([\s\S]*?)<\/p>|<div(?=[^>]*class=["'][^"']*\b(?:s|snippet)\b[^"']*["'])[^>]*>([\s\S]*?)<\/div>/iu,
        maxResults,
      });
    },
  };
}
