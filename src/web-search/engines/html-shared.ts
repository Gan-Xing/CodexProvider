import {
  CodexProviderMetaSearchError,
  type CodexProviderSearchEngineRequest,
  type CodexProviderSearchResult,
} from '../metasearch/index.js';
import {
  normalizeEngineEndpoint,
  normalizeEngineString,
} from './shared.js';

export interface CodexProviderHtmlSearchEngineOptions {
  endpoint?: string | null;
  maxResults?: number | null;
  language?: string | null;
  region?: string | null;
  priority?: number | null;
  timeoutMs?: number | null;
}

export interface HtmlSearchParserOptions {
  engine: string;
  resultBlockPattern: RegExp;
  titlePattern: RegExp;
  snippetPattern?: RegExp | null;
  fallbackTitlePattern?: RegExp | null;
  maxResults: number;
}

export function buildHtmlSearchGetRequest({
  endpoint,
  request,
  queryParam = 'q',
  maxResults,
  language,
  region,
  languageParam,
  regionParam,
}: {
  endpoint: string;
  request: CodexProviderSearchEngineRequest;
  queryParam?: string;
  maxResults: number;
  language?: string | null;
  region?: string | null;
  languageParam?: string | null;
  regionParam?: string | null;
}) {
  const url = new URL(endpoint);
  url.searchParams.set(queryParam, request.query);
  if (maxResults > 0) {
    url.searchParams.set('count', String(Math.min(maxResults, request.maxResults)));
  }
  const effectiveLanguage = normalizeEngineString(language) || normalizeEngineString(request.language);
  const effectiveRegion = normalizeEngineString(region) || normalizeEngineString(request.region);
  if (languageParam && effectiveLanguage) {
    url.searchParams.set(languageParam, effectiveLanguage.toLowerCase());
  }
  if (regionParam && effectiveRegion) {
    url.searchParams.set(regionParam, effectiveRegion.toLowerCase());
  }
  return {
    url: url.toString(),
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'CodexProviderWebSearch/0.1',
    },
  };
}

export function parseHtmlSearchResults(
  html: string,
  options: HtmlSearchParserOptions,
): CodexProviderSearchResult[] {
  assertHtmlSearchPageAvailable(html, options.engine);
  if (isNoResultsHtml(html)) {
    return [];
  }
  const results: CodexProviderSearchResult[] = [];
  for (const block of matchAllGroups(html, options.resultBlockPattern)) {
    if (results.length >= options.maxResults) {
      break;
    }
    const titleMatch = options.titlePattern.exec(block) ?? options.fallbackTitlePattern?.exec(block);
    if (!titleMatch) {
      continue;
    }
    const rawUrl = firstMatchCapture(titleMatch, 'url', [1, 3, 5]);
    const url = cleanupHtmlSearchUrl(decodeHtmlEntities(rawUrl));
    if (!url) {
      continue;
    }
    const rawTitle = firstMatchCapture(titleMatch, 'title', [2, 4, 6]);
    const title = htmlText(rawTitle) || url;
    const snippetMatch = options.snippetPattern?.exec(block);
    const snippet = snippetMatch
      ? htmlText(firstMatchCapture(snippetMatch, 'snippet', [1, 2, 3]))
      : '';
    results.push({
      type: 'web',
      engine: options.engine,
      title,
      url,
      snippet,
      rank: results.length + 1,
      score: null,
      raw: {
        block,
      },
    });
  }
  return results;
}

export function normalizeHtmlEngineEndpoint(value: unknown, fallback: string): string {
  return normalizeEngineEndpoint(value, fallback);
}

export function normalizeHtmlEngineNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampHtmlEngineInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

export function cleanupHtmlSearchUrl(value: string): string {
  const normalized = decodeHtmlEntities(value).trim();
  if (!normalized) {
    return '';
  }
  try {
    const url = new URL(normalized, 'https://example.invalid');
    const uddg = url.searchParams.get('uddg');
    if (uddg) {
      return cleanupHtmlSearchUrl(uddg);
    }
    const target = url.searchParams.get('url')
      || url.searchParams.get('u')
      || url.searchParams.get('redirect');
    if (target && /^https?:\/\//iu.test(target)) {
      return cleanupHtmlSearchUrl(target);
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (isTrackingParam(key)) {
          url.searchParams.delete(key);
        }
      }
      return url.toString();
    }
  } catch {
    return '';
  }
  return '';
}

export function htmlText(value: string): string {
  return collapseWhitespace(stripHtmlTags(decodeHtmlEntities(value)));
}

function assertHtmlSearchPageAvailable(html: string, engine: string): void {
  const text = htmlText(html).toLowerCase();
  if (
    /\bcaptcha\b/u.test(text)
    || text.includes('verify you are human')
    || text.includes('unusual traffic')
    || text.includes('access denied')
    || text.includes('temporarily blocked')
  ) {
    throw new CodexProviderMetaSearchError(
      `${engine} HTML search returned an anti-bot or blocked page.`,
      'engine_blocked',
      null,
      true,
    );
  }
}

function isNoResultsHtml(html: string): boolean {
  const text = htmlText(html).toLowerCase();
  return text.includes('no results found')
    || text.includes('no results')
    || text.includes('did not match any documents');
}

function matchAllGroups(value: string, pattern: RegExp): string[] {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...value.matchAll(globalPattern)].map((match) => match[0]);
}

function firstMatchCapture(match: RegExpExecArray, groupName: string, indices: number[]): string {
  const namedValue = match.groups?.[groupName];
  if (namedValue) {
    return namedValue;
  }
  return indices
    .map((index) => match[index])
    .find((value): value is string => typeof value === 'string' && value.length > 0) ?? '';
}

function stripHtmlTags(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function isTrackingParam(value: string): boolean {
  const key = value.toLowerCase();
  return key === 'fbclid'
    || key === 'gclid'
    || key === 'mc_cid'
    || key === 'mc_eid'
    || key.startsWith('utm_');
}
