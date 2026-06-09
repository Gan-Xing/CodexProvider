import fs from 'node:fs';
import path from 'node:path';

const packageRoot = process.cwd();
const publicEntries = [
  'README.md',
  'CHANGELOG.md',
  'package.json',
  'docs',
  'examples',
];
const dependencySections = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'bundledDependencies',
  'bundleDependencies',
];
const textExtensions = new Set([
  '.cjs',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);
const forbiddenPathPatterns = [
  {
    reason: 'committed env file',
    pattern: /(?:^|[/\\])\.env(?:$|[./\\])/u,
  },
  {
    reason: 'generated cache or local index artifact',
    pattern: /(?:^|[/\\])(?:\.cache|cache|caches|local-index|local_index|retrieval-cache|vector-index|vector_index)(?:$|[/\\])/iu,
  },
  {
    reason: 'generated database or package artifact',
    pattern: /\.(?:db|duckdb|sqlite|sqlite3|tgz|tar|zip)(?:$|[./\\])/iu,
  },
  {
    reason: 'private Linux workspace path',
    pattern: /\/home\/[^/\s`'")>]+\/[^`\s'")>]*/u,
  },
  {
    reason: 'private macOS workspace path',
    pattern: /\/Users\/[^/\s`'")>]+\/[^`\s'")>]*/u,
  },
  {
    reason: 'private Windows workspace path',
    pattern: /[A-Za-z]:\\Users\\[^\\\s`'")>]+\\[^`\s'")>]*/u,
  },
];
const secretLiteralPatterns = [
  {
    reason: 'OpenAI-compatible API key literal',
    pattern: /\bsk-(?:or-v1-)?[A-Za-z0-9_-]{20,}\b/u,
  },
  {
    reason: 'Anthropic API key literal',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/u,
  },
  {
    reason: 'GitHub token literal',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  },
  {
    reason: 'Slack token literal',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  },
  {
    reason: 'Bearer token literal',
    pattern: /\bBearer\s+(?!<redacted>|process\.env|\$\{)[A-Za-z0-9._~+/-]{24,}={0,2}\b/u,
  },
  {
    reason: 'uppercase secret-like assignment literal',
    pattern: /\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|ACCESS_KEY)[A-Z0-9_]*\b\s*[:=]\s*(?!<redacted>|\.\.\.|""|''|process\.env|\$\{)[A-Za-z0-9._~+/-]{16,}={0,2}\b/u,
  },
];
const hardDependencyImportPattern =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;

const failures = [];

for (const entry of publicEntries) {
  const fullPath = path.join(packageRoot, entry);
  if (!fs.existsSync(fullPath)) {
    failures.push(`${entry} is missing from the package public surface scan target list.`);
    continue;
  }
  for (const file of listPublicFiles(fullPath)) {
    checkFilePath(file);
    if (isTextFile(file)) {
      checkFileText(file);
    }
  }
}

checkPackageDependencies();

if (failures.length > 0) {
  console.error('CodexProvider package surface check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('CodexProvider package surface check passed.');

function listPublicFiles(targetPath) {
  const stats = fs.statSync(targetPath);
  if (stats.isFile()) {
    return [targetPath];
  }
  if (!stats.isDirectory()) {
    return [];
  }
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listPublicFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function checkFilePath(file) {
  const relativeFile = toPackageRelativePath(file);
  for (const { reason, pattern } of forbiddenPathPatterns) {
    if (pattern.test(relativeFile)) {
      failures.push(`${relativeFile} has forbidden package-surface path: ${reason}`);
    }
  }
}

function isTextFile(file) {
  return textExtensions.has(path.extname(file));
}

function checkFileText(file) {
  const relativeFile = toPackageRelativePath(file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    checkLineForPrivatePaths(relativeFile, index + 1, line);
    checkLineForSecrets(relativeFile, index + 1, line);
  }
  checkTextForHostAppImports(relativeFile, text);
}

function checkLineForPrivatePaths(relativeFile, lineNumber, line) {
  for (const { reason, pattern } of forbiddenPathPatterns.slice(3)) {
    if (pattern.test(line)) {
      failures.push(`${relativeFile}:${lineNumber} contains ${reason}`);
    }
  }
}

function checkLineForSecrets(relativeFile, lineNumber, line) {
  if (line.includes('<redacted>') || line.includes('process.env')) {
    return;
  }
  for (const { reason, pattern } of secretLiteralPatterns) {
    if (pattern.test(line)) {
      failures.push(`${relativeFile}:${lineNumber} contains ${reason}`);
    }
  }
}

function checkTextForHostAppImports(relativeFile, text) {
  for (const match of text.matchAll(hardDependencyImportPattern)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? '';
    if (/\b(?:CodexBridge|CodexNext)\b|codexbridge|codexnext/u.test(specifier)) {
      failures.push(`${relativeFile} imports host-app dependency ${specifier}`);
    }
  }
}

function checkPackageDependencies() {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  for (const section of dependencySections) {
    const dependencies = packageJson[section];
    if (!dependencies || typeof dependencies !== 'object') {
      continue;
    }
    for (const name of Object.keys(dependencies)) {
      if (/codexbridge|codexnext/u.test(name.toLowerCase())) {
        failures.push(`package.json ${section} depends on host app package ${name}`);
      }
    }
  }
}

function toPackageRelativePath(file) {
  return path.relative(packageRoot, file).split(path.sep).join('/');
}
