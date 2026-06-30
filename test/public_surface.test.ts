import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as sdk from '../src/index.js';
import {
  assessCodexProviderProtocolBoundary,
  buildCodexProviderConfig,
  buildCodexProviderProfile,
  CODEX_PROVIDER_DOES_NOT_OWN,
  CODEX_PROVIDER_OWNS,
  CODEX_PROVIDER_PACKAGE_NAME,
  CODEX_PROVIDER_PACKAGE_PHASE,
  CODEX_PROVIDER_RELEASE_CHANNEL,
  CODEX_PROVIDER_TARGET,
  CodexProviderHostedToolExecutorRegistry,
  CodexProviderRuntime,
  createCodexProviderCodeInterpreterExecutor,
  createCodexProviderComputerExecutor,
  createCodexProviderFileSearchExecutor,
  createCodexProviderHostedToolExecutorRegistry,
  createCodexProviderImageGenerationExecutor,
  createCodexProviderStandaloneServerConfigFromEnv,
  createCodexProviderStandaloneServerFromEnv,
  createCodexProviderToolSearchExecutor,
  createCodexProviderWebSearchExecutor,
  loadCodexProviderStandaloneEnvFile,
  resolveCodexProviderStandaloneServerEnv,
} from '../src/index.js';

const oldR = ['r', 'e', 'l', 'a', 'y'].join('');
const oldRTitle = ['R', 'e', 'l', 'a', 'y'].join('');
const oldG = ['g', 'a', 't', 'e', 'w', 'a', 'y'].join('');
const oldGTitle = ['G', 'a', 't', 'e', 'w', 'a', 'y'].join('');
const legacyProviderTypePrefix = `CodexProvider${oldRTitle}`;
const legacyProviderFactoryPrefix = `createCodexProvider${oldRTitle}`;
const legacyHostTypePrefix = `Codex${oldGTitle}`;
const legacyHostFactoryPrefix = `createCodex${oldGTitle}`;
const legacyProviderBin = `codex-provider-${oldR}-server`;
const legacyHostBin = `codex-${oldG}-server`;
const legacyNamePattern = new RegExp([
  legacyProviderTypePrefix,
  legacyHostTypePrefix,
  `codex-provider-${oldR}`,
  `codex-${oldG}`,
  `${oldR}-${'emulated'}`,
].join('|'), 'u');
const legacyExampleNamePattern = new RegExp([
  legacyProviderTypePrefix,
  legacyHostTypePrefix,
  legacyProviderFactoryPrefix,
  legacyHostFactoryPrefix,
  `${oldR}-${'emulated'}`,
].join('|'), 'u');

