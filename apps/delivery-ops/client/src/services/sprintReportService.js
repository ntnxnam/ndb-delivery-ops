import { authenticatedGet, authenticatedPost } from '../shared/services/apiService';
import { formatters } from '../shared/utils/formatters';

export function countWorkingDays(start, end) {
  let count = 0;
  const cur = new Date(start);
  const endDate = new Date(end);
  while (cur <= endDate) { const d = cur.getDay(); if (d !== 0 && d !== 6) count++; cur.setDate(cur.getDate() + 1); }
  return count;
}

export function getNutanixQuarterRange(fiscalYear, quarter) {
  const y = Number(fiscalYear);
  if (Number.isNaN(y) || !quarter) return null;
  switch (quarter) {
    case 'Q1': return { startDate: `${y}-08-01`, endDate: `${y}-10-31` };
    case 'Q2': return { startDate: `${y}-11-01`, endDate: `${y + 1}-01-31` };
    case 'Q3': return { startDate: `${y + 1}-02-01`, endDate: `${y + 1}-04-30` };
    case 'Q4': return { startDate: `${y + 1}-05-01`, endDate: `${y + 1}-07-31` };
    default: return null;
  }
}

export async function fetchSprints(teamId, state, opts) {
  const body = { teamId };
  if (state) body.state = state;
  const res = await authenticatedPost('/api/jira/sprints', body, opts);
  if (res.data?.success && Array.isArray(res.data.sprints)) return res.data.sprints;
  return [];
}

export async function fetchSprintReport(teamId, sprintId, opts) {
  const res = await authenticatedPost('/api/jira/sprint-report', { teamId, sprintId: Number(sprintId) }, opts);
  if (res.data?.success) return res.data;
  throw new Error(res.data?.error || 'Failed to load report');
}

export async function fetchSprintTrends(teamId, sprintIds, opts) {
  const res = await authenticatedPost('/api/jira/sprint-report-trends', { teamId, sprintIds: sprintIds }, opts);
  if (res.data?.success) return res.data;
  throw new Error(res.data?.error || 'Failed to load trends');
}

export async function fetchProjectComponents(teamId, opts) {
  const res = await authenticatedGet('/api/jira/project-components', { teamId }, opts);
  if (res.data?.success && Array.isArray(res.data.components)) return res.data.components;
  return [];
}

export async function fetchPastReport(teamId, startDate, endDate, componentNames, opts) {
  const payload = { teamId, startDate, endDate };
  if (componentNames?.length) payload.componentNames = componentNames;
  const res = await authenticatedPost('/api/jira/sprint-report-by-range', payload, opts);
  if (res.data?.success) return res.data;
  throw new Error(res.data?.error || 'Failed to load past report');
}

export async function fetchStoryPointFields(search, opts) {
  const res = await authenticatedGet('/api/jira/fields', { search }, opts);
  if (res.data?.success) return res.data.fields || [];
  return [];
}

