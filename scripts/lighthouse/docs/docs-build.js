#!/usr/bin/env node
// Regenerates HTML for Markdown guides under docs/guides/
// Uses marked if available, else minimal fallback.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../..');
const guidesDir = path.join(root, 'docs', 'guides');
let marked;
try { marked = require('marked'); } catch { marked = null; }

function stripFrontmatter(md) {
  if (md.startsWith('---')) {
    const end = md.indexOf('\n---', 3);
    if (end !== -1) return md.slice(end + 4).replace(/^\n+/, '');
  }
  return md;
}
function mdToHtml(md) {
  const clean = stripFrontmatter(md);
  if (marked) return marked.parse(clean);
  return '<pre>' + clean.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
}
function wrap(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title} — Lighthouse Docs</title><link rel="stylesheet" href="../assets/style.css"/></head><body><header class="site-header"><div class="site-header-inner"><div class="brand"><div class="brand-mark">◐</div> Lighthouse <small>Docs</small></div><nav class="nav-links"><a href="../index.html">Home</a><a href="USER_GUIDE.html">User Guide</a><a href="ADMIN_GUIDE.html">Admin Guide</a><a href="../technical/ARCHITECTURE.html">Architecture</a></nav></div></header><nav class="breadcrumb"><a href="../index.html">Docs</a><span class="sep">/</span><a href="../index.html#guides">Guides</a><span class="sep">/</span><span>${title}</span></nav><div class="container"><article class="prose">${body}</article></div><footer class="site-footer"><span>© Nutanix · Lighthouse Docs</span><span><a href="../index.html">Home</a> · <a href="USER_GUIDE.html">User Guide</a></span></footer></body></html>`;
}
if (!fs.existsSync(guidesDir)) { console.log('No guides dir'); process.exit(0); }
const files = fs.readdirSync(guidesDir).filter(f=>f.endsWith('.md'));
for (const f of files) {
  const md = fs.readFileSync(path.join(guidesDir, f), 'utf8');
  const title = f.replace('.md','');
  const html = wrap(title, mdToHtml(md));
  const out = path.join(guidesDir, f.replace('.md','.html'));
  fs.writeFileSync(out, html);
  console.log(`Built ${path.relative(root, out)}`);
}

// Rebuild AI audit indexes (if registry exists) — keeps docs/ai-audit/timeline.md + per-page INDEX.md fresh
const auditRebuild = path.join(root, 'scripts/loom/ai-audit/rebuild-indexes.js');
if (fs.existsSync(auditRebuild)) {
  try {
    require(auditRebuild);
  } catch (e) {
    console.log(`WARN: ai-audit rebuild failed: ${e.message}`);
  }
}
console.log('docs-build done');
