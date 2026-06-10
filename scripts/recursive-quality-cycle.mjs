#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const HANDOFF_DIR = path.join(ROOT, 'docs', 'handoff');
const STATE_PATH = path.join(HANDOFF_DIR, 'CODEX_PROVIDER_RECURSIVE_QUALITY_STATE.json');
const BACKLOG_PATH = path.join(HANDOFF_DIR, 'CODEX_PROVIDER_RECURSIVE_QUALITY_BACKLOG.md');
const REPORT_PATH = path.join(HANDOFF_DIR, 'CODEX_PROVIDER_RECURSIVE_QUALITY_AUDIT_REPORT.md');

const DEFAULT_MAX_CYCLES = 20;
// London 2026-06-11 05:30 is BST (UTC+1), so UTC is 04:30.
const DEFAULT_DEADLINE_UTC = '2026-06-11T04:30:00.000Z';

const DEFAULT_GATE = [
  ['pnpm', ['test']],
  ['pnpm', ['typecheck']],
  ['pnpm', ['build']],
  ['pnpm', ['consumer:harness']],
  ['pnpm', ['check-boundary']],
  ['pnpm', ['check-package-surface']],
  ['pnpm', ['pack:dry-run']],
];

function main() {
  const command = process.argv[2] || 'status';
  const args = parseArgs(process.argv.slice(3));
  ensureDir(HANDOFF_DIR);

  switch (command) {
    case 'init':
      cmdInit(args);
      break;
    case 'status':
      cmdStatus();
      break;
    case 'guard':
      cmdGuard();
      break;
    case 'scan':
      cmdScan();
      break;
    case 'gate':
      cmdGate();
      break;
    case 'complete-cycle':
      cmdCompleteCycle(args);
      break;
    case 'new-cycle':
      cmdNewCycle(args);
      break;
    default:
      usage(`Unknown command: ${command}`);
  }
}

function cmdInit(args) {
  const existing = readStateOrNull();
  const state = existing ?? {
    schemaVersion: 1,
    maxCycles: numberArg(args.maxCycles ?? args.max ?? process.env.CODEX_PROVIDER_QUALITY_MAX_CYCLES, DEFAULT_MAX_CYCLES),
    completedCycles: 0,
    activeCycle: 1,
    deadlineUtc: String(args.deadline ?? process.env.CODEX_PROVIDER_QUALITY_DEADLINE_UTC ?? DEFAULT_DEADLINE_UTC),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cycleHistory: [],
  };
  writeState(state);
  if (!fs.existsSync(BACKLOG_PATH)) {
    fs.writeFileSync(BACKLOG_PATH, initialBacklog(), 'utf8');
  }
  console.log(`Initialized recursive quality loop at ${STATE_PATH}`);
  cmdStatus();
}

function cmdStatus() {
  const state = readState();
  const now = Date.now();
  const deadline = new Date(state.deadlineUtc).getTime();
  const msLeft = deadline - now;
  console.log(JSON.stringify({
    completedCycles: state.completedCycles,
    activeCycle: state.activeCycle,
    maxCycles: state.maxCycles,
    deadlineUtc: state.deadlineUtc,
    stoppedByCount: state.completedCycles >= state.maxCycles,
    stoppedByDeadline: msLeft <= 0,
    hoursLeft: Number((msLeft / 3_600_000).toFixed(2)),
    statePath: rel(STATE_PATH),
    backlogPath: rel(BACKLOG_PATH),
  }, null, 2));
}

function cmdGuard() {
  const state = readState();
  const reasons = stopReasons(state);
  if (reasons.length > 0) {
    console.error(`STOP: ${reasons.join('; ')}`);
    process.exit(2);
  }
  console.log(`OK: cycle ${state.activeCycle}, completed ${state.completedCycles}/${state.maxCycles}, deadline ${state.deadlineUtc}`);
}

function cmdGate() {
  runGate();
}

function cmdScan() {
  const findings = [];
  const targets = [
    'src',
    'test',
    'docs',
    'examples',
    'scripts',
    'README.md',
    'CHANGELOG.md',
    'package.json',
  ];
  for (const target of targets) {
    const full = path.join(ROOT, target);
    if (!fs.existsSync(full)) continue;
    for (const file of collectTextFiles(full)) {
      const text = safeRead(file);
      if (text === null) continue;
      scanFile(file, text, findings);
    }
  }

  const report = [
    '# Recursive Quality Audit Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Findings: ${findings.length}`,
    '',
    '| Severity | File | Line | Rule | Message |',
    '| --- | --- | ---: | --- | --- |',
    ...findings.map((f) => `| ${f.severity} | \`${rel(f.file)}\` | ${f.line} | \`${f.rule}\` | ${escapeMd(f.message)} |`),
    '',
  ].join('\n');
  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(`Wrote ${rel(REPORT_PATH)} with ${findings.length} findings.`);
  const high = findings.filter((f) => f.severity === 'high');
  if (high.length > 0) {
    console.error(`High severity findings: ${high.length}`);
    process.exit(1);
  }
}

