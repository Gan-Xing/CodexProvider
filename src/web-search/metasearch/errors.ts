import type {
  CodexProviderSearchEngineError,
} from './types.js';

export class CodexProviderMetaSearchError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | null = null,
    readonly retryable: boolean | null = null,
  ) {
    super(message);
    this.name = 'CodexProviderMetaSearchError';
  }
}

export function searchEngineErrorFromUnknown(
  error: unknown,
  fallbackCode = 'engine_error',
): CodexProviderSearchEngineError {
  if (error instanceof CodexProviderMetaSearchError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryable: error.retryable,
    };
  }
  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message,
      status: null,
      retryable: null,
    };
  }
  return {
    code: fallbackCode,
    message: String(error),
    status: null,
    retryable: null,
  };
}
