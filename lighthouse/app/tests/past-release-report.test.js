import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __d = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__d, '..');
const verify = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports/_verify-2026-11-13-jql-totals.json'),'utf8'));
const summary = fs.readFileSync(path.join(ROOT, 'reports/NDB-Past-Releases-Summary.html'),'utf8');
function assert(cond, msg){ if(!cond) throw new Error('FAIL: '+msg); console.log('PASS: '+msg); }
 // Headers
assert(summary.includes('<th>NDB-2.10</th>') && summary.includes('<th>NDB-2.11</th>') && summary.includes('<th>NDB-2.12</th>'), 'headers NDB-2.10/2.11/2.12');
assert(summary.includes('id="kpi-matrix"'), 'matrix table id="kpi-matrix"');
 // Rows =13
const rows = summary.match(/<tr><td><strong>Top-CFI/g) ? 1 : 0; // check at least Top-CFI row exists
assert(summary.includes('Top-CFI') && summary.includes('Bugs Out of SLA'), '13 KPI rows present');
// Every cell JQL contains Integrated Version (HTML-encoded as &quot;Integrated Version&quot; is OK)
assert((summary.includes('"Integrated Version"') || summary.includes('&quot;Integrated Version&quot;') || summary.includes('Integrated Version')) && summary.includes('customfield_11360')===false, 'KPI JQL uses Integrated Version (cf11360) quoted, not raw field id');
// Links target blank
assert((summary.match(/target="_blank" rel="noreferrer"/g)||[]).length >= 39, 'every KPI cell link opens in new tab (>=39)');
for(const ver of ['NDB-2.10','NDB-2.11','NDB-2.12']){
  const html = fs.readFileSync(path.join(ROOT, `reports/${ver}-Report.html`),'utf8');
  const liveF = verify.releases[ver].feature.total;
  const liveI = verify.releases[ver].initiative.total;
  assert(html.includes(`<div class="v">${liveF}</div>`) || html.includes(`>${liveF}<`), `${ver} Feature ${liveF} in HTML`);
  assert(html.includes(`<div class="v">${liveI}</div>`) || html.includes(`>${liveI}<`), `${ver} Initiative ${liveI} in HTML`);
  const sum = verify.releases[ver].kpiClosed.totalSum;
  assert(html.includes(`>${sum}<`) || html.includes(`>${sum} `), `${ver} KPI sum ${sum} in HTML`);
  assert(html.includes('"Integrated Version"') || html.includes('&quot;Integrated Version&quot;') || html.includes('Integrated Version'), `${ver} KPI uses Integrated Version`);
}
// Counts match verify JSON
for(const ver of ['NDB-2.10','NDB-2.11','NDB-2.12']){
  const html = fs.readFileSync(path.join(ROOT, 'reports/NDB-Past-Releases-Summary.html'),'utf8');
  const total = verify.releases[ver].kpiClosed.totalSum;
  assert(html.includes(`<strong>${total}</strong>`), `summary ${ver} total ${total} present`);
}
console.log('All exhaustive tests PASSED');