const expectedRootValueExports = `
CLIPROXY_COMPAT_MODEL_CATALOG
CODEX_PROVIDER_BUILTIN_TOOL_ALIASES
CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS
CODEX_PROVIDER_DOES_NOT_OWN
CODEX_PROVIDER_INVARIANTS
CODEX_PROVIDER_NON_GOALS
CODEX_PROVIDER_OWNS
CODEX_PROVIDER_PACKAGE_NAME
CODEX_PROVIDER_PACKAGE_PHASE
CODEX_PROVIDER_RELEASE_CHANNEL
CODEX_PROVIDER_SEARCH_MODES
CODEX_PROVIDER_TARGET
CODEX_PROVIDER_TARGET_ZH
CODE_INTERPRETER_TOOL_PARAMETERS
COMPUTER_TOOL_PARAMETERS
CodexProviderHostedToolExecutorRegistry
CodexProviderMetaSearchError
CodexProviderRuntime
CodexProviderSearchResultContainer
CodexProviderWebRetrievalError
DEFAULT_CODEX_PROVIDER_PROTOCOL_PROXY_PORT
DEFAULT_RETRIEVAL_CONTENT_TYPES
DEFAULT_RETRIEVAL_MAX_REDIRECTS
EMPTY_UNSAFE_TOOL_PARAMETERS
FILE_SEARCH_TOOL_PARAMETERS
IMAGE_GENERATION_TOOL_PARAMETERS
OPENAI_COMPATIBLE_PROFILE_PRESET_REGISTRATIONS
OpenAICompatibleResponsesAdapterServer
TOOL_SEARCH_TOOL_PARAMETERS
WEB_SEARCH_TOOL_PARAMETERS
applyThinkingPolicyToOpenAIChatRequest
applyWebSearchCitationAnnotationsToResponsesOutput
assertAllowedRetrievalContentType
assertHostedToolDeclarationsForStrategy
assertSafeRetrievalUrl
assertSafeRetrievalUrlWithDns
assertValidSearchEngine
assessCodexProviderProtocolBoundary
authModeForProfileMode
budgetForSearchContextSize
buildCliproxyModelCapabilitiesForEntry
buildCliproxyModelCapabilityMap
buildCliproxyModelCatalogEntries
buildCliproxyModelIds
buildCodexProviderCliArgs
buildCodexProviderConfig
buildCodexProviderDeepSearchSynthesisInstructions
buildCodexProviderOpenAiWebSearchToolOutput
buildCodexProviderProfile
buildCodexProviderTomlFragment
buildCodexProviderWebSearchCallOutputItem
buildOpenAICompatibleCapabilityCatalogMetadata
buildOpenAICompatibleChatCompletionsUrl
buildOpenAICompatibleExternalModelCatalog
buildOpenAICompatibleModelCatalog
buildOpenAICompatibleModelsUrl
cacheEntryToLocalIndexDocument
canonicalSearchResultUrl
chatCompletionsResponseToResponses
chunkCodexProviderWebRetrievalText
codexBaseUrlForProfile
codexBaseUrlForProviderProtocol
codexProviderBuiltinToolParameters
collectWebSearchCitationSourcesFromPayloads
createCodexProviderBraveApiEngine
createCodexProviderBraveHtmlEngine
createCodexProviderCodeInterpreterExecutor
createCodexProviderComputerExecutor
createCodexProviderDashScopeQwenProfile
createCodexProviderDeepSearchGraph
createCodexProviderDeepSearchRunner
createCodexProviderDeepSeekProfile
createCodexProviderDeepWebSearchExecutor
createCodexProviderDuckDuckGoHtmlEngine
createCodexProviderEcosiaHtmlEngine
createCodexProviderEmbeddingsApiProvider
createCodexProviderFileSearchExecutor
createCodexProviderHeuristicDeepSearchPlanner
createCodexProviderHostedToolExecutorRegistry
createCodexProviderImageGenerationExecutor
createCodexProviderInMemoryVectorFileSearchSource
createCodexProviderLocalFileSearchSource
createCodexProviderLocalIndexSearchEngine
createCodexProviderLocalIndexingWebRetrievalCache
createCodexProviderLocalVectorFileSearchSource
createCodexProviderMemoryFileSearchSource
createCodexProviderMemoryLocalVectorIndexStore
createCodexProviderMemoryWebRetrievalCache
createCodexProviderMemoryWebSearchLocalIndex
createCodexProviderMetaSearchService
createCodexProviderMiniMaxProfile
createCodexProviderMojeekHtmlEngine
createCodexProviderMoonshotKimiProfile
createCodexProviderOpenAICompatibleImageGenerationProvider
createCodexProviderOpenAiWebSearchExecutor
createCodexProviderOpenRouterEmbeddingProvider
createCodexProviderOpenRouterProfile
createCodexProviderOpenSerpEndpointEngine
createCodexProviderProviderWebSearchSource
createCodexProviderRemoteDocumentsFileSearchSource
createCodexProviderSearchEngineRegistry
createCodexProviderSearchEngineState
createCodexProviderSearchProcessor
createCodexProviderSearxngEndpointEngine
createCodexProviderSerpApiEngine
createCodexProviderSerperApiEngine
createCodexProviderSiliconFlowProfile
createCodexProviderSqliteFtsFileSearchSource
createCodexProviderSqliteFtsLocalIndex
createCodexProviderSqliteLocalVectorIndexStore
createCodexProviderStandaloneServerConfigFromEnv
createCodexProviderStandaloneServerFromEnv
createCodexProviderTavilyApiEngine
createCodexProviderToolSearchExecutor
createCodexProviderVectorStoreFileSearchSource
createCodexProviderWebRetrievalFetcher
createCodexProviderWebSearchExecutor
defaultCodexProviderBuiltinEmulatedToolName
defaultCodexProviderBuiltinToolDescription
defaultProtocolForProfileMode
domainMatchesSearchFilter
extractCodexProviderHtmlDocument
fetchCodexProviderWebRetrievalDocument
findCliproxyModelCatalogEntry
formatCodexProviderHostedToolExecutionResult
getCodexProviderBuiltinToolDefinition
getOpenAICompatibleProviderPreset
getOpenAICompatibleThinkingPolicy
getProviderThinkingSupport
hostnameFromSearchUrl
htmlText
inspectOpenAICompatiblePayloadCompatibility
isAllowedRetrievalContentType
isCodexProviderAdapterEmulatedBuiltinToolType
isCodexProviderBuiltinToolType
isCodexProviderProviderNativeBuiltinToolType
isCodexProviderUnsafeBuiltinToolType
isHtmlRetrievalContentType
isOpenAICompatibleChatCompletionsProxyPath
isOpenAICompatibleModelsProxyPath
isOpenAICompatibleResponsesProxyPath
isPrivateRetrievalHostname
isRetrievalRedirectStatus
loadCodexProviderStandaloneEnvFile
localResponsesProxyBaseUrl
mergeCodexProviderDeepSearchReferences
mergeOpenAICompatibleProviderCapabilities
mergeSearchResults
normalizeCodexProviderBuiltinToolName
normalizeCodexProviderHostedTools
normalizeCodexProviderOpenAiWebSearchRequest
normalizeCodexProviderSearchMode
normalizeProviderBaseUrl
normalizeProviderLabel
normalizeRetrievalContentType
normalizeRetrievalUrlForCache
normalizeSearchEngineName
normalizeSearchEngineResult
normalizeWebSearchCitationSources
planCodexProviderDeepSearchQuery
rankCodexProviderWebRetrievalChunks
replaceWebSearchSourcePlaceholders
reserveLocalPort
resolveCodexProviderProviderPreset
resolveCodexProviderProviderPresetCatalog
resolveCodexProviderStandaloneServerEnv
resolveOpenAICompatibleProviderCapabilitiesForModel
resolveReasoningEffortForProvider
resolveRetrievalRedirectUrl
responsesRequestToChatCompletions
responsesRequestToCompactionResponse
scoreMergedSearchResult
scoreSearchResult
searchEngineErrorFromUnknown
searchUrlMatchesDomainFilters
stripThinkingConfig
textFromPlainRetrievalDocument
tokenizeSearchText
tomlString
tomlValue
topologicalDeepSearchNodeLevels
translateChatCompletionsSseStreamToResponsesSse
translateChatCompletionsSseToResponsesEvents
`.trim().split('\n');

