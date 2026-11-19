import { authenticatedGet, authenticatedPost } from '../shared/services/apiService';

export async function fetchReleaseContext(version, opts = {}) {
  const resp = await authenticatedGet('/api/jira/executive-summary-unified', { version }, opts);
  return resp?.data || null;
}

export async function generateBriefing(version, opts = {}) {
  const resp = await authenticatedPost('/api/ai/release-summary', { version }, opts);
  const payload = resp.data || resp;
  return { summary: payload.summary, intelligence: payload.intelligence };
}

export async function sendReleaseVersionEmail(payload, opts = {}) {
  const resp = await authenticatedPost('/api/email/send-release-versions', payload, opts);
  return resp?.data ?? resp;
}

export function checkReleaseLevelMissingDates(ganttConfig) {
  const missing = [];
  if (!ganttConfig) return missing;
  const hasCG = Object.keys(ganttConfig).some(k => {
    if (!k.startsWith('commitGate')) return false;
    const g = ganttConfig[k];
    if (!g) return false;
    if (Array.isArray(g)) return g.length > 0 && g.some(x => x && x.date);
    return !!g.date;
  });
  const hasPG = Object.keys(ganttConfig).some(k => {
    if (!k.startsWith('promotionGate')) return false;
    const g = ganttConfig[k];
    if (!g) return false;
    if (Array.isArray(g)) return g.length > 0 && g.some(x => x && x.date);
    return !!g.date;
  });
  if (!hasCG) missing.push('CG date not provided');
  if (!hasPG) missing.push('PG date not provided');
  return missing;
}

export { normalizeDateForComparison } from '../utils/releaseVersionUtils';

export function getExtensionLabelInfo(item) {
  if (!item || !item.labels) return null;
  let labels = [];
  if (Array.isArray(item.labels)) labels = item.labels;
  else if (typeof item.labels === 'string') labels = item.labels.includes(',') ? item.labels.split(',').map(l=>l.trim()) : item.labels.split(/\s+/).map(l=>l.trim());
  const suffix = 'code-complete-extension-recieved';
  for (const label of labels) {
    if (!label) continue;
    if (String(label).toLowerCase().trim().endsWith(suffix)) return { hasExtension: true };
  }
  return null;
}

export function getExtensionColor() {
  return { backgroundColor: '#ffcc80', borderColor: '#ff9800' };
}

