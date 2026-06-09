import type {
  CodexProviderHostedToolExecutor,
} from '../hosted_tool_executors.js';
import {
  createCodexProviderOpenAiWebSearchExecutor,
} from './openai/executor.js';
import {
  createCodexProviderSourceWebSearchExecutor,
} from './source-executor.js';
import type {
  CodexProviderWebSearchExecutorOptions,
} from './types.js';

export * from './deep/index.js';
export * from './engines/index.js';
export * from './local-index/index.js';
export * from './metasearch/index.js';
export * from './openai/index.js';
export { createCodexProviderProviderWebSearchSource } from './provider-source.js';
export * from './retrieval/index.js';
export type * from './types.js';

export function createCodexProviderWebSearchExecutor(
  options: CodexProviderWebSearchExecutorOptions,
): CodexProviderHostedToolExecutor {
  if (shouldUseOpenAiWebSearchExecutor(options)) {
    return createCodexProviderOpenAiWebSearchExecutor(options);
  }
  return createCodexProviderSourceWebSearchExecutor(options);
}

function shouldUseOpenAiWebSearchExecutor(options: CodexProviderWebSearchExecutorOptions): boolean {
  return Boolean(
    options.search
    || options.retrieval
    || (Array.isArray(options.engines) && options.engines.length > 0),
  );
}
