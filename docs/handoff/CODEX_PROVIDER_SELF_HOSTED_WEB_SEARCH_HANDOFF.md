# CodexProvider Self-hosted Web Search Handoff

> 目标：在 `Gan-Xing/CodexProvider` 中实现 CodexProvider 自己的 OpenAI-compatible `web_search` hosted tool 替代方案。它不是简单接入 SearXNG endpoint，也不是只做 SERP wrapper，而是内置一个 TypeScript 原生的 **MetaSearch + Web Retrieval + Citation Runtime**，让使用非 OpenAI 厂商 API key 时也能获得接近 OpenAI hosted Web Search 的效果。

---

## 0. 一句话目标

实现一个 CodexProvider-owned 的自部署 Web Search Runtime：

```text
OpenAI Responses tools: [{ type: "web_search" }]
        ↓
CodexProvider adapter-emulated hosted tool
        ↓
TS Native MetaSearch Engine
        ↓
Search engines: API engines + HTML engines + optional endpoint engines + local index
        ↓
Safe Fetch + Extract + Chunk + Rank
        ↓
Tool output with source ids
        ↓
Vendor model answer using normal function calling
        ↓
Synthetic Responses output:
  - web_search_call
  - action.sources
  - output_text.annotations url_citation
```

最终效果：CodexProvider 可以用自己的厂商 API key，例如 DeepSeek、Qwen、OpenRouter、Claude-compatible relay、任意 OpenAI-compatible Chat API，同时仍然支持 OpenAI 风格 `web_search` hosted tool 行为。

---

## 1. 背景和边界

### 1.1 这不是一个 SearXNG endpoint adapter

不要把目标理解成：

```text
CodexProvider -> SearXNG HTTP API
```

真正目标是：

```text
CodexProvider 内置 TS 版 Mini-SearXNG / OpenSERP-like MetaSearch core
```

也就是说：

```text
- 可插拔 engine adapter
- 并发 processor
- 多搜索源 fallback
- 结果归一化
- 去重 / 合并 / 排序
- engine 失败暂停
- search mode: fast / any / balanced / exhaustive
- 后续 fetch/extract/rank/citation
```

SearXNG、OpenSERP、open-webSearch 都是参考对象，不应该成为唯一运行时依赖。

### 1.2 也不是第一版就做完整 Brave-like 独立全网索引

Brave Search 是独立索引型搜索引擎，要自己 crawl、parse、index 全网。这个工程量不适合 CodexProvider 第一阶段。

第一阶段要做的是 **metasearch**：

```text
多个搜索源 -> 聚合 -> 去重 -> 排序 -> 获取网页内容 -> 引用
```

第二阶段再做 local index：

```text
抓取过的页面缓存
用户配置站点
公司文档
本地 markdown/html
SQLite FTS / MiniSearch / FlexSearch / Elasticsearch/OpenSearch adapter
```

---

## 2. OpenAI Web Search 行为基线

CodexProvider 的目标是对齐 OpenAI Responses Web Search 的可见结构，而不是复制 OpenAI 内部搜索索引。

OpenAI Web Search 的关键可见行为：

1. 输出 `web_search_call` item。
2. `web_search_call.action` 可能是：
   - `search`
   - `open_page`
   - `find_in_page`
3. 最终 `message.content[0].text` 包含回答文本。
4. 最终 `message.content[0].annotations` 包含 `url_citation`。
5. 支持 `include: ["web_search_call.action.sources"]` 暴露完整 sources。
6. 支持 `filters.allowed_domains` / `filters.blocked_domains`。
7. 支持 `user_location`、`search_context_size`、`external_web_access`、`return_token_budget` 等控制项。

官方参考：

- https://developers.openai.com/api/docs/guides/tools-web-search
- https://platform.openai.com/docs/api-reference/responses/create

CodexProvider 第一版需要做到：

```text
OpenAI request shape compatibility
Tool-call loop compatibility
web_search_call synthetic output
url_citation annotation postprocess
include sources/results
```

---

## 3. 参考项目分层对比

### 3.1 open-webSearch

仓库：

```text
https://github.com/Aas-ee/open-webSearch
```

定位：TypeScript/Node 生态的多引擎 Web Search + Fetch + MCP/CLI/daemon。

对 CodexProvider 的价值：最高。它最贴近当前项目技术栈。

值得借鉴：

