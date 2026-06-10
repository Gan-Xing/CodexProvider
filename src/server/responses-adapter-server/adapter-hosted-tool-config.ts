import {
  normalizeCodexProviderBuiltinToolName,
} from '../../builtin-tools/index.js';
import type {
  NormalizedCodexProviderHostedToolDeclaration,
} from '../../hosted_tools.js';
import type {
  JsonRecord,
} from './types.js';
import {
  cloneJson,
  normalizeArray,
  normalizeString,
  omitUndefined,
} from './utils.js';

export interface AdapterHostedToolRequestConfig {
  canonicalToolName: string;
  originalToolType: string;
  emulatedToolName: string;
  config: JsonRecord;
}

export type AdapterHostedToolRequestConfigMap = Map<string, AdapterHostedToolRequestConfig>;

const IMPOSSIBLE_ALLOWED_DOMAIN = 'codex-provider-no-allowed-domain-match.invalid';
const IMPOSSIBLE_VECTOR_STORE_ID = '__codex_provider_no_vector_store_match__';
const IMPOSSIBLE_FILE_SEARCH_FILTER = {
  type: 'eq',
  key: '__codex_provider_no_match__',
  value: '__codex_provider_impossible_value__',
};

export function extractAdapterHostedToolRequestConfigs(
  request: JsonRecord,
  hostedTools: NormalizedCodexProviderHostedToolDeclaration[],
): AdapterHostedToolRequestConfigMap {
  const configs: AdapterHostedToolRequestConfigMap = new Map();
  for (const tool of normalizeArray(request?.tools)) {
    if (!tool || typeof tool !== 'object') {
      continue;
    }
    const record = tool as JsonRecord;
    const originalToolType = normalizeString(record.type);
    const canonicalToolName = normalizeCodexProviderBuiltinToolName(originalToolType) ?? originalToolType;
    const declaration = hostedTools.find((hostedTool) => (
      hostedTool.mode === 'adapter-emulated'
      && hostedTool.name === canonicalToolName
    ));
    if (!declaration) {
      continue;
    }
    const emulatedToolName = normalizeString(declaration.emulatedToolName || declaration.name);
    if (!emulatedToolName) {
      continue;
    }
    const config = cloneJson(record);
    delete config.type;
    const requestConfig: AdapterHostedToolRequestConfig = {
      canonicalToolName: declaration.name,
      originalToolType,
      emulatedToolName,
      config,
    };
    const existing = configs.get(emulatedToolName);
    configs.set(emulatedToolName, existing
      ? {
        ...requestConfig,
        config: mergeAdapterHostedToolArguments(declaration.name, existing.config, requestConfig.config),
      }
      : requestConfig);
  }
  return configs;
}

export function mergeAdapterHostedToolArguments(
  toolName: string,
  modelArguments: JsonRecord,
  requestConfig: JsonRecord | null | undefined,
): JsonRecord {
  if (!requestConfig || Object.keys(requestConfig).length === 0) {
    return cloneJson(modelArguments);
  }
  const canonicalToolName = normalizeCodexProviderBuiltinToolName(toolName) ?? toolName;
  if (canonicalToolName === 'web_search') {
    return mergeWebSearchArguments(modelArguments, requestConfig);
  }
  if (canonicalToolName === 'file_search') {
    return mergeFileSearchArguments(modelArguments, requestConfig);
  }
  return {
    ...cloneJson(requestConfig),
    ...cloneJson(modelArguments),
  };
}

export function summarizeAdapterHostedToolConfigBinding({
  toolName,
  modelArguments,
  effectiveArguments,
  requestConfig,
}: {
  toolName: string;
  modelArguments: JsonRecord;
  effectiveArguments: JsonRecord;
  requestConfig: AdapterHostedToolRequestConfig | null | undefined;
}): JsonRecord {
  const summary: JsonRecord = {
    requestConfigApplied: Boolean(requestConfig && Object.keys(requestConfig.config).length > 0),
    requestConfigKeys: safeKeys(requestConfig?.config ?? {}),
    modelArgumentKeys: safeKeys(modelArguments),
    effectiveArgumentKeys: safeKeys(effectiveArguments),
  };
  const canonicalToolName = normalizeCodexProviderBuiltinToolName(toolName) ?? toolName;
  if (canonicalToolName === 'web_search') {
    const requestFilters = webSearchFilters(requestConfig?.config?.filters);
    const modelFilters = webSearchFilters(modelArguments.filters);
    const effectiveFilters = webSearchFilters(effectiveArguments.filters);
    return {
      ...summary,
      filters: {
        requestAllowedDomainCount: requestFilters.allowedDomains.length,
        modelAllowedDomainCount: modelFilters.allowedDomains.length,
        effectiveAllowedDomainCount: effectiveFilters.allowedDomains.length,
        requestBlockedDomainCount: requestFilters.blockedDomains.length,
        modelBlockedDomainCount: modelFilters.blockedDomains.length,
        effectiveBlockedDomainCount: effectiveFilters.blockedDomains.length,
      },
      externalWebAccessFalse: effectiveArguments.external_web_access === false,
      maxResultsBound: effectiveArguments.max_results !== undefined || effectiveArguments.max_num_results !== undefined,
      returnTokenBudgetBound: effectiveArguments.return_token_budget !== undefined,
      userLocationBound: effectiveArguments.user_location !== undefined,
    };
  }
  if (canonicalToolName === 'file_search') {
    return {
      ...summary,
      requestVectorStoreIdCount: normalizeStringArray(requestConfig?.config?.vector_store_ids).length,
      modelVectorStoreIdCount: normalizeStringArray(modelArguments.vector_store_ids).length,
      effectiveVectorStoreIdCount: normalizeStringArray(effectiveArguments.vector_store_ids).length,
      filtersBound: effectiveArguments.filters !== undefined,
      maxResultsBound: effectiveArguments.max_num_results !== undefined || effectiveArguments.max_results !== undefined,
      includeContentFalse: effectiveArguments.include_content === false,
    };
  }
  return summary;
}