function escapeHtml(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function getSprintReportCsvText(result) {
  if (!result) return '';
  const escape = (v) => { const s=String(v??''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
  const issues = result.issues || [];
  const byStatus = {}; const byStatusPts = {}; let totalPts=0;
  issues.forEach((iss)=>{ const s=iss.status||'Unknown'; byStatus[s]=(byStatus[s]||0)+1; const pts=typeof iss.storyPoints==='number'&&!Number.isNaN(iss.storyPoints)?iss.storyPoints:0; byStatusPts[s]=(byStatusPts[s]||0)+pts; totalPts+=pts; });
  const m=result.metrics||{}; const lines=[];
  lines.push('Sprint Report,'+(result.sprint?.name||result.sprint?.id||'')+',');
  lines.push('Scope change,Count'); lines.push('Added after sprint started,'+(m.addedAfterStart??0)); lines.push('Removed from sprint,'+(m.removedFromSprint??0)); lines.push('');
  lines.push('Work in sprint (by status),Count,Story Points');
  Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).forEach(([status,count])=>lines.push(escape(status)+','+count+','+(byStatusPts[status]||0)));
  lines.push('Total in sprint,'+issues.length+','+totalPts); lines.push('');
  lines.push('Key,Summary,Type,Priority,Assignee,Status,Resolution,Story Points,Classification');
  issues.forEach((iss)=>lines.push([escape(iss.key),escape(iss.summary),escape(iss.issuetype),escape(iss.priority),escape(iss.assignee),escape(iss.status),escape(iss.resolution??''),iss.storyPoints??'',escape(iss.classification)].join(',')));
  return lines.join('\r\n');
}

export function getPastReportCsvText(result) {
  if (!result?.aggregatedIssues) return '';
  const escape=(v)=>{ const s=String(v??''); return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
  const header=['Sprint','Key','Summary','Type','Priority','Assignee','Status','Resolution','Story Points','Classification'];
  const lines=[header.join(',')];
  result.aggregatedIssues.forEach((iss)=>lines.push([escape(iss.sprintName??''),escape(iss.key),escape(iss.summary),escape(iss.issuetype),escape(iss.priority),escape(iss.assignee),escape(iss.status),escape(iss.resolution??''),iss.storyPoints??'',escape(iss.classification)].join(',')));
  return lines.join('\r\n');
}

export function getSprintReportHtml(result) {
  if (!result) return '';
  const m=result.metrics||{}; const sprint=result.sprint||{}; const start=sprint.startDate?new Date(sprint.startDate):null; const end=sprint.endDate?new Date(sprint.endDate):null; const now=new Date();
  let timeElapsedPct=0, daysLeft=0, totalWorkingDays=1, elapsedWorkingDays=0, closedPct=m.completionRate??0, nearCompPct=0, closedPtsPct=null, nearCompPtsPct=null, opinionLabel='On track', opinionColor='#28a745';
  const issuesForProgress=result.issues||[]; const totalIssues=issuesForProgress.length;
  if(totalIssues>0){ const closed=issuesForProgress.filter(i=>i.classification==='completedInSprint'); const nearComp=issuesForProgress.filter(i=>i.classification==='pendingQA'); closedPct=Math.round(closed.length/totalIssues*100); nearCompPct=Math.round(nearComp.length/totalIssues*100); const totalPts=issuesForProgress.reduce((s,i)=>s+(i.storyPoints||0),0); if(totalPts>0){ const closedPts=closed.reduce((s,i)=>s+(i.storyPoints||0),0); const nearCompPts=nearComp.reduce((s,i)=>s+(i.storyPoints||0),0); closedPtsPct=Math.round(closedPts/totalPts*100); nearCompPtsPct=Math.round(nearCompPts/totalPts*100); } }
  if(start&&end){ totalWorkingDays=Math.max(1,countWorkingDays(start,end)); elapsedWorkingDays=Math.min(totalWorkingDays,countWorkingDays(start,now)); daysLeft=Math.max(0,totalWorkingDays-elapsedWorkingDays); timeElapsedPct=Math.round(elapsedWorkingDays/totalWorkingDays*100); const gap=timeElapsedPct-closedPct; if(gap<=0){opinionLabel='On track';opinionColor='#28a745';} else if(gap<=15){opinionLabel='Slightly behind';opinionColor='#e6a817';} else if(gap<=30){opinionLabel='At risk';opinionColor='#fd7e14';} else {opinionLabel='Critical';opinionColor='#dc3545';} }
  const scopePct=m.scopeCreepRate??0; const isStale=sprint.state==='active'&&sprint.endDate&&new Date(sprint.endDate)<now; const sprintName=escapeHtml(sprint.name||`Sprint ${sprint.id||''}`); const startStr=start?(formatters.date(start)||'') : ''; const endStr=end?(formatters.date(end)||''):'';
  let html='<div style="font-family: Segoe UI, sans-serif; font-size: 14px; max-width: 720px;">';
  html+=`<h3 style="margin:0 0 4px 0;font-size:18px;">${sprintName}</h3>`;
  if(startStr&&endStr) html+=`<p style="margin:0 0 8px 0;color:#6c757d;font-size:13px;">${startStr} – ${endStr}</p>`;
  if(sprint.state) html+=`<span style="font-size:11px;padding:2px 6px;border-radius:4px;background:${sprint.state==='active'?'#d4edda':'#e2e3e5'};color:#155724;">${escapeHtml(sprint.state.toUpperCase())}</span>`;
  if(isStale) html+='<div style="margin:12px 0;padding:10px 12px;border-radius:8px;background:#fff3cd;border:1px solid #ffc107;color:#856404;font-size:13px;">Stale sprint — End date has passed but this sprint is still active in Jira. Consider closing it.</div>';
  if(start&&end){ html+='<div style="margin:16px 0;padding:12px;border:1px solid #dee2e6;border-radius:8px;background:#f8f9fa;">'; html+='<div style="font-weight:600;margin-bottom:8px;font-size:13px;">Sprint Progress</div>'; html+=`<div style="margin-bottom:6px;"><div style="font-size:12px;color:#495057;">Time elapsed — Day ${elapsedWorkingDays} of ${totalWorkingDays} (${daysLeft} working days left) ${timeElapsedPct}%</div><div style="background:#dee2e6;border-radius:4px;height:10px;"><div style="width:${timeElapsedPct}%;background:#6c757d;height:10px;border-radius:4px;"></div></div></div>`; html+=`<div style="margin-bottom:6px;"><div style="font-size:12px;color:#495057;">Completion (by issue count) — Closed ${closedPct}% · Near completion ${nearCompPct}%</div><div style="background:#dee2e6;border-radius:4px;height:10px;display:flex;"><div style="width:${closedPct}%;background:#28a745;height:10px;"></div><div style="width:${nearCompPct}%;background:#e6a817;height:10px;"></div></div></div>`; if(closedPtsPct!=null){ html+=`<div style="margin-bottom:8px;"><div style="font-size:12px;color:#495057;">Completion (story points) — Closed ${closedPtsPct}% · Near completion ${nearCompPtsPct}%</div><div style="background:#dee2e6;border-radius:4px;height:10px;display:flex;"><div style="width:${closedPtsPct}%;background:#28a745;height:10px;"></div><div style="width:${nearCompPtsPct}%;background:#e6a817;height:10px;"></div></div></div>`; } html+=`<div style="font-size:13px;font-weight:600;color:${opinionColor};">${escapeHtml(opinionLabel)}</div></div>`; }
  html+=`<p style="margin:12px 0;font-size:13px;color:#495057;"><strong>${timeElapsedPct}%</strong> Time elapsed (working days) · <strong>${closedPct}%</strong> Closed · <strong style="color:${scopePct>20?'#dc3545':'inherit'}">${scopePct}%</strong> Scope change</p>`;
  const issuesForHtml=result.issues||[]; const byStatusHtml={}; const byStatusHtmlPts={}; let totalHtmlPts=0; issuesForHtml.forEach((iss)=>{ const s=iss.status||'Unknown'; byStatusHtml[s]=(byStatusHtml[s]||0)+1; const pts=typeof iss.storyPoints==='number'&&!Number.isNaN(iss.storyPoints)?iss.storyPoints:0; byStatusHtmlPts[s]=(byStatusHtmlPts[s]||0)+pts; totalHtmlPts+=pts; });
  html+='<div style="margin-bottom:12px;font-weight:600;font-size:13px;">Scope change</div><table style="border-collapse:collapse;margin-bottom:16px;" cellpadding="6" cellspacing="0"><tbody>'; html+=`<tr><td style="border:1px solid #dee2e6;font-weight:600;">Added after start</td><td style="border:1px solid #dee2e6;">${Number(m.addedAfterStart??0)}</td></tr>`; html+=`<tr><td style="border:1px solid #dee2e6;font-weight:600;">Removed from sprint</td><td style="border:1px solid #dee2e6;">${Number(m.removedFromSprint??0)}</td></tr></tbody></table>`;
  html+='<div style="margin-bottom:12px;font-weight:600;font-size:13px;">Work in sprint (by status)</div><table style="border-collapse:collapse;margin-bottom:16px;" cellpadding="6" cellspacing="0"><thead><tr style="background:#f8f9fa;"><th style="border:1px solid #dee2e6;text-align:left;">Status</th><th style="border:1px solid #dee2e6;text-align:right;">Count</th><th style="border:1px solid #dee2e6;text-align:right;">Story Points</th></tr></thead><tbody>';
  Object.entries(byStatusHtml).sort((a,b)=>b[1]-a[1]).forEach(([label,val])=>{ html+=`<tr><td style="border:1px solid #dee2e6;font-weight:600;">${escapeHtml(label)}</td><td style="border:1px solid #dee2e6;text-align:right;">${Number(val)}</td><td style="border:1px solid #dee2e6;text-align:right;">${byStatusHtmlPts[label]||0}</td></tr>`; });
  html+=`<tr style="background:#f8f9fa;"><td style="border:1px solid #dee2e6;font-weight:700;">Total in sprint</td><td style="border:1px solid #dee2e6;font-weight:700;text-align:right;">${issuesForHtml.length}</td><td style="border:1px solid #dee2e6;font-weight:700;text-align:right;">${totalHtmlPts}</td></tr></tbody></table>`;
  html+='<table style="border-collapse:collapse;width:100%;font-size:13px;" cellpadding="6" cellspacing="0"><thead><tr style="background:#f8f9fa;">'; ['Key','Summary','Type','Priority','Assignee','Status','Resolution','Story Points','Bucket'].forEach(h=>{ const align=h==='Story Points'?'right':'left'; html+=`<th style="border:1px solid #dee2e6;text-align:${align};">${escapeHtml(h)}</th>`; }); html+='</tr></thead><tbody>';
  issuesForHtml.forEach((iss)=>{ html+='<tr>'; [iss.key,iss.summary,iss.issuetype,iss.priority,iss.assignee,iss.status,iss.resolution??'',iss.storyPoints??'',iss.classification].forEach((cell,i)=>{ const align=i===7?'right':'left'; html+=`<td style="border:1px solid #eee;text-align:${align};">${escapeHtml(String(cell??''))}</td>`; }); html+='</tr>'; }); html+='</tbody></table></div>'; return html;
}
