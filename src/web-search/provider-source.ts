import type {
  JsonRecord,
} from '../hosted_tool_executors.js';
import type {
  CodexProviderProviderWebSearchSourceOptions,
  CodexProviderWebSearchCitation,
  CodexProviderWebSearchContextSize,
  CodexProviderWebSearchProvider,
  CodexProviderWebSearchResult,
  CodexProviderWebSearchSource,
  CodexProviderWebSearchSourceReference,
  CodexProviderWebSearchSourceRequest,
  CodexProviderWebSearchSourceResult,
} from './types.js';
import {
  clampInteger,
  normalizeArray,
  normalizeFiniteNumber,
  normalizeString,
} from './executor-utils.js';

const DEFAULT_TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const DEFAULT_BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_SERPAPI_ENDPOINT = 'https://serpapi.com/search.json';
const DEFAULT_SERPER_ENDPOINT = 'https://google.serper.dev/search';

export function createCodexProviderProviderWebSearchSource(
  options: CodexProviderProviderWebSearchSourceOptions,
): CodexProviderWebSearchSource {
  const provider = normalizeWebSearchProvider(options.provider);
  const apiKey = normalizeString(options.apiKey);
  if (!apiKey) {
    throw new Error(`${provider} web_search source requires an API key.`);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxResults = clampInteger(options.maxResults, 1, 10, 5);
  const endpoint = normalizeString(options.endpoint) || defaultEndpointForWebSearchProvider(provider);
  const country = normalizeString(options.country);
  const language = normalizeString(options.language);
  return {
    name: provider,
    type: provider,
    live: true,
    search(request) {
      switch (provider) {
        case 'tavily':
          return executeTavilySearch({
            apiKey,
            endpoint,
            fetchImpl,
            maxResults: Math.min(maxResults, request.maxResults),
            request,
          });
        case 'brave':
          return executeBraveSearch({
            apiKey,
            endpoint,
            fetchImpl,
            maxResults: Math.min(maxResults, request.maxResults),
            request,
            country,
            language,
          });
        case 'serpapi':
          return executeSerpApiSearch({
            apiKey,
            endpoint,
            fetchImpl,
            maxResults: Math.min(maxResults, request.maxResults),
            request,
            country,
            language,
          });
        case 'serper':
          return executeSerperSearch({
            apiKey,
            endpoint,
            fetchImpl,
            maxResults: Math.min(maxResults, request.maxResults),
            request,
            country,
            language,
          });
        default:
          throw new Error(`Unsupported web_search source provider: ${provider}`);
      }
    },
  };
}

async function executeSerpApiSearch({
  apiKey,
  endpoint,
  fetchImpl,
  maxResults,
  request,
  country,
  language,
}: {
  apiKey: string;
  endpoint: string;
  fetchImpl: typeof fetch;
  maxResults: number;
  request: CodexProviderWebSearchSourceRequest;
  country: string;
  language: string;
}): Promise<CodexProviderWebSearchSourceResult> {
  const url = new URL(endpoint);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', request.query);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('num', String(maxResults));
  if (country) {
    url.searchParams.set('gl', country.toLowerCase());
  }
  if (language) {
    url.searchParams.set('hl', language.toLowerCase());
  }
  const response = await fetchJson(fetchImpl, url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  const results = normalizeArray(response.organic_results)
    .slice(0, maxResults)
    .map((result) => ({
      title: normalizeString(result?.title) || normalizeString(result?.link) || 'Untitled result',
      url: normalizeString(result?.link),
      snippet: normalizeString(result?.snippet),
      source: 'serpapi',
      publishedAt: normalizeString(result?.date) || null,
      score: normalizeFiniteNumber(result?.position),
    }))
    .filter((result) => result.url);
  return {
    answer: normalizeString(response.answer_box?.answer)
      || normalizeString(response.answer_box?.snippet)
      || normalizeString(response.knowledge_graph?.description)
      || null,
    results,
    sources: results.map(resultToSourceReference),
    citations: results.map(resultToCitation),
  };
}

async function executeTavilySearch({
  apiKey,
  endpoint,
  fetchImpl,
  maxResults,
  request,
}: {
  apiKey: string;
  endpoint: string;
  fetchImpl: typeof fetch;
  maxResults: number;
  request: CodexProviderWebSearchSourceRequest;
}): Promise<CodexProviderWebSearchSourceResult> {
  const response = await fetchJson(fetchImpl, endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: request.query,
      max_results: maxResults,
      search_depth: tavilySearchDepthFromContextSize(request.searchContextSize),
      include_answer: true,
      ...(request.filters?.allowedDomains.length ? { include_domains: request.filters.allowedDomains } : {}),
      ...(request.filters?.blockedDomains.length ? { exclude_domains: request.filters.blockedDomains } : {}),
    }),
  });
  const results = normalizeArray(response.results)
    .slice(0, maxResults)
    .map((result) => ({
      title: normalizeString(result?.title) || normalizeString(result?.url) || 'Untitled result',
      url: normalizeString(result?.url),
      snippet: normalizeString(result?.content) || normalizeString(result?.snippet),
      source: 'tavily',
      publishedAt: normalizeString(result?.published_date) || null,
      score: normalizeFiniteNumber(result?.score),
    }))
    .filter((result) => result.url);
  return {
    answer: normalizeString(response.answer) || null,
    results,
    sources: results.map(resultToSourceReference),
    citations: results.map(resultToCitation),
  };
}