```text
src/core/search
src/core/fetch
src/core/validation
src/engines/*
多 engine 并发搜索
limit 分配
partial failure 收集
fetch service 和 search service 分离
可选 Playwright fallback，不作为默认依赖
```

CodexProvider 应吸收：

```text
SearchService
Engine registry
Engine executor map
FetchService
URL validation
MCP/CLI/daemon 不作为核心目标
```

不建议照搬：

```text
MCP server / daemon runtime 不是第一阶段重点
所有 engine 代码不能无脑复制，需要按 CodexProvider 类型体系重写
```

---

### 3.2 OpenSERP

仓库：

```text
https://github.com/karust/openserp
```

定位：Go 写的开源 SERP API / CLI，支持多个搜索引擎、megasearch、去重、过滤、URL extraction。

对 CodexProvider 的价值：最高。它非常适合做 MetaSearch API 设计参考。

值得借鉴：

```text
/search/:engine
/mega/search
mode = fast | any | balanced
跨引擎结果 dedupe / merge
language / region / date / file / site filters
extract URL -> markdown/text
JSON / Markdown / Text / NDJSON 输出
proxy / cache / resilient mode
```

CodexProvider 应吸收：

```ts
export type CodexProviderSearchMode =
  | "fast"       // 竞速，最快 engine 返回足够结果即可
  | "any"        // 顺序 fallback，成功即停
  | "balanced"   // 并发多 engine，合并去重
  | "exhaustive" // 尽可能跑完所有 engine
```

不建议照搬：

```text
不要第一版做独立 HTTP API server
先作为内部 TS 模块服务 CodexProvider web_search executor
```

---

### 3.3 SearXNG

仓库：

```text
https://github.com/searxng/searxng
```

定位：Python metasearch engine，聚合大量 search services/databases。

对 CodexProvider 的价值：高。它是 engine/processor/result 架构经典参考。

值得借鉴：

```text
Engine interface
Online/offline processors
request / response parser 分离
category / language / pageno / time_range / safesearch
ResultContainer
engine failure / suspended status
```

CodexProvider 应吸收：

```text
Engine 只负责 build request + parse response
Processor 负责 timeout / headers / redirect / errors / retry / suspension
ResultContainer 负责统一聚合
```

注意：SearXNG 是 AGPL-3.0，不能直接复制代码进 CodexProvider，除非接受 AGPL 影响。只参考架构和行为。

---

### 3.4 LibreY

仓库：

```text
https://github.com/Ahwxorg/LibreY
```

定位：极简、低依赖、隐私友好的 metasearch engine。

对 CodexProvider 的价值：中高。

值得借鉴：

```text
低依赖实现路线
多 HTML search source
简单聚合
privacy-first 默认行为
```

注意：LibreY 也是 AGPL-3.0，不直接复制代码。

---

### 3.5 Firecrawl

仓库：

```text
https://github.com/firecrawl/firecrawl
```

定位：Search + Scrape + Crawl + Interact + Agent 的 Web Retrieval 产品。

对 CodexProvider 的价值：高，但它主要参考 retrieval 层，不是 metasearch core。

值得借鉴：

```text
search 之后可直接 scrape 页面内容
scrapeOptions 控制是否返回 markdown/html/structured data
搜索结果与 scraped content merge
Search source 可替换
```

CodexProvider 应吸收：

```text
search results -> fetch top pages -> extract markdown-ish text -> merge into tool output
```

不建议照搬：

```text
不要把 Firecrawl 的 heavy crawler/browser/job/billing infra 放入 core
不要第一版引入 Playwright/Puppeteer 作为默认依赖
```

---

### 3.6 MindSearch

仓库：

```text
https://github.com/InternLM/MindSearch
```

定位：LLM-based Multi-agent Web Search Engine，类似 Perplexity Pro / SearchGPT 的 deep search 思路。

对 CodexProvider 的价值：第二阶段或第三阶段。

值得借鉴：

```text
WebPlanner 将问题拆成子问题图
WebSearcher 并发搜索每个 node
引用编号重排和 ref2url 合并
搜索过程可流式返回
```

CodexProvider 第一版不应该做完整 MindSearch。可以后续做：

```text
deep_web_search
research
agentic_search
```

---

### 3.7 elasticsearch-head

仓库：

```text
https://github.com/mobz/elasticsearch-head
```

定位：Elasticsearch cluster 的 Web 管理前端。

对 CodexProvider 的价值：低到中，只对本地索引阶段有参考价值。

