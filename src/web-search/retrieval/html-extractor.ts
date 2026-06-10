export interface CodexProviderHtmlExtractionResult {
  title: string;
  description: string;
  canonicalUrl: string | null;
  text: string;
  language: string | null;
}

export function extractCodexProviderHtmlDocument(html: string): CodexProviderHtmlExtractionResult {
  const withoutHidden = stripHiddenHtml(html);
  const contentHtml = stripChromeHtml(selectMainContentHtml(withoutHidden));
  return {
    title: htmlText(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/iu)),
    description: metaDescriptionFromHtml(html),
    canonicalUrl: canonicalUrlFromHtml(html),
    text: htmlText(blockAwareHtmlToText(contentHtml)),
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
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/giu, ' ')
    .replace(/<([a-z][\w:-]*)\b(?=[^>]*(?:\shidden(?:\s|=|>)|\saria-hidden=["']?true["']?|\sstyle=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["']))[^>]*>[\s\S]*?<\/\1>/giu, ' ');
}

function stripChromeHtml(value: string): string {
  return value
    .replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<([a-z][\w:-]*)\b(?=[^>]*\srole=["']?(?:navigation|banner|contentinfo|complementary)["']?)[^>]*>[\s\S]*?<\/\1>/giu, ' ');
}

function blockAwareHtmlToText(value: string): string {
  return value
    .replace(/<\/(?:p|div|article|section|header|footer|main|li|ul|ol|h[1-6]|blockquote|pre|table|thead|tbody|tfoot|tr)>/giu, '\n')
    .replace(/<\/(?:td|th)>/giu, ' ')
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

function selectMainContentHtml(value: string): string {
  const candidates = [
    ...tagFragments(value, 'main'),
    ...tagFragments(value, 'article'),
  ];
  if (candidates.length > 0) {
    return candidates
      .map((candidate) => ({
        html: candidate,
        score: htmlText(blockAwareHtmlToText(stripChromeHtml(candidate))).length,
      }))
      .sort((left, right) => right.score - left.score)[0]?.html ?? value;
  }
  return firstMatch(value, /<body[^>]*>([\s\S]*?)<\/body>/iu) || value;
}

function tagFragments(value: string, tagName: string): string[] {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'giu');
  return [...value.matchAll(pattern)].map((match) => match[0]);
}

function metaDescriptionFromHtml(value: string): string {
  for (const tag of value.matchAll(/<meta\b[^>]*>/giu)) {
    if (attributeValue(tag[0], 'name').toLowerCase() !== 'description') {
      continue;
    }
    return htmlText(attributeValue(tag[0], 'content'));
  }
  return '';
}

function canonicalUrlFromHtml(value: string): string | null {
  for (const tag of value.matchAll(/<link\b[^>]*>/giu)) {
    const relTokens = attributeValue(tag[0], 'rel')
      .toLowerCase()
      .split(/\s+/u)
      .filter(Boolean);
    if (!relTokens.includes('canonical')) {
      continue;
    }
    const href = htmlText(attributeValue(tag[0], 'href'));
    return href || null;
  }
  return null;
}

function attributeValue(tag: string, name: string): string {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu');
  const match = pattern.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
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
