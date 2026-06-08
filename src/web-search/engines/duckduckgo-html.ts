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

const DEFAULT_DUCKDUCKGO_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/';

export function createCodexProviderDuckDuckGoHtmlEngine(
  options: CodexProviderHtmlSearchEngineOptions = {},
): CodexProviderSearchEngine {
  const endpoint = normalizeHtmlEngineEndpoint(options.endpoint, DEFAULT_DUCKDUCKGO_HTML_ENDPOINT);
  const maxResults = clampHtmlEngineInteger(options.maxResults, 1, 20, 10);
  return {
    name: 'duckduckgo-html',
    displayName: 'DuckDuckGo HTML',
    categories: ['web'],
    supportsLanguage: false,
    supportsRegion: false,
    supportsSafeSearch: false,
    priority: normalizeHtmlEngineNumber(options.priority, 50),
    timeoutMs: clampHtmlEngineInteger(options.timeoutMs, 1_000, 60_000, 8_000),
    live: true,
    buildRequest(request) {
      return buildHtmlSearchGetRequest({
        endpoint,
        request,
        maxResults,
      });
    },
    parseResponse(response) {
      return parseHtmlSearchResults(response.text, {
        engine: 'duckduckgo-html',
        resultBlockPattern: /<div[^>]+class=["'][^"']*\bresult\b[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]+class=["'][^"']*\bresult\b|<\/body>|<\/html>|$)/giu,
        titlePattern: /<a(?=[^>]*class=["'][^"']*\bresult__a\b[^"']*["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/iu,
        fallbackTitlePattern: /<a(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/iu,
        snippetPattern: /<a(?=[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'])[^>]*>([\s\S]*?)<\/a>|<div(?=[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'])[^>]*>([\s\S]*?)<\/div>/iu,
        maxResults,
      });
    },
  };
}
