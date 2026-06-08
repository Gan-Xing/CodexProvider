import {
  searchUrlMatchesDomainFilters,
} from './dedupe.js';
import {
  mergeSearchResults,
} from './merge.js';
import type {
  CodexProviderEngineSearchOutcome,
  CodexProviderMergedSearchResult,
  CodexProviderSearchResult,
  CodexProviderUnresponsiveEngine,
} from './types.js';

export interface CodexProviderSearchResultContainerOptions {
  query: string;
  allowedDomains?: string[] | null;
  blockedDomains?: string[] | null;
}

export class CodexProviderSearchResultContainer {
  private readonly results: CodexProviderSearchResult[] = [];
  private readonly unresponsive: CodexProviderUnresponsiveEngine[] = [];
  private readonly timings: Record<string, number> = {};

  constructor(private readonly options: CodexProviderSearchResultContainerOptions) {}

  addOutcome(outcome: CodexProviderEngineSearchOutcome): void {
    this.timings[outcome.engine] = outcome.durationMs;
    if (!outcome.ok) {
      this.unresponsive.push({
        engine: outcome.engine,
        code: outcome.error?.code ?? 'engine_error',
        message: outcome.error?.message ?? 'Search engine failed.',
        durationMs: outcome.durationMs,
      });
      return;
    }
    for (const result of outcome.results) {
      if (searchUrlMatchesDomainFilters(
        result.url,
        this.options.allowedDomains ?? [],
        this.options.blockedDomains ?? [],
      )) {
        this.results.push(result);
      }
    }
  }

  addUnresponsive(entry: CodexProviderUnresponsiveEngine): void {
    this.unresponsive.push(entry);
  }

  mergedResults(maxResults: number): CodexProviderMergedSearchResult[] {
    return mergeSearchResults(this.results, this.options.query).slice(0, maxResults);
  }

  unresponsiveEngines(): CodexProviderUnresponsiveEngine[] {
    return this.unresponsive;
  }

  engineTimings(): Record<string, number> {
    return { ...this.timings };
  }
}
