import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const jsonOutput = process.argv.includes('--json');

const checks = [];
const blockers = [];
const warnings = [];

const packageJson = readJson('package.json');
const publicAlphaPlan = readText('docs/PUBLIC_ALPHA_RELEASE_PLAN.md');
const releaseReadiness = readText('docs/RELEASE_READINESS.md');
const liveSmokeResults = readText('docs/LIVE_SMOKE_RESULTS.md');
const packageName = packageJson.name;

checkPackageState();
checkProviderEvidence();
checkNpmPackagePublication();
checkApiBackedSearchOrException();
checkReleasePlanConclusion();

const result = {
  ready: blockers.length === 0,
  checks,
  blockers,
  warnings,
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHumanSummary(result);
}

process.exit(result.ready ? 0 : 1);

function checkPackageState() {
  addCheck('package-name', packageJson.name === 'codex-provider', `package name is ${formatValue(packageJson.name)}`);
  addCheck('package-version', packageJson.version === '0.1.0-alpha.0', `package version is ${formatValue(packageJson.version)}`);
  addCheck('package-public', packageJson.private === false, 'package is configured for public alpha publishing');
}

function checkProviderEvidence() {
  const requiredEvidence = [
    ['openrouter', /OpenRouter with `deepseek\/deepseek-chat`:[^\n]+streaming `web_search`/u],
    ['deepseek-official', /DeepSeek official with `deepseek-chat`:[^\n]+streaming `web_search`/u],
    ['dashscope-qwen', /DashScope\/Qwen with `qwen-plus`:[^\n]+streaming `web_search`/u],
  ];
  for (const [name, pattern] of requiredEvidence) {
    addCheck(`provider-evidence:${name}`, pattern.test(liveSmokeResults), `${name} full-host smoke evidence is recorded`);
  }
}

function checkNpmPackagePublication() {
  const whoami = runNpm(['whoami']);
  addCheck('npm-authenticated', whoami.status === 0, summarizeCommand('npm whoami', whoami));
  if (whoami.status !== 0) {
    blockers.push('npm package publication cannot be checked because local npm is not authenticated.');
  }

  const view = runNpm(['view', packageName, 'name', 'version', 'dist-tags', '--json']);
  const packageMetadata = view.status === 0 ? parseJsonObject(view.stdout) : null;
  const publishedVersion = normalizeString(packageMetadata?.version);
  const alphaTag = normalizeString(packageMetadata?.['dist-tags']?.alpha);
  addCheck(
    'npm-package-published',
    view.status === 0 && publishedVersion === packageJson.version,
    view.status === 0
      ? `${packageName}@${publishedVersion || '<unknown>'} is visible on npm`
      : summarizeCommand(`npm view ${packageName} name version dist-tags --json`, view),
  );
  if (view.status !== 0 || publishedVersion !== packageJson.version) {
    blockers.push(`npm registry did not confirm that ${packageName}@${packageJson.version} is published.`);
  }
  addCheck(
    'npm-alpha-dist-tag',
    alphaTag === packageJson.version,
    alphaTag
      ? `alpha dist-tag points to ${alphaTag}`
      : 'alpha dist-tag is missing',
  );
  if (alphaTag !== packageJson.version) {
    blockers.push(`npm alpha dist-tag does not point to ${packageName}@${packageJson.version}.`);
  }
}

function checkApiBackedSearchOrException() {
  const searchEnv = findConfiguredSearchCredential();
  const searchEvidence = findRecordedApiBackedSearchEvidence();
  const exceptionApproved = /## Search Release Exception Request[\s\S]*?- Status:\s*approved\b/iu.test(publicAlphaPlan)
    || /Search release exception status:\s*approved\b/iu.test(releaseReadiness);

  addCheck(
    'api-backed-search-credential',
    Boolean(searchEnv),
    searchEnv
      ? `${searchEnv.name} is configured in ${searchEnv.source}`
      : 'BRAVE_SEARCH_API_KEY, SERPAPI_API_KEY, SERPER_API_KEY, and TAVILY_API_KEY are not configured',
  );
  addCheck(
    'api-backed-search-evidence',
    Boolean(searchEvidence),
    searchEvidence
      ? `${searchEvidence.provider} API-backed web_search smoke evidence is recorded`
      : 'no passing API-backed Brave/SerpApi/Serper/Tavily web_search smoke evidence is recorded',
  );
  addCheck(
    'api-backed-search-or-exception',
    Boolean(searchEvidence) || exceptionApproved,
    searchEvidence
      ? 'release exception is not required because API-backed search evidence is recorded'
      : exceptionApproved
      ? 'release owner approved the search exception'
      : 'search release exception is not approved',
  );

  if (!searchEvidence && !exceptionApproved) {
    blockers.push('API-backed web_search evidence is missing and the search release exception is not approved.');
  }
}

