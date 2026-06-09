import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatCompletionsResponseToResponses,
  responsesRequestToChatCompletions,
  translateChatCompletionsSseToResponsesEvents,
} from '../src/index.js';

test('responses request conversion is available from the package boundary', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'gpt-5.4',
    instructions: 'be concise',
    input: 'hello',
    text: {
      format: {
        type: 'json_schema',
        name: 'answer',
        schema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
          },
          required: ['text'],
        },
      },
    },
  });

  assert.equal(chat.model, 'gpt-5.4');
  assert.equal(chat.messages[0].role, 'system');
  assert.equal(chat.messages[1].role, 'user');
  assert.equal(chat.response_format.type, 'json_schema');
});

test('responses conversion exposes adapter-emulated web_search as a Chat function tool', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'example-model',
    input: 'search the web',
    tools: [{
      type: 'web_search',
    }],
    tool_choice: 'web_search',
  }, {
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'web_search',
      mode: 'adapter-emulated',
      providerToolName: null,
      emulatedToolName: 'adapter_web_search',
      description: 'Search through the adapter.',
    }],
  });

  assert.equal(chat.tools[0].type, 'function');
  assert.equal(chat.tools[0].function.name, 'adapter_web_search');
  assert.equal(chat.tools[0].function.parameters.required[0], 'query');
  assert.equal(chat.tools[0].function.parameters.properties.filters.type, 'object');
  assert.equal(chat.tools[0].function.parameters.properties.filters.properties.allowed_domains.type, 'array');
  assert.equal(chat.tools[0].function.parameters.properties.filters.properties.blocked_domains.type, 'array');
  assert.equal(chat.tools[0].function.parameters.properties.external_web_access.type, 'boolean');
  assert.deepEqual(chat.tools[0].function.parameters.properties.return_token_budget.enum, ['default', 'unlimited']);
  assert.equal(chat.tools[0].function.parameters.properties.max_results.type, 'integer');
  assert.equal(chat.tools[0].function.parameters.properties.max_num_results.type, 'integer');
  assert.deepEqual(chat.tool_choice, {
    type: 'function',
    function: {
      name: 'adapter_web_search',
    },
  });
});

test('responses conversion accepts dated web_search alias for adapter-emulated web_search', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'example-model',
    input: 'search the web',
    tools: [{
      type: 'web_search_2025_08_26',
    }],
    tool_choice: 'web_search_2025_08_26',
  }, {
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'web_search',
      mode: 'adapter-emulated',
      providerToolName: null,
      emulatedToolName: 'adapter_web_search',
      description: 'Search through the adapter.',
    }],
  });

  assert.equal(chat.tools[0].type, 'function');
  assert.equal(chat.tools[0].function.name, 'adapter_web_search');
  assert.deepEqual(chat.tool_choice, {
    type: 'function',
    function: {
      name: 'adapter_web_search',
    },
  });
});

test('responses conversion normalizes dated web_search alias for provider-native web_search', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'example-model',
    input: 'search the web',
    tools: [{
      type: 'web_search_2025_08_26',
      search_context_size: 'low',
    }],
    tool_choice: 'web_search_2025_08_26',
  }, {
    providerCapabilities: {
      supportsBuiltinWebSearchTool: true,
    },
  });

  assert.equal(chat.tools[0].type, 'web_search');
  assert.equal(chat.tools[0].search_context_size, 'low');
  assert.equal(chat.tool_choice, 'web_search');
});

test('responses conversion exposes adapter-emulated file_search as a Chat function tool', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'example-model',
    input: 'search configured files',
    tools: [{
      type: 'file_search',
    }],
    tool_choice: 'file_search',
  }, {
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'file_search',
      mode: 'adapter-emulated',
      providerToolName: null,
      emulatedToolName: 'adapter_file_search',
      description: 'Search local configured files.',
    }],
  });

  assert.equal(chat.tools[0].type, 'function');
  assert.equal(chat.tools[0].function.name, 'adapter_file_search');
  assert.equal(chat.tools[0].function.parameters.required[0], 'query');
  assert.equal(chat.tools[0].function.parameters.properties.path_glob.type, 'string');
  assert.equal(chat.tools[0].function.parameters.properties.max_num_results.type, 'integer');
  assert.equal(chat.tools[0].function.parameters.properties.vector_store_ids.type, 'array');
  assert.equal(chat.tools[0].function.parameters.properties.filters.type, 'object');
  assert.equal(chat.tools[0].function.parameters.properties.ranking_options.type, 'object');
  assert.deepEqual(chat.tool_choice, {
    type: 'function',
    function: {
      name: 'adapter_file_search',
    },
  });
});

test('responses conversion exposes adapter-emulated tool_search as a deferred Chat function tool', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'example-model',
    input: 'find the right tool',
    tools: [{
      type: 'tool_search',
    }],
    tool_choice: 'tool_search',
  }, {
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'tool_search',
      mode: 'adapter-emulated',
      providerToolName: null,
      emulatedToolName: 'adapter_tool_search',
      description: 'Discover deferred tools.',
    }],
  });

  assert.equal(chat.tools[0].type, 'function');
  assert.equal(chat.tools[0].function.name, 'adapter_tool_search');
  assert.equal(chat.tools[0].function.parameters.properties.query.type, 'string');
  assert.equal(chat.tools[0].function.parameters.properties.goal.type, 'string');
  assert.deepEqual(chat.tool_choice, {
    type: 'function',
    function: {
      name: 'adapter_tool_search',
    },
  });
});

