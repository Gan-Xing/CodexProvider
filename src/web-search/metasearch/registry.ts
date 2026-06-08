import {
  assertValidSearchEngine,
  normalizeSearchEngineName,
} from './engine.js';
import type {
  CodexProviderSearchEngine,
  CodexProviderSearchEngineRegistry,
} from './types.js';

export function createCodexProviderSearchEngineRegistry(
  engines: CodexProviderSearchEngine[] = [],
): CodexProviderSearchEngineRegistry {
  const registry = new DefaultCodexProviderSearchEngineRegistry();
  for (const engine of engines) {
    registry.register(engine);
  }
  return registry;
}

class DefaultCodexProviderSearchEngineRegistry implements CodexProviderSearchEngineRegistry {
  private readonly engines = new Map<string, CodexProviderSearchEngine>();

  register(engine: CodexProviderSearchEngine): this {
    assertValidSearchEngine(engine);
    const name = normalizeSearchEngineName(engine.name);
    if (this.engines.has(name)) {
      throw new Error(`Search engine already registered: ${name}`);
    }
    this.engines.set(name, {
      ...engine,
      name,
    });
    return this;
  }

  has(name: string): boolean {
    return this.engines.has(normalizeSearchEngineName(name));
  }

  get(name: string): CodexProviderSearchEngine | null {
    return this.engines.get(normalizeSearchEngineName(name)) ?? null;
  }

  list(): CodexProviderSearchEngine[] {
    return [...this.engines.values()]
      .sort((left, right) => (
        normalizePriority(right.priority) - normalizePriority(left.priority)
        || left.name.localeCompare(right.name)
      ));
  }
}

function normalizePriority(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
