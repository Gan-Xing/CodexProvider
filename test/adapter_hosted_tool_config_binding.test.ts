import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenAICompatibleResponsesAdapterServer,
} from '../src/index.js';
import {
  mergeAdapterHostedToolArguments,
} from '../src/server/responses-adapter-server/adapter-hosted-tool-config.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createEventStreamResponse(chunks: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
    },
  });
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('hosted tool config merge keeps empty intersections restrictive', () => {
  const webSearchArguments = mergeAdapterHostedToolArguments('web_search', {
    query: 'no overlap',
    filters: {
      allowed_domains: ['model.example.com'],
    },
  }, {
    filters: {
      allowed_domains: ['request.example.com'],
    },
  });
  assert.deepEqual(webSearchArguments.filters.allowed_domains, [
    'codex-provider-no-allowed-domain-match.invalid',
  ]);

  const fileSearchArguments = mergeAdapterHostedToolArguments('file_search', {
    query: 'no overlap',
    vector_store_ids: ['model-store'],
  }, {
    vector_store_ids: ['request-store'],
  });
  assert.deepEqual(fileSearchArguments.vector_store_ids, [
    '__codex_provider_no_vector_store_match__',
  ]);
  assert.deepEqual(fileSearchArguments.filters, {
    type: 'eq',
    key: '__codex_provider_no_match__',
    value: '__codex_provider_impossible_value__',
  });
});