function cmdCompleteCycle(args) {
  const state = readState();
  const reasons = stopReasons(state);
  if (reasons.length > 0) {
    console.error(`STOP: ${reasons.join('; ')}`);
    process.exit(2);
  }

  const cycle = state.activeCycle;
  const backlog = readBacklog();
  const block = activeCycleBlock(backlog, cycle);
  if (!block) {
    console.error(`No backlog block found for cycle ${cycle}. Expected markers <!-- cycle:${cycle}:start --> and <!-- cycle:${cycle}:end -->.`);
    process.exit(1);
  }
  const unchecked = uncheckedItems(block);
  if (unchecked.length > 0) {
    console.error(`Cycle ${cycle} still has unchecked items:`);
    for (const item of unchecked) {
      console.error(`- ${item}`);
    }
    process.exit(1);
  }

  if (!args.noGate) {
    runGate();
  }

  state.completedCycles += 1;
  state.cycleHistory.push({
    cycle,
    completedAt: new Date().toISOString(),
  });
  state.activeCycle += 1;
  state.updatedAt = new Date().toISOString();
  writeState(state);
  appendCycleTemplateIfMissing(state.activeCycle);

  console.log(`Cycle ${cycle} complete. Count is now ${state.completedCycles}/${state.maxCycles}. Next active cycle: ${state.activeCycle}.`);
  const afterReasons = stopReasons(state);
  if (afterReasons.length > 0) {
    console.log(`Loop should stop now: ${afterReasons.join('; ')}`);
  }
}

function cmdNewCycle(args) {
  const state = readState();
  const cycle = numberArg(args.cycle, state.activeCycle);
  appendCycleTemplateIfMissing(cycle);
  console.log(`Ensured cycle ${cycle} template exists in ${rel(BACKLOG_PATH)}.`);
}

function runGate() {
  for (const [cmd, args] of DEFAULT_GATE) {
    console.log(`\n$ ${cmd} ${args.join(' ')}`);
    const result = spawnSync(cmd, args, {
      stdio: 'inherit',
      cwd: ROOT,
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
      console.error(`Gate failed: ${cmd} ${args.join(' ')}`);
      process.exit(result.status ?? 1);
    }
  }
}

function stopReasons(state) {
  const reasons = [];
  if (state.completedCycles >= state.maxCycles) {
    reasons.push(`completedCycles ${state.completedCycles} >= maxCycles ${state.maxCycles}`);
  }
  if (Date.now() >= new Date(state.deadlineUtc).getTime()) {
    reasons.push(`deadline reached ${state.deadlineUtc}`);
  }
  return reasons;
}

function readStateOrNull() {
  if (!fs.existsSync(STATE_PATH)) return null;
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function readState() {
  const state = readStateOrNull();
  if (!state) {
    console.error('State file missing. Run: node scripts/recursive-quality-cycle.mjs init');
    process.exit(1);
  }
  return state;
}

function writeState(state) {
  ensureDir(path.dirname(STATE_PATH));
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function readBacklog() {
  if (!fs.existsSync(BACKLOG_PATH)) {
    console.error('Backlog file missing. Run init first.');
    process.exit(1);
  }
  return fs.readFileSync(BACKLOG_PATH, 'utf8');
}

function activeCycleBlock(text, cycle) {
  const start = `<!-- cycle:${cycle}:start -->`;
  const end = `<!-- cycle:${cycle}:end -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < 0 || j <= i) return null;
  return text.slice(i + start.length, j);
}

function uncheckedItems(block) {
  return block
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^- \[ \]/u.test(line))
    .map((line) => line.replace(/^- \[ \]\s*/u, ''));
}

function appendCycleTemplateIfMissing(cycle) {
  const existing = fs.existsSync(BACKLOG_PATH) ? fs.readFileSync(BACKLOG_PATH, 'utf8') : '';
  if (existing.includes(`<!-- cycle:${cycle}:start -->`)) return;
  const template = `

<!-- cycle:${cycle}:start -->
## Cycle ${cycle} Backlog

### Audit

- [ ] Re-audit the five target streams: release readiness, provider matrix/presets, web_search productization, deep search, observability/error policy.
- [ ] Generate a concrete backlog for this cycle based on current repository state.
- [ ] Complete all generated backlog items or mark external blockers with \`- [!]\`.

### Validation

- [ ] Run node scripts/recursive-quality-cycle.mjs scan.
- [ ] Run pnpm test.
- [ ] Run pnpm typecheck.
- [ ] Run pnpm build.
- [ ] Run pnpm consumer:harness.
- [ ] Run pnpm check-boundary.
- [ ] Run pnpm check-package-surface.
- [ ] Run pnpm pack:dry-run.
- [ ] Update this backlog so no unchecked \`- [ ]\` remains in Cycle ${cycle}.
- [ ] Commit and push.
- [ ] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:${cycle}:end -->
`;
  fs.appendFileSync(BACKLOG_PATH, template, 'utf8');
}

function initialBacklog() {
  return `# CodexProvider Recursive Quality Backlog

Run \`node scripts/recursive-quality-cycle.mjs new-cycle\` to append the active cycle template.

<!-- cycle:1:start -->
## Cycle 1 Backlog

### Audit

- [ ] Generate concrete Cycle 1 backlog from the recursive quality handoff.
- [ ] Complete or externally-block all generated backlog items.

### Validation

- [ ] Run node scripts/recursive-quality-cycle.mjs scan.
- [ ] Run the full local gate.
- [ ] Commit and push.
- [ ] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:1:end -->
`;
}

function collectTextFiles(target) {
  const results = [];
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (isLikelyText(target) && stat.size <= 1_500_000) results.push(target);
    return results;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTextFiles(full));
    } else if (entry.isFile()) {
      const s = fs.statSync(full);
      if (isLikelyText(full) && s.size <= 1_500_000) results.push(full);
    }
  }
  return results;
}

