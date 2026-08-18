#!/usr/bin/env node
/**
 * Fail if app code contains hardcoded localhost or 127.0.0.1.
 * Prevents production builds from depending on local URLs.
 *
 * Allowed (excluded from check):
 * - client/package.json "proxy" (dev server only)
 * - nginx*.conf, deploy*.sh, *production*.sh, manage-production.sh, start-production.sh, etc.
 * - ecosystem.config.js (documents ALLOWED_ORIGINS; default is now '')
 * - server/data/* (historical data may contain IPs)
 * - Test scripts: test-*.js, test-*.sh in repo root
 * - __tests__ directories
 *
 * Run: node scripts/check-no-localhost.js (from project root)
 * Exit: 0 if clean, 1 if forbidden pattern found.
 */

const fs = require('fs');
const path = require('path');

const FORBIDDEN = [
  /\blocalhost\b/i,
  /\b127\.0\.0\.1\b/,
];

const ROOT = path.resolve(__dirname, '..');

// Paths to scan (relative to ROOT). Only app code that gets deployed.
const SCAN_DIRS = ['client/src', 'server'];

// Exact path suffixes that are allowed to contain localhost (e.g. dev-only config).
const ALLOWED_SUFFIXES = [
  path.join('client', 'package.json'), // "proxy" for dev server
];

// Dir names to skip when scanning
const SKIP_DIRS = new Set(['node_modules', 'build', '__tests__', '.git', 'data', 'logs']);

// File path contains one of these → skip entire file (deploy/config, not app code)
const SKIP_PATH_CONTAINS = [
  'nginx',
  'deploy',
  'ecosystem.config.js',
  'manage-production.sh',
  'start-production.sh',
  'restart-production',
  'deploy_rhel8',
  'deploy-rhel8',
  'test-jira',
  'test-email.js',
  'test-app-email.js',
  'test-changelog',
  'start-servers.sh',
];

function isAllowed(filePath) {
  const rel = path.relative(ROOT, filePath);
  if (ALLOWED_SUFFIXES.some((s) => rel === s || rel.endsWith(s))) return true;
  if (SKIP_PATH_CONTAINS.some((s) => rel.includes(s))) return true;
  return false;
}

// Strip JS comments so we only flag localhost in actual code/strings, not in
// comments (comments don't affect runtime, which is what the rule cares about).
// URL schemes like `http://` are preserved so real `http://localhost` is caught.
// `state.inBlock` carries /* ... */ status across lines within a file.
function stripComments(line, state) {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    if (state.inBlock) {
      const end = line.indexOf('*/', i);
      if (end === -1) return out;
      i = end + 1;
      continue;
    }
    if (line[i] === '/' && line[i + 1] === '*') {
      state.inBlock = true;
      i += 1;
      continue;
    }
    if (line[i] === '/' && line[i + 1] === '/') {
      if (line[i - 1] === ':') {
        out += '//'; // part of a URL scheme (e.g. http://) — keep it
        i += 1;
        continue;
      }
      return out; // rest of the line is a // comment
    }
    out += line[i];
  }
  return out;
}

function scanDir(dir, results) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return;
  const walk = (d) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      const rel = path.relative(ROOT, p);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
        continue;
      }
      if (!/\.(js|jsx|ts|tsx|json)$/i.test(e.name)) continue;
      if (isAllowed(p)) continue;
      const content = fs.readFileSync(p, 'utf8');
      const lines = content.split('\n');
      const state = { inBlock: false };
      lines.forEach((line, i) => {
        const code = stripComments(line, state);
        if (FORBIDDEN.some((re) => re.test(code))) {
          results.push({ file: rel, line: i + 1, content: line.trim() });
        }
      });
    }
  };
  walk(full);
}

const hits = [];
for (const dir of SCAN_DIRS) scanDir(dir, hits);

if (hits.length === 0) {
  console.log('check-no-localhost: OK (no hardcoded localhost/127.0.0.1 in app code)');
  process.exit(0);
}

console.error('check-no-localhost: FAIL — hardcoded localhost/127.0.0.1 is not allowed in app code.\n');
hits.forEach(({ file, line, content }) => {
  console.error(`  ${file}:${line}  ${content}`);
});
console.error('\nUse relative paths, getApiBase(), or env (e.g. REACT_APP_API_URL, ALLOWED_ORIGINS). See ~/.cursor/rules/no-localhost.mdc.');
process.exit(1);
