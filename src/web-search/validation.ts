import type {
  CodexProviderNormalizedWebSearchReturnTokenBudget,
  CodexProviderWebSearchInvalidParameterStrategy,
  CodexProviderWebSearchParameterWarning,
} from './types.js';

export class CodexProviderWebSearchInvalidParameterError extends Error {
  readonly type = 'invalid_request_error';

  readonly code = 'invalid_request';

  readonly status = 400;

  readonly param: string;

  constructor(param: string, value: unknown, expected = '"default" or "unlimited"') {
    super(invalidParameterErrorMessage(param, value, expected));
    this.name = 'CodexProviderWebSearchInvalidParameterError';
    this.param = param;
  }
}

export function normalizeWebSearchInvalidParameterStrategy(
  value: unknown,
): CodexProviderWebSearchInvalidParameterStrategy {
  return value === 'drop' ? 'drop' : 'error';
}

export function normalizeWebSearchReturnTokenBudget(
  value: unknown,
  {
    param = 'return_token_budget',
    strategy = 'error',
    warnings = null,
  }: {
    param?: string;
    strategy?: CodexProviderWebSearchInvalidParameterStrategy | null;
    warnings?: CodexProviderWebSearchParameterWarning[] | null;
  } = {},
): CodexProviderNormalizedWebSearchReturnTokenBudget {
  if (value === undefined) {
    return null;
  }
  if (value === 'default' || value === 'unlimited') {
    return value;
  }
  const normalizedStrategy = normalizeWebSearchInvalidParameterStrategy(strategy);
  if (normalizedStrategy === 'drop') {
    warnings?.push(buildWebSearchReturnTokenBudgetWarning(param, value));
    return null;
  }
  throw new CodexProviderWebSearchInvalidParameterError(param, value);
}

export function isWebSearchReturnTokenBudgetValue(value: unknown): boolean {
  return value === 'default' || value === 'unlimited';
}

export function buildWebSearchReturnTokenBudgetWarning(
  param: string,
  value: unknown,
): CodexProviderWebSearchParameterWarning {
  return {
    code: 'invalid_web_search_return_token_budget',
    param,
    message: webSearchReturnTokenBudgetErrorMessage(param, value),
    strategy: 'drop',
    valueType: valueType(value),
  };
}

function webSearchReturnTokenBudgetErrorMessage(param: string, value: unknown): string {
  return invalidParameterErrorMessage(param, value, '"default" or "unlimited"');
}

function invalidParameterErrorMessage(param: string, value: unknown, expected: string): string {
  return `Invalid value for ${param}: expected ${expected}, received ${describeValue(value)}.`;
}

function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return valueType(value);
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}
