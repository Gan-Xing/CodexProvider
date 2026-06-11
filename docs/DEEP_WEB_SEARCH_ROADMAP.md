# Deep Web Search Roadmap

Deep web search is an opt-in research surface. It must not be mixed into the default `web_search` path.

## Current Status

Current implementation files:

- `src/web-search/deep/planner.ts`
- `src/web-search/deep/graph.ts`
- `src/web-search/deep/subquery-runner.ts`
- `src/web-search/deep/reference-merge.ts`

The current planner is heuristic. It decomposes a query into bounded subqueries, builds a graph, runs search nodes, merges references by canonical URL, and returns synthesis instructions. It is useful for experimentation and host-owned custom tools such as `custom:deep_web_search`, but it is not yet a recommended default research product.

## Non-Default Contract

- Default `web_search` remains a single search/retrieval executor.
- Deep search must be registered explicitly through `createCodexProviderDeepWebSearchExecutor`.
- Hosts should expose it as a separate custom hosted tool name, for example `custom:deep_web_search`.
- Deep search results should preserve merged sources and citation placeholders rather than hiding which subquery found each source.

## Planner Interface

Current planner contract:

- Input: user query and optional `maxSubqueries`.
- Output: `CodexProviderDeepSearchPlan` with `root` and `search` nodes plus heuristic diagnostics.
- Current planner: `createCodexProviderHeuristicDeepSearchPlanner`.
- Cycle 10 adds diagnostics for selected subqueries, discarded candidates, and subquery budget usage. It also adds fixture coverage for comparison, multi-part, current-evidence, and CJK comparison queries.

Roadmap:

- Add a host-injected model planner interface for query decomposition.
- Add domain-aware planning so allowed/blocked domains affect subquery generation.
- Add language/region-aware planning for non-English research.

## Graph Execution

Current graph support:

- Validates duplicate and missing node dependencies.
- Produces topological execution levels.
- Runs search nodes in parallel within each level.
- Cycle 10 adds regression coverage for missing dependency and cycle rejection.
- Cycle 11 adds regression coverage for partial search-node failures continuing with successful branches.

Roadmap:

- Add per-node timeout and retry metadata.
- Add graph-level budget accounting for total queries, sources, and wall-clock time.
- Add optional dependency types, such as "expand after source found" or "compare evidence".
- Add tests for multi-level graphs, partial failures, and cycle rejection.

## Reference Merge

Current merge support:

- Groups search results by canonical URL.
- Scores sources higher when they support multiple subqueries or engines.
- Preserves supporting queries and node ids.
- Cycle 10 adds regression coverage for URL tracking-parameter canonicalization and stable citation ids.

Roadmap:

- Add source-quality signals: canonical publisher, freshness, duplicate syndication, and content type.
- Add conflict markers when sources disagree across subqueries.
- Add dedupe tests for tracking parameters, canonical URL variants, and translated pages.

## Synthesis Contract

Current synthesis support:

- Returns instructions for a downstream model to cite merged sources with `[[source:N]]` placeholders.
- Does not synthesize final prose inside the executor.
- Cycle 11 adds response and hosted-tool metadata diagnostics for failed subqueries, unresponsive engines, selected/discarded planner counts, and source counts.

Roadmap:

- Define a host-injected synthesis executor that can be disabled by default.
- Add citation budget controls and minimum-source requirements.
- Add answer-shape modes such as brief answer, evidence table, and research memo.
- Add policy for "no supporting evidence found" responses.

## Test Plan

Required before recommending deep search as productized:

- Done: planner decomposition tests for comparison, multi-part, current-evidence, and CJK comparison queries.
- Done: graph tests for topological levels, cycles, missing dependencies, and partial failure handling.
- Done: reference merge tests for URL canonicalization, repeated source boosts, and citation id stability.
- Done: executor tests for budget limits, external web access false, domain filters, and unresponsive engines.
- Documentation examples that keep `custom:deep_web_search` separate from default `web_search`.