test('codex provider package exposes the unified provider boundary contract', () => {
  assert.equal(CODEX_PROVIDER_PACKAGE_NAME, 'codex-provider');
  assert.equal(CODEX_PROVIDER_PACKAGE_PHASE, 'phase-2-canonical-api');
  assert.equal(CODEX_PROVIDER_RELEASE_CHANNEL, 'public-alpha');
  assert.equal(CODEX_PROVIDER_TARGET, 'Let non-OpenAI models participate in the Codex native tool-call loop.');
  assert.equal(CODEX_PROVIDER_OWNS.includes('codex-provider-config'), true);
  assert.equal(CODEX_PROVIDER_OWNS.includes('provider-profile-presets'), true);
  assert.equal(CODEX_PROVIDER_DOES_NOT_OWN.includes('codex-native-api'), true);
  assert.equal(assessCodexProviderProtocolBoundary('openai-chat-compatible').strategy, 'responses-to-chat-direct');
});

test('codex provider root value exports are explicitly audited', () => {
  assert.deepEqual(Object.keys(sdk).sort(), expectedRootValueExports);
});

test('codex provider package metadata exposes only the primary server bin', () => {
  const packageJsonPath = path.resolve(import.meta.dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    bin?: Record<string, string>;
    description?: string;
    name?: string;
    private?: boolean;
    exports?: Record<string, unknown>;
    files?: string[];
    version?: string;
  };

  assert.equal(packageJson.name, 'codex-provider');
  assert.equal(packageJson.version, '0.1.0-alpha.0');
  assert.equal(packageJson.private, false);
  assert.equal(
    packageJson.description,
    'Provider compatibility SDK that lets non-OpenAI models participate in the Codex native tool-call loop.',
  );
  assert.deepEqual(Object.keys(packageJson.exports ?? {}).sort(), ['.', './package.json']);
  assert.equal(packageJson.bin?.['codex-provider-server'], 'dist/cli.js');
  assert.equal(packageJson.bin?.[legacyProviderBin], undefined);
  assert.equal(packageJson.bin?.[legacyHostBin], undefined);
  assert.deepEqual(packageJson.files, ['dist', 'README.md', 'CHANGELOG.md', 'docs', 'examples']);
});

