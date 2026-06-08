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

const DEFAULT_ECOSIA_HTML_ENDPOINT = 'https://www.ecosia.org/search';

export function createCodexProviderEcosiaHtmlEngine(
  options: CodexProviderHtmlSearchEngineOptions = {},
): CodexProviderSearchEngine {
  const endpoint = normalizeHtmlEngineEndpoint(options.endpoint, DEFAULT_ECOSIA_HTML_ENDPOINT);
  const maxResults = clampHtmlEngineInteger(options.maxResults, 1, 20, 10);
  return {
    name: 'ecosia-html',
    displayName: 'Ecosia HTML',
    categories: ['web'],
    supportsLanguage: true,
    supportsRegion: true,
    supportsSafeSearch: false,
    priority: normalizeHtmlEngineNumber(options.priority, 40),
    timeoutMs: clampHtmlEngineInteger(options.timeoutMs, 1_000, 60_000, 8_000),
    live: true,
    buildRequest(request) {
      return buildHtmlSearchGetRequest({
        endpoint,
        request,
        maxResults,
        language: options.language,
        region: options.region,
        languageParam: 'lang',
        regionParam: 'addon',
      });
    },
    parseResponse(response) {
      return parseHtmlSearchResults(response.text, {
        engine: 'ecosia-html',
        resultBlockPattern: /<article[^>]+class=["'][^"']*\bresult\b[^"']*["'][^>]*>[\s\S]*?<\/article>/giu,
        titlePattern: /<a(?=[^>]*class=["'][^"']*\bresult-title\b[^"']*["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>|<a(?=[^>]*href=["']([^"']+)["'])[^>]*>\s*<h\d[^>]*>([\s\S]*?)<\/h\d>\s*<\/a>/iu,
        fallbackTitlePattern: /<a(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/iu,
        snippetPattern: /<p(?=[^>]*class=["'][^"']*\b(?:result-snippet|snippet)\b[^"']*["'])[^>]*>([\s\S]*?)<\/p>|<div(?=[^>]*class=["'][^"']*\b(?:result-snippet|snippet)\b[^"']*["'])[^>]*>([\s\S]*?)<\/div>/iu,
        maxResults,
      });
    },
  };
}
