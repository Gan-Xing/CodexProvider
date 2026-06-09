import type {
  ServerResponse,
} from 'node:http';
import type {
  OpenAICompatibleProviderCapabilities,
} from '../../capabilities/thinking_policy.js';
import {
  writeJson,
} from './body.js';
import {
  normalizeUpstreamError,
} from './errors.js';
import {
  pipeUpstreamStream,
  type UpstreamFetchResult,
} from './upstream.js';
import {
  buildChatCompletionsUrl,
} from './urls.js';
import type {
  AdapterRoute,
  CodexProviderTraceEvent,
  JsonRecord,
} from './types.js';

type FetchUpstreamWithRetry = (
  url: string,
  init: RequestInit,
  route: AdapterRoute,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null,
) => Promise<UpstreamFetchResult>;

export async function handleDirectResponsesProxy({
  requestBody,
  response,
  requestedModel,
  stream,
  route,
  providerCapabilities,
  upstreamBaseUrl,
  upstreamResponsesPath,
  apiKey,
  providerName,
  fetchUpstreamWithRetry,
  emitTrace,
}: {
  requestBody: JsonRecord;
  response: ServerResponse;
  requestedModel: string;
  stream: boolean;
  route: AdapterRoute;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  upstreamBaseUrl: string;
  upstreamResponsesPath: string | null;
  apiKey: string;
  providerName: string;
  fetchUpstreamWithRetry: FetchUpstreamWithRetry;
  emitTrace: (event: CodexProviderTraceEvent) => void;
}): Promise<void> {
  emitTrace({
    type: 'request.translated',
    route: 'responses',
    model: requestedModel,
    stream,
    request: requestBody,
    upstreamRequest: requestBody,
  });
  const upstream = await fetchUpstreamWithRetry(
    buildChatCompletionsUrl(upstreamBaseUrl, upstreamResponsesPath),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(requestBody),
    },
    route,
    providerCapabilities,
  );
  if (!upstream.response.ok) {
    const error = normalizeUpstreamError(
      upstream.errorText ?? '',
      providerName,
      upstream.response.status,
      upstream.response.headers,
    );
    emitTrace({
      type: 'upstream.error',
      route,
      status: upstream.response.status || 502,
      error,
    });
    writeJson(response, upstream.response.status || 502, { error });
    return;
  }
  if (stream) {
    await pipeUpstreamStream(upstream.response, response);
    return;
  }
  const text = await upstream.response.text();
  const contentType = upstream.response.headers.get('Content-Type') || 'application/json; charset=utf-8';
  try {
    const json = JSON.parse(text) as JsonRecord;
    emitTrace({
      type: 'response.translated',
      route: 'responses',
      model: requestedModel,
      stream: false,
      response: json,
    });
    writeJson(response, 200, json);
    return;
  } catch {
    response.writeHead(200, {
      'Content-Type': contentType,
    });
    response.end(text);
  }
}