test('codex provider package metadata and build layout stay aligned', () => {
  const packageJsonPath = path.resolve(import.meta.dirname, '../package.json');
  const tsconfigPath = path.resolve(import.meta.dirname, '../tsconfig.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    bin?: Record<string, string>;
    exports?: Record<string, { types?: string; default?: string } | string>;
    files?: string[];
  };
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as {
    compilerOptions?: { outDir?: string; rootDir?: string };
  };

  assert.equal(tsconfig.compilerOptions?.rootDir, 'src');
  assert.equal(tsconfig.compilerOptions?.outDir, 'dist');
  assert.equal((packageJson.exports?.['.'] as { types?: string })?.types, './dist/index.d.ts');
  assert.equal((packageJson.exports?.['.'] as { default?: string })?.default, './dist/index.js');
  assert.equal(packageJson.bin?.['codex-provider-server'], 'dist/cli.js');
  assert.equal(packageJson.bin?.[legacyProviderBin], undefined);
  assert.equal(packageJson.bin?.[legacyHostBin], undefined);
  assert.deepEqual(packageJson.files, ['dist', 'README.md', 'CHANGELOG.md', 'docs', 'examples']);
});

test('codex provider root scripts expose the package commands', () => {
  const rootPackageJsonPath = path.resolve(import.meta.dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.build, 'tsc -p tsconfig.json');
  assert.equal(packageJson.scripts?.test, 'tsx --test test/*.test.ts');
  assert.equal(packageJson.scripts?.typecheck, 'tsc -p tsconfig.json --noEmit');
  assert.equal(packageJson.scripts?.['check-boundary'], 'node scripts/check-boundary.mjs');
  assert.equal(packageJson.scripts?.['check-package-surface'], 'node scripts/check-package-surface.mjs');
  assert.equal(packageJson.scripts?.['consumer:harness'], 'pnpm build && tsx examples/standalone-consumer-harness.ts');
  assert.equal(packageJson.scripts?.['public-alpha:audit'], 'node scripts/check-public-alpha-readiness.mjs');
  assert.equal(packageJson.scripts?.check, 'pnpm test && pnpm typecheck && pnpm build && pnpm consumer:harness && pnpm check-boundary && pnpm check-package-surface');
});

