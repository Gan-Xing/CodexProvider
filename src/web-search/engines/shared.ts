import type {
  CodexProviderEngineHttpResponse,
  JsonRecord,
} from '../metasearch/index.js';

export function jsonRecordFromEngineResponse(
  response: CodexProviderEngineHttpResponse,
  provider: string,
): JsonRecord {
  const json = response.json ?? parseJsonOrThrow(response.text, provider);
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error(`${provider} web_search response must be a JSON object.`);
  }
  return json as JsonRecord;
}

export function normalizeEngineString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeEngineArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeEngineNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeEngineEndpoint(value: unknown, fallback: string): string {
  return normalizeEngineString(value) || fallback;
}

export function normalizeEngineApiKey(value: unknown, provider: string): string {
  const apiKey = normalizeEngineString(value);
  if (!apiKey) {
    throw new Error(`${provider} web_search engine requires an API key.`);
  }
  return apiKey;
}

export function normalizeEngineLanguage(value: unknown): string {
  return normalizeEngineString(value).toLowerCase();
}

export function normalizeEngineRegion(value: unknown): string {
  return normalizeEngineString(value).toLowerCase();
}

function parseJsonOrThrow(text: string, provider: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${provider} web_search response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
