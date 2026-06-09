import type {
  CodexProviderHostedToolExecutor,
} from './hosted_tool_executors.js';
import {
  createCodexProviderOpenAiWebSearchExecutor,
} from './web-search/openai/executor.js';
import {
  createLegacyCodexProviderWebSearchExecutor,
} from './web-search/legacy-executor.js';
import type {
  CodexProviderWebSearchExecutorOptions,
} from './web-search/types.js';

export type {
  CodexProviderProviderWebSearchSourceOptions,
  CodexProviderWebSearchCitation,
  CodexProviderWebSearchContextSize,
  CodexProviderWebSearchExecutorContent,
  CodexProviderWebSearchExecutorOptions,
  CodexProviderWebSearchFilters,
  CodexProviderWebSearchProvider,
  CodexProviderWebSearchResult,
  CodexProviderWebSearchSource,
  CodexProviderWebSearchSourceInput,
  CodexProviderWebSearchSourceReference,
  CodexProviderWebSearchSourceRequest,
  CodexProviderWebSearchSourceResult,
} from './web-search/types.js';

export {
  createCodexProviderProviderWebSearchSource,
} from './web-search/provider-source.js';

export function createCodexProviderWebSearchExecutor(
  options: CodexProviderWebSearchExecutorOptions,
): CodexProviderHostedToolExecutor {
  if (shouldUseOpenAiWebSearchExecutor(options)) {
    return createCodexProviderOpenAiWebSearchExecutor(options);
  }
  return createLegacyCodexProviderWebSearchExecutor(options);
}

function shouldUseOpenAiWebSearchExecutor(options: CodexProviderWebSearchExecutorOptions): boolean {
  return Boolean(
    options.search
    || options.retrieval
    || (Array.isArray(options.engines) && options.engines.length > 0),
  );
}