它不是 live web search，不负责抓取互联网。

未来如果 CodexProvider 做 local index：

```text
fetched page cache
allowlisted domains crawl
company docs
local markdown/html
Elasticsearch/OpenSearch adapter
```

那么 elasticsearch-head 可以参考：

```text
index browser
cluster status
query console
debug UI
```

但第一版不需要它。

---

### 3.8 Whoogle

仓库：

```text
https://github.com/benbusby/whoogle-search
```

定位：Google Search proxy / privacy frontend。

对 CodexProvider 的价值：主要是反例和风险提醒。

结论：Google HTML scraping 不适合作为第一版主路径。可以做 optional/best-effort engine，但不要依赖它。

---

### 3.9 Vane / Perplexica

仓库：

```text
https://github.com/ItzCrazyKns/Perplexica
```

定位：AI Answer Engine，通常依赖 SearXNG/Tavily/Exa 作为搜索后端。

对 CodexProvider 的价值：产品形态参考。

值得借鉴：

```text
answer with sources
多模型配置
search modes
UI/UX
```

不适合作为内置 metasearch core 参考，因为它通常把搜索层交给 SearXNG/Tavily/Exa。

---

## 4. CodexProvider 最佳实践路线

最终应拆成三层。

### 4.1 第一层：MetaSearch Core

参考：

```text
open-webSearch
OpenSERP
SearXNG
LibreY
```

职责：

```text
多搜索引擎 adapter
engine registry
processor
并发搜索
fallback
partial failures
engine suspension
结果归一化
去重 / 合并 / 排序
filters / language / region / safeSearch / timeRange
```

建议目录：

```text
src/web-search/metasearch/
  types.ts
  engine.ts
  registry.ts
  processor.ts
  search-service.ts
  result-container.ts
  modes.ts
  dedupe.ts
  merge.ts
  score.ts
  errors.ts
  engine-state.ts
```

---

### 4.2 第二层：Retrieval Core

参考：

```text
Firecrawl
OpenSERP extract
open-webSearch fetch
```

职责：

```text
safe fetch
SSRF protection
content-type check
HTML extraction
markdown-ish text
chunking
chunk ranking
page cache
```

建议目录：

```text
src/web-search/retrieval/
  fetcher.ts
  safety.ts
  redirects.ts
  cache.ts
  content-type.ts
  extractor.ts
  html-extractor.ts
  chunker.ts
  ranker.ts
```

---

### 4.3 第三层：OpenAI-compatible Web Search Tool

参考：

```text
OpenAI Responses web_search
CodexProvider hosted tool loop
```

职责：

```text
Responses web_search tool -> Chat function tool
execute CodexProviderWebSearchExecutor
convert results to tool output
model answers with source placeholders
postprocess citations
append web_search_call output item
include action.sources / results
```

建议目录：

```text
src/web-search/openai/
  executor.ts
  request.ts
  tool-output.ts
  web-search-call.ts
  annotations.ts
  placeholders.ts
```

---

### 4.4 第四层：Agentic Deep Search，后续阶段

参考：

```text
MindSearch
ManuSearch
Perplexica/Vane
```

职责：

```text
query decomposition
sub-question graph
parallel sub-searches
reference merge
final synthesis
```

建议后续做成：

```text
deep_web_search
research
```

不要放入第一版 `web_search` MVP。

---

## 5. 核心 TypeScript 接口设计

### 5.1 Search request

```ts
export interface CodexProviderSearchRequest {
  query: string;
  engines?: string[] | null;
  mode?: CodexProviderSearchMode | null;
  category?: CodexProviderSearchCategory | null;
  language?: string | null;
  region?: string | null;
  page?: number | null;
  safeSearch?: "off" | "moderate" | "strict" | null;
  timeRange?: "day" | "week" | "month" | "year" | null;
  maxResults?: number | null;
  allowedDomains?: string[] | null;
  blockedDomains?: string[] | null;
  externalWebAccess?: boolean | null;
}

export type CodexProviderSearchMode =
  | "fast"
  | "any"
  | "balanced"
  | "exhaustive";

export type CodexProviderSearchCategory =
  | "web"
  | "news"
  | "images"
  | "videos"
  | "it"
  | "science";
```

### 5.2 Engine interface