function checkReleasePlanConclusion() {
  const publicAlphaPublished = /Current conclusion on 2026-06-30:\s*public alpha `codex-provider@0\.1\.0-alpha\.0` is published/iu.test(publicAlphaPlan);
  addCheck(
    'release-plan-conclusion',
    publicAlphaPublished,
    publicAlphaPublished
      ? 'release plan records the codex-provider public alpha publish'
      : 'release plan conclusion is missing or does not record the codex-provider public alpha publish',
  );
}

function addCheck(name, passed, detail) {
  checks.push({
    name,
    status: passed ? 'passed' : 'failed',
    detail,
  });
}

function runNpm(args) {
  const result = spawnSync('npm', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: scrubCommandOutput(result.stdout),
    stderr: scrubCommandOutput(result.stderr),
    error: result.error ? String(result.error.message ?? result.error) : '',
  };
}

function summarizeCommand(command, result) {
  if (result.status === 0) {
    return `${command} passed`;
  }
  const output = [result.error, result.stderr, result.stdout]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return `${command} failed${output ? `: ${truncate(output, 180)}` : ''}`;
}

function scrubCommandOutput(value) {
  return String(value ?? '')
    .replace(/\/\/[^:\s]+:[^@\s]+@/gu, '//<redacted>@')
    .replace(/\b(_authToken|token|password)\s*=\s*\S+/giu, '$1=<redacted>');
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function findConfiguredSearchCredential() {
  const names = ['BRAVE_SEARCH_API_KEY', 'SERPAPI_API_KEY', 'SERPER_API_KEY', 'TAVILY_API_KEY'];
  for (const name of names) {
    if (normalizeString(process.env[name])) {
      return { name, source: 'environment' };
    }
  }
  for (const envFile of listRootEnvFiles()) {
    const text = fs.readFileSync(envFile, 'utf8');
    for (const name of names) {
      const pattern = new RegExp(`^${name}=\\s*\\S+`, 'mu');
      if (pattern.test(text)) {
        return { name, source: path.relative(repoRoot, envFile) };
      }
    }
  }
  return null;
}

function findRecordedApiBackedSearchEvidence() {
  const providers = ['brave', 'serpapi', 'serper', 'tavily'];
  const sections = liveSmokeResults.split(/\n(?=## )/u);
  for (const section of sections) {
    if (!/Adapter-emulated web_search live smoke/u.test(section)) {
      continue;
    }
    const provider = providers.find((entry) => section.includes(`Search provider: \`${entry}\``));
    if (!provider) {
      continue;
    }
    if (
      /\| Non-streaming adapter web_search \| Passed \|/u.test(section)
      && /\| Streaming adapter web_search \| Passed \|/u.test(section)
    ) {
      return { provider };
    }
  }
  return null;
}

function listRootEnvFiles() {
  return fs.readdirSync(repoRoot)
    .filter((entry) => entry === '.env' || entry.startsWith('.env.'))
    .map((entry) => path.join(repoRoot, entry))
    .filter((entryPath) => fs.statSync(entryPath).isFile());
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatValue(value) {
  return JSON.stringify(value);
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function printHumanSummary(result) {
  console.log(`CodexProvider public alpha readiness: ${result.ready ? 'ready' : 'blocked'}`);
  console.log('');
  console.log('Checks:');
  for (const check of result.checks) {
    console.log(`- [${check.status === 'passed' ? 'x' : '!'}] ${check.name}: ${check.detail}`);
  }
  if (result.blockers.length > 0) {
    console.log('');
    console.log('Blockers:');
    for (const blocker of result.blockers) {
      console.log(`- ${blocker}`);
    }
  }
  if (result.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
}
