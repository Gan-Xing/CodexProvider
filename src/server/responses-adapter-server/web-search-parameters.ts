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
  const invalid = inspectWebSearchTools(effectiveRequest.tools, 'tools', normalizedStrategy, adjustments)
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
  return inspectWebSearchTools(record.tools, 'tool_choice.tools', strategy, adjustments);
}

function inspectWebSearchTools(
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
    if (normalizeCodexProviderBuiltinToolName(record.type) !== 'web_search') {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(record, 'return_token_budget')) {
      continue;
    }
    const fieldPath = `${path}[${index}].return_token_budget`;
    if (isWebSearchReturnTokenBudgetValue(record.return_token_budget)) {
      continue;
    }
    if (strategy === 'drop') {
      adjustments.push({
        kind: 'field_filtered',
        path: fieldPath,
        reason: 'invalid_web_search_parameter_drop',
        before: record.return_token_budget,
      });
      delete record.return_token_budget;
      continue;
    }
    return new CodexProviderWebSearchInvalidParameterError(fieldPath, record.return_token_budget);
  }
  return null;
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
