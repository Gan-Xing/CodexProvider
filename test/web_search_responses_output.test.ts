import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenAICompatibleResponsesAdapterServer,
} from '../src/index.js';
import {
  appendHostedToolResultsToResponsesOutput,
} from '../src/server/responses-adapter-server/hosted-tool-output.js';

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

function parseSseText(text: string): Array<{ event: string; data: any }> {
  const blocks = text.split('\n\n').map((entry) => entry.trim()).filter(Boolean);
  const parsed: Array<{ event: string; data: any }> = [];
  for (const block of blocks) {
    const eventLine = block.split('\n').find((line) => line.startsWith('event: '));
    const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
    if (!eventLine || !dataLine) {
      continue;
    }
    parsed.push({
      event: eventLine.slice(7).trim(),
      data: JSON.parse(dataLine.slice(6)),
    });
  }
  return parsed;
}

function outputItem(response: any, type: string): any {
  return response.output.find((item: any) => item?.type === type);
}

function outputItems(response: any, type: string): any[] {
  return response.output.filter((item: any) => item?.type === type);
}

function outputTextPart(response: any): any {
  const message = outputItem(response, 'message');
  return message?.content?.find((part: any) => part?.type === 'output_text');
}

function createWebSearchExecution(): any {
  const content = {
    query: 'detailed search',
    sources: [{
      id: 1,
      title: 'Detailed Source',
      url: 'https://example.com/detailed-source',
    }],
    results: [{
      title: 'Detailed Result',
      url: 'https://example.com/detailed-result',
    }],
    documents: [{
      source_id: 1,
      url: 'https://example.com/detailed-source',
      final_url: 'https://example.com/detailed-source',
      title: 'Detailed Source',
      text: 'Detailed retrieved page text.',
    }],
    chunks: [{
      source_id: 1,
      chunk_id: 'chunk_detailed_1',
      url: 'https://example.com/detailed-source',
      title: 'Detailed Source',
      text: 'Detailed chunk text for find in page.',
      score: 0.9,
    }],
  };
  return {
    toolName: 'web_search',
    emulatedToolName: 'adapter_web_search',
    callId: 'call_detailed_actions_1',
    iteration: 1,
    arguments: {
      query: 'detailed search',
    },
    content: JSON.stringify({ content }),
    resultContent: content,
    resultMetadata: null,
  };
}

test('web_search detailed action items require explicit action include or option', () => {
  const compactResponse = { output: [] };
  appendHostedToolResultsToResponsesOutput({
    response: compactResponse,
    request: {
      include: [
        'web_search_call.action.sources',
        'web_search_call.results',
      ],
    },
    executions: [createWebSearchExecution()],
    exposeByDefault: false,
  });

  assert.deepEqual(
    outputItems(compactResponse, 'web_search_call').map((item: any) => item.action.type),
    ['search'],
  );
  assert.equal(outputItem(compactResponse, 'web_search_call').action.sources[0].url, 'https://example.com/detailed-source');
  assert.equal(outputItem(compactResponse, 'web_search_call').results[0].url, 'https://example.com/detailed-result');

  const includedResponse = { output: [] };
  appendHostedToolResultsToResponsesOutput({
    response: includedResponse,
    request: {
      include: ['web_search_call.actions'],
    },
    executions: [createWebSearchExecution()],
    exposeByDefault: false,
  });

  assert.deepEqual(
    outputItems(includedResponse, 'web_search_call').map((item: any) => item.action.type),
    ['search', 'open_page', 'find_in_page'],
  );
  assert.equal(outputItems(includedResponse, 'web_search_call')[1].action.url, 'https://example.com/detailed-source');
  assert.match(outputItems(includedResponse, 'web_search_call')[2].action.pattern, /find in page/u);

  const optionResponse = { output: [] };
  appendHostedToolResultsToResponsesOutput({
    response: optionResponse,
    request: {},
    executions: [createWebSearchExecution()],
    exposeByDefault: false,
    exposeWebSearchDetailedActions: true,
  });

  assert.deepEqual(
    outputItems(optionResponse, 'web_search_call').map((item: any) => item.action.type),
    ['search', 'open_page', 'find_in_page'],
  );
});

