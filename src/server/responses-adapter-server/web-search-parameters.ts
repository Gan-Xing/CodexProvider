import {
  normalizeCodexProviderBuiltinToolName,
} from '../../builtin-tools/index.js';
import type {
  CodexProviderWebSearchInvalidParameterStrategy,
} from '../../web-search/types.js';
import {
  CodexProviderWebSearchInvalidParameterError,
  isWebSearchReturnTokenBudgetValue,
  normalizeWebSearchInvalidParameterStrategy,
} from '../../web-search/validation.js';
import type {
  CodexProviderRequestAdjustment,
  JsonRecord,
} from './types.js';
import {
  normalizeArray,
  normalizeString,
} from './utils.js';

export interface WebSearchParameterValidationResult {
  requestBody: JsonRecord;
  adjustments: CodexProviderRequestAdjustment[];
  error: JsonRecord | null;
}

export function validateWebSearchRequestParameters(
  requestBody: JsonRecord,
  strategy: CodexProviderWebSearchInvalidParameterStrategy | null | undefined,
): WebSearchParameterValidationResult {
  const normalizedStrategy = normalizeWebSearchInvalidParameterStrategy(strategy);
  const effectiveRequest = normalizedStrategy === 'drop' ? cloneJson(requestBody) : requestBody;
  const adjustments: CodexProviderRequestAdjustment[] = [];
  const invalid = inspectHostedToolDeclarations(effectiveRequest.tools, 'tools', normalizedStrategy, adjustments)
    ?? inspectAllowedToolChoice(effectiveRequest.tool_choice, normalizedStrategy, adjustments);
  if (invalid) {
    return {
      requestBody,
      adjustments: [],
      error: invalidParameterErrorBody(invalid),
    };
  }
  return {
    requestBody: effectiveRequest,
    adjustments,
    error: null,
  };
}

function inspectAllowedToolChoice(
  toolChoice: unknown,
  strategy: CodexProviderWebSearchInvalidParameterStrategy,
  adjustments: CodexProviderRequestAdjustment[],
): CodexProviderWebSearchInvalidParameterError | null {
  if (!toolChoice || typeof toolChoice !== 'object') {
    return null;
  }
  const record = toolChoice as JsonRecord;
  if (normalizeString(record.type) !== 'allowed_tools') {
    return null;
  }
  return inspectHostedToolDeclarations(record.tools, 'tool_choice.tools', strategy, adjustments);
}

function inspectHostedToolDeclarations(
  tools: unknown,
  path: string,
  strategy: CodexProviderWebSearchInvalidParameterStrategy,
  adjustments: CodexProviderRequestAdjustment[],
): CodexProviderWebSearchInvalidParameterError | null {
  for (const [index, tool] of normalizeArray(tools).entries()) {
    if (!tool || typeof tool !== 'object') {
      continue;
    }
    const record = tool as JsonRecord;
    const toolName = normalizeCodexProviderBuiltinToolName(record.type);
    if (toolName === 'web_search') {
      const invalid = inspectWebSearchTool(record, `${path}[${index}]`, strategy, adjustments);
      if (invalid) {
        return invalid;
      }
      continue;
    }
    if (toolName === 'file_search') {
      const invalid = inspectFileSearchTool(record, `${path}[${index}]`, strategy, adjustments);
      if (invalid) {
        return invalid;
      }
      continue;
    }
  }
  return null;
}

