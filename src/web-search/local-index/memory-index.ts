import {
  canonicalSearchResultUrl,
  searchUrlMatchesDomainFilters,
} from '../metasearch/dedupe.js';
import {
  tokenizeSearchText,
} from '../metasearch/score.js';

export interface CodexProviderLocalIndexDocument {
  url: string;
  finalUrl?: string | null;
  title?: string | null;
  text: string;
  snippet?: string | null;
  contentType?: string | null;
  fetchedAt?: string | null;
  source?: string | null;
  metadata?: Record<string, any> | null;
}

export interface CodexProviderLocalIndexSearchRequest {
  query: string;
  maxResults?: number | null;
  allowedDomains?: string[] | null;
  blockedDomains?: string[] | null;
}

export interface CodexProviderLocalIndexSearchResult extends CodexProviderLocalIndexDocument {
  title: string;
  snippet: string;
  score: number;
  rank: number;
}

export interface CodexProviderLocalIndexStats {
  entries: number;
}

export interface CodexProviderLocalIndexStore {
  upsert(document: CodexProviderLocalIndexDocument): void;
  upsertMany?(documents: CodexProviderLocalIndexDocument[]): void;
  delete(url: string): boolean;
  clear(): void;
  search(request: CodexProviderLocalIndexSearchRequest): CodexProviderLocalIndexSearchResult[];
  snapshotStats?(): CodexProviderLocalIndexStats;
}

export interface CodexProviderMemoryLocalIndexOptions {
  documents?: CodexProviderLocalIndexDocument[] | null;
  maxEntries?: number | null;
}

interface StoredLocalIndexDocument extends Required<Omit<CodexProviderLocalIndexDocument, 'metadata'>> {
  key: string;
  metadata: Record<string, any> | null;
}

export function createCodexProviderMemoryWebSearchLocalIndex(
  options: CodexProviderMemoryLocalIndexOptions = {},
): CodexProviderLocalIndexStore {
  return new CodexProviderMemoryWebSearchLocalIndex(options);
}

class CodexProviderMemoryWebSearchLocalIndex implements CodexProviderLocalIndexStore {
  private readonly maxEntries: number;
  private readonly documents = new Map<string, StoredLocalIndexDocument>();

  constructor(options: CodexProviderMemoryLocalIndexOptions) {
    this.maxEntries = clampInteger(options.maxEntries, 1, 100_000, 10_000);
    this.upsertMany(options.documents ?? []);
  }

  upsert(document: CodexProviderLocalIndexDocument): void {
    const normalized = normalizeLocalIndexDocument(document);
    const existing = this.documents.get(normalized.key);
    if (existing) {
      this.documents.delete(normalized.key);
    }
    this.documents.set(normalized.key, normalized);
    this.evictOverflow();
  }

  upsertMany(documents: CodexProviderLocalIndexDocument[]): void {
    for (const document of documents) {
      this.upsert(document);
    }
  }

  delete(url: string): boolean {
    return this.documents.delete(canonicalSearchResultUrl(url));
  }

  clear(): void {
    this.documents.clear();
  }

  search(request: CodexProviderLocalIndexSearchRequest): CodexProviderLocalIndexSearchResult[] {
    const query = normalizeString(request.query);
    const terms = tokenizeSearchText(query);
    const maxResults = clampInteger(request.maxResults, 1, 50, 10);
    return [...this.documents.values()]
      .filter((document) => searchUrlMatchesDomainFilters(
        document.finalUrl || document.url,
        normalizeDomainList(request.allowedDomains),
        normalizeDomainList(request.blockedDomains),
      ))
      .map((document) => scoreLocalIndexDocument(document, query, terms))
      .filter((result) => result.score > 0 || terms.length === 0)
      .sort((left, right) => (
        right.score - left.score
        || compareFetchedAt(right.fetchedAt, left.fetchedAt)
        || left.url.localeCompare(right.url)
      ))
      .slice(0, maxResults)
      .map((result, index) => ({
        ...result,
        rank: index + 1,
      }));
  }

