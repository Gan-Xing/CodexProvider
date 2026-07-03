import type {
  OpenAICompatibleProviderCapabilities,
} from '../../capabilities/thinking_policy.js';
import type {
  NormalizedCodexProviderHostedToolDeclaration,
} from '../../hosted_tools.js';
import type {
  CodexToolContext,
} from '../codex_tool_context.js';

export type JsonRecord = Record<string, any>;
export type ToolNameMap = Map<string, string>;
export type AdapterEmulatedHostedToolMap = Map<string, NormalizedCodexProviderHostedToolDeclaration>;
export type ToolNamespaceStrategy = 'expand' | 'drop';

export interface ToolCatalogPolicy {
  namespaceStrategy?: ToolNamespaceStrategy | null;
  maxForwardedTools?: number | null;
}

export interface ResponsesToChatOptions {
  model?: string | null;
  stream?: boolean | null;
  providerKind?: string | null;
  providerCapabilities?: OpenAICompatibleProviderCapabilities | null;
  hostedTools?: NormalizedCodexProviderHostedToolDeclaration[] | null;
  toolCatalogPolicy?: ToolCatalogPolicy | null;
  compact?: boolean | null;
}

export interface ChatToResponsesOptions {
  request?: JsonRecord | null;
  responseId?: string | null;
  createdAt?: number | null;
  providerCapabilities?: OpenAICompatibleProviderCapabilities | null;
  modelMetadata?: JsonRecord | null;
}

export interface ResponsesSseTranslateOptions extends ChatToResponsesOptions {
  traceEvent?: ((event: JsonRecord) => void) | null;
}

export interface StreamToolCallState {
  key: string;
  id: string | null;
  callId: string | null;
  name: string;
  arguments: string;
  outputIndex: number | null;
  added: boolean;
  done: boolean;
}

export type InlineThinkMode = 'detecting' | 'reasoning' | 'text';

export interface InlineThinkState {
  mode: InlineThinkMode;
  buffer: string;
}

export interface StreamState {
  responseId: string;
  createdAt: number;
  responseModel: string | null;
  sequence: number;
  request: JsonRecord;
  output: JsonRecord[];
  nextOutputIndex: number;
  messageStates: Map<number, {
    id: string;
    outputIndex: number;
    text: string;
    added: boolean;
    contentAdded: boolean;
    done: boolean;
  }>;
  inlineThinkStates: Map<number, InlineThinkState>;
  reasoningStates: Map<number, {
    id: string;
    outputIndex: number;
    text: string;
    added: boolean;
    partAdded: boolean;
    done: boolean;
  }>;
  toolCalls: Map<string, StreamToolCallState>;
  createdEmitted: boolean;
  terminalEmitted: boolean;
  failedError: JsonRecord | null;
  usage: JsonRecord | null;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  reverseToolNameMap: ToolNameMap;
  toolContext: CodexToolContext;
}

export interface InputConversionState {
  pendingToolCalls: JsonRecord[];
  pendingReasoning: string[];
  seenToolCallIds: Set<string>;
}