function inspectWebSearchTool(
  record: JsonRecord,
  path: string,
  strategy: CodexProviderWebSearchInvalidParameterStrategy,
  adjustments: CodexProviderRequestAdjustment[],
): CodexProviderWebSearchInvalidParameterError | null {
  if (hasOwn(record, 'search_context_size') && !['low', 'medium', 'high'].includes(record.search_context_size)) {
    const invalid = invalidOrDrop(record, 'search_context_size', `${path}.search_context_size`, record.search_context_size, '"low", "medium", or "high"', strategy, adjustments, 'invalid_web_search_parameter_drop');
    if (invalid) {
      return invalid;
    }
  }
  if (hasOwn(record, 'filters')) {
    if (!isJsonRecord(record.filters)) {
      const invalid = invalidOrDrop(record, 'filters', `${path}.filters`, record.filters, 'object', strategy, adjustments, 'invalid_web_search_parameter_drop');
      if (invalid) {
        return invalid;
      }
    }
    if (hasOwn(record, 'filters')) {
      const invalid = inspectWebSearchFilters(record.filters, `${path}.filters`, strategy, adjustments);
      if (invalid) {
        return invalid;
      }
      if (isJsonRecord(record.filters) && Object.keys(record.filters).length === 0) {
        delete record.filters;
      }
    }
  }
  if (hasOwn(record, 'external_web_access') && typeof record.external_web_access !== 'boolean') {
    const invalid = invalidOrDrop(record, 'external_web_access', `${path}.external_web_access`, record.external_web_access, 'boolean', strategy, adjustments, 'invalid_web_search_parameter_drop');
    if (invalid) {
      return invalid;
    }
  }
  if (hasOwn(record, 'user_location') && !isJsonRecord(record.user_location)) {
    const invalid = invalidOrDrop(record, 'user_location', `${path}.user_location`, record.user_location, 'object', strategy, adjustments, 'invalid_web_search_parameter_drop');
    if (invalid) {
      return invalid;
    }
  }
  if (hasOwn(record, 'return_token_budget') && !isWebSearchReturnTokenBudgetValue(record.return_token_budget)) {
    const invalid = invalidOrDrop(record, 'return_token_budget', `${path}.return_token_budget`, record.return_token_budget, '"default" or "unlimited"', strategy, adjustments, 'invalid_web_search_parameter_drop');
    if (invalid) {
      return invalid;
    }
  }
  for (const key of ['max_results', 'max_num_results', 'num_results']) {
    if (hasOwn(record, key) && !isIntegerInRange(record[key], 1, 50)) {
      const invalid = invalidOrDrop(record, key, `${path}.${key}`, record[key], 'integer from 1 to 50', strategy, adjustments, 'invalid_web_search_parameter_drop');
      if (invalid) {
        return invalid;
      }
    }
  }
  return null;
}

function inspectWebSearchFilters(
  value: unknown,
  path: string,
  strategy: CodexProviderWebSearchInvalidParameterStrategy,
  adjustments: CodexProviderRequestAdjustment[],
): CodexProviderWebSearchInvalidParameterError | null {
  const record = value as JsonRecord;
  for (const key of ['allowed_domains', 'allowedDomains', 'include_domains', 'includeDomains']) {
    if (!hasOwn(record, key)) {
      continue;
    }
    if (!isValidDomainFilterList(record[key])) {
      const invalid = invalidOrDrop(record, key, `${path}.${key}`, record[key], 'array of up to 100 domain strings', strategy, adjustments, 'invalid_web_search_parameter_drop');
      if (invalid) {
        return invalid;
      }
    }
  }
  for (const key of ['blocked_domains', 'blockedDomains', 'exclude_domains', 'excludeDomains']) {
    if (!hasOwn(record, key)) {
      continue;
    }
    if (!isValidDomainFilterList(record[key])) {
      const invalid = invalidOrDrop(record, key, `${path}.${key}`, record[key], 'array of up to 100 domain strings', strategy, adjustments, 'invalid_web_search_parameter_drop');
      if (invalid) {
        return invalid;
      }
    }
  }
  return null;
}

function inspectFileSearchTool(
  record: JsonRecord,
  path: string,
  strategy: CodexProviderWebSearchInvalidParameterStrategy,
  adjustments: CodexProviderRequestAdjustment[],
): CodexProviderWebSearchInvalidParameterError | null {
  if (hasOwn(record, 'vector_store_ids') && !isValidStringList(record.vector_store_ids, 100)) {
    const invalid = invalidOrDrop(record, 'vector_store_ids', `${path}.vector_store_ids`, record.vector_store_ids, 'array of up to 100 strings', strategy, adjustments, 'invalid_file_search_parameter_drop');
    if (invalid) {
      return invalid;
    }
  }
  for (const key of ['max_num_results', 'max_results']) {
    if (hasOwn(record, key) && !isIntegerInRange(record[key], 1, 50)) {
      const invalid = invalidOrDrop(record, key, `${path}.${key}`, record[key], 'integer from 1 to 50', strategy, adjustments, 'invalid_file_search_parameter_drop');
      if (invalid) {
        return invalid;
      }
    }
  }
  if (hasOwn(record, 'filters')) {
    const invalid = validateFileSearchFilter(record.filters, `${path}.filters`);
    if (invalid) {
      const handled = invalidOrDrop(record, 'filters', invalid.path, invalid.value, invalid.expected, strategy, adjustments, 'invalid_file_search_parameter_drop');
      if (handled) {
        return handled;
      }
    }
  }
  if (hasOwn(record, 'ranking_options')) {
    if (!isJsonRecord(record.ranking_options)) {
      const invalid = invalidOrDrop(record, 'ranking_options', `${path}.ranking_options`, record.ranking_options, 'object', strategy, adjustments, 'invalid_file_search_parameter_drop');
      if (invalid) {
        return invalid;
      }
    }
    if (isJsonRecord(record.ranking_options)) {
      const rankingOptions = record.ranking_options;
      if (
        hasOwn(rankingOptions, 'score_threshold')
        && !(typeof rankingOptions.score_threshold === 'number' && rankingOptions.score_threshold >= 0 && rankingOptions.score_threshold <= 1)
      ) {
        const invalid = invalidOrDrop(rankingOptions, 'score_threshold', `${path}.ranking_options.score_threshold`, rankingOptions.score_threshold, 'number from 0 to 1', strategy, adjustments, 'invalid_file_search_parameter_drop');
        if (invalid) {
          return invalid;
        }
      }
    }
  }
  return null;
}