async function executeBraveSearch({
  apiKey,
  endpoint,
  fetchImpl,
  maxResults,
  request,
  country,
  language,
}: {
  apiKey: string;
  endpoint: string;
  fetchImpl: typeof fetch;
  maxResults: number;
  request: CodexProviderWebSearchSourceRequest;
  country: string;
  language: string;
}): Promise<CodexProviderWebSearchSourceResult> {
  const url = new URL(endpoint);
  url.searchParams.set('q', request.query);
  url.searchParams.set('count', String(maxResults));
  if (country) {
    url.searchParams.set('country', country.toUpperCase());
  }
  if (language) {
    url.searchParams.set('search_lang', language.toLowerCase());
  }
  const response = await fetchJson(fetchImpl, url.toString(), {
    method: 'GET',
    headers: {
      'X-Subscription-Token': apiKey,
      Accept: 'application/json',
    },
  });
  const results = normalizeArray(response.web?.results)
    .slice(0, maxResults)
    .map((result) => ({
      title: normalizeString(result?.title) || normalizeString(result?.url) || 'Untitled result',
      url: normalizeString(result?.url),
      snippet: normalizeString(result?.description) || normalizeString(result?.snippet),
      source: 'brave',
      publishedAt: normalizeString(result?.page_age) || normalizeString(result?.age) || null,
      score: normalizeFiniteNumber(result?.score),
    }))
    .filter((result) => result.url);
  return {
    results,
    sources: results.map(resultToSourceReference),
    citations: results.map(resultToCitation),
  };
}

async function executeSerperSearch({
  apiKey,
  endpoint,
  fetchImpl,
  maxResults,
  request,
  country,
  language,
}: {
  apiKey: string;
  endpoint: string;
  fetchImpl: typeof fetch;
  maxResults: number;
  request: CodexProviderWebSearchSourceRequest;
  country: string;
  language: string;
}): Promise<CodexProviderWebSearchSourceResult> {
  const response = await fetchJson(fetchImpl, endpoint, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: request.query,
      num: maxResults,
      ...(country ? { gl: country.toLowerCase() } : {}),
      ...(language ? { hl: language.toLowerCase() } : {}),
    }),
  });
  const results = normalizeArray(response.organic)
    .slice(0, maxResults)
    .map((result) => ({
      title: normalizeString(result?.title) || normalizeString(result?.link) || 'Untitled result',
      url: normalizeString(result?.link),
      snippet: normalizeString(result?.snippet),
      source: 'serper',
      publishedAt: normalizeString(result?.date) || null,
      score: normalizeFiniteNumber(result?.position),
    }))
    .filter((result) => result.url);
  return {
    answer: normalizeString(response.answerBox?.answer)
      || normalizeString(response.knowledgeGraph?.description)
      || null,
    results,
    sources: results.map(resultToSourceReference),
    citations: results.map(resultToCitation),
  };
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<JsonRecord> {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`web_search upstream returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  try {
    const json = JSON.parse(text) as JsonRecord;
    return json && typeof json === 'object' ? json : {};
  } catch (error) {
    throw new Error(`web_search upstream returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function tavilySearchDepthFromContextSize(
  contextSize: CodexProviderWebSearchContextSize,
): 'basic' | 'advanced' | 'fast' {
  if (contextSize === 'high') {
    return 'advanced';
  }
  if (contextSize === 'low') {
    return 'fast';
  }
  return 'basic';
}

function resultToSourceReference(result: CodexProviderWebSearchResult): CodexProviderWebSearchSourceReference {
  return {
    title: result.title,
    url: result.url,
    source: result.source ?? null,
    snippet: result.snippet,
  };
}

function resultToCitation(result: CodexProviderWebSearchResult): CodexProviderWebSearchCitation {
  return {
    type: 'url_citation',
    title: result.title,
    url: result.url,
  };
}

function defaultEndpointForWebSearchProvider(provider: CodexProviderWebSearchProvider): string {
  switch (provider) {
    case 'tavily':
      return DEFAULT_TAVILY_ENDPOINT;
    case 'brave':
      return DEFAULT_BRAVE_ENDPOINT;
    case 'serpapi':
      return DEFAULT_SERPAPI_ENDPOINT;
    case 'serper':
      return DEFAULT_SERPER_ENDPOINT;
    default:
      return '';
  }
}

function normalizeWebSearchProvider(value: unknown): CodexProviderWebSearchProvider {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'tavily' || normalized === 'brave' || normalized === 'serpapi' || normalized === 'serper') {
    return normalized;
  }
  throw new Error(`Unsupported web_search executor provider: ${String(value)}`);
}
