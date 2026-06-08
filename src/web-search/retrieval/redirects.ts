import {
  assertSafeRetrievalUrl,
  type CodexProviderWebRetrievalSafetyOptions,
} from './safety.js';

export const DEFAULT_RETRIEVAL_MAX_REDIRECTS = 5;

export function isRetrievalRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function resolveRetrievalRedirectUrl(
  currentUrl: string,
  location: string | null,
  safetyOptions: CodexProviderWebRetrievalSafetyOptions = {},
): URL | null {
  if (!location) {
    return null;
  }
  const resolved = new URL(location, currentUrl);
  return assertSafeRetrievalUrl(resolved, safetyOptions);
}
