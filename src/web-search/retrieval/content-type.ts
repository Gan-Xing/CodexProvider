import {
  CodexProviderWebRetrievalError,
} from './safety.js';

export const DEFAULT_RETRIEVAL_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
  'application/xml',
  'text/xml',
];

export function normalizeRetrievalContentType(value: string | null | undefined): string {
  return String(value ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

export function isAllowedRetrievalContentType(
  value: string | null | undefined,
  allowedContentTypes: string[] = DEFAULT_RETRIEVAL_CONTENT_TYPES,
): boolean {
  const contentType = normalizeRetrievalContentType(value) || 'text/html';
  return allowedContentTypes
    .map((entry) => normalizeRetrievalContentType(entry))
    .filter(Boolean)
    .some((allowed) => contentType === allowed || contentType.endsWith(`+${allowed.split('/').pop()}`));
}

export function assertAllowedRetrievalContentType(
  value: string | null | undefined,
  allowedContentTypes: string[] = DEFAULT_RETRIEVAL_CONTENT_TYPES,
): string {
  const contentType = normalizeRetrievalContentType(value) || 'text/html';
  if (!isAllowedRetrievalContentType(contentType, allowedContentTypes)) {
    throw new CodexProviderWebRetrievalError(
      `Unsupported retrieval content type: ${contentType}`,
      'unsupported_content_type',
      null,
      false,
    );
  }
  return contentType;
}

export function isHtmlRetrievalContentType(value: string): boolean {
  const contentType = normalizeRetrievalContentType(value);
  return contentType === 'text/html' || contentType === 'application/xhtml+xml';
}