function mergeWebSearchArguments(
  modelArguments: JsonRecord,
  requestConfig: JsonRecord,
): JsonRecord {
  const request = cloneJson(requestConfig);
  const model = cloneJson(modelArguments);
  const merged: JsonRecord = {
    ...request,
    ...model,
  };
  for (const key of ['search_context_size', 'return_token_budget', 'user_location']) {
    if (request[key] !== undefined) {
      merged[key] = cloneJson(request[key]);
    }
  }
  const externalWebAccess = mergeFalseDominatesBoolean(
    request.external_web_access,
    model.external_web_access,
  );
  if (externalWebAccess !== undefined) {
    merged.external_web_access = externalWebAccess;
  }
  const filters = mergeWebSearchFilters(request.filters, model.filters);
  if (filters) {
    merged.filters = filters;
  }
  const maxResults = smallerPositiveInteger([
    request.max_results,
    request.max_num_results,
    request.num_results,
    model.max_results,
    model.max_num_results,
    model.num_results,
  ]);
  if (maxResults !== null) {
    merged.max_results = maxResults;
  }
  return omitUndefined(merged);
}

function mergeFileSearchArguments(
  modelArguments: JsonRecord,
  requestConfig: JsonRecord,
): JsonRecord {
  const request = cloneJson(requestConfig);
  const model = cloneJson(modelArguments);
  const merged: JsonRecord = {
    ...request,
    ...model,
  };
  const vectorStoreIds = mergeRestrictiveStringLists(
    normalizeStringArray(request.vector_store_ids),
    normalizeStringArray(model.vector_store_ids),
    {
      caseInsensitive: true,
      emptyIntersectionValue: IMPOSSIBLE_VECTOR_STORE_ID,
    },
  );
  if (vectorStoreIds !== null) {
    merged.vector_store_ids = vectorStoreIds;
  }
  const filters = mergeFileSearchFilters(
    mergeFileSearchFilters(request.filters, model.filters),
    vectorStoreIds?.length === 1 && vectorStoreIds[0] === IMPOSSIBLE_VECTOR_STORE_ID
      ? IMPOSSIBLE_FILE_SEARCH_FILTER
      : undefined,
  );
  if (filters !== undefined) {
    merged.filters = filters;
  }
  const rankingOptions = mergeFileSearchRankingOptions(request.ranking_options, model.ranking_options);
  if (rankingOptions !== undefined) {
    merged.ranking_options = rankingOptions;
  }
  const maxResults = smallerPositiveInteger([
    request.max_num_results,
    request.max_results,
    model.max_num_results,
    model.max_results,
  ]);
  if (maxResults !== null) {
    merged.max_num_results = maxResults;
  }
  const includeContent = mergeFalseDominatesBoolean(
    request.include_content,
    model.include_content,
  );
  if (includeContent !== undefined) {
    merged.include_content = includeContent;
  }
  return omitUndefined(merged);
}

