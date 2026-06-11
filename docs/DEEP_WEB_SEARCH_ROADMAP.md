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
- Deep search results should preserve merged sources and citation placeholders rather than hiding which subquery found each source. Explicit citation budgets may cap citation output, but they do not drop merged sources.

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
- Cycle 17 adds graph-level budget accounting for search-node count, executed subqueries, total raw results, configured budgets, and wall-clock duration.
- Cycle 18 adds opt-in per-node timeout budgets, retry attempts for failed or timeout-empty subqueries, and response metadata for attempts, timeouts, retries, and per-node duration.

Roadmap:

- Add optional dependency types, such as "expand after source found" or "compare evidence".
- Add tests for multi-level graphs, partial failures, and cycle rejection.

## Reference Merge

Current merge support:

- Groups search results by canonical URL.
- Scores sources higher when they support multiple subqueries or engines.
- Preserves supporting queries and node ids.
- Cycle 10 adds regression coverage for URL tracking-parameter canonicalization and stable citation ids.
- Cycle 19 exposes supporting node ids on returned deep-search results and sources so hosts can trace merged evidence back to the search graph.

Roadmap:

- Add source-quality signals: canonical publisher, freshness, duplicate syndication, and content type.
- Add conflict markers when sources disagree across subqueries.
- Add dedupe tests for tracking parameters, canonical URL variants, and translated pages.

## Synthesis Contract

Current synthesis support:

- Returns instructions for a downstream model to cite merged sources with `[[source:N]]` placeholders.
- Does not synthesize final prose inside the executor.
- Cycle 11 adds response and hosted-tool metadata diagnostics for failed subqueries, unresponsive engines, selected/discarded planner counts, and source counts.
- Cycle 12 adds recipe and example coverage that registers `custom:deep_web_search` separately from default `web_search`.
- Cycle 13 adds `no_supporting_evidence` response diagnostics plus `noSupportingEvidence` hosted-tool metadata when all searched branches return zero merged sources.
- Cycle 14 adds optional `min_sources` request handling with below-minimum-source synthesis instructions, response diagnostics, and hosted-tool metadata.
- Cycle 15 adds optional `citation_budget` / `max_citations` request handling with capped citation output, synthesis instructions, response diagnostics, and hosted-tool metadata.
- Cycle 16 adds optional `answer_shape` request handling for `brief`, `evidence_table`, and `research_memo` synthesis guidance with response diagnostics and hosted-tool metadata.

Roadmap:

- Define a host-injected synthesis executor that can be disabled by default.

## Test Plan

Required before recommending deep search as productized:

- Done: planner decomposition tests for comparison, multi-part, current-evidence, and CJK comparison queries.
- Done: graph tests for topological levels, cycles, missing dependencies, and partial failure handling.
- Done: reference merge tests for URL canonicalization, repeated source boosts, and citation id stability.
- Done: executor tests for budget limits, external web access false, domain filters, and unresponsive engines.
- Done: documentation examples that keep `custom:deep_web_search` separate from default `web_search`.
- Done: no-supporting-evidence tests for empty branch results and hosted-tool metadata.
- Done: minimum-source tests for limited-evidence synthesis instructions and hosted-tool metadata.
- Done: citation-budget tests for capped citation output, zero-citation mode, and hosted-tool metadata.
- Done: answer-shape tests for hosted-tool argument normalization, synthesis guidance, and hosted-tool metadata.
- Done: graph-budget tests for configured query/source/result budgets, executed subqueries, raw result counts, unresponsive engines, and duration metadata.
- Done: subquery timeout/retry tests for opt-in timeout forwarding, retry attempts, per-node metadata, aggregate diagnostics, and hosted-tool metadata.
- Done: source-provenance tests for `supporting_node_ids` on merged deep-search results and sources.
