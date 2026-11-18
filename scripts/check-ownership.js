#!/usr/bin/env node
/**
 * check:ownership — ownership guard for lighthouse / loom self-containment.
 *
 * Rules:
 *  - No file under lighthouse/ imports from loom/ and vice versa (except agent-pack/base/ + platform/)
 *  - No lighthouse/mcp/src imports from loom/mcp/src (after collapse)
 *  - No .claude/ directories in product paths
 *  - lighthouse/ and loom/ remain self-contained — no cross-product relative hops
 *
 * This is Phase 0 guard; before collapse it validates that current structure
 * doesn't already violate future boundaries (no premature lighthouse/ loom/ at root yet).
 * After Phase 2, it becomes blocking: lighthouse/ must not reference loom/ etc.
 *
 * Allowlist: agent-pack/base/, platform/, node_modules, .git, docs/, apps/bin-packing (standalone)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failed = false;
function fail(msg) { console.error(`check:ownership FAIL — ${msg}`); failed = true; }

// 1. No .claude/ in product paths (worktree's .claude/worktrees/ is tooling, excluded)
const productClaudePaths = [];
function findClaude(dir, base) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);
    // Skip tooling locations
    if (rel.startsWith('.claude/worktrees')) continue;
    if (rel.includes('node_modules')) continue;
    if (entry.name === '.claude' && entry.isDirectory()) {
      // Allow root-adjacent worktree metadata only if it's .claude itself at repo root (worktree infra)
      // Real violation: .claude/ inside lighthouse/, loom/, platform/, agent-pack/
      if (rel === '.claude') continue; // worktree root's .claude symlink dir — ok (infra)
      productClaudePaths.push(rel);
    } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
      // only descend into product-relevant dirs to keep quick
      if (['lighthouse', 'loom', 'platform', 'agent-pack', 'apps', 'mcp', 'shared'].some(p => rel === p || rel.startsWith(p + '/'))) {
        findClaude(full, base);
      }
    }
  }
}
findClaude(ROOT, ROOT);
if (productClaudePaths.length) {
  for (const p of productClaudePaths) fail(`forbidden .claude/ at ${p}`);
} else {
  // Also direct check for future layout
  for (const prod of ['lighthouse', 'loom', 'platform']) {
    const p = path.join(ROOT, prod, '.claude');
    if (fs.existsSync(p)) fail(`forbidden ${prod}/.claude`);
  }
}

// 2. Cross-product import guard — only active once lighthouse/ or loom/ exist at top level
for (const [owner, forbidden] of [['lighthouse', 'loom'], ['loom', 'lighthouse']]) {
  const ownerDir = path.join(ROOT, owner);
  if (!fs.existsSync(ownerDir)) continue;
  const files = [];
  function collect(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(ROOT, full);
      if (rel.includes('node_modules') || rel.includes('dist') || rel.includes('.git')) continue;
      if (e.isDirectory()) collect(full);
      else if (/\.(ts|js|tsx|jsx|mdc|md|json)$/.test(e.name)) files.push(full);
    }
  }
  collect(ownerDir);
  const importRe = new RegExp(`from\\s+['"][^'"]*${forbidden}[^'"]*['"]|import\\s*\\([^)]*${forbidden}[^)]*\\)|\\b${forbidden}/`, 'i');
  const allowedRe = /(agent-pack\/base|platform\/)/;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    // Check each line
    for (const line of content.split('\n')) {
      if (allowedRe.test(line)) continue;
      if (importRe.test(line) && line.includes(forbidden)) {
        // Exclude comments about the rule itself
        if (line.includes('check:ownership') || line.includes('Ownership rule')) continue;
        fail(`${owner}/ imports from ${forbidden}/ in ${path.relative(ROOT, file)}: ${line.trim().slice(0, 120)}`);
      }
    }
  }
}

// 3. mcp/shared should not exist after Phase 1 — warn if it does post-dissolve marker
// (No failure yet — Phase 1 will remove it. Just info if lighthouse/mcp still uses ../shared include)
for (const mcpDir of ['mcp/lighthouse', 'mcp/loom', 'lighthouse/mcp', 'loom/mcp']) {
  const tsconfigPath = path.join(ROOT, mcpDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) continue;
  try {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    const includes = (tsconfig.include || []).join(' ');
    if (includes.includes('../shared')) {
      // Only fail after lighthouse/ exists (meaning Phase 2 done) — before that it's expected legacy
      if (fs.existsSync(path.join(ROOT, 'lighthouse'))) {
        fail(`${mcpDir}/tsconfig.json still includes ../shared (should be removed post-reorg)`);
      }
    }
  } catch {}
}

// 4. agent-pack/base must exist after Phase 0
if (!fs.existsSync(path.join(ROOT, 'agent-pack/base'))) {
  fail('agent-pack/base/ missing — Phase 0 incomplete');
}
if (!fs.existsSync(path.join(ROOT, 'agent-pack/base/rules'))) {
  fail('agent-pack/base/rules/ missing');
}
if (!fs.existsSync(path.join(ROOT, 'agent-pack/base/tsconfig.base.json'))) {
  fail('agent-pack/base/tsconfig.base.json missing');
}

if (!failed) console.log('check:ownership OK — no cross-product imports, no .claude/ in products, base present');
process.exit(failed ? 1 : 0);
