#!/usr/bin/env node
/**
 * Fails if two MCP workspaces share the same bin name, or if any tool file
 * exists byte-identical in both mcp-lighthouse and mcp-loom (indicates
 * un-split duplication).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const MCP_DIRS = ['mcp/loom', 'mcp/lighthouse', 'mcp-lighthouse', 'mcp-loom'];
let failed = false;

function fail(msg) { console.error(`check:mcp FAIL — ${msg}`); failed = true; }

// 1. Bin names must be unique
const binNames = new Map();
for (const dir of MCP_DIRS) {
  const pkgPath = path.join(ROOT, dir, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  for (const bin of Object.keys(pkg.bin || {})) {
    if (binNames.has(bin)) {
      fail(`duplicate bin "${bin}" in ${binNames.get(bin)} and ${dir}`);
    } else {
      binNames.set(bin, dir);
    }
  }
}

// 2. No byte-identical tool files across both dirs
const hashes = new Map(); // hash -> [{dir, file}]
for (const dir of MCP_DIRS) {
  const toolsDir = path.join(ROOT, dir, 'src', 'tools');
  if (!fs.existsSync(toolsDir)) continue;
  for (const file of fs.readdirSync(toolsDir)) {
    const full = path.join(toolsDir, file);
    if (!fs.statSync(full).isFile()) continue;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    if (!hashes.has(hash)) hashes.set(hash, []);
    hashes.get(hash).push({ dir, file });
  }
}
for (const [hash, entries] of hashes) {
  const dirs = new Set(entries.map(e => e.dir));
  if (dirs.size > 1) {
    fail(`byte-identical tool file across MCP dirs: ${entries.map(e => `${e.dir}/${e.file}`).join(', ')} (hash ${hash.slice(0, 8)})`);
  }
}

if (!failed) console.log('check:mcp OK — bins unique, no duplicate tool files');
process.exit(failed ? 1 : 0);
