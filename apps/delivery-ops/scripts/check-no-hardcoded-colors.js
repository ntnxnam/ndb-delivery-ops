#!/usr/bin/env node
/**
 * check-no-hardcoded-colors.js — warn-only guard.
 * Flags hardcoded hex colors in client JS/CSS outside the token files,
 * nudging new code toward var(--*). Does not fail the build.
 */
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ALLOW = [
  'client/src/styles/tokens.css',
  'client/src/design-system/tokens.css',
  'client/src/design-system/primitives.css',
];

function run() {
  let files = [];
  try {
    const out = execSync(
      `grep -r -n -E '#[0-9a-fA-F]{3,6}\\b' --include='*.js' --include='*.css' client/src | grep -v node_modules || true`,
      { cwd: ROOT, encoding: 'utf8' }
    );
    files = out.trim().split('\n').filter(Boolean);
  } catch { return; }

  const hits = files.filter((line) => {
    if (line.includes('.test.') || line.includes('__tests__')) return false;
    if (ALLOW.some((a) => line.includes(a))) return false;
    // Allow pure white/black shorthands (#fff, #ffffff, #000, #000000) and print media — but not #fff3cd etc.
    if (line.includes('@media print')) return false;
    // strip the file:line prefix, test the hex itself
    const hexes = line.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
    const onlyMonochrome = hexes.length > 0 && hexes.every((h) => /^(#fff|#ffffff|#000|#000000)$/i.test(h));
    if (onlyMonochrome) return false;
    return true;
  });

  if (hits.length === 0) {
    console.log('✓ check-no-hardcoded-colors: no hardcoded colors outside tokens.css');
    return;
  }
  console.warn(`⚠ check-no-hardcoded-colors: ${hits.length} hardcoded hex color(s) outside tokens.css (warn-only):`);
  hits.slice(0, 40).forEach((h) => console.warn('  ' + h));
  if (hits.length > 40) console.warn(`  …and ${hits.length - 40} more`);
  console.warn('  Prefer var(--*) from styles/tokens.css');
}

run();
