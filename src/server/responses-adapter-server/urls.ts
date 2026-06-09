import {
  normalizePath,
  normalizeString,
} from './utils.js';

export function buildOpenAICompatibleChatCompletionsUrl(
  baseUrl: string,
  pathname = '/chat/completions',
): string {
  const normalizedPath = normalizePath(pathname) || '/chat/completions';
  return buildOpenAICompatibleEndpointUrl(baseUrl, normalizedPath);
}

export function buildOpenAICompatibleModelsUrl(baseUrl: string): string {
  const base = stripChatCompletionsSuffix(normalizeEndpointBaseUrl(baseUrl));
  return buildOpenAICompatibleEndpointUrl(base, '/models');
}

export function buildChatCompletionsUrl(baseUrl: string, pathname: string): string {
  return buildOpenAICompatibleChatCompletionsUrl(baseUrl, pathname);
}

function buildOpenAICompatibleEndpointUrl(baseUrl: string, endpointPath: string): string {
  const endpoint = normalizePath(endpointPath) || '/chat/completions';
  const skipVersionPrefix = normalizeString(baseUrl).endsWith('#');
  const base = endpoint === '/models'
    ? stripChatCompletionsSuffix(normalizeEndpointBaseUrl(baseUrl))
    : normalizeEndpointBaseUrl(baseUrl);
  if (base.toLowerCase().endsWith(endpoint.toLowerCase())) {
    return base;
  }
  const originOnly = isOriginOnlyBaseUrl(base);
  let url = skipVersionPrefix || hasVersionSuffix(base) || !originOnly
    ? `${base}${endpoint}`
    : `${base}/v1${endpoint}`;
  while (url.includes('/v1/v1')) {
    url = url.replace('/v1/v1', '/v1');
  }
  return url;
}

function normalizeEndpointBaseUrl(baseUrl: string): string {
  return normalizeString(baseUrl)
    .replace(/#+$/u, '')
    .replace(/\/+$/u, '');
}

function stripChatCompletionsSuffix(baseUrl: string): string {
  return baseUrl.toLowerCase().endsWith('/chat/completions')
    ? baseUrl.slice(0, -'/chat/completions'.length)
    : baseUrl;
}

function isOriginOnlyBaseUrl(baseUrl: string): boolean {
  const parts = baseUrl.split('://', 2);
  return parts.length === 2
    ? !parts[1].includes('/')
    : !baseUrl.includes('/');
}

function hasVersionSuffix(baseUrl: string): boolean {
  return /\/v\d+(?:beta)?$/iu.test(baseUrl);
}

export function isResponsesPath(pathname: string): boolean {
  const canonical = canonicalProxyRoutePath(pathname);
  return canonical === '/responses' || isResponsesCompactPath(pathname);
}

export function isResponsesCompactPath(pathname: string): boolean {
  return canonicalProxyRoutePath(pathname) === '/responses/compact';
}

export function isModelsPath(pathname: string): boolean {
  return isOpenAICompatibleModelsProxyPath(pathname);
}

export function isOpenAICompatibleResponsesProxyPath(pathname: string): boolean {
  return isResponsesPath(pathname);
}

export function isOpenAICompatibleChatCompletionsProxyPath(pathname: string): boolean {
  return canonicalProxyRoutePath(pathname) === '/chat/completions';
}

export function isOpenAICompatibleModelsProxyPath(pathname: string): boolean {
  return canonicalProxyRoutePath(pathname) === '/models';
}

function canonicalProxyRoutePath(pathname: string): string {
  const [pathOnly] = normalizeString(pathname).split('?', 1);
  let path = normalizePath(pathOnly) || '/';
  while (path.startsWith('/v1/v1/')) {
    path = `/v1${path.slice('/v1/v1'.length)}`;
  }
  if (path === '/codex/v1') {
    return '/';
  }
  if (path.startsWith('/codex/v1/')) {
    path = path.slice('/codex/v1'.length);
  }
  if (path.startsWith('/v1/')) {
    path = path.slice('/v1'.length);
  }
  return path;
}