```ts
export interface CodexProviderSearchEngine {
  name: string;
  displayName?: string;
  categories: CodexProviderSearchCategory[];

  supportsPaging?: boolean;
  supportsTimeRange?: boolean;
  supportsSafeSearch?: boolean;
  supportsLanguage?: boolean;
  supportsRegion?: boolean;

  priority?: number;
  timeoutMs?: number;
  live?: boolean;

  buildRequest(
    request: CodexProviderSearchEngineRequest,
  ): Promise<CodexProviderEngineHttpRequest> | CodexProviderEngineHttpRequest;

  parseResponse(
    response: CodexProviderEngineHttpResponse,
    request: CodexProviderSearchEngineRequest,
  ): Promise<CodexProviderSearchResult[]> | CodexProviderSearchResult[];
}
```

### 5.3 Processor

```ts
export interface CodexProviderSearchProcessor {
  search(
    engine: CodexProviderSearchEngine,
    request: CodexProviderSearchEngineRequest,
  ): Promise<CodexProviderEngineSearchOutcome>;
}

export interface CodexProviderEngineSearchOutcome {
  engine: string;
  ok: boolean;
  durationMs: number;
  results: CodexProviderSearchResult[];
  error?: CodexProviderSearchEngineError | null;
}
```

### 5.4 Result

```ts
export interface CodexProviderSearchResult {
  type: "web" | "news" | "image" | "video" | "answer";
  engine: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string | null;
  thumbnail?: string | null;
  rank?: number | null;
  score?: number | null;
  raw?: unknown;
}

export interface CodexProviderMergedSearchResult {
  title: string;
  url: string;
  snippet: string;
  engines: string[];
  engineRanks: Record<string, number>;
  score: number;
  publishedAt?: string | null;
}
```

### 5.5 Search service

```ts
export interface CodexProviderMetaSearchService {
  search(request: CodexProviderSearchRequest): Promise<CodexProviderSearchResponse>;
}

export interface CodexProviderSearchResponse {
  query: string;
  mode: CodexProviderSearchMode;
  results: CodexProviderMergedSearchResult[];
  unresponsiveEngines: CodexProviderUnresponsiveEngine[];
  timings: Record<string, number>;
  searchedAt: string;
}
```

---

## 6. Search modes 设计

### 6.1 fast

```text
并发多个 engine，谁最快返回足够结果就先用谁。
适合低延迟场景。
```

### 6.2 any

```text
按优先级顺序尝试 engine，某个 engine 成功返回足够结果即停止。
适合稳定 fallback。
```

### 6.3 balanced

```text
并发多个 engine，等待预算内的结果，做 dedupe + merge + ranking。
适合作为默认模式。
```

### 6.4 exhaustive

```text
尽可能跑完所有 engine，适合 research/deep search。
延迟较高。
```

默认建议：

```ts
mode: "balanced"
```

---

## 7. Engine 优先级

### 7.1 P1 API engines，稳定生产路径

```text
Brave API
Serper API
Tavily API
Bing Search API，后续
Google Programmable Search，后续
```

保留现有 Tavily / Brave / Serper 逻辑，但迁移到新的 engine interface。

### 7.2 P2 HTML engines，免费 best-effort 路径

```text
DuckDuckGo HTML
Brave HTML
Ecosia HTML
Mojeek HTML
Startpage HTML
Bing HTML，可选
Google HTML，可选但不作为主路径
```

这些 engine 必须设计为：

```text
best-effort
可失败
失败不影响整个 search
有 suspension/backoff
单独 mock fixtures 测试 parser
```

### 7.3 P3 Endpoint engines，可选兼容路径

```text
SearXNG-compatible endpoint adapter
OpenSERP-compatible endpoint adapter
```

这不是依赖它们，而是如果用户已经部署了 endpoint，可以接进 CodexProvider。

### 7.4 P4 Local index engines，后续

```text
Fetched page cache engine
SQLite FTS engine
MiniSearch/FlexSearch engine
Meilisearch/Typesense adapter
Elasticsearch/OpenSearch adapter
```

---

## 8. Retrieval 设计

### 8.1 Safe fetch

必须实现 SSRF 防护。

禁止：

```text
localhost
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
::1
fc00::/7
fe80::/10
file:
data:
ftp:
```

规则：

```text
只允许 http/https
DNS resolve 后校验 IP
redirect 后重新校验
max redirects 默认 5
单页面 timeout 默认 8s
单页面 max bytes 默认 2-4MB
整次 search max bytes 默认 10-20MB
```

### 8.2 Extract

第一版零新增 runtime 依赖。

