import type {
  CodexProviderSearchEngineState,
  CodexProviderSearchEngineStateSnapshot,
} from './types.js';

export interface CodexProviderSearchEngineStateOptions {
  failureThreshold?: number | null;
  suspensionMs?: number | null;
}

interface MutableEngineState {
  consecutiveFailures: number;
  suspendedUntil: Date | null;
}

export function createCodexProviderSearchEngineState(
  options: CodexProviderSearchEngineStateOptions = {},
): CodexProviderSearchEngineState {
  return new DefaultCodexProviderSearchEngineState(options);
}

class DefaultCodexProviderSearchEngineState implements CodexProviderSearchEngineState {
  private readonly states = new Map<string, MutableEngineState>();
  private readonly failureThreshold: number;
  private readonly suspensionMs: number;

  constructor(options: CodexProviderSearchEngineStateOptions) {
    this.failureThreshold = clampInteger(options.failureThreshold, 1, 20, 2);
    this.suspensionMs = clampInteger(options.suspensionMs, 1_000, 60 * 60 * 1000, 60_000);
  }

  isSuspended(engineName: string, now: Date = new Date()): boolean {
    const state = this.states.get(engineName);
    return Boolean(state?.suspendedUntil && state.suspendedUntil.getTime() > now.getTime());
  }

  suspendedUntil(engineName: string): Date | null {
    return this.states.get(engineName)?.suspendedUntil ?? null;
  }

  recordSuccess(engineName: string): void {
    this.states.set(engineName, {
      consecutiveFailures: 0,
      suspendedUntil: null,
    });
  }

  recordFailure(engineName: string, now: Date = new Date()): void {
    const current = this.states.get(engineName) ?? {
      consecutiveFailures: 0,
      suspendedUntil: null,
    };
    const consecutiveFailures = current.consecutiveFailures + 1;
    this.states.set(engineName, {
      consecutiveFailures,
      suspendedUntil: consecutiveFailures >= this.failureThreshold
        ? new Date(now.getTime() + this.suspensionMs)
        : current.suspendedUntil,
    });
  }

  snapshot(): CodexProviderSearchEngineStateSnapshot[] {
    return [...this.states.entries()]
      .map(([name, state]) => ({
        name,
        consecutiveFailures: state.consecutiveFailures,
        suspendedUntil: state.suspendedUntil?.toISOString() ?? null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}
