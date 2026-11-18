#!/usr/bin/env node
// Regenerates HTML for Markdown guides under Documentation/guides/
// Uses marked if available, else minimal fallback.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const guidesDir = path.join(root, 'Documentation', 'guides');
let marked;
try { marked = require('marked'); } catch { marked = null; }

function mdToHtml(md) {
  if (marked) return marked.parse(md);
  // minimal fallback — wrap in <pre> if no parser
  return '<pre>' + md.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
}
function wrap(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><link rel="stylesheet" href="../assets/style.css"/></head><body><div class="container"><p class="breadcrumb"><a href="../index.html">Documentation</a> / Guides / ${title}</p><article class="prose">${body}</article></div></body></html>`;
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
console.log('docs-build done');
