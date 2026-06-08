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

const DEFAULT_BRAVE_HTML_ENDPOINT = 'https://search.brave.com/search';

export function createCodexProviderBraveHtmlEngine(
  options: CodexProviderHtmlSearchEngineOptions = {},
): CodexProviderSearchEngine {
  const endpoint = normalizeHtmlEngineEndpoint(options.endpoint, DEFAULT_BRAVE_HTML_ENDPOINT);
  const maxResults = clampHtmlEngineInteger(options.maxResults, 1, 20, 10);
  return {
    name: 'brave-html',
    displayName: 'Brave HTML',
    categories: ['web'],
    supportsLanguage: true,
    supportsRegion: false,
    supportsSafeSearch: false,
    priority: normalizeHtmlEngineNumber(options.priority, 45),
    timeoutMs: clampHtmlEngineInteger(options.timeoutMs, 1_000, 60_000, 8_000),
    live: true,
    buildRequest(request) {
      return buildHtmlSearchGetRequest({
        endpoint,
        request,
        maxResults,
        language: options.language,
        languageParam: 'lang',
      });
    },
    parseResponse(response) {
      return parseHtmlSearchResults(response.text, {
        engine: 'brave-html',
        resultBlockPattern: /<div[^>]+(?:data-testid=["']result["']|class=["'][^"']*\bresult\b[^"']*["'])[^>]*>[\s\S]*?(?=<div[^>]+(?:data-testid=["']result["']|class=["'][^"']*\bresult\b)|<\/body>|<\/html>|$)/giu,
        titlePattern: /<a(?=[^>]*class=["'][^"']*\b(?:result-header|result-title)\b[^"']*["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>|<a(?=[^>]*href=["']([^"']+)["'])[^>]*>\s*<h\d[^>]*>([\s\S]*?)<\/h\d>\s*<\/a>/iu,
        fallbackTitlePattern: /<a(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/iu,
        snippetPattern: /<div(?=[^>]*class=["'][^"']*\b(?:snippet-description|description|snippet-content)\b[^"']*["'])[^>]*>([\s\S]*?)<\/div>|<p(?=[^>]*class=["'][^"']*\b(?:snippet-description|description)\b[^"']*["'])[^>]*>([\s\S]*?)<\/p>/iu,
        maxResults,
      });
    },
  };
}
