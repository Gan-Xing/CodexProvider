import type {
  CodexProviderHostedToolDeltaEmitter,
  CodexProviderHostedToolExecutionRequest,
  CodexProviderHostedToolExecutionResult,
  CodexProviderHostedToolExecutor,
  JsonRecord,
} from './hosted_tool_executors.js';

export interface CodexProviderCodeInterpreterExecutorOptions {
  execute: CodexProviderCodeInterpreterProvider;
}

export type CodexProviderCodeInterpreterContainer =
  | string
  | JsonRecord
  | null;

export interface CodexProviderCodeInterpreterInputFile {
  file_id?: string | null;
  filename?: string | null;
  content?: string | null;
}

export interface CodexProviderCodeInterpreterOutputFile {
  filename: string;
  mime_type?: string | null;
  b64_data?: string | null;
  uri?: string | null;
}

export interface CodexProviderCodeInterpreterRequest {
  code: string;
  language: string | null;
  container: CodexProviderCodeInterpreterContainer;
  files: CodexProviderCodeInterpreterInputFile[];
  emitStdout: CodexProviderCodeInterpreterStreamEmitter;
  emitStderr: CodexProviderCodeInterpreterStreamEmitter;
  toolRequest: CodexProviderHostedToolExecutionRequest;
}

export interface CodexProviderCodeInterpreterExecutionResult {
  stdout?: string | null;
  stderr?: string | null;
  result?: unknown;
  files?: CodexProviderCodeInterpreterOutputFile[] | null;
  metadata?: JsonRecord | null;
}

export interface CodexProviderCodeInterpreterExecutorContent {
  stdout?: string | null;
  stderr?: string | null;
  result?: unknown;
  files: CodexProviderCodeInterpreterOutputFile[];
  executed_at: string;
}

export type CodexProviderCodeInterpreterProvider = (
  request: CodexProviderCodeInterpreterRequest,
) => CodexProviderCodeInterpreterExecutionResult | Promise<CodexProviderCodeInterpreterExecutionResult>;

export type CodexProviderCodeInterpreterStreamEmitter = (
  text: string,
  metadata?: JsonRecord | null,
) => Promise<void>;

export function createCodexProviderCodeInterpreterExecutor(
  options: CodexProviderCodeInterpreterExecutorOptions,
): CodexProviderHostedToolExecutor {
  if (typeof options?.execute !== 'function') {
    throw new Error('code_interpreter executor requires an explicit sandboxed execution provider.');
  }
  return async (
    request: CodexProviderHostedToolExecutionRequest,
  ): Promise<CodexProviderHostedToolExecutionResult> => {
    const normalizedRequest = normalizeCodeInterpreterRequest(request);
    if (!normalizedRequest.code) {
      throw new Error('code_interpreter executor requires a non-empty code argument.');
    }
    const result = normalizeCodeInterpreterExecutionResult(await options.execute({
      ...normalizedRequest,
      emitStdout: buildCodeInterpreterStreamEmitter(request.emitDelta, 'stdout'),
      emitStderr: buildCodeInterpreterStreamEmitter(request.emitDelta, 'stderr'),
    }));
    return {
      content: {
        stdout: result.stdout || undefined,
        stderr: result.stderr || undefined,
        result: result.result,
        files: result.files,
        executed_at: new Date().toISOString(),
      } satisfies CodexProviderCodeInterpreterExecutorContent,
      metadata: {
        stdoutBytes: Buffer.byteLength(result.stdout ?? '', 'utf8'),
        stderrBytes: Buffer.byteLength(result.stderr ?? '', 'utf8'),
        fileCount: result.files.length,
        ...(result.metadata && typeof result.metadata === 'object' ? result.metadata : {}),
      },
    };
  };
}

function normalizeCodeInterpreterRequest(
  request: CodexProviderHostedToolExecutionRequest,
): Omit<CodexProviderCodeInterpreterRequest, 'emitStdout' | 'emitStderr'> {
  const args = request.arguments ?? {};
  return {
    code: firstNonEmptyString([args.code, args.input, args.source]),
    language: normalizeString(args.language) || null,
    container: normalizeContainer(args.container),
    files: normalizeInputFiles(args.files),
    toolRequest: request,
  };
}

function normalizeCodeInterpreterExecutionResult(
  value: unknown,
): Required<Pick<CodexProviderCodeInterpreterExecutionResult, 'stdout' | 'stderr' | 'result' | 'files' | 'metadata'>> {
  if (!value || typeof value !== 'object') {
    return {
      stdout: '',
      stderr: '',
      result: value ?? null,
      files: [],
      metadata: null,
    };
  }
  const record = value as JsonRecord;
  return {
    stdout: normalizeString(record.stdout),
    stderr: normalizeString(record.stderr),
    result: record.result ?? null,
    files: normalizeOutputFiles(record.files),
    metadata: record.metadata && typeof record.metadata === 'object'
      ? record.metadata
      : null,
  };
}

function normalizeContainer(value: unknown): CodexProviderCodeInterpreterContainer {
  if (typeof value === 'string') {
    return normalizeString(value) || null;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return null;
}

function normalizeInputFiles(value: unknown): CodexProviderCodeInterpreterInputFile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as JsonRecord;
      const file = {
        file_id: normalizeString(record.file_id ?? record.fileId) || undefined,
        filename: normalizeString(record.filename ?? record.name) || undefined,
        content: typeof record.content === 'string' ? record.content : undefined,
      };
      return file.file_id || file.filename || file.content ? file : null;
    })
    .filter(Boolean) as CodexProviderCodeInterpreterInputFile[];
}

function normalizeOutputFiles(value: unknown): CodexProviderCodeInterpreterOutputFile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as JsonRecord;
      const filename = normalizeString(record.filename ?? record.name);
      if (!filename) {
        return null;
      }
      return {
        filename,
        mime_type: normalizeString(record.mime_type ?? record.mimeType) || undefined,
        b64_data: normalizeString(record.b64_data ?? record.b64Data) || undefined,
        uri: normalizeString(record.uri ?? record.url) || undefined,
      };
    })
    .filter(Boolean) as CodexProviderCodeInterpreterOutputFile[];
}

function buildCodeInterpreterStreamEmitter(
  emitDelta: CodexProviderHostedToolDeltaEmitter | null | undefined,
  stream: 'stdout' | 'stderr',
): CodexProviderCodeInterpreterStreamEmitter {
  return async (text, metadata = null) => {
    const normalizedText = normalizeString(text);
    if (!normalizedText) {
      return;
    }
    await emitDelta?.({
      type: 'code_interpreter.stream',
      stream,
      text: normalizedText,
    }, {
      stream,
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
    });
  };
}

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