test('responses conversion exposes adapter-emulated image_generation as a Chat function tool', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'example-model',
    input: 'generate an image',
    tools: [{
      type: 'image_generation',
    }],
    tool_choice: 'image_generation',
  }, {
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'image_generation',
      mode: 'adapter-emulated',
      providerToolName: null,
      emulatedToolName: 'adapter_image_generation',
      description: 'Generate images through the adapter.',
    }],
  });

  assert.equal(chat.tools[0].type, 'function');
  assert.equal(chat.tools[0].function.name, 'adapter_image_generation');
  assert.equal(chat.tools[0].function.parameters.required[0], 'prompt');
  assert.equal(chat.tools[0].function.parameters.properties.output_format.type, 'string');
  assert.deepEqual(chat.tool_choice, {
    type: 'function',
    function: {
      name: 'adapter_image_generation',
    },
  });
});

test('responses conversion does not expose image_generation without an adapter declaration', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'example-model',
    input: 'generate an image',
    tools: [{
      type: 'image_generation',
    }],
    tool_choice: 'image_generation',
  }, {
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [],
  });

  assert.equal(chat.tools, undefined);
  assert.equal(chat.tool_choice, undefined);
});

test('responses conversion exposes adapter-emulated code_interpreter as a Chat function tool', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'example-model',
    input: 'run code',
    tools: [{
      type: 'code_interpreter',
    }],
    tool_choice: 'code_interpreter',
  }, {
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'code_interpreter',
      mode: 'adapter-emulated',
      providerToolName: null,
      emulatedToolName: 'adapter_code_interpreter',
      description: 'Run code through an explicit sandbox.',
    }],
  });

  assert.equal(chat.tools[0].type, 'function');
  assert.equal(chat.tools[0].function.name, 'adapter_code_interpreter');
  assert.equal(chat.tools[0].function.parameters.required[0], 'code');
  assert.equal(chat.tools[0].function.parameters.properties.language.type, 'string');
  assert.equal(chat.tools[0].function.parameters.properties.files.type, 'array');
  assert.deepEqual(chat.tool_choice, {
    type: 'function',
    function: {
      name: 'adapter_code_interpreter',
    },
  });
});

test('responses conversion does not expose code_interpreter without an adapter declaration', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'example-model',
    input: 'run code',
    tools: [{
      type: 'code_interpreter',
    }],
    tool_choice: 'code_interpreter',
  }, {
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [],
  });

  assert.equal(chat.tools, undefined);
  assert.equal(chat.tool_choice, undefined);
});

test('responses conversion exposes adapter-emulated computer as a Chat function tool', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'example-model',
    input: 'use computer',
    tools: [{
      type: 'computer',
    }],
    tool_choice: 'computer',
  }, {
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'computer',
      mode: 'adapter-emulated',
      providerToolName: null,
      emulatedToolName: 'adapter_computer',
      description: 'Use an explicit host computer adapter.',
    }],
  });

  assert.equal(chat.tools[0].type, 'function');
  assert.equal(chat.tools[0].function.name, 'adapter_computer');
  assert.equal(chat.tools[0].function.parameters.required[0], 'actions');
  assert.equal(chat.tools[0].function.parameters.properties.actions.type, 'array');
  assert.equal(chat.tools[0].function.parameters.properties.display.type, 'object');
  assert.deepEqual(chat.tool_choice, {
    type: 'function',
    function: {
      name: 'adapter_computer',
    },
  });
});

test('responses conversion does not expose computer without an adapter declaration', () => {
  const chat = responsesRequestToChatCompletions({
    model: 'example-model',
    input: 'use computer',
    tools: [{
      type: 'computer',
    }],
    tool_choice: 'computer',
  }, {
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [],
  });

  assert.equal(chat.tools, undefined);
  assert.equal(chat.tool_choice, undefined);
});

test('chat response conversion is available from the package boundary', () => {
  const response = chatCompletionsResponseToResponses({
    id: 'chatcmpl_test',
    created: 1234,
    model: 'example-model',
    choices: [{
      message: {
        content: 'done',
      },
    }],
    usage: {
      prompt_tokens: 2,
      completion_tokens: 3,
      total_tokens: 5,
    },
  });

  assert.equal(response.id, 'chatcmpl_test');
  assert.equal(response.model, 'example-model');
  assert.equal(response.output[0].content[0].text, 'done');
  assert.equal(response.usage.total_tokens, 5);
});

test('chat SSE conversion is available from the package boundary', () => {
  const events = translateChatCompletionsSseToResponsesEvents([
    JSON.stringify({
      id: 'chatcmpl_stream',
      created: 1234,
      model: 'example-model',
      choices: [{
        index: 0,
        delta: {
          content: 'hi',
        },
      }],
    }),
    JSON.stringify({
      id: 'chatcmpl_stream',
      created: 1234,
      model: 'example-model',
      choices: [{
        index: 0,
        finish_reason: 'stop',
      }],
    }),
  ], {
    request: {
      model: 'example-model',
    },
  });

  assert.equal(events[0].type, 'response.created');
  assert.equal(events.some((event) => event.type === 'response.output_text.delta'), true);
  assert.equal(events.at(-1)?.type, 'response.completed');
});