  snapshotStats(): CodexProviderLocalIndexStats {
    return {
      entries: this.documents.size,
    };
  }

  private evictOverflow(): void {
    while (this.documents.size > this.maxEntries) {
      const oldestKey = this.documents.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.documents.delete(oldestKey);
    }
  }
}

function normalizeLocalIndexDocument(document: CodexProviderLocalIndexDocument): StoredLocalIndexDocument {
  const url = normalizeUrl(document.finalUrl) || normalizeUrl(document.url);
  if (!url) {
    throw new Error('Local web search index document requires a valid URL.');
  }
  const text = normalizeWhitespace(document.text);
  const title = normalizeString(document.title) || titleFromUrl(url);
  const snippet = normalizeWhitespace(document.snippet) || buildLocalIndexSnippet(text, tokenizeSearchText(title));
  return {
    key: canonicalSearchResultUrl(url),
    url: normalizeUrl(document.url) || url,
    finalUrl: url,
    title,
    text,
    snippet,
    contentType: normalizeString(document.contentType),
    fetchedAt: normalizeString(document.fetchedAt),
    source: normalizeString(document.source),
    metadata: document.metadata && typeof document.metadata === 'object'
      ? { ...document.metadata }
      : null,
  };
}

function scoreLocalIndexDocument(
  document: StoredLocalIndexDocument,
  query: string,
  terms: string[],
): CodexProviderLocalIndexSearchResult {
  if (terms.length === 0) {
    return localIndexResultFromDocument(document, 1, document.snippet);
  }
  const titleTerms = tokenizeSearchText(document.title);
  const snippetTerms = tokenizeSearchText(document.snippet);
  const textTerms = tokenizeSearchText(document.text);
  const urlTerms = tokenizeSearchText(document.finalUrl || document.url);
  let score = 0;
  for (const term of terms) {
    score += countTerm(titleTerms, term) * 6;
    score += countTerm(snippetTerms, term) * 3;
    score += Math.min(8, countTerm(textTerms, term));
    score += countTerm(urlTerms, term) * 0.5;
  }
  const haystack = `${document.title} ${document.snippet} ${document.text}`.toLowerCase();
  if (query && haystack.includes(query.toLowerCase())) {
    score += 12;
  }
  return localIndexResultFromDocument(document, score, buildLocalIndexSnippet(document.text, terms) || document.snippet);
}

function localIndexResultFromDocument(
  document: StoredLocalIndexDocument,
  score: number,
  snippet: string,
): CodexProviderLocalIndexSearchResult {
  return {
    url: document.url,
    finalUrl: document.finalUrl,
    title: document.title,
    text: document.text,
    snippet,
    contentType: document.contentType,
    fetchedAt: document.fetchedAt,
    source: document.source,
    metadata: document.metadata ? { ...document.metadata } : null,
    score,
    rank: 0,
  };
}

function buildLocalIndexSnippet(text: string, terms: string[], maxLength = 240): string {
  const normalizedText = normalizeWhitespace(text);
  if (!normalizedText) {
    return '';
  }
  const lower = normalizedText.toLowerCase();
  const firstMatch = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, firstMatch - Math.floor(maxLength / 3));
  const end = Math.min(normalizedText.length, start + maxLength);
  return normalizedText.slice(start, end).trim();
}

function compareFetchedAt(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) {
    return 0;
  }
  return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
}

function countTerm(values: string[], term: string): number {
  return values.reduce((count, value) => count + (value === term ? 1 : 0), 0);
}

function normalizeUrl(value: unknown): string {
  const raw = normalizeString(value);
  if (!raw) {
    return '';
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function titleFromUrl(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function normalizeDomainList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => normalizeString(entry).toLowerCase()).filter(Boolean)
    : [];
}

function normalizeWhitespace(value: unknown): string {
  return normalizeString(value).replace(/\s+/gu, ' ').trim();
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}
