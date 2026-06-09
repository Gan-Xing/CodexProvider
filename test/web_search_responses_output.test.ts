import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenAICompatibleResponsesAdapterServer,
} from '../src/index.js';

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

function outputTextPart(response: any): any {
  const message = outputItem(response, 'message');
  return message?.content?.find((part: any) => part?.type === 'output_text');
}

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
    const webSearchCall = outputItem(body, 'web_search_call');

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
    assert.equal(webSearchCall.action.sources[0].url, 'https://example.com/phase-7-source');
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
    const webSearchCall = outputItem(completed, 'web_search_call');

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
    assert.equal(webSearchCall.action.sources[0].url, 'https://example.com/streaming-phase-7');
    assert.equal(webSearchCall.results[0].url, 'https://example.com/streaming-phase-7-result');
  } finally {
    await server.stop();
  }
});
