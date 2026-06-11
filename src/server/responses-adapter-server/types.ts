import type {
  OpenAICompatibleProviderCapabilities,
} from '../../capabilities/thinking_policy.js';
import type {
  CodexProviderWebSearchInvalidParameterStrategy,
} from '../../web-search/types.js';
import type {
  CodexProviderHostedToolDeclaration,
} from '../../hosted_tools.js';
import type {
  CodexProviderHostedToolExecutorRegistryInput,
} from '../../hosted_tool_executors.js';

export type JsonRecord = Record<string, any>;
export type AdapterRoute = 'responses' | 'responses.compact';

export type AdapterHostedToolExecutionRecord = {
  toolName: string;
  emulatedToolName: string;
  callId: string;
  iteration: number;
  arguments: JsonRecord;
  content: string;
  resultContent: unknown;
  resultMetadata: JsonRecord | null;
};

export type ProviderErrorCategory =
  | 'authentication'
  | 'rate_limit'
  | 'transient_upstream'
  | 'unsupported_feature'
  | 'not_found'
  | 'invalid_request'
  | 'malformed_upstream'
  | 'upstream_failure';

export type ProviderRetryHint =
  | 'check_api_key_or_access'
  | 'respect_retry_after'
  | 'retry_with_backoff'
  | 'remove_or_downgrade_unsupported_feature'
  | 'check_model_or_route'
  | 'fix_request'
  | 'retry_or_inspect_upstream';

export type CodexProviderRequestAdjustment =
  | {
    kind: 'field_filtered' | 'tool_choice_dropped' | 'model_overridden';
    path: string;
    reason: string;
    before: unknown;
    after?: unknown;
  }
  | {
    kind: 'tools_dropped' | 'image_input_downgraded' | 'file_input_downgraded';
    path: string;
    reason: string;
    requestedCount: number;
    forwardedCount: number;
    strategy?: string | null;
  }
  | {
    kind: 'max_output_tokens_capped';
    path: 'max_output_tokens';
    reason: 'model_limit';
    before: number;
    after: number;
  };

export type CodexProviderTraceEvent =
  | {
    type: 'request.received';
    route: AdapterRoute;
    model: string;
    stream: boolean;
    request: JsonRecord;
  }
  | {
    type: 'request.translated';
    route: 'responses';
    model: string;
    stream: boolean;
    request: JsonRecord;
    upstreamRequest: JsonRecord;
  }
  | {
    type: 'request.adjusted';
    route: 'responses';
    model: string;
    stream: boolean;
    adjustments: CodexProviderRequestAdjustment[];
  }
  | {
    type: 'response.translated';
    route: 'responses';
    model: string;
    stream: false;
    response: JsonRecord;
  }
  | {
    type: 'response.compaction_fallback';
    route: 'responses.compact';
    model: string;
    reason: 'compact_not_supported';
    response: JsonRecord;
  }
  | {
    type: 'upstream.retry';
    route: AdapterRoute;
    attempt: number;
    nextAttempt: number;
    status: number | null;
    reason: 'network' | 'status';
    delayMs: number;
  }
  | {
    type: 'upstream.error';
    route: AdapterRoute;
    status: number;
    error: JsonRecord;
  }
  | {
    type: 'stream.event';
    route: 'responses';
    event: JsonRecord;
  }
  | {
    type: 'stream.completed';
    route: 'responses';
    eventCount: number;
  }
  | {
    type: 'web_search.citations';
    route: 'responses';
    stream: boolean;
    sourceCount: number;
    outputTextPartCount: number;
    placeholderCount: number;
    annotationCount: number;
    missingSourceCount: number;
  }
  | {
    type: 'web_search.executed';
    route: 'responses';
    stream: boolean;
    toolName: 'web_search';
    emulatedToolName: string;
    callId: string;
    iteration: number;
    executionStatus: 'completed' | 'failed';
    durationMs: number;
    mode: string | null;
    resultCount: number;
    sourceCount: number;
    documentCount: number;
    chunkCount: number;
    retrievalErrorCount: number;
    retrievalCacheHitCount: number;
    retrievalCacheMissCount: number;
    unresponsiveEngineCount: number;
    engineTimingCount: number;
    warningCount: number;
    externalWebAccess: boolean | null;
    searchContextSize: string | null;
  }
  | {
    type: 'hosted_tool.config_bound';
    route: 'responses';
    toolName: string;
    emulatedToolName: string;
    callId: string;
    iteration: number;
    summary: JsonRecord;
  }
  | {
    type: 'hosted_tool.executed';
    route: 'responses';
    toolName: string;
    emulatedToolName: string;
    callId: string;
    iteration: number;
  };

export type CodexProviderTraceSink = (event: CodexProviderTraceEvent) => void;

export interface OpenAICompatibleResponsesAdapterServerOptions {
  apiKey: string;
  upstreamBaseUrl?: string | null;
  defaultModel?: string | null;
  models?: Array<Record<string, any> & { id?: string; model?: string; slug?: string; object?: string; created?: number; owned_by?: string }>;
  fetchImpl?: typeof fetch;
  host?: string;
  port?: number;
  providerKind?: string | null;
  providerName?: string | null;
  providerCapabilities?: OpenAICompatibleProviderCapabilities | null;
  upstreamResponsesPath?: string | null;
  upstreamChatCompletionsPath?: string | null;
  ownedBy?: string | null;
  traceSink?: CodexProviderTraceSink | null;
  hostedTools?: CodexProviderHostedToolDeclaration[] | null;
  hostedToolExecutors?: CodexProviderHostedToolExecutorRegistryInput;
  maxHostedToolIterations?: number | null;
  emitHostedToolSseEvents?: boolean | null;
  exposeHostedToolResultsInResponsesOutput?: boolean | null;
  exposeWebSearchDetailedActions?: boolean | null;
  webSearchInvalidParameterStrategy?: CodexProviderWebSearchInvalidParameterStrategy | null;
}