test('adapter-emulated web_search binds request filters and return_token_budget when model omits them', async () => {
  const executedRequests: any[] = [];
  const traceEvents: any[] = [];
  const server = new OpenAICompatibleResponsesAdapterServer({
    apiKey: 'test-key',
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'web_search',
      mode: 'adapter-emulated',
      emulatedToolName: 'adapter_web_search',
    }],
    hostedToolExecutors: {
      web_search: async (request) => {
        executedRequests.push(cloneJson(request));
        return {
          content: {
            results: [],
          },
        };
      },
    },
    traceSink: (event) => {
      traceEvents.push(cloneJson(event));
    },
    fetchImpl: (async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      if (executedRequests.length === 0 && requestBody.messages.at(-1)?.role !== 'tool') {
        return jsonResponse({
          id: 'chatcmpl_web_config_1',
          created: 1_700_001_001,
          model: 'config-model',
          choices: [{
            message: {
              tool_calls: [{
                id: 'call_web_config_1',
                type: 'function',
                function: {
                  name: 'adapter_web_search',
                  arguments: '{"query":"request bound web search"}',
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        });
      }
      return jsonResponse({
        id: 'chatcmpl_web_config_2',
        created: 1_700_001_002,
        model: 'config-model',
        choices: [{
          message: {
            content: 'web search done',
          },
        }],
      });
    }) as typeof fetch,
  });

  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'config-model',
        input: 'Search the configured docs.',
        tools: [{
          type: 'web_search',
          search_context_size: 'high',
          return_token_budget: 'default',
          user_location: {
            type: 'approximate',
            country: 'US',
          },
          filters: {
            allowed_domains: ['https://Example.com/docs', 'docs.example.com'],
            blocked_domains: ['blocked.example.com'],
          },
          max_results: 7,
        }],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(executedRequests.length, 1);
    assert.equal(executedRequests[0].arguments.query, 'request bound web search');
    assert.equal(executedRequests[0].arguments.search_context_size, 'high');
    assert.equal(executedRequests[0].arguments.return_token_budget, 'default');
    assert.deepEqual(executedRequests[0].arguments.user_location, {
      type: 'approximate',
      country: 'US',
    });
    assert.deepEqual(executedRequests[0].arguments.filters.allowed_domains, [
      'example.com',
      'docs.example.com',
    ]);
    assert.deepEqual(executedRequests[0].arguments.filters.blocked_domains, [
      'blocked.example.com',
    ]);
    assert.equal(executedRequests[0].arguments.max_results, 7);
    assert.equal(traceEvents.some((event) => (
      event.type === 'hosted_tool.config_bound'
      && event.summary?.requestConfigApplied === true
      && event.summary?.returnTokenBudgetBound === true
    )), true);
  } finally {
    await server.stop();
  }
});

test('adapter-emulated web_search keeps request-level security restrictions over model args', async () => {
  const executedRequests: any[] = [];
  const server = new OpenAICompatibleResponsesAdapterServer({
    apiKey: 'test-key',
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'web_search',
      mode: 'adapter-emulated',
      emulatedToolName: 'adapter_web_search',
    }],
    hostedToolExecutors: {
      web_search: async (request) => {
        executedRequests.push(cloneJson(request));
        return {
          content: {
            results: [],
          },
        };
      },
    },
    fetchImpl: (async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      if (requestBody.messages.at(-1)?.role !== 'tool') {
        return jsonResponse({
          id: 'chatcmpl_web_secure_1',
          created: 1_700_001_011,
          model: 'config-model',
          choices: [{
            message: {
              tool_calls: [{
                id: 'call_web_secure_1',
                type: 'function',
                function: {
                  name: 'adapter_web_search',
                  arguments: JSON.stringify({
                    query: 'attempted bypass',
                    external_web_access: true,
                    filters: {
                      allowed_domains: ['b.example.com', 'c.example.com'],
                      blocked_domains: ['model-blocked.example.com'],
                    },
                    max_results: 10,
                  }),
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        });
      }
      return jsonResponse({
        id: 'chatcmpl_web_secure_2',
        created: 1_700_001_012,
        model: 'config-model',
        choices: [{
          message: {
            content: 'secure web search done',
          },
        }],
      });
    }) as typeof fetch,
  });

  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'config-model',
        input: 'Search with strict restrictions.',
        tools: [{
          type: 'web_search',
          external_web_access: false,
          filters: {
            allowed_domains: ['a.example.com', 'b.example.com'],
            blocked_domains: ['request-blocked.example.com'],
          },
          max_results: 3,
        }],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(executedRequests.length, 1);
    assert.equal(executedRequests[0].arguments.query, 'attempted bypass');
    assert.equal(executedRequests[0].arguments.external_web_access, false);
    assert.deepEqual(executedRequests[0].arguments.filters.allowed_domains, ['b.example.com']);
    assert.deepEqual(new Set(executedRequests[0].arguments.filters.blocked_domains), new Set([
      'request-blocked.example.com',
      'model-blocked.example.com',
    ]));
    assert.equal(executedRequests[0].arguments.max_results, 3);
  } finally {
    await server.stop();
  }
});

test('adapter-emulated file_search binds request vector stores and filters when model omits them', async () => {
  const executedRequests: any[] = [];
  const server = new OpenAICompatibleResponsesAdapterServer({
    apiKey: 'test-key',
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'file_search',
      mode: 'adapter-emulated',
      emulatedToolName: 'adapter_file_search',
    }],
    hostedToolExecutors: {
      file_search: async (request) => {
        executedRequests.push(cloneJson(request));
        return {
          content: {
            object: 'vector_store.search_results.page',
            data: [],
            has_more: false,
            next_page: null,
          },
        };
      },
    },
    fetchImpl: (async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      if (requestBody.messages.at(-1)?.role !== 'tool') {
        return jsonResponse({
          id: 'chatcmpl_file_bound_1',
          created: 1_700_001_021,
          model: 'config-model',
          choices: [{
            message: {
              tool_calls: [{
                id: 'call_file_bound_1',
                type: 'function',
                function: {
                  name: 'adapter_file_search',
                  arguments: '{"query":"configured docs"}',
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        });
      }
      return jsonResponse({
        id: 'chatcmpl_file_bound_2',
        created: 1_700_001_022,
        model: 'config-model',
        choices: [{
          message: {
            content: 'file search done',
          },
        }],
      });
    }) as typeof fetch,
  });

  const requestFilter = {
    type: 'eq',
    key: 'source',
    value: 'docs',
  };
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'config-model',
        input: 'Search configured files.',
        tools: [{
          type: 'file_search',
          vector_store_ids: ['repo-docs'],
          filters: requestFilter,
          max_num_results: 4,
          include_content: false,
        }],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(executedRequests.length, 1);
    assert.equal(executedRequests[0].arguments.query, 'configured docs');
    assert.deepEqual(executedRequests[0].arguments.vector_store_ids, ['repo-docs']);
    assert.deepEqual(executedRequests[0].arguments.filters, requestFilter);
    assert.equal(executedRequests[0].arguments.max_num_results, 4);
    assert.equal(executedRequests[0].arguments.include_content, false);
  } finally {
    await server.stop();
  }
});

test('adapter-emulated file_search intersects vector stores and AND-combines filters', async () => {
  const executedRequests: any[] = [];
  const server = new OpenAICompatibleResponsesAdapterServer({
    apiKey: 'test-key',
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'file_search',
      mode: 'adapter-emulated',
      emulatedToolName: 'adapter_file_search',
    }],
    hostedToolExecutors: {
      file_search: async (request) => {
        executedRequests.push(cloneJson(request));
        return {
          content: {
            object: 'vector_store.search_results.page',
            data: [],
            has_more: false,
            next_page: null,
          },
        };
      },
    },
    fetchImpl: (async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      if (requestBody.messages.at(-1)?.role !== 'tool') {
        return jsonResponse({
          id: 'chatcmpl_file_intersect_1',
          created: 1_700_001_031,
          model: 'config-model',
          choices: [{
            message: {
              tool_calls: [{
                id: 'call_file_intersect_1',
                type: 'function',
                function: {
                  name: 'adapter_file_search',
                  arguments: JSON.stringify({
                    query: 'restricted files',
                    vector_store_ids: ['repo-docs', 'unscoped-store'],
                    filters: {
                      type: 'eq',
                      key: 'language',
                      value: 'en',
                    },
                    max_num_results: 9,
                    include_content: true,
                  }),
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        });
      }
      return jsonResponse({
        id: 'chatcmpl_file_intersect_2',
        created: 1_700_001_032,
        model: 'config-model',
        choices: [{
          message: {
            content: 'intersected file search done',
          },
        }],
      });
    }) as typeof fetch,
  });

  const requestFilter = {
    type: 'eq',
    key: 'source',
    value: 'docs',
  };
  const modelFilter = {
    type: 'eq',
    key: 'language',
    value: 'en',
  };
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'config-model',
        input: 'Search configured files.',
        tools: [{
          type: 'file_search',
          vector_store_ids: ['repo-docs', 'tickets'],
          filters: requestFilter,
          max_num_results: 4,
          include_content: false,
        }],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(executedRequests.length, 1);
    assert.deepEqual(executedRequests[0].arguments.vector_store_ids, ['repo-docs']);
    assert.deepEqual(executedRequests[0].arguments.filters, {
      type: 'and',
      filters: [
        requestFilter,
        modelFilter,
      ],
    });
    assert.equal(executedRequests[0].arguments.max_num_results, 4);
    assert.equal(executedRequests[0].arguments.include_content, false);
  } finally {
    await server.stop();
  }
});

test('streaming adapter-emulated web_search uses the same request config binding', async () => {
  const executedRequests: any[] = [];
  const upstreamRequests: any[] = [];
  const server = new OpenAICompatibleResponsesAdapterServer({
    apiKey: 'test-key',
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'web_search',
      mode: 'adapter-emulated',
      emulatedToolName: 'adapter_web_search',
    }],
    hostedToolExecutors: {
      web_search: async (request) => {
        executedRequests.push(cloneJson(request));
        return {
          content: {
            results: [],
          },
        };
      },
    },
    fetchImpl: (async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      upstreamRequests.push(requestBody);
      assert.equal(requestBody.stream, true);
      if (upstreamRequests.length === 1) {
        return createEventStreamResponse([
          {
            id: 'chatcmpl_stream_web_config_1',
            created: 1_700_001_041,
            model: 'config-model',
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'call_stream_web_config_1',
                  type: 'function',
                  function: {
                    name: 'adapter_web_search',
                    arguments: JSON.stringify({
                      query: 'streaming web config',
                      external_web_access: true,
                      filters: {
                        allowed_domains: ['docs.example.com', 'other.example.com'],
                      },
                    }),
                  },
                }],
              },
            }],
          },
          {
            id: 'chatcmpl_stream_web_config_1',
            created: 1_700_001_041,
            model: 'config-model',
            choices: [{
              index: 0,
              finish_reason: 'tool_calls',
            }],
          },
        ]);
      }
      return createEventStreamResponse([
        {
          id: 'chatcmpl_stream_web_config_2',
          created: 1_700_001_042,
          model: 'config-model',
          choices: [{
            index: 0,
            delta: {
              content: 'streaming config final',
            },
          }],
        },
        {
          id: 'chatcmpl_stream_web_config_2',
          created: 1_700_001_042,
          model: 'config-model',
          choices: [{
            index: 0,
            finish_reason: 'stop',
          }],
        },
      ]);
    }) as typeof fetch,
  });

  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'config-model',
        input: 'Stream search.',
        stream: true,
        tools: [{
          type: 'web_search',
          external_web_access: false,
          filters: {
            allowed_domains: ['docs.example.com'],
          },
          return_token_budget: 'default',
        }],
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /response.completed/u);
    assert.equal(executedRequests.length, 1);
    assert.equal(executedRequests[0].arguments.external_web_access, false);
    assert.deepEqual(executedRequests[0].arguments.filters.allowed_domains, ['docs.example.com']);
    assert.equal(executedRequests[0].arguments.return_token_budget, 'default');
  } finally {
    await server.stop();
  }
});

