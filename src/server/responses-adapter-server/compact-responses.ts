import type {
  ServerResponse,
} from 'node:http';
import {
  responsesRequestToCompactionResponse,
} from '../../converters/responses_adapter.js';
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
  resolveModelMetadata,
} from './models.js';
import {
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
import {
  normalizePath,
  normalizeString,
} from './utils.js';

type AdapterModel = {
  id: string;
  slug: string;
  object: string;
  created: number;
  owned_by: string;
};

type FetchUpstreamWithRetry = (
  url: string,
  init: RequestInit,
  route: AdapterRoute,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null,
) => Promise<UpstreamFetchResult>;

export async function handleCompactResponses({
  requestBody,
  response,
  providerCapabilities,
  upstreamBaseUrl,
  apiKey,
  providerName,
  models,
  defaultModel,
  fetchUpstreamWithRetry,
  emitTrace,
}: {
  requestBody: JsonRecord;
  response: ServerResponse;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  upstreamBaseUrl: string;
  apiKey: string;
  providerName: string;
  models: AdapterModel[];
  defaultModel: string;
  fetchUpstreamWithRetry: FetchUpstreamWithRetry;
  emitTrace: (event: CodexProviderTraceEvent) => void;
}): Promise<void> {
  if (Boolean(requestBody?.stream)) {
    writeJson(response, 400, {
      error: {
        message: 'Streaming not supported for compact responses',
        type: 'invalid_request_error',
      },
    });
    return;
  }
  const compactBody = { ...requestBody };
  delete compactBody.stream;

  if (!providerCapabilities?.supportsResponsesCompact) {
    const modelMetadata = resolveModelMetadata(
      models,
      normalizeString(compactBody?.model) || defaultModel,
    );
    const compactResponse = responsesRequestToCompactionResponse(compactBody, {
      request: compactBody,
      providerCapabilities,
      modelMetadata,
    });
    emitTrace({
      type: 'response.compaction_fallback',
      route: 'responses.compact',
      model: normalizeString(compactBody?.model) || defaultModel,
      reason: 'compact_not_supported',
      response: compactResponse,
    });
    writeJson(response, 200, compactResponse);
    return;
  }

  const compactPath = normalizePath(providerCapabilities.upstreamResponsesCompactPath) || '/responses/compact';
  const upstream = await fetchUpstreamWithRetry(
    buildChatCompletionsUrl(upstreamBaseUrl, compactPath),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(compactBody),
    },
    'responses.compact',
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
      route: 'responses.compact',
      status: upstream.response.status || 502,
      error,
    });
    writeJson(response, upstream.response.status || 502, { error });
    return;
  }
  const text = await upstream.response.text();
  response.writeHead(200, {
    'Content-Type': upstream.response.headers.get('Content-Type') || 'application/json; charset=utf-8',
  });
  response.end(text);
}
