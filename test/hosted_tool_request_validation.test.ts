import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenAICompatibleResponsesAdapterServer,
} from '../src/index.js';

function jsonResponse(content = 'validation ok'): Response {
  return new Response(JSON.stringify({
    id: 'chatcmpl_validation',
    created: 1_700_004_001,
    model: 'validation-model',
    choices: [{
      message: {
        content,
      },
    }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('adapter server rejects invalid web_search declaration fields by default', async () => {
  let upstreamCalled = false;
  const server = new OpenAICompatibleResponsesAdapterServer({
    apiKey: 'test-key',
    fetchImpl: (async () => {
      upstreamCalled = true;
      return jsonResponse();
    }) as typeof fetch,
  });

  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-model',
        input: 'search',
        tools: [{
          type: 'web_search',
          search_context_size: 'massive',
        }],
      }),
    });
    const body = await response.json() as any;

    assert.equal(response.status, 400);
    assert.equal(upstreamCalled, false);
    assert.equal(body.error.type, 'invalid_request_error');
    assert.equal(body.error.code, 'invalid_request');
    assert.equal(body.error.param, 'tools[0].search_context_size');
    assert.match(body.error.message, /expected "low", "medium", or "high"/u);
  } finally {
    await server.stop();
  }
});

test('adapter server drop mode removes invalid hosted tool fields and traces adjustments', async () => {
  const events: any[] = [];
  const upstreamRequests: any[] = [];
  const server = new OpenAICompatibleResponsesAdapterServer({
    apiKey: 'test-key',
    webSearchInvalidParameterStrategy: 'drop',
    traceSink: (event) => {
      events.push(cloneJson(event));
    },
    fetchImpl: (async (_url, init) => {
      upstreamRequests.push(JSON.parse(String(init?.body ?? '{}')));
      return jsonResponse('dropped invalid fields');
    }) as typeof fetch,
  });

  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-model',
        input: 'search',
        tools: [{
          type: 'web_search',
          search_context_size: 'huge',
          external_web_access: 'yes',
          filters: {
            allowed_domains: ['*.example.com'],
            blocked_domains: ['blocked.example.com'],
          },
          max_results: 0,
        }],
      }),
    });
    const body = await response.json() as any;
    const adjustmentEvent = events.find((event) => event.type === 'request.adjusted');
    const forwardedTool = upstreamRequests[0].tools[0];

    assert.equal(response.status, 200);
    assert.equal(body.output[0].content[0].text, 'dropped invalid fields');
    assert.equal(forwardedTool.search_context_size, undefined);
    assert.equal(forwardedTool.external_web_access, undefined);
    assert.equal(forwardedTool.filters.allowed_domains, undefined);
    assert.deepEqual(forwardedTool.filters.blocked_domains, ['blocked.example.com']);
    assert.equal(forwardedTool.max_results, undefined);
    assert.deepEqual(
      adjustmentEvent?.adjustments?.map((entry: any) => entry.path),
      [
        'tools[0].search_context_size',
        'tools[0].filters.allowed_domains',
        'tools[0].external_web_access',
        'tools[0].max_results',
      ],
    );
  } finally {
    await server.stop();
  }
});

test('adapter server rejects invalid file_search filters by default', async () => {
  let upstreamCalled = false;
  const server = new OpenAICompatibleResponsesAdapterServer({
    apiKey: 'test-key',
    fetchImpl: (async () => {
      upstreamCalled = true;
      return jsonResponse();
    }) as typeof fetch,
  });

  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-model',
        input: 'search files',
        tools: [{
          type: 'file_search',
          filters: {
            type: 'and',
            filters: [{
              type: 'eq',
              value: 'docs',
            }],
          },
        }],
      }),
    });
    const body = await response.json() as any;

    assert.equal(response.status, 400);
    assert.equal(upstreamCalled, false);
    assert.equal(body.error.type, 'invalid_request_error');
    assert.equal(body.error.param, 'tools[0].filters.filters[0].property');
    assert.match(body.error.message, /expected non-empty string/u);
  } finally {
    await server.stop();
  }
});

test('adapter server rejects invalid file_search ranking options by default', async () => {
  let upstreamCalled = false;
  const server = new OpenAICompatibleResponsesAdapterServer({
    apiKey: 'test-key',
    fetchImpl: (async () => {
      upstreamCalled = true;
      return jsonResponse();
    }) as typeof fetch,
  });

  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-model',
        input: 'search files',
        tools: [{
          type: 'file_search',
          ranking_options: {
            score_threshold: 2,
          },
        }],
      }),
    });
    const body = await response.json() as any;

    assert.equal(response.status, 400);
    assert.equal(upstreamCalled, false);
    assert.equal(body.error.param, 'tools[0].ranking_options.score_threshold');
    assert.match(body.error.message, /expected number from 0 to 1/u);
  } finally {
    await server.stop();
  }
});

test('adapter server validates hosted tool fields inside allowed_tools', async () => {
  let upstreamCalled = false;
  const server = new OpenAICompatibleResponsesAdapterServer({
    apiKey: 'test-key',
    fetchImpl: (async () => {
      upstreamCalled = true;
      return jsonResponse();
    }) as typeof fetch,
  });

  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-model',
        input: 'search files',
        tool_choice: {
          type: 'allowed_tools',
          tools: [{
            type: 'file_search',
            vector_store_ids: ['docs', 123],
          }],
        },
      }),
    });
    const body = await response.json() as any;

    assert.equal(response.status, 400);
    assert.equal(upstreamCalled, false);
    assert.equal(body.error.param, 'tool_choice.tools[0].vector_store_ids');
    assert.match(body.error.message, /expected array of up to 100 strings/u);
  } finally {
    await server.stop();
  }
});
