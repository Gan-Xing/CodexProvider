import type {
  ServerResponse,
} from 'node:http';
import { Readable } from 'node:stream';
import type {
  OpenAICompatibleProviderCapabilities,
} from '../../capabilities/thinking_policy.js';
import {
  normalizeRetryCapabilities,
  resolveRetryDelayMs,
  sleep,
} from './retry.js';
import type {
  AdapterRoute,
  CodexProviderTraceEvent,
} from './types.js';

export type UpstreamFetchResult = {
  response: Response;
  errorText: string | null;
};

export async function fetchUpstreamWithRetry({
  url,
  init,
  route,
  providerCapabilities,
  fetchImpl,
  emitTrace,
}: {
  url: string;
  init: RequestInit;
  route: AdapterRoute;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  fetchImpl: typeof fetch;
  emitTrace: (event: CodexProviderTraceEvent) => void;
}): Promise<UpstreamFetchResult> {
  const retry = normalizeRetryCapabilities(providerCapabilities?.retry);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    let upstream: Response;
    try {
      upstream = await fetchImpl(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < retry.maxAttempts && retry.retryNetworkErrors) {
        const delayMs = resolveRetryDelayMs(null, '', attempt, retry);
        emitTrace({
          type: 'upstream.retry',
          route,
          attempt,
          nextAttempt: attempt + 1,
          status: null,
          reason: 'network',
          delayMs,
        });
        await sleep(delayMs);
        continue;
      }
      throw error;
    }
    if (upstream.ok || attempt >= retry.maxAttempts || !retry.retryStatuses.has(upstream.status)) {
      return {
        response: upstream,
        errorText: upstream.ok ? null : await upstream.text().catch(() => ''),
      };
    }
    const text = await upstream.text().catch(() => '');
    const delayMs = resolveRetryDelayMs(upstream.headers, text, attempt, retry);
    emitTrace({
      type: 'upstream.retry',
      route,
      attempt,
      nextAttempt: attempt + 1,
      status: upstream.status,
      reason: 'status',
      delayMs,
    });
    await sleep(delayMs);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'OpenAI-compatible upstream retry failed.'));
}

export async function pipeUpstreamStream(
  upstreamResponse: Response,
  response: ServerResponse,
): Promise<void> {
  response.writeHead(200, {
    'Content-Type': upstreamResponse.headers.get('Content-Type') || 'text/event-stream; charset=utf-8',
    'Cache-Control': upstreamResponse.headers.get('Cache-Control') || 'no-cache',
    Connection: upstreamResponse.headers.get('Connection') || 'keep-alive',
  });
  if (!upstreamResponse.body) {
    response.end();
    return;
  }
  const readable = Readable.fromWeb(upstreamResponse.body as any);
  for await (const chunk of readable) {
    response.write(chunk);
  }
  response.end();
}