function isLikelyText(file) {
  return /\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml|txt|toml|sh|gitignore)$/u.test(file)
    || ['README', 'CHANGELOG', 'LICENSE', 'package.json'].includes(path.basename(file));
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function scanFile(file, text, findings) {
  const lines = text.split(/\r?\n/u);
  const relFile = rel(file);
  const activeCode = /^(src|test|examples|scripts)\//u.test(relFile);

  const legacySurfacePattern = new RegExp([
    `CodexProvider${'Relay'}`,
    `Codex${'Gateway'}`,
    `codex-provider-${'relay'}`,
    `${'relay'}-emulated`,
  ].join('|'), 'u');
  addMatches(file, lines, findings, legacySurfacePattern, 'legacy-name', 'high', 'Legacy Relay/Gateway naming in active surface.');
  addMatches(file, lines, findings, /test\.skip|describe\.skip|it\.skip/u, 'skipped-test', 'medium', 'Skipped test should be justified or removed.');
  if (/^src\//u.test(relFile)) {
    addMatches(file, lines, findings, /\bTODO\b|\bFIXME\b|\bHACK\b/u, 'todo-in-src', 'medium', 'TODO/FIXME/HACK remains in src.');
    addMatches(file, lines, findings, /console\.log\(/u, 'console-log-src', 'low', 'console.log in src should be intentional.');
  }
  if (!/LIVE_SMOKE_RESULTS|RECIPES|README|CHANGELOG/u.test(relFile)) {
    addMatches(file, lines, findings, /(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{20,})/u, 'secret-looking-token', 'high', 'Secret-looking token found.');
  }
  if (activeCode) {
    addMatches(file, lines, findings, /\/home\/ubuntu\/dev\/(CodexBridge|CodexNext|codexprovider)/u, 'private-path', 'medium', 'Private local path in active code.');
  }
}

function addMatches(file, lines, findings, regex, rule, severity, message) {
  for (const [index, line] of lines.entries()) {
    if (regex.test(line)) {
      findings.push({
        file,
        line: index + 1,
        rule,
        severity,
        message,
      });
    }
  }
}

function parseArgs(items) {
  const args = {};
  for (const item of items) {
    if (!item.startsWith('--')) continue;
    const [key, value] = item.slice(2).split('=');
    args[toCamel(key)] = value ?? true;
  }
  return args;
}

function toCamel(value) {
  return value.replace(/-([a-z])/gu, (_, char) => char.toUpperCase());
}

function numberArg(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/gu, '/');
}

function escapeMd(value) {
  return String(value).replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}

function usage(message) {
  if (message) console.error(message);
  console.error(`Usage:
  node scripts/recursive-quality-cycle.mjs init [--max-cycles=20] [--deadline=2026-06-11T04:30:00.000Z]
  node scripts/recursive-quality-cycle.mjs status
  node scripts/recursive-quality-cycle.mjs guard
  node scripts/recursive-quality-cycle.mjs scan
  node scripts/recursive-quality-cycle.mjs gate
  node scripts/recursive-quality-cycle.mjs complete-cycle [--no-gate]
  node scripts/recursive-quality-cycle.mjs new-cycle [--cycle=N]
`);
  process.exit(message ? 1 : 0);
}

main();
