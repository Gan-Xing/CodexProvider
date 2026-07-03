import {
  applyThinkingPolicyToOpenAIChatRequest,
  resolveOpenAICompatibleProviderCapabilitiesForModel,
} from '../../../capabilities/thinking_policy.js';
import {
  buildCodexToolContext,
  responsesToolsToChatTools,
} from '../../codex_tool_context.js';
import type {
  JsonRecord,
  ResponsesToChatOptions,
} from '../types.js';
import {
  copyIfPresent,
  normalizeArray,
  omitUndefined,
} from '../shared/json.js';
import {
  isOpenAIOFamilyModel,
} from '../shared/model.js';
import {
  normalizeString,
} from '../shared/strings.js';
import {
  buildToolNameMap,
  shortenToolName,
} from '../shared/tool-names.js';
import {
  instructionText,
} from './content-parts.js';
import {
  appendInputItem,
} from './input-items.js';
import {
  collapseSystemMessagesToHead,
  createInputConversionState,
  flushPendingReasoning,
  flushPendingToolCalls,
  normalizeChatMessages,
} from './messages.js';
import {
  applyOpenAICompatiblePayloadCompatibility,
} from './payload-compatibility.js';
import {
  convertResponsesToolChoiceToChatToolChoice,
} from './tool-choice.js';
import {
  convertResponsesBuiltinToolToChatTool,
  convertResponsesTextFormatToChatResponseFormat,
  requestUsesBuiltinWebSearch,
  resolveAdapterEmulatedHostedTools,
  resolveBuiltinWebSearchTransport,
  supportsToolCalling,
} from './tools.js';

export function responsesRequestToChatCompletions(
  request: JsonRecord,
  options: ResponsesToChatOptions = {},
): JsonRecord {
  const toolContext = buildCodexToolContext(request?.tools);
  const toolNameMap = buildToolNameMap(request);
  const model = normalizeString(options.model) || normalizeString(request?.model);
  const providerCapabilities = resolveOpenAICompatibleProviderCapabilitiesForModel(
    options.providerCapabilities,
    model,
  );
  const chat: JsonRecord = {
    model,
    messages: [],
    stream: Boolean(options.stream ?? request?.stream),
  };
  const builtinWebSearchTransport = resolveBuiltinWebSearchTransport(providerCapabilities);
  const adapterEmulatedHostedTools = resolveAdapterEmulatedHostedTools(options.hostedTools);

  copyIfPresent(request, chat, 'temperature');
  copyIfPresent(request, chat, 'top_p');
  copyIfPresent(request, chat, 'top_logprobs');
  copyIfPresent(request, chat, 'user');
  if (request?.max_output_tokens !== undefined) {
    if (isOpenAIOFamilyModel(model)) {
      chat.max_completion_tokens = request.max_output_tokens;
    } else {
      chat.max_tokens = request.max_output_tokens;
    }
  }
  copyIfPresent(request, chat, 'max_tokens');
  copyIfPresent(request, chat, 'max_completion_tokens');
  if (chat.stream) {
    chat.stream_options = {
      ...(chat.stream_options && typeof chat.stream_options === 'object' ? chat.stream_options : {}),
      include_usage: true,
    };
  }
  if (
    builtinWebSearchTransport === 'chat_enable_search'
    && requestUsesBuiltinWebSearch(request)
  ) {
    chat.enable_search = true;
  }
  const toolsSupported = supportsToolCalling(providerCapabilities);
  const responseFormat = convertResponsesTextFormatToChatResponseFormat(request?.text);
  if (responseFormat) {
    chat.response_format = responseFormat;
  }

  const instructions = instructionText(request?.instructions);
  if (instructions) {
    chat.messages.push({
      role: 'system',
      content: instructions,
    });
  }

  const inputItems = typeof request?.input === 'string'
    ? [{
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text: request.input,
      }],
    }]
    : normalizeArray(request?.input);
  const inputState = createInputConversionState();
  for (const item of inputItems) {
    appendInputItem(chat.messages, item, toolNameMap, providerCapabilities, inputState);
  }
  flushPendingToolCalls(chat.messages, inputState);
  flushPendingReasoning(chat.messages, inputState);
  normalizeChatMessages(chat.messages);
  chat.messages = collapseSystemMessagesToHead(chat.messages);

  const tools = toolsSupported
    ? responsesToolsToChatTools(request?.tools, toolContext, {
      shortenToolName: (name) => shortenToolName(name, toolNameMap),
      builtinToolConverter: (tool) => convertResponsesBuiltinToolToChatTool(
        tool,
        options.providerKind,
        providerCapabilities,
        builtinWebSearchTransport,
        adapterEmulatedHostedTools,
      ),
      namespaceStrategy: options.toolCatalogPolicy?.namespaceStrategy,
      maxForwardedTools: options.toolCatalogPolicy?.maxForwardedTools,
    })
    : [];
  if (tools.length > 0) {
    chat.tools = tools;
    if (request?.tool_choice !== undefined) {
      const toolChoice = convertResponsesToolChoiceToChatToolChoice(
        request.tool_choice,
        options.providerKind,
        providerCapabilities,
        toolNameMap,
        builtinWebSearchTransport,
        adapterEmulatedHostedTools,
      );
      if (toolChoice !== undefined) {
        chat.tool_choice = toolChoice;
      }
    }
    copyIfPresent(request, chat, 'parallel_tool_calls');
  } else if (normalizeArray(request?.tools).length > 0) {
    delete chat.tool_choice;
    delete chat.parallel_tool_calls;
  }

  applyThinkingPolicyToOpenAIChatRequest(chat, {
    providerKind: options.providerKind,
    requestedEffort: request?.reasoning?.effort ?? null,
    capabilities: providerCapabilities,
  });

  applyOpenAICompatiblePayloadCompatibility(chat, {
    model,
    protocol: options.providerKind,
    providerCapabilities,
  });

  return omitUndefined(chat);
}