轻量 HTML extractor：

```text
remove script/style/noscript/svg/canvas/iframe
extract title
extract meta description
extract canonical URL
replace h1-h6/p/li/br/div/tr/td with line breaks
strip tags
decode common HTML entities
collapse whitespace
```

后续可选：

```text
linkedom + @mozilla/readability
Playwright/Puppeteer 作为 optional heavy adapter
```

不要第一版默认引入浏览器自动化。

### 8.3 Chunk + Rank

Chunk：

```text
800-1500 chars
保留 source_id / url / title / offsets
```

Rank：

```text
source SERP score
engine rank
engine votes
title query overlap
snippet query overlap
chunk BM25 / term overlap
exact phrase boost
recency boost
duplicate penalty
```

---

## 9. OpenAI-compatible web_search integration

### 9.1 Tool execution

CodexProvider 接收：

```json
{
  "tools": [{ "type": "web_search" }],
  "input": "..."
}
```

转成 vendor Chat function：

```json
{
  "type": "function",
  "function": {
    "name": "web_search",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string" },
        "search_context_size": { "type": "string", "enum": ["low", "medium", "high"] },
        "filters": { "type": "object" },
        "external_web_access": { "type": "boolean" }
      },
      "required": ["query"]
    }
  }
}
```

### 9.2 Executor pipeline

```text
normalize request
metaSearch.search()
dedupe / merge / rank
safe fetch top pages
extract text
chunk + rank chunks
build sources
return tool output with source ids and citation instruction
```

### 9.3 Tool output to model

```json
{
  "query": "...",
  "results": [
    {
      "source_id": 1,
      "title": "...",
      "url": "...",
      "snippet": "...",
      "chunks": [{ "text": "..." }]
    }
  ],
  "sources": [
    { "source_id": 1, "title": "...", "url": "..." }
  ],
  "instructions": "When using information from a source, cite it as [[source:1]], [[source:2]], etc."
}
```

### 9.4 Synthetic Responses output

Append `web_search_call`：

```json
{
  "id": "ws_call_xxx",
  "type": "web_search_call",
  "status": "completed",
  "action": {
    "type": "search",
    "query": "...",
    "queries": ["..."],
    "sources": [
      { "title": "...", "url": "..." }
    ]
  }
}
```

最终 message：

```json
{
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "output_text",
      "text": "... [1]",
      "annotations": [
        {
          "type": "url_citation",
          "start_index": 10,
          "end_index": 13,
          "url": "https://...",
          "title": "..."
        }
      ]
    }
  ]
}
```

---

## 10. 阶段计划

## Phase 0: Baseline and current code audit

目标：不改行为，建立测试和边界。

任务：

```text
确认改名后的 CodexProvider API 稳定
确认现有 hosted tool loop 可执行 web_search function tool
补 Web Search fixture 测试框架
定义 src/web-search/ 模块入口
```

完成标准：

```text
pnpm test
pnpm typecheck
pnpm build
```

---

## Phase 1: MetaSearch core

目标：实现 TS 原生 metasearch core，不接具体 engine 也能跑 fake engine 测试。

新增：

```text
src/web-search/metasearch/types.ts
src/web-search/metasearch/engine.ts
src/web-search/metasearch/registry.ts
src/web-search/metasearch/processor.ts
src/web-search/metasearch/search-service.ts
src/web-search/metasearch/result-container.ts
src/web-search/metasearch/modes.ts
src/web-search/metasearch/dedupe.ts
src/web-search/metasearch/merge.ts
src/web-search/metasearch/score.ts
src/web-search/metasearch/errors.ts
src/web-search/metasearch/engine-state.ts
```

测试：

```text
test/web_search_metasearch_core.test.ts
```

覆盖：

```text
engine register/list/get
fast mode
any mode
balanced mode
exhaustive mode
partial failure
engine suspension
dedupe/merge/scoring
allowed/blocked domains
```

---

## Phase 2: API engines migration

目标：把现有 Tavily / Brave / Serper 逻辑迁移成新的 SearchEngine adapter。

新增：

```text
src/web-search/engines/brave-api.ts
src/web-search/engines/serper-api.ts
src/web-search/engines/tavily-api.ts
```

测试：

```text
test/web_search_api_engines.test.ts
```

覆盖：

```text
mock fetch requests
headers/body/query params
result normalization
errors
filters where supported
```

---

## Phase 3: HTML engines