test('streaming adapter-emulated file_search uses vector and filter request config binding', async () => {
  const executedRequests: any[] = [];
  const upstreamRequests: any[] = [];
  const server = new OpenAICompatibleResponsesAdapterServer({
    apiKey: 'test-key',
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    hostedTools: [{
      name: 'file_search',
      mode: 'adapter-emulated',
      emulatedToolName: 'adapter_file_search',
    }],
    hostedToolExecutors: {
      file_search: async (request) => {
        executedRequests.push(cloneJson(request));
        return {
          content: {
            object: 'vector_store.search_results.page',
            data: [],
            has_more: false,
            next_page: null,
          },
        };
      },
    },
    fetchImpl: (async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      upstreamRequests.push(requestBody);
      assert.equal(requestBody.stream, true);
      if (upstreamRequests.length === 1) {
        return createEventStreamResponse([
          {
            id: 'chatcmpl_stream_file_config_1',
            created: 1_700_001_051,
            model: 'config-model',
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'call_stream_file_config_1',
                  type: 'function',
                  function: {
                    name: 'adapter_file_search',
                    arguments: JSON.stringify({
                      query: 'streaming file config',
                      vector_store_ids: ['repo-docs', 'unscoped-store'],
                      filters: {
                        type: 'eq',
                        key: 'language',
                        value: 'en',
                      },
                    }),
                  },
                }],
              },
            }],
          },
          {
            id: 'chatcmpl_stream_file_config_1',
            created: 1_700_001_051,
            model: 'config-model',
            choices: [{
              index: 0,
              finish_reason: 'tool_calls',
            }],
          },
        ]);
      }
      return createEventStreamResponse([
        {
          id: 'chatcmpl_stream_file_config_2',
          created: 1_700_001_052,
          model: 'config-model',
          choices: [{
            index: 0,
            delta: {
              content: 'streaming file final',
            },
          }],
        },
        {
          id: 'chatcmpl_stream_file_config_2',
          created: 1_700_001_052,
          model: 'config-model',
          choices: [{
            index: 0,
            finish_reason: 'stop',
          }],
        },
      ]);
    }) as typeof fetch,
  });

  const requestFilter = {
    type: 'eq',
    key: 'source',
    value: 'docs',
  };
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'config-model',
        input: 'Stream file search.',
        stream: true,
        tools: [{
          type: 'file_search',
          vector_store_ids: ['repo-docs', 'tickets'],
          filters: requestFilter,
          max_num_results: 2,
        }],
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /response.completed/u);
    assert.equal(executedRequests.length, 1);
    assert.deepEqual(executedRequests[0].arguments.vector_store_ids, ['repo-docs']);
    assert.deepEqual(executedRequests[0].arguments.filters, {
      type: 'and',
      filters: [
        requestFilter,
        {
          type: 'eq',
          key: 'language',
          value: 'en',
        },
      ],
    });
    assert.equal(executedRequests[0].arguments.max_num_results, 2);
  } finally {
    await server.stop();
  }
});
