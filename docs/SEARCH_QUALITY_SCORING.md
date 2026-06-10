# Search Quality Scoring

This document records the deterministic scoring policy for adapter-owned `web_search`, local web indexes, web retrieval chunks, and `file_search`.

The policy is intentionally lightweight. It is not an OpenAI hosted search-quality claim; it is a stable local ranking contract that can be tested without live providers.

## Shared Tokenization

Search ranking uses a shared tokenizer for web and file search lexical scoring.

- Latin and numeric text is lowercased into word tokens.
- Hyphenated and underscored terms keep the full token and also expose split parts. For example, `file_search` emits `file_search`, `file`, and `search`.
- CJK runs emit the full run plus bigrams and trigrams. For example, `量子计算平台` emits the full phrase, `量子`, `计算`, `平台`, and matching trigrams.
- Duplicate tokens are removed where overlap scoring is used. Retrieval chunk ranking can request repeated tokens so repeated text mentions still count.

## Web Metasearch Ranking

Metasearch first deduplicates URLs through canonicalization:

- fragments are dropped.
- hosts are lowercased.
- default ports are removed.
- tracking parameters such as `utm_*`, `fbclid`, and `gclid` are removed.
- remaining query parameters are sorted.

Each engine result is scored from:

- upstream rank.
- bounded upstream score, when supplied.
- title/query token overlap.
- snippet/query token overlap.
- a boost when every query token appears in the title.
- a larger boost when the normalized title exactly equals the normalized query.
- a phrase boost when the title or snippet contains the normalized query text.

Merged results then add:

- summed engine rank evidence.
- duplicate-engine vote boost.
- merged title and snippet overlap.

Domain allow/block filters are applied after engine parsing and before final result merging in the service result container.

Published dates are normalized and preserved for consumers, but Phase 7 does not add wall-clock recency scoring. Date-oriented fixtures assert that dated, query-relevant results rank deterministically through rank and lexical evidence.

## Web Retrieval Chunk Ranking

Retrieved page text is split into bounded chunks and ranked against the same shared query terms.

- Text term hits count normally.
- Title hits count double.
- URL hits count lightly.
- Earlier chunks break otherwise equal ties.

The ranker is used after page retrieval to select quote-safe grounding chunks for synthetic `web_search_call` output.

## Local Web Index

The in-memory local web index uses the same tokenizer as metasearch.

- Title terms carry the highest lexical weight.
- Snippet terms carry medium weight.
- Body terms carry bounded weight.
- URL terms carry low weight.
- Exact query phrase matches across title, snippet, and body receive a boost.
- Domain filters apply before scoring.

The local web index is owned by `web_search`. It is never a `file_search` source unless a host explicitly creates a separate file-search source.

## File Search Ranking

File search lexical scoring is source-local and normalized by the executor before response shaping.

- Path hits add a small boost.
- Title hits add a medium boost.
- If every query term appears in the title, the document receives an additional title-complete boost.
- Content term occurrences carry the highest lexical weight.
- Vector-capable sources can combine lexical and embedding evidence through `ranking_options.hybrid_search`.
- RRF hybrid ranking remains available for local-vector sources.
- `score_threshold` is applied after source aggregation and executor normalization.

Source-level cursor pagination and signed executor page tokens do not change ranking. They only control which ranked page is returned.

## HTML Extraction

HTML extraction is dependency-free and fixture-tested.

- Scripts, styles, noscript, SVG, comments, hidden blocks, and `aria-hidden="true"` blocks are removed.
- `main` and `article` fragments are preferred over the whole document.
- Common page chrome such as `nav`, `header`, `footer`, `aside`, and equivalent landmark roles is removed from the selected content.
- Description metadata and canonical URLs are extracted when present.
- Block tags, table rows, and table cells are converted into readable whitespace before tag stripping.

The extractor is designed for readable grounding text, not browser-perfect rendering.

## Fixture Workflow

Ranking and extraction fixtures live under `test/fixtures/web-search-ranking/`.

When changing scoring or extraction:

- add or update a fixture before changing assertions.
- keep fixtures deterministic and provider-independent.
- cover duplicate URLs, exact-title matches, tracking cleanup, domain filters, CJK tokenization, local-index ranking, and file-search ranking.
- include article pages with navigation/header/footer noise, docs pages with code/table/list content, CJK pages, and malformed HTML.

HTML engine parser fixtures live under `test/fixtures/web-search/`.

When changing parser selectors:

- preserve no-results and blocked/captcha fixtures.
- keep tracking URL cleanup assertions.
- add malformed-result and relative-link fixtures when a provider parser changes shape.
- keep fixtures small and redacted; do not depend on live provider HTML during unit tests.