function mergeWebSearchFilters(
  requestFiltersValue: unknown,
  modelFiltersValue: unknown,
): JsonRecord | undefined {
  const requestFilters = webSearchFilters(requestFiltersValue);
  const modelFilters = webSearchFilters(modelFiltersValue);
  const allowedDomains = mergeRestrictiveStringLists(
    requestFilters.allowedDomains,
    modelFilters.allowedDomains,
    {
      caseInsensitive: true,
      emptyIntersectionValue: IMPOSSIBLE_ALLOWED_DOMAIN,
    },
  );
  const blockedDomains = uniqueStrings([
    ...requestFilters.blockedDomains,
    ...modelFilters.blockedDomains,
  ], { caseInsensitive: true });
  const merged: JsonRecord = {};
  if (allowedDomains !== null) {
    merged.allowed_domains = allowedDomains;
  }
  if (blockedDomains.length > 0) {
    merged.blocked_domains = blockedDomains;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function webSearchFilters(value: unknown): { allowedDomains: string[]; blockedDomains: string[] } {
  if (!value || typeof value !== 'object') {
    return {
      allowedDomains: [],
      blockedDomains: [],
    };
  }
  const record = value as JsonRecord;
  return {
    allowedDomains: normalizeDomainList(
      record.allowed_domains ?? record.allowedDomains ?? record.include_domains ?? record.includeDomains,
    ),
    blockedDomains: normalizeDomainList(
      record.blocked_domains ?? record.blockedDomains ?? record.exclude_domains ?? record.excludeDomains,
    ),
  };
}

function mergeFileSearchFilters(
  requestFilters: unknown,
  modelFilters: unknown,
): unknown {
  const hasRequestFilters = isJsonRecord(requestFilters);
  const hasModelFilters = isJsonRecord(modelFilters);
  if (hasRequestFilters && hasModelFilters) {
    return {
      type: 'and',
      filters: [
        cloneJson(requestFilters),
        cloneJson(modelFilters),
      ],
    };
  }
  if (hasRequestFilters) {
    return cloneJson(requestFilters);
  }
  if (hasModelFilters) {
    return cloneJson(modelFilters);
  }
  return undefined;
}

function mergeFileSearchRankingOptions(
  requestRankingOptions: unknown,
  modelRankingOptions: unknown,
): JsonRecord | undefined {
  if (!isJsonRecord(requestRankingOptions) && !isJsonRecord(modelRankingOptions)) {
    return undefined;
  }
  const request = isJsonRecord(requestRankingOptions) ? requestRankingOptions : {};
  const model = isJsonRecord(modelRankingOptions) ? modelRankingOptions : {};
  const merged: JsonRecord = {
    ...cloneJson(request),
    ...cloneJson(model),
  };
  if (request.ranker !== undefined) {
    merged.ranker = cloneJson(request.ranker);
  }
  if (request.hybrid_search !== undefined) {
    merged.hybrid_search = cloneJson(request.hybrid_search);
  }
  const scoreThreshold = greaterFiniteNumber([
    request.score_threshold,
    model.score_threshold,
  ]);
  if (scoreThreshold !== null) {
    merged.score_threshold = scoreThreshold;
  }
  return omitUndefined(merged);
}

function mergeRestrictiveStringLists(
  requestList: string[],
  modelList: string[],
  options: { caseInsensitive?: boolean; emptyIntersectionValue?: string } = {},
): string[] | null {
  if (requestList.length > 0 && modelList.length > 0) {
    const modelKeys = new Set(modelList.map((entry) => stringKey(entry, options)));
    const intersection = requestList.filter((entry) => modelKeys.has(stringKey(entry, options)));
    return intersection.length > 0
      ? intersection
      : options.emptyIntersectionValue ? [options.emptyIntersectionValue] : [];
  }
  if (requestList.length > 0) {
    return requestList;
  }
  if (modelList.length > 0) {
    return modelList;
  }
  return null;
}

function mergeFalseDominatesBoolean(
  requestValue: unknown,
  modelValue: unknown,
): boolean | undefined {
  if (requestValue === false || modelValue === false) {
    return false;
  }
  if (typeof modelValue === 'boolean') {
    return modelValue;
  }
  if (typeof requestValue === 'boolean') {
    return requestValue;
  }
  return undefined;
}

function normalizeDomainList(value: unknown): string[] {
  return uniqueStrings(normalizeStringArray(value).map((entry) => (
    entry
      .replace(/^https?:\/\//iu, '')
      .replace(/\/.*$/u, '')
      .toLowerCase()
  )).filter(Boolean));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map((entry) => normalizeString(entry)).filter(Boolean));
}

function uniqueStrings(
  values: string[],
  options: { caseInsensitive?: boolean } = {},
): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const key = stringKey(value, options);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function stringKey(value: string, options: { caseInsensitive?: boolean }): string {
  return options.caseInsensitive ? value.toLowerCase() : value;
}

function smallerPositiveInteger(values: unknown[]): number | null {
  const normalized = values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (normalized.length === 0) {
    return null;
  }
  return Math.min(...normalized);
}

function greaterFiniteNumber(values: unknown[]): number | null {
  const normalized = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (normalized.length === 0) {
    return null;
  }
  return Math.max(...normalized);
}

function safeKeys(value: JsonRecord): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.keys(value).sort();
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
