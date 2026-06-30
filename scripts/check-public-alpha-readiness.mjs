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

checkPackageState();
checkProviderEvidence();
checkNpmScopeOwnership();
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
  addCheck('package-name', packageJson.name === '@codex-provider/core', `package name is ${formatValue(packageJson.name)}`);
  addCheck('package-version', packageJson.version === '0.1.0-alpha.0', `package version is ${formatValue(packageJson.version)}`);
  addCheck('package-private', packageJson.private === true, 'package remains private for internal alpha');
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

function checkNpmScopeOwnership() {
  const whoami = runNpm(['whoami']);
  addCheck('npm-authenticated', whoami.status === 0, summarizeCommand('npm whoami', whoami));
  if (whoami.status !== 0) {
    blockers.push('npm scope ownership is unconfirmed because local npm is not authenticated.');
  }

  const org = runNpm(['org', 'ls', '@codex-provider', '--json']);
  addCheck('npm-scope-visible', org.status === 0, summarizeCommand('npm org ls @codex-provider --json', org));
  if (org.status !== 0) {
    blockers.push('npm registry did not prove ownership or visibility for the @codex-provider scope.');
  }

  const view = runNpm(['view', '@codex-provider/core', '--json']);
  addCheck('npm-package-visible', view.status === 0, summarizeCommand('npm view @codex-provider/core --json', view));
  if (view.status !== 0) {
    warnings.push('@codex-provider/core is not publicly visible; this is expected while private, but not proof of scope ownership.');
  }
}

function checkApiBackedSearchOrException() {
  const searchEnv = findConfiguredSearchCredential();
  const exceptionApproved = /## Search Release Exception Request[\s\S]*?- Status:\s*approved\b/iu.test(publicAlphaPlan)
    || /Search release exception status:\s*approved\b/iu.test(releaseReadiness);

  addCheck(
    'api-backed-search-credential',
    Boolean(searchEnv),
    searchEnv
      ? `${searchEnv.name} is configured in ${searchEnv.source}`
      : 'BRAVE_SEARCH_API_KEY, SERPER_API_KEY, and TAVILY_API_KEY are not configured',
  );
  addCheck(
    'search-release-exception-approved',
    exceptionApproved,
    exceptionApproved
      ? 'release owner approved the search exception'
      : 'search release exception is not approved',
  );

  if (!searchEnv && !exceptionApproved) {
    blockers.push('API-backed web_search evidence is missing and the search release exception is not approved.');
  }
}

function checkReleasePlanConclusion() {
  const continuePrivate = /Current conclusion on 2026-06-30:\s*continue private\b/iu.test(publicAlphaPlan);
  addCheck(
    'release-plan-conclusion',
    continuePrivate,
    continuePrivate
      ? 'release plan explicitly concludes continue private'
      : 'release plan conclusion is missing or no longer says continue private',
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

function findConfiguredSearchCredential() {
  const names = ['BRAVE_SEARCH_API_KEY', 'SERPER_API_KEY', 'TAVILY_API_KEY'];
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
