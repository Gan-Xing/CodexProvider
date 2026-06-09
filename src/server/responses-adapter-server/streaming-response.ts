import type {
  ServerResponse,
} from 'node:http';
import {
  translateChatCompletionsSseStreamToResponsesSse,
} from '../../converters/responses_adapter.js';
import type {
  OpenAICompatibleProviderCapabilities,
} from '../../capabilities/thinking_policy.js';
import {
  appendHostedToolResultsToResponsesOutput,
} from './hosted-tool-output.js';
import {
  resolveModelMetadata,
} from './models.js';
import {
  buildAppendedOutputItemSseEvents,
  ensureSseResponseHeaders,
  formatResponsesSseEvent,
  parseResponsesSseEventFrame,
  resequenceInsertedStreamEvents,
  responsesObjectToSyntheticSseEvents,
} from './synthetic-sse.js';
import type {
  AdapterHostedToolExecutionRecord,
  CodexProviderTraceEvent,
  JsonRecord,
} from './types.js';
import {
  normalizeString,
} from './utils.js';

type AdapterModel = {
  id: string;
  slug: string;
  object: string;
  created: number;
  owned_by: string;
};

type EmitTrace = (event: CodexProviderTraceEvent) => void;

export async function writeStreamingDataLinesResponse({
  requestBody,
  providerCapabilities,
  dataLines,
  response,
  models,
  defaultModel,
  emitTrace,
}: {
  requestBody: JsonRecord;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  dataLines: AsyncIterable<string>;
  response: ServerResponse;
  models: AdapterModel[];
  defaultModel: string;
  emitTrace: EmitTrace;
}): Promise<void> {
  ensureSseResponseHeaders(response);
  let eventCount = 0;
  for await (const event of translateChatCompletionsSseStreamToResponsesSse(
    dataLines,
    {
      request: requestBody,
      providerCapabilities,
      modelMetadata: resolveModelMetadata(
        models,
        normalizeString(requestBody?.model) || defaultModel,
      ),
      traceEvent: (traceEvent) => {
        eventCount += 1;
        emitTrace({
          type: 'stream.event',
          route: 'responses',
          event: traceEvent,
        });
      },
    },
  )) {
    response.write(event);
  }
  emitTrace({
    type: 'stream.completed',
    route: 'responses',
    eventCount,
  });
  response.end();
}

export async function writeStreamingDataLinesResponseWithHostedToolResults({
  requestBody,
  providerCapabilities,
  dataLines,
  executions,
  response,
  models,
  defaultModel,
  exposeHostedToolResultsInResponsesOutput,
  emitTrace,
}: {
  requestBody: JsonRecord;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  dataLines: AsyncIterable<string>;
  executions: AdapterHostedToolExecutionRecord[];
  response: ServerResponse;
  models: AdapterModel[];
  defaultModel: string;
  exposeHostedToolResultsInResponsesOutput: boolean;
  emitTrace: EmitTrace;
}): Promise<void> {
  ensureSseResponseHeaders(response);
  let eventCount = 0;
  for await (const frame of translateChatCompletionsSseStreamToResponsesSse(
    dataLines,
    {
      request: requestBody,
      providerCapabilities,
      modelMetadata: resolveModelMetadata(
        models,
        normalizeString(requestBody?.model) || defaultModel,
      ),
    },
  )) {
    const event = parseResponsesSseEventFrame(frame);
    if (!event) {
      response.write(frame);
      continue;
    }
    let eventsToWrite = [event];
    if (
      (event.type === 'response.completed' || event.type === 'response.failed')
      && event.response
      && typeof event.response === 'object'
    ) {
      const previousOutputLength = Array.isArray(event.response.output)
        ? event.response.output.length
        : 0;
      appendHostedToolResultsToResponsesOutput({
        response: event.response,
        request: requestBody,
        executions,
        exposeByDefault: exposeHostedToolResultsInResponsesOutput,
      });
      const appendedOutputEvents = buildAppendedOutputItemSseEvents(event.response, previousOutputLength);
      resequenceInsertedStreamEvents(appendedOutputEvents, event);
      eventsToWrite = [
        ...appendedOutputEvents,
        event,
      ];
    }
    for (const eventToWrite of eventsToWrite) {
      eventCount += 1;
      emitTrace({
        type: 'stream.event',
        route: 'responses',
        event: eventToWrite,
      });
      response.write(formatResponsesSseEvent(eventToWrite));
    }
  }
  emitTrace({
    type: 'stream.completed',
    route: 'responses',
    eventCount,
  });
  response.end();
}

export async function writeSyntheticStreamingResponse({
  adaptedResponse,
  response,
  emitTrace,
}: {
  adaptedResponse: JsonRecord;
  response: ServerResponse;
  emitTrace: EmitTrace;
}): Promise<void> {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  let eventCount = 0;
  for (const event of responsesObjectToSyntheticSseEvents(adaptedResponse)) {
    eventCount += 1;
    emitTrace({
      type: 'stream.event',
      route: 'responses',
      event,
    });
    response.write(formatResponsesSseEvent(event));
  }
  response.write('data: [DONE]\n\n');
  emitTrace({
    type: 'stream.completed',
    route: 'responses',
    eventCount,
  });
  response.end();
}