目标：内置无 API key 的 best-effort engines。

新增：

```text
src/web-search/engines/duckduckgo-html.ts
src/web-search/engines/brave-html.ts
src/web-search/engines/ecosia-html.ts
src/web-search/engines/mojeek-html.ts
```

可选：

```text
startpage-html.ts
bing-html.ts
google-html.ts, 低优先级
```

测试：

```text
test/web_search_html_engines.test.ts
fixtures/web-search/*.html
```

覆盖：

```text
fixture HTML parse
title/url/snippet extraction
tracking URL cleanup
no-result page
blocked/captcha page classified as engine error
```

---

## Phase 4: Endpoint adapters

目标：支持用户已有搜索后端，但不依赖它们。

新增：

```text
src/web-search/engines/searxng-endpoint.ts
src/web-search/engines/openserp-endpoint.ts
```

测试：

```text
test/web_search_endpoint_engines.test.ts
```

覆盖：

```text
SearXNG JSON response normalize
OpenSERP JSON response normalize
endpoint errors
```

---

## Phase 5: Retrieval core

目标：Search 后可以安全抓网页并提取正文。

新增：

```text
src/web-search/retrieval/fetcher.ts
src/web-search/retrieval/safety.ts
src/web-search/retrieval/redirects.ts
src/web-search/retrieval/cache.ts
src/web-search/retrieval/content-type.ts
src/web-search/retrieval/html-extractor.ts
src/web-search/retrieval/chunker.ts
src/web-search/retrieval/ranker.ts
```

测试：

```text
test/web_search_retrieval.test.ts
test/web_search_fetch_security.test.ts
```

覆盖：

```text
SSRF block
redirect-to-private block
timeout
max bytes
content-type allowlist
HTML extraction
chunking
chunk rank
cache hit/miss
external_web_access=false no live fetch
```

---

## Phase 6: CodexProvider web_search executor integration

目标：把 MetaSearch + Retrieval 接到 hosted tool executor。

新增/修改：

```text
src/web-search/openai/executor.ts
src/web-search/openai/request.ts
src/web-search/openai/tool-output.ts
src/web_search_executor.ts facade
```

Public API：

```ts
createCodexProviderWebSearchExecutor({
  search: createCodexProviderMetaSearch(...),
  retrieval: createCodexProviderWebRetrieval(...),
})
```

兼容简化配置：

```ts
createCodexProviderWebSearchExecutor({
  engines: [...],
  mode: "balanced",
  fetchPages: true,
})
```

测试：

```text
test/web_search_executor.test.ts
```

覆盖：

```text
web_search query normalize
search_context_size budget mapping
filters pass through
external_web_access=false
return tool output with sources/chunks/instructions
```

---

## Phase 7: OpenAI-compatible output parity

目标：最终 Responses output 对齐 OpenAI 可见结构。

修改：

```text
src/server/responses_adapter_server.ts
src/web-search/openai/web-search-call.ts
src/web-search/openai/annotations.ts
src/web-search/openai/placeholders.ts
```

实现：

```text
append web_search_call
include web_search_call.action.sources
include web_search_call.results
parse [[source:N]]
generate output_text.annotations url_citation
```

测试：

```text
test/web_search_responses_output.test.ts
```

覆盖：

```text
web_search_call exists
action.type=search
action.sources include works
results include works
placeholder citation -> url_citation annotation
no placeholder -> no fake citation
streaming synthetic response includes web_search_call
```

---

## Phase 8: Local index and cache engine

目标：逐步走向 Brave-like own index 的轻量版本。

新增：

```text
src/web-search/local-index/
  memory-index.ts
  sqlite-fts-index.ts, optional adapter contract only
  cache-engine.ts
```

功能：

```text
把 fetched pages 缓存进 local index
external_web_access=false 可以搜索 cache/local index
future: allowlisted domains crawler
```

测试：

```text
test/web_search_local_index.test.ts
```

---

## Phase 9: MindSearch-style deep search, optional

目标：构建 agentic deep search，不进入第一版 web_search MVP。

新增：

```text
src/web-search/deep/
  planner.ts
  graph.ts
  subquery-runner.ts
  reference-merge.ts
```

功能：

```text
query decomposition
parallel sub-searches
source merge
final synthesis support
```

对外可做单独 tool：

```text
deep_web_search
research
```

---

## 11. 推荐配置示例

### 11.1 免费优先配置