test('codex provider CI runs package hygiene before dry-run pack', () => {
  const workflowPath = path.resolve(import.meta.dirname, '../.github/workflows/ci.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const packageSurfaceIndex = workflow.indexOf('pnpm check-package-surface');
  const packIndex = workflow.indexOf('pnpm pack:dry-run');

  assert.notEqual(packageSurfaceIndex, -1);
  assert.notEqual(packIndex, -1);
  assert.equal(packageSurfaceIndex < packIndex, true);
});

test('codex provider root entrypoint exports primary provider surfaces', () => {
  const indexPath = path.resolve(import.meta.dirname, '../src/index.ts');
  const source = fs.readFileSync(indexPath, 'utf8');

  assert.match(source, /export \* from '\.\/codex_config\.js'/);
  assert.match(source, /export \* from '\.\/builtin-tools\/index\.js'/);
  assert.match(source, /export \* from '\.\/code_interpreter_executor\.js'/);
  assert.match(source, /export \* from '\.\/computer_executor\.js'/);
  assert.match(source, /export \* from '\.\/image_generation_executor\.js'/);
  assert.match(source, /export \* from '\.\/runtime\.js'/);
  assert.match(source, /export \{\s*[\s\S]*getOpenAICompatibleProviderPreset/);
  assert.match(source, /export type \{\s*[\s\S]*OpenAICompatibleProviderCapabilities/);
  assert.match(source, /export \{\s*[\s\S]*OpenAICompatibleResponsesAdapterServer/);
  assert.match(source, /CodexProviderTraceEvent/);
  assert.match(source, /createCodexProviderStandaloneServerConfigFromEnv/);
  assert.match(source, /createCodexProviderStandaloneServerFromEnv/);
  assert.match(source, /loadCodexProviderStandaloneEnvFile/);
  assert.match(source, /resolveCodexProviderStandaloneServerEnv/);
  assert.doesNotMatch(source, /codex_provider_aliases/u);
});

test('codex provider root entrypoint exposes only primary CodexProvider APIs', () => {
  assert.equal(CodexProviderRuntime.name, 'CodexProviderRuntime');
  assert.equal(CodexProviderHostedToolExecutorRegistry.name, 'CodexProviderHostedToolExecutorRegistry');
  assert.equal(typeof buildCodexProviderConfig, 'function');
  assert.equal(typeof buildCodexProviderProfile, 'function');
  assert.equal(typeof createCodexProviderFileSearchExecutor, 'function');
  assert.equal(typeof createCodexProviderWebSearchExecutor, 'function');
  assert.equal(typeof createCodexProviderToolSearchExecutor, 'function');
  assert.equal(typeof createCodexProviderImageGenerationExecutor, 'function');
  assert.equal(typeof createCodexProviderCodeInterpreterExecutor, 'function');
  assert.equal(typeof createCodexProviderComputerExecutor, 'function');
  assert.equal(typeof createCodexProviderHostedToolExecutorRegistry, 'function');
  assert.equal(typeof createCodexProviderStandaloneServerConfigFromEnv, 'function');
  assert.equal(typeof createCodexProviderStandaloneServerFromEnv, 'function');
  assert.equal(typeof loadCodexProviderStandaloneEnvFile, 'function');
  assert.equal(typeof resolveCodexProviderStandaloneServerEnv, 'function');

  for (const key of Object.keys(sdk)) {
    assert.equal(key.startsWith(legacyProviderFactoryPrefix), false, `${key} should not be exported`);
    assert.equal(key.startsWith(legacyHostFactoryPrefix), false, `${key} should not be exported`);
    assert.equal(key.startsWith(legacyProviderTypePrefix), false, `${key} should not be exported`);
    assert.equal(key.startsWith(legacyHostTypePrefix), false, `${key} should not be exported`);
  }

  const config = buildCodexProviderConfig({
    providerLabel: 'test-provider',
    upstreamBaseUrl: 'https://provider.example/v1',
    defaultModel: 'example-model',
  });
  assert.equal(config.providerLabel, 'test-provider');
  assert.equal(config.codexBaseUrl, 'https://provider.example/v1');
  assert.equal(config.entries.some((entry) => entry.key === 'model' && entry.value === 'example-model'), true);

  const registry = createCodexProviderHostedToolExecutorRegistry();
  assert.equal(registry instanceof CodexProviderHostedToolExecutorRegistry, true);
});

test('codex provider package includes public examples and package readiness docs', () => {
  const packageRoot = path.resolve(import.meta.dirname, '..');
  const requiredFiles = [
    'docs/OPENAI_BUILTIN_TOOL_COMPATIBILITY.md',
    'docs/INDEPENDENT_PACKAGE_CHECKLIST.md',
    'docs/LIVE_SMOKE_RECIPES.md',
    'docs/OBSERVABILITY_AND_ERROR_POLICY.md',
    'docs/RELEASE_READINESS.md',
    'docs/PUBLIC_ALPHA_RELEASE_PLAN.md',
    'docs/PROVIDER_COMPATIBILITY_MATRIX.md',
    'docs/RECIPES.md',
    'docs/DEEP_WEB_SEARCH_ROADMAP.md',
    'docs/UNSAFE_TOOL_SECURITY.md',
    'docs/handoff/CODEX_PROVIDER_RESPONSES_ADAPTER_REFACTOR_HANDOFF.md',
    'docs/handoff/CODEX_PROVIDER_SELF_HOSTED_WEB_SEARCH_HANDOFF.md',
    'docs/handoff/archive/CODEX_PROVIDER_RENAME_AND_EXTRACTION_HANDOFF.md',
    'docs/handoff/archive/CODEX_PROVIDER_RENAME_CLEANUP_HANDOFF.md',
    'examples/standalone-consumer-harness.ts',
    'examples/mixed-openrouter-runtime.ts',
    'examples/adapter-emulated-web-search.ts',
    'examples/adapter-emulated-web-search-metasearch.ts',
    'examples/live-web-search-smoke.ts',
    'examples/live-host-integration-smoke.ts',
    'examples/adapter-emulated-file-search-local-vector.ts',
    'examples/adapter-emulated-image-generation.ts',
    'examples/adapter-emulated-code-interpreter-custom-executor.ts',
    'examples/codexnext-integration.ts',
  ];

  for (const relativePath of requiredFiles) {
    assert.equal(fs.existsSync(path.join(packageRoot, relativePath)), true, `${relativePath} should exist`);
  }
});

test('codex provider docs and examples prefer primary product naming', () => {
  const packageRoot = path.resolve(import.meta.dirname, '..');
  const readPackageFile = (relativePath: string): string => fs.readFileSync(path.join(packageRoot, relativePath), 'utf8');

  const readme = readPackageFile('README.md');
  const recipes = readPackageFile('docs/RECIPES.md');
  const examples = [
    'examples/standalone-consumer-harness.ts',
    'examples/mixed-openrouter-runtime.ts',
    'examples/adapter-emulated-web-search.ts',
    'examples/adapter-emulated-web-search-metasearch.ts',
    'examples/live-host-integration-smoke.ts',
    'examples/adapter-emulated-file-search-local-vector.ts',
    'examples/adapter-emulated-image-generation.ts',
    'examples/adapter-emulated-code-interpreter-custom-executor.ts',
    'examples/codexnext-integration.ts',
  ];

  assert.match(readme, /^# CodexProvider/u);
  assert.match(readme, /`codex-provider` is a provider compatibility SDK/u);
  assert.doesNotMatch(readme, legacyNamePattern);
  assert.match(recipes, /^# CodexProvider Recipes/u);
  assert.match(recipes, /codex-provider-server/u);

  for (const relativePath of examples) {
    const source = readPackageFile(relativePath);
    assert.match(source, /from 'codex-provider'/u, `${relativePath} should import the package name`);
    assert.doesNotMatch(source, /@codexbridge\/codex-provider/u, `${relativePath} should not import legacy package names`);
    assert.doesNotMatch(source, legacyExampleNamePattern, `${relativePath} should not use legacy names`);
  }
});

test('deep search docs and example keep custom tool separate from web_search', () => {
  const packageRoot = path.resolve(import.meta.dirname, '..');
  const recipes = fs.readFileSync(path.join(packageRoot, 'docs/RECIPES.md'), 'utf8');
  const example = fs.readFileSync(path.join(packageRoot, 'examples/adapter-emulated-web-search-metasearch.ts'), 'utf8');

  assert.match(recipes, /separate custom hosted tool, not as the default `web_search`/u);
  assert.match(recipes, /name: "custom:deep_web_search"/u);
  assert.match(recipes, /"custom:deep_web_search": research/u);
  assert.match(example, /name: 'web_search'/u);
  assert.match(example, /name: 'custom:deep_web_search'/u);
  assert.match(example, /'custom:deep_web_search': deepWebSearch/u);
});

test('codex provider release readiness docs keep unsafe tools disabled by default', () => {
  const packageRoot = path.resolve(import.meta.dirname, '..');
  const securityDoc = fs.readFileSync(path.join(packageRoot, 'docs/UNSAFE_TOOL_SECURITY.md'), 'utf8');
  const releaseDoc = fs.readFileSync(path.join(packageRoot, 'docs/RELEASE_READINESS.md'), 'utf8');
  const checklist = fs.readFileSync(path.join(packageRoot, 'docs/INDEPENDENT_PACKAGE_CHECKLIST.md'), 'utf8');

  assert.match(securityDoc, /No shell executor is bundled/u);
  assert.match(securityDoc, /No local computer controller is bundled/u);
  assert.match(securityDoc, /No code interpreter sandbox is bundled/u);
  assert.match(releaseDoc, /Set `private: false`/u);
  assert.match(releaseDoc, /"name": "codex-provider"/u);
  assert.match(releaseDoc, /"version": "0\.1\.0-alpha\.0"/u);
  assert.match(checklist, /Live consumer validation is completed/u);
  assert.match(checklist, /package name is now `codex-provider`/u);
});