function invalidOrDrop(
  record: JsonRecord,
  key: string,
  path: string,
  value: unknown,
  expected: string,
  strategy: CodexProviderWebSearchInvalidParameterStrategy,
  adjustments: CodexProviderRequestAdjustment[],
  reason: string,
): CodexProviderWebSearchInvalidParameterError | null {
  if (strategy === 'drop') {
    adjustments.push({
      kind: 'field_filtered',
      path,
      reason,
      before: value,
    });
    delete record[key];
    return null;
  }
  return new CodexProviderWebSearchInvalidParameterError(path, value, expected);
}

function validateFileSearchFilter(
  value: unknown,
  path: string,
  depth = 0,
): { path: string; value: unknown; expected: string } | null {
  if (depth > 20) {
    return { path, value, expected: 'filter tree with depth of 20 or less' };
  }
  if (!isJsonRecord(value)) {
    return { path, value, expected: 'recognized file_search filter object' };
  }
  const type = normalizeString(value.type).toLowerCase();
  if (type === 'and' || type === 'or') {
    if (!Array.isArray(value.filters) || value.filters.length === 0 || value.filters.length > 100) {
      return { path: `${path}.filters`, value: value.filters, expected: 'array of 1 to 100 filters' };
    }
    for (const [index, filter] of value.filters.entries()) {
      const invalid = validateFileSearchFilter(filter, `${path}.filters[${index}]`, depth + 1);
      if (invalid) {
        return invalid;
      }
    }
    return null;
  }
  if (!['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin'].includes(type)) {
    return { path: `${path}.type`, value: value.type, expected: 'one of "and", "or", "eq", "ne", "gt", "gte", "lt", "lte", "in", or "nin"' };
  }
  const key = normalizeString(value.key ?? value.property);
  if (!key) {
    return { path: hasOwn(value, 'key') ? `${path}.key` : `${path}.property`, value: value.key ?? value.property, expected: 'non-empty string' };
  }
  if (!hasOwn(value, 'value')) {
    return { path: `${path}.value`, value: undefined, expected: 'filter comparison value' };
  }
  if ((type === 'in' || type === 'nin') && !Array.isArray(value.value)) {
    return { path: `${path}.value`, value: value.value, expected: 'array value for "in" or "nin" filter' };
  }
  return null;
}

function isValidDomainFilterList(value: unknown): boolean {
  return Array.isArray(value)
    && value.length <= 100
    && value.every((entry) => typeof entry === 'string' && isValidDomainFilterEntry(entry));
}

function isValidDomainFilterEntry(value: string): boolean {
  const raw = value.trim();
  if (!raw || raw.includes('*') || /\s/u.test(raw)) {
    return false;
  }
  let hostname = raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(raw)) {
    if (!/^https?:\/\//iu.test(raw)) {
      return false;
    }
    try {
      const url = new URL(raw);
      if (url.username || url.password) {
        return false;
      }
      hostname = url.hostname;
    } catch {
      return false;
    }
  } else {
    hostname = raw.replace(/\/.*$/u, '');
  }
  return /^[A-Za-z0-9.-]+$/u.test(hostname)
    && !hostname.startsWith('.')
    && !hostname.endsWith('.')
    && hostname.includes('.');
}

function isValidStringList(value: unknown, maxLength: number): boolean {
  return Array.isArray(value)
    && value.length <= maxLength
    && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidParameterErrorBody(error: CodexProviderWebSearchInvalidParameterError): JsonRecord {
  return {
    message: error.message,
    type: error.type,
    code: error.code,
    param: error.param,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
