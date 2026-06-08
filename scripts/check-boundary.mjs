import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const repoRoot = process.cwd();
const packageRoot = repoRoot;
const sourceRoot = path.join(packageRoot, 'src');
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const forbiddenPathParts = [
  `${path.sep}apps${path.sep}`,
  `${path.sep}src${path.sep}platforms${path.sep}`,
  `${path.sep}src${path.sep}runtime${path.sep}`,
  `${path.sep}src${path.sep}store${path.sep}`,
  `${path.sep}src${path.sep}i18n${path.sep}`,
  `${path.sep}src${path.sep}providers${path.sep}`,
  `${path.sep}packages${path.sep}codex-native-api${path.sep}`,
  `${path.sep}packages${path.sep}codex-provider${path.sep}`,
  `${path.sep}packages${path.sep}codex-provider${path.sep}`,
  `${path.sep}packages${path.sep}mission-control${path.sep}`,
  `${path.sep}CodexBridge${path.sep}`,
  `${path.sep}CodexNext${path.sep}`,
];

const forbiddenTextPatterns = [
  /\bCODEXBRIDGE_/u,
  /\bCodexBridge\b/u,
  /\bCodexNext\b/u,
  /\bweixin\b/u,
];

const importPattern =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function listTypeScriptFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveRelativeImport(fromFile, specifier) {
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  if (path.extname(resolved)) {
    return resolved;
  }
  return `${resolved}.ts`;
}

const failures = [];

for (const file of listTypeScriptFiles(sourceRoot)) {
  const text = fs.readFileSync(file, 'utf8');
  const relativeFile = path.relative(repoRoot, file);
  for (const forbidden of forbiddenPathParts) {
    if (text.includes(forbidden.replaceAll(path.sep, '/')) || text.includes(forbidden)) {
      failures.push(`${relativeFile} references forbidden host-app path ${forbidden}`);
    }
  }
  for (const pattern of forbiddenTextPatterns) {
    if (pattern.test(text)) {
      failures.push(`${relativeFile} references forbidden host-app text pattern ${pattern}`);
    }
  }

  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) {
      continue;
    }
    if (specifier.startsWith('.')) {
      const resolved = resolveRelativeImport(file, specifier);
      if (!isInside(resolved, packageRoot)) {
        failures.push(`${relativeFile} imports outside allowed package boundary: ${specifier}`);
      }
      continue;
    }
    if (!nodeBuiltins.has(specifier)) {
      failures.push(`${relativeFile} imports external module: ${specifier}`);
    }
  }
}

if (failures.length > 0) {
  console.error('CodexProvider package boundary check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('CodexProvider package boundary check passed.');