```ts
const webSearch = createCodexProviderWebSearchExecutor({
  mode: "balanced",
  engines: [
    createCodexProviderDuckDuckGoHtmlEngine(),
    createCodexProviderBraveHtmlEngine(),
    createCodexProviderEcosiaHtmlEngine(),
    createCodexProviderMojeekHtmlEngine(),
  ],
  fetchPages: true,
  maxResults: 8,
  maxRetrievedPages: 5,
});
```

### 11.2 生产推荐配置

```ts
const webSearch = createCodexProviderWebSearchExecutor({
  mode: "balanced",
  engines: [
    process.env.BRAVE_SEARCH_API_KEY
      ? createCodexProviderBraveApiEngine({ apiKey: process.env.BRAVE_SEARCH_API_KEY })
      : null,
    process.env.SERPER_API_KEY
      ? createCodexProviderSerperApiEngine({ apiKey: process.env.SERPER_API_KEY })
      : null,
    createCodexProviderDuckDuckGoHtmlEngine(),
    createCodexProviderBraveHtmlEngine(),
  ].filter(Boolean),
  fetchPages: true,
  maxResults: 10,
  maxRetrievedPages: 5,
});
```

### 11.3 Endpoint + local fallback

```ts
const localIndex = createCodexProviderMemoryWebSearchLocalIndex();
const retrieval = createCodexProviderWebRetrievalFetcher({
  cache: createCodexProviderLocalIndexingWebRetrievalCache({
    cache: createCodexProviderMemoryWebRetrievalCache(),
    index: localIndex,
  }),
});

const webSearch = createCodexProviderWebSearchExecutor({
  mode: "balanced",
  engines: [
    process.env.SEARXNG_ENDPOINT
      ? createCodexProviderSearxngEndpointEngine({ endpoint: process.env.SEARXNG_ENDPOINT })
      : null,
    process.env.OPENSERP_ENDPOINT
      ? createCodexProviderOpenSerpEndpointEngine({ endpoint: process.env.OPENSERP_ENDPOINT })
      : null,
    createCodexProviderLocalIndexSearchEngine({ index: localIndex, name: "local-cache" }),
    createCodexProviderDuckDuckGoHtmlEngine(),
  ].filter(Boolean),
  retrieval,
  fetchPages: true,
});
```

---

## 12. 测试总清单

```text
test/web_search_metasearch_core.test.ts
test/web_search_api_engines.test.ts
test/web_search_html_engines.test.ts
test/web_search_endpoint_engines.test.ts
test/web_search_retrieval.test.ts
test/web_search_fetch_security.test.ts
test/web_search_executor.test.ts
test/web_search_responses_output.test.ts
test/web_search_local_index.test.ts
```

所有网络相关测试必须 mock fetch 或使用本地 HTTP server，不访问真实互联网。

---

## 13. 非目标

第一版不要做：

```text
完整自建全网索引
浏览器自动化作为默认依赖
PDF/Office/image OCR
复杂视觉搜索
Google HTML scraping 主路径
复制 SearXNG/LibreY AGPL 代码
独立 HTTP search API server
MindSearch deep agent 默认开启
```

---

## 14. 验收标准

### 14.1 功能验收

```text
1. 没有 OpenAI API key 也能使用 web_search，通过其他 vendor model + CodexProvider executor 工作。
2. 没有搜索 API key 时，也能通过 HTML engines best-effort 返回结果。
3. 有 Brave/Serper/Tavily API key 时，优先使用稳定 API engines。
4. 支持多引擎 balanced 聚合、去重、合并排序。
5. Search 后可以 fetch top pages 并提取正文 chunks。
6. Tool output 包含 sources、documents/chunks、citation instruction。
7. 最终 Responses output 包含 web_search_call。
8. include web_search_call.action.sources 可暴露 sources。
9. [[source:N]] 可生成 url_citation annotations。
10. external_web_access=false 不访问 live web，只用 cache/local index。
```

### 14.2 安全验收

```text
SSRF block
redirect-to-private block
max redirects
max bytes
timeout
content type allowlist
engine suspension
partial failures not fatal
```

### 14.3 工程验收

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm check-boundary
```

---

## 15. 给 Coding Agent 的 Prompt

```text
你正在 Gan-Xing/CodexProvider 仓库工作。当前任务是实现 CodexProvider 自己的 self-hosted OpenAI-compatible web_search tool。目标不是接入 SearXNG endpoint，而是在 CodexProvider 内实现 TypeScript 原生的 MetaSearch + Retrieval Runtime，用于替代 OpenAI hosted web_search。

