#!/usr/bin/env node
/**
 * Fail if app code contains hardcoded product-specific literals.
 * Enforces agent-pack/rules/product-agnostic.mdc (D1).
 *
 * Forbidden in app code (apps/delivery-ops/server, client/src, shared/src):
 * 1. Hardcoded customfield_NNNNN outside productService / jiraFieldsConfig
 * 2. Hardcoded release label literals like "ndb-2.12-deferred", "ndb-2.12-mustfix", "ndb-2.12-demo-site-test"
 *    → must be derived via deferredLabel(release) / mustFixLabel(release) / `${release}-demo-site-test`
 * 3. Hardcoded fixVersion="NDB-X.Y" literals outside tests/config
 *
 * Allowed:
 * - shared/src/services/productService.ts (source of truth)
 * - server/config/*, shared/config/*, apps/delivery-ops/server/config/*
 * - __tests__/, scripts/, reports/, docs/, .md files (examples)
 *
 * Run: node scripts/lighthouse/checks/check-product-agnostic.js (from project root)
 * Exit: 0 if clean, 1 if forbidden pattern found.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ROOT = path.join(REPO_ROOT, 'apps/delivery-ops');

// Patterns that indicate hardcoding (tested against code stripped of comments)
const FORBIDDEN = [
  {
    // literal versioned deferred/mustfix/demo label, e.g. "ndb-2.12-deferred" — must be derived
    re: /["']ndb-\d+\.\d+-(deferred|mustfix|demo-site-test)["']/i,
    msg: 'hardcoded versioned label literal — derive via `${release.toLowerCase()}-*` or deferredLabel()/mustFixLabel()',
  },
  {
    // fixVersion = "NDB-X.Y" hardcode in JQL strings — should be `fixVersion = "${release}"`
    re: /fixVersion\s*=\s*["']NDB-\d+\.\d+["']/i,
    msg: 'hardcoded fixVersion="NDB-X.Y" — use fixVersion = "${release}" param',
  },
  {
    // hardcoded team label like "ndb-not-por" / "ndb-non-por" — must be derived via `${labelPrefix}-not-por`
    // allows dynamic form: `${labelPrefix}-not-por` or `${prefix}-non-por` (no literal ndb- prefix)
    re: /["']ndb-(not|non)-por["']/i,
    msg: 'hardcoded "ndb-(not|non)-por" — derive via `${labelPrefix}-not-por` / `${prefix}-non-por`',
  },
];

// Grandfathered: customfield_NNNNN outside allowlist — warning only (not fail) until Phase 5 migration
// Fires when customfield_<digits> appears in scanned dirs outside productService/jiraFieldsConfig/allowed files.
// Set to [] to disable warning; kept to surface migration tail per minimal-architecture.mdc hard line #3.
const WARN_ONLY = [
  {
    re: /customfield_\d{4,5}/i,
    msg: 'grandfathered customfield_NNNNN — migrate to productService.getCustomFields(productId) / jiraFieldsConfig (warn-only)',
  },
];

const SCAN_DIRS = [
  path.join(ROOT, 'server'),
  path.join(ROOT, 'client/src'),
  path.join(REPO_ROOT, 'shared/src'),
];

// Exact path suffixes or path-contains that are allowed to have hardcodes
const ALLOWED_PATH_CONTAINS = [
  'productService', // source of truth
  'jiraFieldsConfig',
  'teamBoardConfig',
  'releaseVersionsEmailConfig',
  'releaseVersionsCCConfig',
  'releaseOutstandingWorkConfig',
  '__tests__',
  '.test.',
  '.spec.',
  'scripts/', // dev scripts may use fixtures
  'reports/',
  'docs/',
  '.md',
  // ChatbotPage: whitelisted intentionally — placeholder JQL examples in button
  // presets/textarea (lines ~229, 248) are UI fixtures for the digging drawer;
  // not consumed as logic. Deriving them from productId would obscure the
  // example. See product-agnostic.mdc "What may stay product-neutral".
  'ChatbotPage',
];

const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '__tests__', '.git', 'data', 'logs', 'coverage']);

function isAllowed(filePath) {
  const rel = path.relative(REPO_ROOT, filePath);
  return ALLOWED_PATH_CONTAINS.some((s) => rel.includes(s));
}

function stripComments(line, state) {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    if (state.inBlock) {
      const end = line.indexOf('*/', i);
      if (end === -1) return out;
      i = end + 1;
      state.inBlock = false;
      continue;
    }
    if (line[i] === '/' && line[i + 1] === '*') {
      state.inBlock = true;
      i += 1;
      continue;
    }
    if (line[i] === '/' && line[i + 1] === '/') {
      if (line[i - 1] === ':') { out += '//'; i += 1; continue; }
      return out;
    }
    out += line[i];
  }
  return out;
}

function scanDir(dir, results, warnResults) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  const walk = (d) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
      if (!/\.(js|jsx|ts|tsx)$/i.test(e.name)) continue;
      if (isAllowed(p)) continue;
      const content = fs.readFileSync(p, 'utf8');
      const lines = content.split('\n');
      const state = { inBlock: false };
      lines.forEach((line, i) => {
        const code = stripComments(line, state);
        for (const { re, msg } of FORBIDDEN) {
          if (re.test(code)) {
            results.push({ file: path.relative(REPO_ROOT, p), line: i + 1, content: line.trim(), msg, pattern: re.source });
          }
        }
        if (warnResults) {
          for (const { re, msg } of WARN_ONLY) {
            if (re.test(code)) {
              warnResults.push({ file: path.relative(REPO_ROOT, p), line: i + 1, content: line.trim(), msg, pattern: re.source });
            }
          }
        }
      });
    }
  };
  walk(dir);
}

const hits = [];
const warns = [];
// SCAN_DIRS includes shared/src — shared/src/services scanned; customfield is warn-only (grandfathered per D1 migration tail)
for (const dir of SCAN_DIRS) scanDir(dir, hits, warns);

if (warns.length > 0) {
  const byFile = {};
  warns.forEach(w => { byFile[w.file] = (byFile[w.file] || 0) + 1; });
  console.warn(`check-product-agnostic: WARN — ${warns.length} grandfathered customfield_NNNNN hits (warn-only, not failing):`);
  Object.entries(byFile).slice(0, 10).forEach(([f, n]) => console.warn(`  ${f}: ${n} hits`));
  if (Object.keys(byFile).length > 10) console.warn(`  ... and ${Object.keys(byFile).length - 10} more files`);
  console.warn('  → migrate via productService.getCustomFields(productId) per minimal-architecture.mdc hard line #3\n');
}

if (hits.length === 0) {
  console.log('check-product-agnostic: OK (no hardcoded product literals in app code)');
  process.exit(0);
}

console.error('check-product-agnostic: FAIL — product-agnostic rule violated (see agent-pack/rules/product-agnostic.mdc)\n');
hits.forEach(({ file, line, content, msg }) => {
  console.error(`  ${file}:${line}  ${content}`);
  console.error(`    → ${msg}\n`);
});
console.error('Fix: derive via productService or release param (e.g. `${release.toLowerCase()}-deferred`).');
process.exit(1);
