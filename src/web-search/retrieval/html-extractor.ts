export interface CodexProviderHtmlExtractionResult {
  title: string;
  description: string;
  text: string;
  language: string | null;
}

export function extractCodexProviderHtmlDocument(html: string): CodexProviderHtmlExtractionResult {
  const withoutHidden = stripHiddenHtml(html);
  return {
    title: htmlText(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/iu)),
    description: htmlText(firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/iu)
      || firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/iu)),
    text: htmlText(blockAwareHtmlToText(withoutHidden)),
    language: firstMatch(html, /<html[^>]+lang=["']([^"']+)["'][^>]*>/iu) || null,
  };
}

export function htmlText(value: string): string {
  return collapseWhitespace(decodeHtmlEntities(stripHtmlTags(value)));
}

export function textFromPlainRetrievalDocument(value: string): string {
  return collapseWhitespace(decodeHtmlEntities(value));
}

function stripHiddenHtml(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/giu, ' ');
}

function blockAwareHtmlToText(value: string): string {
  return value
    .replace(/<\/(?:p|div|article|section|header|footer|main|li|ul|ol|h[1-6]|blockquote|pre|table|tr)>/giu, '\n')
    .replace(/<br\s*\/?>/giu, '\n');
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/gu, ' ');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function firstMatch(value: string, pattern: RegExp): string {
  return pattern.exec(value)?.[1] ?? '';
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}