不要做改名任务，假设 CodexProvider rename cleanup 已完成。不要新增 Playwright/Puppeteer/jsdom 等重依赖。不要复制 SearXNG/LibreY AGPL 源码。所有外部网络测试必须 mock fetch 或本地 HTTP server。

必须先阅读：

src/index.ts
src/hosted_tools.ts
src/hosted_tool_executors.ts
src/web_search_executor.ts
src/server/responses_adapter_server.ts
src/converters/responses_adapter.ts
test/web_search_executor.test.ts

参考项目，但不要直接复制：

open-webSearch: https://github.com/Aas-ee/open-webSearch
OpenSERP: https://github.com/karust/openserp
SearXNG: https://github.com/searxng/searxng
Firecrawl: https://github.com/firecrawl/firecrawl
MindSearch: https://github.com/InternLM/MindSearch
LibreY: https://github.com/Ahwxorg/LibreY
Whoogle: https://github.com/benbusby/whoogle-search

阶段 1：MetaSearch core
新增 src/web-search/metasearch/*，实现 engine interface、registry、processor、search-service、modes、dedupe、merge、score、engine-state。支持 fast/any/balanced/exhaustive。写 fake engine tests。

阶段 2：API engines
把现有 Brave API / Serper / Tavily 迁移成 CodexProviderSearchEngine adapter。保留行为，改成新 metasearch interface。写 mock fetch tests。

阶段 3：HTML engines
实现 DuckDuckGo HTML、Brave HTML、Ecosia HTML、Mojeek HTML best-effort engines。用 fixtures 测试 parser，不访问真实网络。HTML engines 失败不能导致整体失败。

阶段 4：Endpoint engines
实现 SearXNG-compatible endpoint adapter 和 OpenSERP-compatible endpoint adapter。它们是可选 engine，不是必需依赖。

阶段 5：Retrieval core
新增 src/web-search/retrieval/*。实现 safe fetch、SSRF 防护、redirect 校验、timeout、max bytes、content-type allowlist、HTML extraction、chunking、chunk ranking、cache。external_web_access=false 时禁止 live fetch。

阶段 6：web_search executor integration
重构 src/web_search_executor.ts 为 facade，核心放入 src/web-search/openai/executor.ts。createCodexProviderWebSearchExecutor 内部调用 metasearch + retrieval，返回 sources、results、documents/chunks、citation instruction。

阶段 7：OpenAI-compatible output parity
修改 src/server/responses_adapter_server.ts。每次 web_search execution 后 append web_search_call output item。支持 include ["web_search_call.action.sources"] 和 ["web_search_call.results"]。解析 [[source:N]]，生成 output_text.annotations 的 url_citation。

阶段 8：Local index/cache engine
实现 local cache search engine，让 external_web_access=false 可以搜索缓存。不要第一版接 Elasticsearch，只预留 adapter contract。

阶段 9：Deep search, optional
参考 MindSearch 设计 query decomposition graph，但不要放入第一版默认 web_search。后续可做 deep_web_search/research tool。

验收：

pnpm test
pnpm typecheck
pnpm build
pnpm check-boundary

必须新增测试：

test/web_search_metasearch_core.test.ts
test/web_search_api_engines.test.ts
test/web_search_html_engines.test.ts
test/web_search_endpoint_engines.test.ts
test/web_search_retrieval.test.ts
test/web_search_fetch_security.test.ts
test/web_search_responses_output.test.ts

最终效果：使用非 OpenAI vendor API key 时，CodexProvider 仍能支持 OpenAI-compatible tools: [{ type: "web_search" }]，并返回 synthetic web_search_call + cited message annotations。
```

---

## 16. 总结

最终实现不是单点搜索插件，而是：

```text
CodexProvider Native MetaSearch + Web Retrieval Runtime
```

参考组合：

```text
open-webSearch：TS 多 engine + fetch service
OpenSERP：megasearch modes + dedupe/merge/extract
SearXNG：engine/processor/result container 架构
Firecrawl：search -> scrape -> markdown merge
MindSearch：后续 deep search graph
elasticsearch-head：未来 local index UI/admin 参考
```

这条路线能让 CodexProvider 真正具备接近 OpenAI Web Search 的自部署能力，而不是简单依赖某个外部搜索服务。