test('responses output exposes adapter web_search call with sources, results, and citation annotations', async () => {
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
      web_search: async (request) => ({
        content: {
          query: request.arguments.query,
          sources: [{
            id: 1,
            title: 'Phase 7 Source',
            url: 'https://example.com/phase-7-source',
            snippet: 'Phase 7 source snippet.',
          }],
          results: [{
            title: 'Phase 7 Result',
            url: 'https://example.com/phase-7-result',
            snippet: 'Phase 7 result snippet.',
          }],
          documents: [{
            source_id: 1,
            url: 'https://example.com/phase-7-source',
            final_url: 'https://example.com/phase-7-source',
            title: 'Phase 7 Source',
            text: 'Phase 7 retrieved page text.',
            content_type: 'text/html',
            fetched_at: '2026-06-09T00:00:00.000Z',
            from_cache: false,
          }],
          chunks: [{
            source_id: 1,
            chunk_id: 'chunk_phase_7_1',
            url: 'https://example.com/phase-7-source',
            title: 'Phase 7 Source',
            text: 'Phase 7 chunk text for find in page.',
            score: 0.93,
          }],
        },
      }),
    },
    fetchImpl: (async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      upstreamRequests.push(requestBody);
      if (upstreamRequests.length === 1) {
        return new Response(JSON.stringify({
          id: 'chatcmpl_web_search_output_1',
          created: 1_700_001_001,
          model: 'adapter-search-model',
          choices: [{
            message: {
              tool_calls: [{
                id: 'call_web_search_output_1',
                type: 'function',
                function: {
                  name: 'adapter_web_search',
                  arguments: '{"query":"phase 7 search"}',
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      assert.equal(requestBody.messages.at(-1).role, 'tool');
      assert.match(requestBody.messages.at(-1).content, /Phase 7 Source/u);
      return new Response(JSON.stringify({
        id: 'chatcmpl_web_search_output_2',
        created: 1_700_001_002,
        model: 'adapter-search-model',
        choices: [{
          message: {
            content: 'Answer with evidence [[source:1]]',
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'adapter-search-model',
        input: 'Search phase 7.',
        include: [
          'web_search_call.action.sources',
          'web_search_call.results',
        ],
        tools: [{
          type: 'web_search',
        }],
      }),
    });
    const body = await response.json() as any;
    const textPart = outputTextPart(body);
    const webSearchCalls = outputItems(body, 'web_search_call');
    const webSearchCall = webSearchCalls[0];

    assert.equal(response.status, 200);
    assert.equal(upstreamRequests.length, 2);
    assert.equal(textPart.text, 'Answer with evidence');
    assert.equal(textPart.annotations.length, 1);
    assert.equal(textPart.annotations[0].type, 'url_citation');
    assert.equal(textPart.annotations[0].title, 'Phase 7 Source');
    assert.equal(textPart.annotations[0].url, 'https://example.com/phase-7-source');
    assert.equal(webSearchCall.status, 'completed');
    assert.equal(webSearchCall.call_id, 'call_web_search_output_1');
    assert.equal(webSearchCall.action.type, 'search');
    assert.equal(webSearchCall.action.query, 'phase 7 search');
    assert.deepEqual(webSearchCall.action.queries, ['phase 7 search']);
    assert.equal(webSearchCall.action.sources[0].url, 'https://example.com/phase-7-source');
    assert.deepEqual(webSearchCalls.map((item: any) => item.action.type), ['search']);
    assert.equal(webSearchCall.results[0].url, 'https://example.com/phase-7-result');
  } finally {
    await server.stop();
  }
});

test('responses output does not fabricate citation annotations without placeholders', async () => {
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
      web_search: async () => ({
        content: {
          sources: [{
            id: 1,
            title: 'Unreferenced Source',
            url: 'https://example.com/unreferenced',
          }],
        },
      }),
    },
    fetchImpl: (async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      if (!requestBody.messages.some((message: any) => message.role === 'tool')) {
        return new Response(JSON.stringify({
          id: 'chatcmpl_web_search_no_placeholder_1',
          created: 1_700_001_003,
          model: 'adapter-search-model',
          choices: [{
            message: {
              tool_calls: [{
                id: 'call_web_search_no_placeholder_1',
                type: 'function',
                function: {
                  name: 'adapter_web_search',
                  arguments: '{"query":"uncited search"}',
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        id: 'chatcmpl_web_search_no_placeholder_2',
        created: 1_700_001_004,
        model: 'adapter-search-model',
        choices: [{
          message: {
            content: 'Answer without citation marker.',
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'adapter-search-model',
        input: 'Search without citation marker.',
        tools: [{
          type: 'web_search',
        }],
      }),
    });
    const body = await response.json() as any;
    const textPart = outputTextPart(body);

    assert.equal(response.status, 200);
    assert.equal(textPart.text, 'Answer without citation marker.');
    assert.deepEqual(textPart.annotations ?? [], []);
    assert.equal(outputItem(body, 'web_search_call').action.type, 'search');
    assert.equal(outputItems(body, 'web_search_call').length, 1);
  } finally {
    await server.stop();
  }
});

test('streaming responses completed event includes adapter web_search call output', async () => {
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
      web_search: async () => ({
        content: {
          sources: [{
            id: 1,
            title: 'Streaming Phase 7 Source',
            url: 'https://example.com/streaming-phase-7',
          }],
          results: [{
            title: 'Streaming Phase 7 Result',
            url: 'https://example.com/streaming-phase-7-result',
          }],
          documents: [{
            source_id: 1,
            url: 'https://example.com/streaming-phase-7',
            final_url: 'https://example.com/streaming-phase-7',
            title: 'Streaming Phase 7 Source',
            text: 'Streaming retrieved page text.',
            content_type: 'text/html',
            fetched_at: '2026-06-09T00:00:00.000Z',
            from_cache: false,
          }],
          chunks: [{
            source_id: 1,
            chunk_id: 'chunk_streaming_phase_7_1',
            url: 'https://example.com/streaming-phase-7',
            title: 'Streaming Phase 7 Source',
            text: 'Streaming chunk text for find in page.',
            score: 0.88,
          }],
        },
      }),
    },
    fetchImpl: (async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      upstreamRequests.push(requestBody);
      assert.equal(requestBody.stream, true);
      if (upstreamRequests.length === 1) {
        return createEventStreamResponse([
          {
            id: 'chatcmpl_web_search_stream_output_1',
            created: 1_700_001_005,
            model: 'adapter-search-model',
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'call_web_search_stream_output_1',
                  type: 'function',
                  function: {
                    name: 'adapter_web_search',
                    arguments: '{"query":"streaming phase 7"}',
                  },
                }],
              },
            }],
          },
          {
            id: 'chatcmpl_web_search_stream_output_1',
            created: 1_700_001_005,
            model: 'adapter-search-model',
            choices: [{
              index: 0,
              finish_reason: 'tool_calls',
            }],
          },
        ]);
      }
      assert.equal(requestBody.messages.at(-1).role, 'tool');
      return createEventStreamResponse([
        {
          id: 'chatcmpl_web_search_stream_output_2',
          created: 1_700_001_006,
          model: 'adapter-search-model',
          choices: [{
            index: 0,
            delta: {
              content: 'Streaming answer [[source:1]]',
            },
          }],
        },
        {
          id: 'chatcmpl_web_search_stream_output_2',
          created: 1_700_001_006,
          model: 'adapter-search-model',
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
        model: 'adapter-search-model',
        input: 'Stream search phase 7.',
        stream: true,
        include: [
          'web_search_call.action.sources',
          'web_search_call.results',
        ],
        tools: [{
          type: 'web_search',
        }],
      }),
    });
    const events = parseSseText(await response.text());
    const completed = events.find((event) => event.event === 'response.completed')?.data.response;
    const textPart = outputTextPart(completed);
    const webSearchCalls = outputItems(completed, 'web_search_call');
    const webSearchCall = webSearchCalls[0];

    assert.equal(response.status, 200);
    assert.equal(upstreamRequests.length, 2);
    assert.equal(events.some((event) => (
      event.event === 'response.output_item.done'
      && event.data.item?.type === 'web_search_call'
    )), true);
    assert.equal(textPart.text, 'Streaming answer');
    assert.equal(textPart.annotations[0].url, 'https://example.com/streaming-phase-7');
    assert.equal(webSearchCall.action.type, 'search');
    assert.equal(webSearchCall.action.query, 'streaming phase 7');
    assert.deepEqual(webSearchCall.action.queries, ['streaming phase 7']);
    assert.equal(webSearchCall.action.sources[0].url, 'https://example.com/streaming-phase-7');
    assert.deepEqual(webSearchCalls.map((item: any) => item.action.type), ['search']);
    assert.equal(webSearchCall.results[0].url, 'https://example.com/streaming-phase-7-result');
  } finally {
    await server.stop();
  }
});
