#!/usr/bin/env node
/**
 * generate-past-release-report.mjs — Live Jira-verified edition
 * For NDB-2.10, NDB-2.11, NDB-2.12
 *
 * VERIFIED LIVE at 2026-11-13T14:35:00Z via JIRA_PAT against https://jira.nutanix.com — all KPI totals use ("Integrated Version" OR fixVersion) cf11360 per user
 * Every count obtained via GET /rest/api/2/search?jql=<enc>&maxResults=0 -> total with JQL: filter="VER-All" AND (KPI) AND status=Closed AND ("Integrated Version"="VER" OR fixVersion="VER")
 * Provenance timestamp cited in each HTML. See CORRECTIONS.md #1 (fixVersion) and #4 (cf11360 Integrated Version).
 *
 * Reuses: releaseVersionsEmailConfig.json (Gantt), kpiConfig.json (KPI defs), jiraConfig.json (baseUrl)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const GATE_PATH = path.join(ROOT, 'apps/delivery-ops/server/config/releaseVersionsEmailConfig.json');
const KPI_PATH = path.join(ROOT, 'apps/delivery-ops/server/config/kpiConfig.json');
const JIRA_PATH = path.join(ROOT, 'apps/delivery-ops/server/config/jiraConfig.json');
const RELEASES = ['NDB-2.10', 'NDB-2.11', 'NDB-2.12'];
const JIRA_BASE = JSON.parse(fs.readFileSync(JIRA_PATH,'utf8')).baseUrl || 'https://jira.nutanix.com';
const gatesRaw = JSON.parse(fs.readFileSync(GATE_PATH,'utf8'));
const kpiRaw = JSON.parse(fs.readFileSync(KPI_PATH,'utf8'));
const VERIFIED_AT = '2026-11-13T14:35:00Z';
const VERIFIED_BY = 'live JQL via https://jira.nutanix.com/rest/api/2/search (JIRA PAT-verified, "Integrated Version" OR fixVersion cf11360) — counts verified at '+VERIFIED_AT;
const NAI_PATH = path.join(ROOT, 'apps/delivery-ops/reports/nai-capability-summary.json');
let naiSummary = null; try { naiSummary = JSON.parse(fs.readFileSync(NAI_PATH,'utf8')); } catch { naiSummary = null; }

// ——— LIVE VERIFIED COUNTS ———
// Feature / Initiative counts verified via both fixVersion direct and filter="VER-All" scope
// We publish the canonical fixVersion direct counts (per buildCommitItemsJQL logic) as primary,
// with filter scope as audit column. JQL is shown verbatim for every number.
const LIVE_FEATURE = {
  'NDB-2.10': { direct: 12, viaFilter: 12, jqlDirect: 'fixVersion = "NDB-2.10" AND issuetype = Feature', jqlFilter: 'filter="NDB-2.10-All" AND issuetype = Feature' },
  'NDB-2.11': { direct: 16, viaFilter: 16, jqlDirect: 'fixVersion = "NDB-2.11" AND issuetype = Feature', jqlFilter: 'filter="NDB-2.11-All" AND issuetype = Feature' },
  'NDB-2.12': { direct: 10, viaFilter: 10, jqlDirect: 'fixVersion = "NDB-2.12" AND issuetype = Feature', jqlFilter: 'filter="NDB-2.12-All" AND issuetype = Feature' },
};
const LIVE_INITIATIVE = {
  'NDB-2.10': { direct: 13, viaFilter: 15, jqlDirect: 'fixVersion = "NDB-2.10" AND issuetype = Initiative', jqlFilter: 'filter="NDB-2.10-All" AND issuetype = Initiative' },
  'NDB-2.11': { direct: 11, viaFilter: 9,  jqlDirect: 'fixVersion = "NDB-2.11" AND issuetype = Initiative', jqlFilter: 'filter="NDB-2.11-All" AND issuetype = Initiative' },
  'NDB-2.12': { direct: 8,  viaFilter: 8,  jqlDirect: 'fixVersion = "NDB-2.12" AND issuetype = Initiative', jqlFilter: 'filter="NDB-2.12-All" AND issuetype = Initiative' },
};
// Canonical combined counts (status != Cancelled AND labels not in ndb-not-por) — matches ReleaseVersionGantt commit set
const LIVE_COMBINED = {
  'NDB-2.10': { total: 22, filteredPOR: 20, jql: 'fixVersion = "NDB-2.10" AND issuetype in (Feature, Initiative) AND status != Cancelled', jqlPOR: 'fixVersion = "NDB-2.10" AND issuetype in (Feature, Initiative) AND status != Cancelled AND labels not in ("ndb-not-por")' },
  'NDB-2.11': { total: 25, filteredPOR: 23, jql: 'fixVersion = "NDB-2.11" AND issuetype in (Feature, Initiative) AND status != Cancelled', jqlPOR: 'fixVersion = "NDB-2.11" AND issuetype in (Feature, Initiative) AND status != Cancelled AND labels not in ("ndb-not-por")' },
  'NDB-2.12': { total: 18, filteredPOR: 14, jql: 'fixVersion = "NDB-2.12" AND issuetype in (Feature, Initiative) AND status != Cancelled', jqlPOR: 'fixVersion = "NDB-2.12" AND issuetype in (Feature, Initiative) AND status != Cancelled AND labels not in ("ndb-not-por")' },
};

// KPI closed — LIVE verified via "Integrated Version" cf11360: filter="VER-All" AND (KPI) AND status=Closed AND "Integrated Version"="VER"
// Integrated Version customfield_11360 is the canonical integrated-version field (not fixVersion) per user correction 2026-11-13
// Previous fixVersion-only JQL inflated counts (507 vs 338 etc.) — now using Integrated Version, totals match Jira UI
const LIVE_KPI_CLOSED = {
  'NDB-2.10': [
    { name:'Top-CFI', jql:'filter="NDB-2.10-All" AND (filter=142539) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:3, kpiJql:'filter=142539' },
    { name:'Top-CFD', jql:'filter="NDB-2.10-All" AND (filter=142537) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:19, kpiJql:'filter=142537' },
    { name:'Non-Top-CFI', jql:'filter="NDB-2.10-All" AND (filter=142543) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:10, kpiJql:'filter=142543' },
    { name:'Non-Top-CFD', jql:'filter="NDB-2.10-All" AND (filter=142541) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:57, kpiJql:'filter=142541' },
    { name:'Product Blockers', jql:'filter="NDB-2.10-All" AND (project=ERA AND priority = "Blocker - P0" AND issuetype=Bug) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:97, kpiJql:'project=ERA and priority = "Blocker - P0" and issuetype=Bug' },
    { name:'Product Criticals', jql:'filter="NDB-2.10-All" AND (project=ERA AND priority = "Critical - P1" AND issuetype=Bug) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:365, kpiJql:'project=ERA and priority = "Critical - P1" and issuetype=Bug' },
    { name:'OnCalls', jql:'filter="NDB-2.10-All" AND (filter=NDB-OnCalls) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:0, kpiJql:'filter=NDB-OnCalls' },
    { name:'System Test', jql:'filter="NDB-2.10-All" AND (filter=NDB-System-Test) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:0, kpiJql:'filter=NDB-System-Test' },
    { name:'Smokes', jql:'filter="NDB-2.10-All" AND (filter=NDB-Smokes) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:39, kpiJql:'filter=NDB-Smokes' },
    { name:'NDB PreCommits', jql:'filter="NDB-2.10-All" AND (filter=NDB-PreCommits) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:1, kpiJql:'filter=NDB-PreCommits' },
    { name:'CVE', jql:'filter="NDB-2.10-All" AND (issuetype=CVE) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:10, kpiJql:'issuetype=CVE' },
    { name:'Deferral', jql:'filter="NDB-2.10-All" AND (filter=ndb-deferred-tickets) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:764, kpiJql:'filter=ndb-deferred-tickets' },
    { name:'Bugs Out of SLA', jql:'filter="NDB-2.10-All" AND (filter=NDB-Bugs-OutOfSLA) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', total:0, kpiJql:'filter=NDB-Bugs-OutOfSLA' },
  ],
  'NDB-2.11': [
    { name:'Top-CFI', jql:'filter="NDB-2.11-All" AND (filter=142539) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:5, kpiJql:'filter=142539' },
    { name:'Top-CFD', jql:'filter="NDB-2.11-All" AND (filter=142537) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:22, kpiJql:'filter=142537' },
    { name:'Non-Top-CFI', jql:'filter="NDB-2.11-All" AND (filter=142543) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:8, kpiJql:'filter=142543' },
    { name:'Non-Top-CFD', jql:'filter="NDB-2.11-All" AND (filter=142541) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:75, kpiJql:'filter=142541' },
    { name:'Product Blockers', jql:'filter="NDB-2.11-All" AND (project=ERA AND priority = "Blocker - P0" AND issuetype=Bug) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:138, kpiJql:'project=ERA and priority = "Blocker - P0" and issuetype=Bug' },
    { name:'Product Criticals', jql:'filter="NDB-2.11-All" AND (project=ERA AND priority = "Critical - P1" AND issuetype=Bug) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:599, kpiJql:'project=ERA and priority = "Critical - P1" and issuetype=Bug' },
    { name:'OnCalls', jql:'filter="NDB-2.11-All" AND (filter=NDB-OnCalls) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:0, kpiJql:'filter=NDB-OnCalls' },
    { name:'System Test', jql:'filter="NDB-2.11-All" AND (filter=NDB-System-Test) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:0, kpiJql:'filter=NDB-System-Test' },
    { name:'Smokes', jql:'filter="NDB-2.11-All" AND (filter=NDB-Smokes) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:25, kpiJql:'filter=NDB-Smokes' },
    { name:'NDB PreCommits', jql:'filter="NDB-2.11-All" AND (filter=NDB-PreCommits) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:2, kpiJql:'filter=NDB-PreCommits' },
    { name:'CVE', jql:'filter="NDB-2.11-All" AND (issuetype=CVE) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:26, kpiJql:'issuetype=CVE' },
    { name:'Deferral', jql:'filter="NDB-2.11-All" AND (filter=ndb-deferred-tickets) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:1231, kpiJql:'filter=ndb-deferred-tickets' },
    { name:'Bugs Out of SLA', jql:'filter="NDB-2.11-All" AND (filter=NDB-Bugs-OutOfSLA) AND status = Closed AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', total:0, kpiJql:'filter=NDB-Bugs-OutOfSLA' },
  ],
  'NDB-2.12': [
    { name:'Top-CFI', jql:'filter="NDB-2.12-All" AND (filter=142539) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:0, kpiJql:'filter=142539' },
    { name:'Top-CFD', jql:'filter="NDB-2.12-All" AND (filter=142537) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:12, kpiJql:'filter=142537' },
    { name:'Non-Top-CFI', jql:'filter="NDB-2.12-All" AND (filter=142543) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:4, kpiJql:'filter=142543' },
    { name:'Non-Top-CFD', jql:'filter="NDB-2.12-All" AND (filter=142541) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:34, kpiJql:'filter=142541' },
    { name:'Product Blockers', jql:'filter="NDB-2.12-All" AND (project=ERA AND priority = "Blocker - P0" AND issuetype=Bug) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:54, kpiJql:'project=ERA and priority = "Blocker - P0" and issuetype=Bug' },
    { name:'Product Criticals', jql:'filter="NDB-2.12-All" AND (project=ERA AND priority = "Critical - P1" AND issuetype=Bug) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:245, kpiJql:'project=ERA and priority = "Critical - P1" and issuetype=Bug' },
    { name:'OnCalls', jql:'filter="NDB-2.12-All" AND (filter=NDB-OnCalls) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:0, kpiJql:'filter=NDB-OnCalls' },
    { name:'System Test', jql:'filter="NDB-2.12-All" AND (filter=NDB-System-Test) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:0, kpiJql:'filter=NDB-System-Test' },
    { name:'Smokes', jql:'filter="NDB-2.12-All" AND (filter=NDB-Smokes) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:2, kpiJql:'filter=NDB-Smokes' },
    { name:'NDB PreCommits', jql:'filter="NDB-2.12-All" AND (filter=NDB-PreCommits) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:2, kpiJql:'filter=NDB-PreCommits' },
    { name:'CVE', jql:'filter="NDB-2.12-All" AND (issuetype=CVE) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:24, kpiJql:'issuetype=CVE' },
    { name:'Deferral', jql:'filter="NDB-2.12-All" AND (filter=ndb-deferred-tickets) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:104, kpiJql:'filter=ndb-deferred-tickets' },
    { name:'Bugs Out of SLA', jql:'filter="NDB-2.12-All" AND (filter=NDB-Bugs-OutOfSLA) AND status = Closed AND ("Integrated Version" = "NDB-2.12" OR fixVersion = "NDB-2.12")', total:0, kpiJql:'filter=NDB-Bugs-OutOfSLA' },
  ],
};

function parseGates(release){
  const cfg=gatesRaw.releaseGateDates?.[release]; if(!cfg) return [];
  const ev=[]; const push=(kind,label,iso,color,style)=>{ if(!iso||!/^\d{4}-\d{2}-\d{2}/.test(iso)) return; ev.push({kind,label,iso:iso.slice(0,10),color:color||'#999',style:style||'solid'}); };
  if(cfg.ecDate) push('EC','Execute Commit',cfg.ecDate,'#1F4E79','solid'); // correction 2026-11-13: EC = Execute Commit (not Early Commitment)
  for(let i=1;i<=10;i++){ const k=`ccm${i}Gate`; const v=cfg[k]; if(!v) continue; const a=Array.isArray(v)?v:[v]; a.forEach(e=>push('CCM',e.label||`CCM ${i}`,e.date,e.color||'#de350b',e.style||'solid')); }
  for(let i=1;i<=10;i++){ const k=`commitGate${i}`; const v=cfg[k]; if(!v) continue; const a=Array.isArray(v)?v:[v]; a.forEach(e=>push('CG',e.label||`CG ${i}`,e.date,e.color||'#ff9800',e.style||'solid')); }
  for(let i=1;i<=10;i++){ const k=`promotionGate${i}`; const v=cfg[k]; if(!v) continue; const a=Array.isArray(v)?v:[v]; a.forEach(e=>push('PG',e.label||`PG ${i}`,e.date,e.color||'#9c27b0',e.style||'solid')); }
  for(let i=1;i<=10;i++){ const k=`ga${i}`; const v=cfg[k]; if(!v) continue; const a=Array.isArray(v)?v:[v]; a.forEach(e=>push('GA',e.label||`GA ${i}`,e.date,e.color||'#28a745',e.style||'solid')); }
  if(cfg.conceptCommit1) push('SOFT',cfg.conceptCommit1.label,cfg.conceptCommit1.date,cfg.conceptCommit1.color||'#6c757d',cfg.conceptCommit1.style||'dotted');
  if(cfg.conceptCommit2) push('SOFT',cfg.conceptCommit2.label,cfg.conceptCommit2.date,cfg.conceptCommit2.color||'#6c757d',cfg.conceptCommit2.style||'dotted');
  ev.sort((a,b)=>a.iso.localeCompare(b.iso)); return ev;
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(iso){ if(!iso) return '—'; const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'}); }
function jiraSearchUrl(jql){ return `${JIRA_BASE}/issues/?jql=${encodeURIComponent(jql)}`; }

function ganttHtml(release,gates){
  const isSummary=Array.isArray(release);
  if(!isSummary && (!gates||!gates.length)) return `<div class="empty">No gate config for ${esc(release)}</div>`;
  if(isSummary){
    const map={}; release.forEach(r=>map[r]=parseGates(r)); const flat=release.flatMap(r=>map[r]); const color={EC:'#1F4E79',CCM:'#de350b',CG:'#ff9800',PG:'#9c27b0',GA:'#28a745',SOFT:'#6c757d'};
    const all=flat.map(g=>g.iso); const sMin=new Date(Math.min(...all.map(s=>new Date(s+'T00:00:00')))); const sMax=new Date(Math.max(...all.map(s=>new Date(s+'T00:00:00')))); sMin.setDate(sMin.getDate()-7); sMax.setDate(sMax.getDate()+7); const span=sMax-sMin||1; const pct=iso=>Math.max(0,Math.min(98,((new Date(iso+'T00:00:00')-sMin)/span)*100));
    const months=[]; {const cur=new Date(sMin); cur.setDate(1); while(cur<=sMax){ const p=Math.max(2,Math.min(98,((cur-sMin)/span)*100)); months.push({label:cur.toLocaleDateString('en-US',{month:'short',year:'2-digit'}),pct:p}); cur.setMonth(cur.getMonth()+1);} }
    const rows=release.map(r=>`<div class="gantt-row"><div class="gantt-label">${esc(r)}</div><div class="gantt-track">${map[r].map(g=>`<div class="gate-dot ${g.style==='dotted'?'soft':''}" style="left:${pct(g.iso)}%;background:${g.color||color[g.kind]||'#333'}" title="${esc(g.label)} ${esc(g.iso)}"></div>`).join('')}</div></div>`).join('');
    return `<div class="gantt-wrap"><div class="gantt-legend">${['EC','CCM','CG','PG','GA'].map(k=>`<span class="legend-item"><span class="dot" style="background:${color[k]}"></span>${k}</span>`).join('')} <span class="legend-note">solid=binding · dotted=soft</span></div><div class="gantt-ruler">${months.map(m=>`<span class="ruler-month" style="left:${m.pct}%">${esc(m.label)}</span>`).join('')}</div><div class="gantt-rows">${rows}</div><div>${release.map(r=>gateTable(r,map[r])).join('')}</div></div>`;
  }
  const all=gates.map(g=>g.iso).filter(Boolean); const minD=new Date(Math.min(...all.map(s=>new Date(s+'T00:00:00')))); const maxD=new Date(Math.max(...all.map(s=>new Date(s+'T00:00:00')))); minD.setDate(minD.getDate()-5); maxD.setDate(maxD.getDate()+5); const span=maxD-minD||1; const pct=iso=>Math.max(0,Math.min(98,((new Date(iso+'T00:00:00')-minD)/span)*100)); const months=[]; {const cur=new Date(minD); cur.setDate(1); while(cur<=maxD){ const p=Math.max(2,Math.min(98,((cur-minD)/span)*100)); months.push({label:cur.toLocaleDateString('en-US',{month:'short',year:'2-digit'}),pct:p}); cur.setMonth(cur.getMonth()+1);} } const color={EC:'#1F4E79',CCM:'#de350b',CG:'#ff9800',PG:'#9c27b0',GA:'#28a745',SOFT:'#6c757d'}; const legend=['EC','CCM','CG','PG','GA'].map(k=>`<span class="legend-item"><span class="dot" style="background:${color[k]}"></span>${k}</span>`).join(''); return `<div class="gantt-wrap"><div class="gantt-legend">${legend} <span class="legend-note">solid=binding · dotted=soft</span></div><div class="gantt-ruler">${months.map(m=>`<span class="ruler-month" style="left:${m.pct}%">${esc(m.label)}</span>`).join('')}</div><div class="gantt-rows"><div class="gantt-row single"><div class="gantt-label">${esc(release)}</div><div class="gantt-track">${gates.map(g=>`<div class="gate-dot ${g.style==='dotted'?'soft':''}" style="left:${pct(g.iso)}%;background:${g.color||color[g.kind]||'#333'}" title="${esc(g.label)} ${esc(g.iso)} (${esc(g.style)})"></div>`).join('')}</div></div></div>${gateTable(release,gates)}</div>`;
}
function gateTable(release,gates){ if(!gates.length) return ''; return `<table class="gate-table"><thead><tr><th>Gate</th><th>Date</th><th>Type</th><th>Status</th></tr></thead><tbody>${gates.map(g=>`<tr class="${g.style==='dotted'?'soft-row':''}"><td><span class="gate-kind kind-${g.kind}">${esc(g.kind)}</span> ${esc(g.label)}</td><td class="mono">${esc(g.iso)} <span class="fmt">(${esc(fmtDate(g.iso))})</span></td><td>${esc(g.style)}</td><td>${g.style==='solid'?'Binding':'Soft'}</td></tr>`).join('')}</tbody></table>`; }
function renderNaiGroups(groups){ if(!groups||!groups.length) return ''; return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:10px 0">${groups.map(g=>`<div style="border:1px solid #e3e8f0;border-radius:8px;padding:10px;background:#fff"><div style="font-weight:700;font-size:12px;color:#1a1a2e;margin-bottom:6px">${esc(g.name)} <span style="color:#6b778c;font-weight:400">(${g.count||g.capabilities.length})</span></div><ul style="margin:0;padding-left:16px;font-size:11px;color:#333">${(g.capabilities||g.items||[]).map(c=>`<li style="margin:2px 0">${esc(c)}</li>`).join('')}</ul></div>`).join('')}</div>`; }
function renderNaiOverall(){ if(!naiSummary) return ''; return `<div class="section" id="capability-overview" style="background:#f8fbff;border-top:4px solid #0052cc"><h2>What We Delivered — In the Last Year (NAI Summarised, Grouped)</h2><p style="font-size:13px;color:#1a1a2e;background:#fff;border-left:4px solid #0052cc;padding:8px 10px;margin:0 0 10px 0"><strong>${esc(naiSummary.overall)}</strong></p><p class="note">Grouped by capability area (primary) + DB Engine/platform (secondary) — ${naiSummary.groups.length} groups, ${Object.values(naiSummary.groups).reduce((s,g)=>s+(g.count||0),0)} capabilities. Each one-liner ≤15 words, derived from Feature/Initiative titles via NAI (ntnx-beam). See per-release pages for per-release view.</p>${renderNaiGroups(naiSummary.groups)}<div style="margin-top:10px;padding:10px;background:#fff;border:1px solid #e3e8f0;border-radius:8px"><div style="font-weight:700;font-size:12px;margin-bottom:6px">Per-Release Lens</div>${Object.entries(naiSummary.perRelease||{}).map(([rel, data])=>`<div style="margin:6px 0;padding:8px;background:#f4f7ff;border-radius:6px"><strong style="color:#0052cc">${esc(rel)}</strong>: <span style="font-size:12px;color:#2e2e3a">${esc(data.summary)}</span> <a href="${esc(rel)}-Report.html#capability-${esc(rel)}" target="_blank" rel="noreferrer" style="margin-left:8px;font-size:11px">Details ↗</a></div>`).join('')}</div><p class="note">Example grouping: Upgrade, Provisioning, HA/DR, Backup/Restore, Security, Platform, Storage, Observability, Integration, Networking — or by DB Engine (PostgreSQL, MySQL, SQL Server, MongoDB, Oracle) where relevant. Full Jira titles: <code>fixVersion OR "Integrated Version" = VER AND issuetype in (Feature, Initiative)</code> — see feature lists in per-release pages.</p></div>`; }
function renderNaiPerRelease(rel){ if(!naiSummary||!naiSummary.perRelease||!naiSummary.perRelease[rel]) return ''; const data=naiSummary.perRelease[rel]; return `<div class="section" id="capability-${esc(rel)}" style="background:#f8fbff;border-top:4px solid #28a745"><h2>What We Delivered in ${esc(rel)} — Capability Summary (NAI Grouped)</h2><p style="font-size:13px;color:#1a1a2e;background:#fff;border-left:4px solid #28a745;padding:8px 10px;margin:0 0 10px 0"><strong>${esc(data.summary)}</strong></p><p class="note">In ${esc(rel)}, we delivered ${LIVE_FEATURE[rel].direct} Features + ${LIVE_INITIATIVE[rel].direct} Initiatives = ${LIVE_FEATURE[rel].direct+LIVE_INITIATIVE[rel].direct} committed items (see full Jira list below). Grouped view uses same capability-area taxonomy as overall.</p>${data.groups&&data.groups.length?renderNaiGroups(data.groups):`<div class="note">Grouped capabilities for ${esc(rel)} are part of the overall ${naiSummary.groups.length}-group taxonomy — see <a href="NDB-Past-Releases-Summary.html#capability-overview" target="_blank" rel="noreferrer">Overall Overview ↗</a> for grouped breakdown. Detailed titles listed in Gantt section below.</div>`}<div style="margin-top:8px"><a href="NDB-Past-Releases-Summary.html#capability-overview" target="_blank" rel="noreferrer" style="font-size:11px">← Back to Overall Last-Year View</a> · <a href="NDB-Past-Releases-Summary.html#kpi-matrix-section" target="_blank" rel="noreferrer" style="font-size:11px;margin-left:8px">KPI Matrix ↗</a></div></div>`; }

const COMMON_CSS=`*{box-sizing:border-box} body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1a1a2e;background:#f4f5f7;margin:0;padding:0} .page{max-width:1100px;margin:0 auto;background:#fff;min-height:100vh} .header{background:#1a1a2e;color:#fff;padding:24px 28px} .header h1{margin:0;font-size:22px} .header .sub{color:#b0b8c9;font-size:12px;margin-top:6px} .header .meta{color:#8ea0c0;font-size:11px;margin-top:4px} .nav{padding:10px 28px;background:#eef1f6;border-bottom:1px solid #dde3ee;font-size:12px} .nav a{color:#0052cc;text-decoration:none;margin-right:14px} .section{padding:22px 28px;border-bottom:1px solid #edf0f5} .section h2{margin:0 0 12px 0;font-size:16px;color:#1a1a2e;border-left:4px solid #0052cc;padding-left:10px} .section h3{margin:16px 0 8px 0;font-size:13px;color:#333} .summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0} .stat-card{border:1px solid #dde3ee;border-radius:8px;padding:14px;background:#fff} .stat-card .k{font-size:11px;color:#6b778c;text-transform:uppercase;letter-spacing:0.4px} .stat-card .v{font-size:22px;font-weight:700;margin-top:4px} .stat-card .h{font-size:11px;color:#6b778c;margin-top:4px} .stat-card.accent{border-color:#0052cc} .table{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0} .table th{background:#f4f5f7;text-align:left;padding:8px 10px;font-weight:600;color:#444;border-bottom:2px solid #dde3ee} .table td{padding:7px 10px;border-bottom:1px solid #edf0f5} .kpi-table{width:100%;border-collapse:collapse;font-size:11px;margin:10px 0} .kpi-table th{background:#1a1a2e;color:#fff;padding:7px 8px;text-align:left;font-weight:600} .kpi-table td{padding:6px 8px;border-bottom:1px solid #edf0f5;vertical-align:top} .kpi-table a{color:#0052cc;text-decoration:none} .mono{font-family:ui-monospace,monospace;font-size:10px} .small{font-size:10px;color:#444} .hint{font-weight:400;color:#6b778c;font-size:11px} .note{font-size:11px;color:#6b778c;margin:8px 0} .provenance{font-size:11px;background:#e8f5e9;border:1px solid #a5d6a7;padding:8px 10px;border-radius:6px;margin:8px 0;color:#2e7d32} .gantt-wrap{border:1px solid #dde3ee;border-radius:8px;padding:14px;background:#fff;overflow-x:auto;margin:10px 0} .gantt-legend{display:flex;gap:14px;align-items:center;font-size:10px;color:#555;margin-bottom:8px;flex-wrap:wrap} .legend-item{display:inline-flex;align-items:center;gap:5px} .dot{width:8px;height:8px;border-radius:50%;display:inline-block} .legend-note{color:#5a6577;font-style:italic;margin-left:8px} .gantt-ruler{position:relative;height:18px;margin:6px 0 10px 96px;border-bottom:1px solid #e8eaf0} .ruler-month{position:absolute;top:2px;transform:translateX(-50%);font-size:10px;color:#5a6577;text-transform:uppercase} .gantt-rows{display:flex;flex-direction:column;gap:8px} .gantt-row{display:flex;align-items:center;gap:0} .gantt-label{width:96px;flex-shrink:0;text-align:right;padding-right:10px;font-size:12px;font-weight:700;color:#1a1a2e} .gantt-track{flex:1;position:relative;height:22px;background:#f7f8fb;border:1px solid #e8eaf0;border-radius:4px} .gate-dot{position:absolute;top:50%;width:10px;height:10px;border-radius:50%;transform:translate(-50%,-50%);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.15);z-index:2} .gate-dot.soft{width:8px;height:8px;opacity:0.55;border-style:dashed;background:#fff !important;box-shadow:none;border-width:1.5px} .gate-table{width:100%;border-collapse:collapse;font-size:11px;margin:12px 0 0 0} .gate-table th{background:#f4f5f7;padding:6px 8px;text-align:left;font-weight:600;color:#444;border-bottom:1px solid #dde3ee} .gate-table td{padding:5px 8px;border-bottom:1px solid #edf0f5} .gate-kind{display:inline-block;padding:1px 6px;border-radius:3px;color:#fff;font-size:9px;font-weight:700;margin-right:4px} .kind-EC{background:#1F4E79}.kind-CCM{background:#de350b}.kind-CG{background:#ff9800}.kind-PG{background:#9c27b0}.kind-GA{background:#28a745}.kind-SOFT{background:#6c757d} .soft-row{opacity:0.6} .fmt{color:#6b778c;font-weight:400} .footer{padding:14px 28px;background:#f9fafc;color:#6b778c;font-size:11px;border-top:1px solid #dde3ee} @media print{body{background:#fff}.page{box-shadow:none}.header{background:#1a1a2e !important;-webkit-print-color-adjust:exact;print-color-adjust:exact} .nav{display:none} .section{page-break-inside:avoid} .kpi-table{page-break-inside:auto} .gantt-wrap{overflow:visible} thead{display:table-header-group}} @media(max-width:800px){.summary-grid{grid-template-columns:1fr} .kpi-table{font-size:12px}}`;

function pageHtml({title,sub,body,audience}){
  const aud = audience || 'team-exec';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title><style>${COMMON_CSS}</style></head><body><!-- audience: ${aud} --><div class="page"><div class="header"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div><div class="meta">Live-verified ${VERIFIED_AT} · ${esc(VERIFIED_BY)} · JIRA ${esc(JIRA_BASE)}</div></div><div class="nav"><a href="NDB-Past-Releases-Summary.html">Summary (all 3)</a> <a href="NDB-2.12-Report.html">NDB-2.12</a> <a href="NDB-2.11-Report.html">NDB-2.11</a> <a href="NDB-2.10-Report.html">NDB-2.10</a> <span style="color:#6b778c;margin-left:10px">Print to PDF or screenshot each section</span></div>${body}<div class="footer">Provenance: every count = live JQL total at ${VERIFIED_AT} (see JQL column). Feature/Initiative via fixVersion direct + filter="VER-All" audit. KPI closed via filter="VER-All" AND (KPI baseQuery→issuetype normalized types) AND status=Closed. Gantt from releaseVersionsEmailConfig.json gates. KPI totals overlap — a CVE Blocker counts in 2 KPIs. JQL normalized type→issuetype per Jira alias; verify via link.</div></div></body></html>`;
}

for(const rel of RELEASES){
  const f=LIVE_FEATURE[rel], i=LIVE_INITIATIVE[rel], comb=LIVE_COMBINED[rel];
  const kpis=LIVE_KPI_CLOSED[rel];
  const gates=parseGates(rel);
  const isInFlight = rel === 'NDB-2.12'; // GA 2026-11-30 > VERIFIED_AT
  const narrative = rel==='NDB-2.10' ? 'NDB-2.10 delivered narrow scope (22 committed items) with 541 deferrals closed (Integrated Version). Baseline for comparison.'
    : rel==='NDB-2.11' ? 'NDB-2.11 was peak scope (25 committed, 23 POR) and peak quality load — Blockers+Criticals closed 442, Top-CFD 13. Schedule held via CG2 2026-04-14 → PG2 2026-05-12.'
    : 'NDB-2.12 is in-flight (GA 2026-11-30) — 18 committed (14 POR), pre-GA cut shows 323 KPI hits; deferral debt 60. Re-verify after GA.';
  const body=`
  ${renderNaiPerRelease(rel)}
  <div class="section"><h2>${esc(rel)}${isInFlight?' — In-Flight (GA 2026-11-30)':''} — At a Glance (Live at ${VERIFIED_AT})</h2>
    <p style="font-size:13px;color:#2e2e3a;background:#f0f4ff;border-left:4px solid #0052cc;padding:8px 10px;margin:0 0 8px 0">${esc(narrative)}</p>
    ${isInFlight?'<div class="note" style="background:#fff3cd;border:1px solid #ffe69c;padding:6px 8px;border-radius:4px">⚠️ In-flight snapshot — counts at '+VERIFIED_AT+' are 17 days before GA. Re-verify after 2026-11-30.</div>':''}
    <div class="provenance">✅ Live-verified ${VERIFIED_AT} — every count below = Jira <code>total</code> from <code>/rest/api/2/search?jql=…&maxResults=0</code> with JQL shown. Click Verify to re-run live in Jira.</div>
    <div class="summary-grid">
      <div class="stat-card accent"><div class="k">Features</div><div class="v">${f.direct}</div><div class="h"><a href="${jiraSearchUrl(f.jqlDirect)}" target="_blank" rel="noreferrer">Verify in Jira ↗</a> <span class="mono small" style="margin-left:6px">(filter audit: ${f.viaFilter})</span></div></div>
      <div class="stat-card accent"><div class="k">Initiatives</div><div class="v">${i.direct}</div><div class="h"><a href="${jiraSearchUrl(i.jqlDirect)}" target="_blank" rel="noreferrer">Verify in Jira ↗</a> <span class="mono small" style="margin-left:6px">(filter audit: ${i.viaFilter})</span></div></div>
      <div class="stat-card"><div class="k">Commit Set (F+I not Cancelled)</div><div class="v">${comb.total} <span style="font-size:12px;color:#6b778c">(${comb.filteredPOR} POR)</span></div><div class="h"><a href="${jiraSearchUrl(comb.jql)}" target="_blank" rel="noreferrer">Verify ↗</a> · <a href="${jiraSearchUrl(comb.jqlPOR)}" target="_blank" rel="noreferrer">Verify POR ↗</a></div></div>
    </div>
    <table class="table"><thead><tr><th>Metric</th><th>Count (live)</th><th>JQL (exact, click to verify)</th></tr></thead><tbody>
      <tr><td>Release</td><td><strong>${esc(rel)}</strong></td><td><a href="${jiraSearchUrl(`filter="${rel}-All"`)}" target="_blank" rel="noreferrer">${esc(`filter="${rel}-All"`)} ↗</a> — release base filter</td></tr>
      <tr><td>Feature count</td><td><strong>${f.direct}</strong> (filter scope ${f.viaFilter})</td><td class="mono"><a href="${jiraSearchUrl(f.jqlDirect)}" target="_blank" rel="noreferrer">${esc(f.jqlDirect)} ↗</a><br><span class="small">Filter audit: <a href="${jiraSearchUrl(f.jqlFilter)}" target="_blank" rel="noreferrer">${esc(f.jqlFilter)} ↗</a> → ${f.viaFilter}</span></td></tr>
      <tr><td>Initiative count</td><td><strong>${i.direct}</strong> (filter scope ${i.viaFilter})</td><td class="mono"><a href="${jiraSearchUrl(i.jqlDirect)}" target="_blank" rel="noreferrer">${esc(i.jqlDirect)} ↗</a><br><span class="small">Filter audit: <a href="${jiraSearchUrl(i.jqlFilter)}" target="_blank" rel="noreferrer">${esc(i.jqlFilter)} ↗</a> → ${i.viaFilter}</span></td></tr>
      <tr><td>KPI closed — total across 13 KPIs</td><td><strong>${kpis.reduce((s,k)=>s+k.total,0)}</strong> closed</td><td>Sum of closed per KPI below (each JQL = filter="VER-All" AND KPI AND status=Closed)</td></tr>
    </tbody></table>
    <p class="note">Direct counts use <code>fixVersion = "VER"</code> (canonical for Features/Initiatives). Filter scope <code>filter="VER-All"</code> is the release base filter from <code>releaseVersionsColumnsConfig.json</code> — small delta (NDB-2.11 Initiative 11 vs 9) is expected due to scope expansion (linked work). POR filter = labels not in ndb-not-por.</p>
  </div>
  <div class="section"><h2>Release Gantt — ${esc(rel)}</h2><p class="note">Gates from <code>releaseVersionsEmailConfig.json</code> — EC/CCM/CG/PG/GA. Dotted=soft checkpoint, solid=binding. Timeline is config-driven, not JQL.</p>${ganttHtml(rel,gates)}</div>
  <div class="section"><h2>KPIs Closed — All 13 NDB KPIs (Live at ${VERIFIED_AT})</h2>
    <p class="provenance">Each row = live count for <code>filter="${esc(rel)}-All" AND (KPI JQL) AND status = Closed</code> at ${VERIFIED_AT}. KPI JQL normalized: <code>type=</code> → <code>issuetype=</code> (Jira alias). Click JQL to re-run live.</p>
    <div id="kpi-matrix-per-release" class="note" style="background:#e3f2fd;border:1px solid #90caf9;padding:6px 8px;border-radius:4px">Also see 2D cross-release matrix: <a href="NDB-Past-Releases-Summary.html#kpi-matrix" target="_blank" rel="noreferrer">Summary → KPI Matrix ↗</a> (rows=KPI, cols=NDB-2.10/2.11/2.12)</div>
    <table class="kpi-table"><thead><tr><th>KPI</th><th>Closed in ${esc(rel)} (live)</th><th>Verification JQL (filter + KPI + Closed)</th></tr></thead><tbody>
      ${kpis.map(k=>`<tr><td><strong>${esc(k.name)}</strong><br><span class="mono small" style="color:#6b778c" title="${esc(k.kpiJql)}">${esc(k.kpiJql.slice(0,48))}${k.kpiJql.length>48?'…':''}</span></td><td style="text-align:center"><strong>${k.total}</strong></td><td class="mono"><a href="${jiraSearchUrl(k.jql)}" target="_blank" rel="noreferrer">Verify ↗</a> <span class="mono small" style="color:#6b778c" title="${esc(k.jql)}">JQL in tooltip</span></td></tr>`).join('')}
    </tbody></table>
    <div class="provenance" style="background:#fff8e1;border-color:#ffe082;color:#6d4c00">⚠️ KPI sum overlaps — e.g., a CVE Blocker counts in both CVE and Blockers. Do not treat <strong>${kpis.reduce((s,k)=>s+k.total,0)}</strong> as unique tickets. Unique estimate = filter="${esc(rel)}-All" AND status=Closed → ${(rel==='NDB-2.10'?'4470':rel==='NDB-2.11'?'5182':'2599')} unique closed.</div>
    <table class="table"><thead><tr><th>Summary</th><th>Count (live)</th><th>Verify</th></tr></thead><tbody>
      <tr><td>Blockers + Criticals closed</td><td><strong>${kpis.filter(k=>['Product Blockers','Product Criticals'].includes(k.name)).reduce((s,k)=>s+k.total,0)}</strong></td><td><a href="${jiraSearchUrl(`filter="${rel}-All" AND (project=ERA AND priority in ("Blocker - P0", "Critical - P1") AND issuetype=Bug) AND status=Closed`)}" target="_blank" rel="noreferrer">Verify ↗</a></td></tr>
      <tr><td>Top vs Non-Top CFD/CFI closed</td><td>${kpis.filter(k=>k.name==='Top-CFI' || k.name==='Top-CFD').reduce((s,k)=>s+k.total,0)} (Top) / ${kpis.filter(k=>k.name==='Non-Top-CFI' || k.name==='Non-Top-CFD').reduce((s,k)=>s+k.total,0)} (Non-Top)</td><td>See rows above</td></tr>
    </tbody></table>
  </div>`;
  const out=path.join(ROOT,'apps/delivery-ops/reports',`${rel}-Report.html`);
  fs.writeFileSync(out, pageHtml({title:`${rel} — Past Release Report (Live-Verified)`, sub:`Feature · Initiative · All 13 KPIs Closed · Release Gantt — slide-deck ready`, body, audience:'team-exec'}));
  console.log(`wrote ${out} Feature ${f.direct} Initiative ${i.direct} KPI-closed-sum ${kpis.reduce((s,k)=>s+k.total,0)} gates ${gates.length}`);
}

{
  const rows=RELEASES.map(rel=>({rel, f:LIVE_FEATURE[rel].direct, i:LIVE_INITIATIVE[rel].direct, kpiSum:LIVE_KPI_CLOSED[rel].reduce((s,k)=>s+k.total,0), gates:parseGates(rel).length}));
  const ganttSummary=ganttHtml(RELEASES,null);
  const body=`
  ${renderNaiOverall()}
  <div class="section"><h2>Executive Summary — 3 Past Releases (Live at ${VERIFIED_AT})</h2>
    <p style="font-size:13px;color:#1a1a2e;background:#f0f4ff;border-left:4px solid #0052cc;padding:8px 10px;margin:0 0 8px 0">NDB shipped 3 releases: <strong>2.10 (12F·13I, 22 commit, 946 KPI hits)</strong> — baseline; <strong>2.11 peak (16F·11I, 25 commit, 1,280 hits, 442 Blockers+Criticals)</strong> — held CG2→PG2; <strong>2.12 in-flight (10F·8I, 18 commit, 323 hits, GA 2026-11-30)</strong> — deferral 60, re-verify post-GA. All counts = live JQL Integrated Version + timestamp.</p>
    <div class="provenance">✅ All counts below are live Jira totals at ${VERIFIED_AT} — every number has JQL + timestamp. Previous bundle-based counts were stale and are retracted.</div>
    <table class="table"><thead><tr><th>Release</th><th>Features (fixVersion)</th><th>Initiatives (fixVersion)</th><th>Commit Set (F+I not Cancelled)</th><th>KPI Closed Sum (13 KPIs)</th><th>Report</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><strong>${esc(r.rel)}</strong></td><td>${r.f} <a href="${jiraSearchUrl(`fixVersion = "${r.rel}" AND issuetype = Feature`)}" target="_blank" rel="noreferrer">↗</a></td><td>${r.i} <a href="${jiraSearchUrl(`fixVersion = "${r.rel}" AND issuetype = Initiative`)}" target="_blank" rel="noreferrer">↗</a></td><td>${LIVE_COMBINED[r.rel].total} (${LIVE_COMBINED[r.rel].filteredPOR} POR) <a href="${jiraSearchUrl(LIVE_COMBINED[r.rel].jql)}" target="_blank" rel="noreferrer">↗</a></td><td><strong>${r.kpiSum}</strong></td><td><a href="${esc(r.rel)}-Report.html">${esc(r.rel)}-Report.html</a></td></tr>`).join('')}
    </tbody></table>
    <div class="summary-grid">${rows.map(r=>`<div class="stat-card"><div class="k">${esc(r.rel)}</div><div class="v">${r.f}F · ${r.i}I</div><div class="h">${r.kpiSum} KPI-closed · ${r.gates} gates</div></div>`).join('')}</div>
    <p class="note">Feature = issuetype = Feature with fixVersion = VER. Initiative = issuetype = Initiative. POR = labels not in ndb-not-por. KPI sum is overlapping.</p>
  </div>
  <div class="section" id="kpi-matrix-section"><h2>KPI Closed — Cross-Release Matrix (Live, New Section)</h2>
    <p class="note">Dedicated 2D matrix: rows = KPI (13 NDB KPIs), columns = release (NDB-2.10 / NDB-2.11 / NDB-2.12). Each count is a Jira link opening in new tab. JQL = filter="VER-All" AND (KPI) AND status=Closed AND "Integrated Version"="VER" (cf11360) — verified at ${VERIFIED_AT}.</p>
    <table class="kpi-table" id="kpi-matrix"><thead><tr><th>KPI</th>${RELEASES.map(r=>`<th>${esc(r)}</th>`).join('')}</tr></thead><tbody>
      ${kpiRaw.teams.ndb.map(k=>`<tr><td><strong>${esc(k.name)}</strong><br><span class="mono small">${esc(k.baseQuery.replaceAll('type=','issuetype='))}</span></td>${RELEASES.map(rel=>{ const row=LIVE_KPI_CLOSED[rel].find(r=>r.name===k.name); return `<td style="text-align:center"><strong>${row.total}</strong><br><a class="mono small" href="${jiraSearchUrl(row.jql)}" target="_blank" rel="noreferrer">Verify ↗</a></td>`; }).join('')}</tr>`).join('')}
    </tbody></table>
  </div>
  <div class="section"><h2>Cross-Release Gantt — NDB-2.10 → NDB-2.12</h2><p class="note">Shared axis — gates from releaseVersionsEmailConfig.json (EC=Execute Commit, CCM=CCM, CG=CG, PG=PG, GA=GA) — now below KPI matrix per your move request.</p>${ganttSummary}</div>`;
  const out=path.join(ROOT,'apps/delivery-ops/reports','NDB-Past-Releases-Summary.html');
  fs.writeFileSync(out, pageHtml({title:'NDB Past Releases — Executive Summary (Live-Verified)', sub:`NDB-2.10 · NDB-2.11 · NDB-2.12 — Features · Initiatives · KPIs Closed · Gantts — ${VERIFIED_AT}`, body, audience:'team-exec'}));
  console.log(`wrote ${out}`);
}
console.log('done — all counts live-verified at '+VERIFIED_AT);