export function extractExecutiveSummaryText(statusUpdate) {
  if (!statusUpdate || typeof statusUpdate !== 'string') return null;
  let text = statusUpdate.replace(/\{color:[^}]+\}(.*?)\{color\}/g,'$1').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\[([^\]]+)\|([^\]]+)\]/g,'').replace(/\[([^\]]+)\]/g,'').trim();
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const datePat = /\d{1,2}\/\w{3}\/\d{4}|\d{1,2}-\w{3}|\d{4}-\d{2}-\d{2}/i;
  const statusPat = /(Done|In Progress|In progress|TBD|Not Done|Not Started|Completed|Blocked|At Risk)/i;
  const msPat = /(PRD|Requirements|FS\/DS|Test Plan|Coding|Testing|QA|Milestone|Sprint|ETA)/i;
  const out=[];
  for (const line of lines) {
    if (out.length>=2) break;
    const hasDate=datePat.test(line), hasStatus=statusPat.test(line), hasMs=msPat.test(line);
    if ((hasDate||hasStatus||hasMs) && line.length>20) {
      const c=line.replace(/^h[1-6]\.\s+/i,'').replace(/^#+\s+/,'').replace(/^[-*]\s+/,'').trim();
      if (c.length>10) out.push(c);
    }
  }
  if (out.length<2) for (const line of lines){ if(out.length>=2) break; if(out.includes(line.trim())) continue; const c=line.replace(/^h[1-6]\.\s+/i,'').replace(/^#+\s+/,'').replace(/^[-*]\s+/,'').trim(); if(c.length>30 && !c.match(/^[A-Z\s]+$/)) out.push(c); }
  if (out.length<2) for (const line of lines){ if(out.length>=2) break; const c=line.replace(/^h[1-6]\.\s+/i,'').replace(/^#+\s+/,'').replace(/^[-*]\s+/,'').trim(); if(c.length>15 && !out.includes(c)) out.push(c); }
  return out.slice(0,2).map(l=>{ let c=l.replace(/\s+/g,' ').replace(/\{[^}]+\}/g,'').trim(); if(c.length>0) c=c.charAt(0).toUpperCase()+c.slice(1); if(c.length>100){ const sm=c.substring(0,100).match(/[.!?]/); if(sm && sm.index>60) return c.substring(0,sm.index+1); const wm=c.substring(0,97).match(/\s+\S*$/); if(wm && wm.index>60) return c.substring(0,wm.index)+'...'; return c.substring(0,97)+'...'; } return c; });
}

export function formatJiraWikiMarkup(text, jiraBaseUrl) {
  if (!text || typeof text !== 'string') return '';
  let formatted = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const lines = formatted.split('\n');
  const out=[];
  let stack=[];
  for (let i=0;i<lines.length;i++){
    const trimmed=lines[i].trim();
    if (/^h[1-6]\.\s+(.+)$/i.test(trimmed)) { while(stack.length) out.push(stack.pop().type==='ordered'?'</ol>':'</ul>'); const m=trimmed.match(/^h([1-6])\.\s+(.+)$/i); const lv=parseInt(m[1]); out.push(`<h${lv} style="font-size: ${24-(lv-1)*2}px; font-weight: 600; margin: 15px 0 8px 0; color: #1a1a1a;">${m[2]}</h${lv}>`); continue; }
    const olm=trimmed.match(/^(#+)\s+(.+)$/);
    if (olm){ const lvl=olm[1].length; const txt=olm[2]; while(stack.length>0 && stack[stack.length-1].level>lvl) out.push(stack.pop().type==='ordered'?'</ol>':'</ul>'); while(stack.length<lvl){ const cl=stack.length+1; out.push(`<ol style="margin: 6px 0; padding-left: ${20+(cl-1)*20}px;">`); stack.push({type:'ordered',level:cl}); } out.push(`<li style="margin: 4px 0;">${txt}</li>`); continue; }
    if (/^[-*]\s+(.+)$/.test(trimmed)){ while(stack.length>0 && stack[stack.length-1].type==='ordered'){ stack.pop(); out.push('</ol>'); } if(stack.length===0||stack[stack.length-1].type!=='unordered'){ out.push('<ul style="margin: 8px 0; padding-left: 25px; list-style-type: disc;">'); stack.push({type:'unordered',level:1}); } out.push(`<li style="margin: 4px 0;">${trimmed.replace(/^[-*]\s+/,'')}</li>`); continue; }
    if (trimmed===''){ while(stack.length) out.push(stack.pop().type==='ordered'?'</ol>':'</ul>'); out.push('<br>'); continue; }
    if (stack.length>0 && !trimmed.startsWith(' ') && !trimmed.startsWith('\t')) while(stack.length) out.push(stack.pop().type==='ordered'?'</ol>':'</ul>');
    out.push(`<div style="margin-bottom: 6px;">${trimmed}</div>`);
  }
  while(stack.length) out.push(stack.pop().type==='ordered'?'</ol>':'</ul>');
  formatted=out.join('');
  formatted=formatted.replace(/\{color:([^}]+)\}(.*?)\{color\}/g,(m,c,t)=>{ const map={'deep red':'#8B0000',red:'#de350b',green:'#00875a',yellow:'#ff8b00',blue:'#0052cc',orange:'#ff8b00'}; const cv=c.trim(); let fc=map[cv.toLowerCase()]||(cv.startsWith('#')?cv:'#'+cv); return `<span style="color: ${fc};">${t}</span>`; });
  formatted=formatted.replace(/\{\*\}(.*?)\{\*\}/gs,'<strong>$1</strong>').replace(/\{-\}(.*?)\{-\}/gs,'<del style="text-decoration: line-through; color: #999;">$1</del>').replace(/\{\+\}(.*?)\{\+\}/gs,'<u>$1</u>').replace(/\{_\}(.*?)\{_\}/gs,'<em>$1</em>');
  formatted=formatted.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/(?<!\*)\*([^*\n<]+)\*(?!\*)/g,'<strong>$1</strong>');
  formatted=formatted.replace(/(?<!\w)-([^\-\n]{2,}?)-(?!\w)/g,'<del style="text-decoration: line-through; color: #999;">$1</del>').replace(/(?<!\w)_([^_\n]+)_(?!\w)/g,'<em>$1</em>');
  formatted=formatted.replace(/\[([^\]]+)\|([^\]]+)\]/g,'<a href="$2" style="color: #0065ff; text-decoration: none;">$1</a>').replace(/\[([^\]]+)\]/g,'<a href="#" style="color: #0065ff; text-decoration: none;">$1</a>');
  const base=jiraBaseUrl||'';
  formatted=formatted.replace(/([A-Z]+-\d+)/g,`<a href="${base}/browse/$1" style="color: #0065ff; text-decoration: none;">$1</a>`);
  return formatted;
}
