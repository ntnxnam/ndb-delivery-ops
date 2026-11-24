
import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { PageLoading } from '../../shared/components/PageLoading';
import { useCfdcfiV2, TIMEFRAMES } from '../../hooks/useCfdcfiV2';
import { useTeam } from '../../contexts/TeamContext';
import { TeamRequiredGate } from '../../layout/components/TeamRequiredGate';
import { jiraHref, ticketHref, linkify } from '../Oncalls/OncallsParts';
import KpiPulseBand from '../KpiPulse/KpiPulseBand';
import './CfdCfiV2.css';

function PillBar({ timeframe, setTimeframe }) {
  return (
    <div className="cfdcfi-v2-pills" role="tablist" aria-label="Timeframe">
      {TIMEFRAMES.map((tf) => (
        <button key={tf} type="button" role="tab" aria-selected={timeframe === tf} className={`cfdcfi-v2-pill ${timeframe === tf ? 'active' : ''}`} onClick={() => setTimeframe(tf)}>{tf}</button>
      ))}
    </div>
  );
}
function ExplainHero({ label, cell, explain, jiraBase, onOpen, meta }) {
  const count = cell?.count ?? 0;
  const jiraUrl = jiraHref(jiraBase, cell?.jql);
  const showJiraHint = Boolean(jiraUrl && onOpen);
  const tone = String(label||'').toLowerCase().includes('mttr') || String(label).toLowerCase().includes('throughput') || String(label).toLowerCase().includes('aged share') ? 'neutral' : '';
  return (
    <div className={`cfdcfi-v2-hero ${tone ? 'cfdcfi-v2-hero-neutral' : ''}`} title={jiraUrl ? 'Open in JIRA' : undefined}>
      <div className="label">{label}</div>
      {onOpen ? <button type="button" className="value cfdcfi-hero-open" onClick={onOpen} aria-label={`Show ${label}: ${count}`}>{String(count)}</button> : <div className="value">{String(count)}</div>}
      {meta ? <div className="meta">{meta}</div> : null}
      {explain ? <div className="explain">{explain}</div> : null}
      {showJiraHint ? <a className="jira-link" href={jiraUrl} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a> : jiraUrl && !onOpen ? <a className="jira-link" href={jiraUrl} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a> : null}
    </div>
  );
}
function isP0(priority){ return /blocker|\bp0\b/i.test(String(priority||'')); }
function isP1(priority){ return /critical|\bp1\b/i.test(String(priority||'')); }
function deriveKeysForView(mode, dash, agedDays){
  if(!dash||!mode) return [];
  const openTickets = dash.openTickets || dash.openTicketsList || [];
  const openArr = Array.isArray(openTickets) ? openTickets : (openTickets.issues || openTickets.tickets || []);
  const closedPreview = dash.closedStacksPreview || dash.closedPreview || [];
  const gapMeta = dash.gapMeta || {};
  const closedModes = ['closedInWindow','throughput','mttr','mttrP90'];
  if(closedModes.includes(mode)) return closedPreview.slice(0,12).map(t=>t.key).filter(Boolean);
  if(gapMeta.boomerangKeys && mode==='boomerang') return (gapMeta.boomerangKeys||[]).slice(0,12);
  if(mode==='agedOpen') return openArr.filter(t=>(t.ageDays??0)>=(agedDays??14)).slice(0,12).map(t=>t.key);
  if(mode==='p0Open') return openArr.filter(t=>isP0(t.priority)).slice(0,12).map(t=>t.key);
  if(mode==='p1Open') return openArr.filter(t=>isP1(t.priority)).slice(0,12).map(t=>t.key);
  if(mode.startsWith('component:')){
    const comp=mode.slice('component:'.length);
    return openArr.filter(t=>{ const comps=t.components||t.fields?.components||(t.component?[t.component]:[]); const names=(Array.isArray(comps)?comps:[]).map(c=>typeof c==='string'?c:c.name||c.key||'').filter(Boolean); return names.includes(comp)||String(t.component||'').includes(comp); }).slice(0,12).map(t=>t.key);
  }
  if(mode.startsWith('fixVersion:')||mode.startsWith('release:')){
    const ver=mode.split(':').slice(1).join(':');
    return openArr.filter(t=>{ const fvs=t.fixVersions||t.fields?.fixVersions||t.fixVersion||[]; const arr=Array.isArray(fvs)?fvs:[fvs]; const names=arr.map(v=>typeof v==='string'?v:v.name||'').filter(Boolean); return names.includes(ver)||String(t.fixVersion||'').includes(ver); }).slice(0,12).map(t=>t.key);
  }
  if(mode.startsWith('ageBucket:')){
    const bucket=mode.slice('ageBucket:'.length); const ranges={'0-7':[0,7],'8-30':[8,30],'31-90':[31,90],'90+':[90,9999]}; const [lo,hi]=ranges[bucket]||[0,9999];
    return openArr.filter(t=>{ const ad=t.ageDays??0; return ad>=lo&&ad<=hi; }).slice(0,12).map(t=>t.key);
  }
  if(mode.startsWith('customerFound:')){
    const key=mode.slice('customerFound:'.length);
    // Client-side approximator: use labels/issuelinks where available; full truth is JQL proof
    return openArr.filter(t=>{
      const labels=Array.isArray(t.labels)?t.labels:(Array.isArray(t.fields?.labels)?t.fields.labels:[]);
      const lbl=s=>labels.some(l=>String(l).toLowerCase().includes(s.toLowerCase()));
      if(key==='oncallLinked') return (t.linked||t.issuelinks||[]).some(l=>String(l.key||l).startsWith('ONCALL')) || lbl('oncall') || String(t.summary||'').includes('ONCALL');
      if(key==='sfCases5') return lbl('sf') || String(t.summary||'').includes('SF');
      if(key==='eelLabels') return lbl('EELIST')||lbl('DevEx-Top-Issue')||lbl('Serviceability-Promoted');
      if(key==='impact') return lbl('Unavailability')||lbl('Data Loss')||lbl('Corruption');
      if(key==='nps') return lbl('NPS_Impacting');
      return false;
    }).slice(0,12).map(t=>t.key);
  }
  return openArr.slice(0,12).map(t=>t.key);
}
function ChipRow({ chips, activeChip, setActiveChip }){
  if(!chips||!chips.length) return null;
  return (
    <div className="cfdcfi-v2-chips" role="tablist" aria-label="Breakdown chips">
      <span style={{fontSize:'var(--fs-muted)',color:'var(--muted)'}}>Filter:</span>
      {chips.map(c=>{ const id=`${c.kind}:${c.value}`; const active=activeChip===id; return <button key={id} type="button" role="tab" aria-selected={active} className={`cfdcfi-v2-chip ${active?'active':''}`} onClick={()=>setActiveChip(active?null:id)} title={c.jql?`Filter by ${c.label}`:c.label}><span>{c.label}</span>{c.count!=null?<span className="count">{c.count}</span>:null}</button>; })}
      {activeChip?<button type="button" className="cfdcfi-v2-btn" onClick={()=>setActiveChip(null)}>Clear</button>:null}
    </div>
  );
}
function CfdCfiDrill({ mode, label, tickets, jiraBase, jql, cellCount, scope, gapMeta, agedDays, teamId, timeframe, aiSlice, aiSliceState, aiSliceError, aiSliceView, onClose, activeChip }){
  const closeRef=useRef(null); const isOpen=Boolean(mode); const viewLabel=label||mode||'View';
  const rows=useMemo(()=>{ if(!tickets) return []; const arr=Array.isArray(tickets)?tickets:(tickets.issues||tickets.tickets||[]); return arr; },[tickets]);
  const filteredRows=useMemo(()=>{
    if(!mode) return [];
    if(mode==='open') return rows;
    if(mode==='agedOpen') return rows.filter(t=>(t.ageDays??0)>=(agedDays??14));
    if(mode==='p0Open') return rows.filter(t=>isP0(t.priority));
    if(mode==='p1Open') return rows.filter(t=>isP1(t.priority));
    if(mode==='boomerang'){ const keys=new Set(gapMeta?.boomerangKeys||[]); if(keys.size) return rows.filter(r=>keys.has(r.key)); return rows.filter(r=>String(r.labels||'').includes('deferred')||r.isBoomerang); }
    if(mode.startsWith('component:')){ const comp=mode.slice('component:'.length); return rows.filter(t=>{ const comps=t.components||t.fields?.components||(t.component?[t.component]:[]); const names=(Array.isArray(comps)?comps:[]).map(c=>typeof c==='string'?c:c.name||c.key||'').filter(Boolean); return names.includes(comp)||String(t.component||'').includes(comp); }); }
    if(mode.startsWith('fixVersion:')||mode.startsWith('release:')){ const ver=mode.split(':').slice(1).join(':'); return rows.filter(t=>{ const fvs=t.fixVersions||t.fields?.fixVersions||t.fixVersion||[]; const arr=Array.isArray(fvs)?fvs:[fvs]; const names=arr.map(v=>typeof v==='string'?v:v.name||'').filter(Boolean); return names.includes(ver)||String(t.fixVersion||'').includes(ver); }); }
    if(mode.startsWith('ageBucket:')){ const bucket=mode.slice('ageBucket:'.length); const ranges={'0-7':[0,7],'8-30':[8,30],'31-90':[31,90],'90+':[90,9999]}; const [lo,hi]=ranges[bucket]||[0,9999]; return rows.filter(t=>{ const ad=t.ageDays??0; return ad>=lo&&ad<=hi; }); }
    if(mode.startsWith('testEscape:')||mode.startsWith('rootCause:')){ const val=mode.split(':').slice(1).join(':'); return rows.filter(t=>String(t.testEscape||t.rootCause||t.cfdcfiFields?.testEscape||t.cfdcfiFields?.rootCause||'').toLowerCase().includes(val.toLowerCase())); }
    if(mode.startsWith('customerFound:')){
      const key=mode.slice('customerFound:'.length);
      return rows.filter(t=>{
        const labels=Array.isArray(t.labels)?t.labels:(Array.isArray(t.fields?.labels)?t.fields.labels:[]);
        const lbl=s=>labels.some(l=>String(l).toLowerCase().includes(s.toLowerCase()));
        if(key==='oncallLinked') return (t.linked||[]).some(l=>String(l.key||'').startsWith('ONCALL')) || (t.techHelp||[]).length>0 || lbl('oncall');
        if(key==='eelLabels') return lbl('EELIST')||lbl('DevEx-Top-Issue')||lbl('Serviceability-Promoted');
        if(key==='nps') return lbl('NPS_Impacting');
        if(key==='impact') return lbl('Unavailability')||lbl('Data Loss')||lbl('Corruption');
        if(key==='sfCases5') return true; // SF count not in sample — show all open with JQL proof
        return true;
      });
    }
    return rows;
  },[rows,mode,agedDays,gapMeta]);
  const displayRows=useMemo(()=>{
    if(!activeChip) return filteredRows;
    const [kind,...rest]=activeChip.split(':'); const val=rest.join(':');
    if(kind==='component') return filteredRows.filter(t=>{ const comps=t.components||t.fields?.components||(t.component?[t.component]:[]); const names=(Array.isArray(comps)?comps:[]).map(c=>typeof c==='string'?c:c.name||c.key||'').filter(Boolean); return names.includes(val)||String(t.component||'').includes(val); });
    if(kind==='fixVersion'||kind==='release') return filteredRows.filter(t=>{ const fvs=t.fixVersions||t.fields?.fixVersions||t.fixVersion||[]; const arr=Array.isArray(fvs)?fvs:[fvs]; const names=arr.map(v=>typeof v==='string'?v:v.name||'').filter(Boolean); return names.includes(val)||String(t.fixVersion||'').includes(val); });
    if(kind==='type') return filteredRows.filter(t=>String(t.issueType||t.issuetype||t.type||'').toLowerCase().includes(val.toLowerCase()));
    if(kind==='boomerang'){ const keys=new Set(gapMeta?.boomerangKeys||[]); if(keys.size) return filteredRows.filter(r=>keys.has(r.key)); return filteredRows.filter(r=>String(r.labels||'').includes('deferred')); }
    if(kind==='customerFound'){
      const labels=Array.isArray(filteredRows);
      const key=val;
      return filteredRows.filter(t=>{
        const lbs=Array.isArray(t.labels)?t.labels:(Array.isArray(t.fields?.labels)?t.fields.labels:[]);
        const has=s=>lbs.some(l=>String(l).toLowerCase().includes(s.toLowerCase()));
        if(key==='eelLabels') return has('EELIST')||has('DevEx-Top-Issue')||has('Serviceability-Promoted');
        if(key==='nps') return has('NPS_Impacting');
        if(key==='impact') return has('Unavailability')||has('Data Loss')||has('Corruption');
        return true;
      });
    }
    return filteredRows;
  },[filteredRows,activeChip,gapMeta]);
  useEffect(()=>{ if(!isOpen) return undefined; const prev=document.body.style.overflow; document.body.style.overflow='hidden'; closeRef.current?.focus(); const onKey=e=>{ if(e.key==='Escape') onClose(); }; document.addEventListener('keydown',onKey); return ()=>{ document.body.style.overflow=prev; document.removeEventListener('keydown',onKey); }; },[isOpen,onClose]);
  if(!isOpen) return null;
  const jiraUrl=jiraHref(jiraBase,jql); const total=cellCount!=null?cellCount:filteredRows.length; const truncated=cellCount!=null&&displayRows.length<cellCount;
  return (
    <div className="cfdcfi-v2-drawer" role="dialog" aria-modal="true" aria-label={viewLabel} onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="cfdcfi-v2-drawer-panel">
        <div className="cfdcfi-v2-drawer-head">
          <div>
            <h3>{viewLabel} · {activeChip?`${displayRows.length} of ${total}`:total}{timeframe?` · ${timeframe}`:''}</h3>
            <p className="cfdcfi-v2-mono" style={{marginTop:6,color:'var(--muted)'}}>{scope==='past'?'Closed scope':'Open scope'} · aged {agedDays}d{activeChip?` · chip: ${activeChip}`:''}{teamId?` · team ${teamId}`:''}</p>
            {aiSliceState==='loading'&&aiSliceView===mode&&<p className="oc-muted" style={{marginTop:6}}>Generating AI slice for {viewLabel}...</p>}
            {aiSliceState==='error'&&aiSliceView===mode&&<p className="oc-error" style={{marginTop:6}}>{aiSliceError}</p>}
            {aiSliceState==='done'&&aiSliceView===mode&&aiSlice&&<div style={{marginTop:8,padding:'8px 10px',background:'var(--oc-slice-bg, #f5f7ff)',border:'1px solid var(--border)',borderRadius:6,whiteSpace:'pre-wrap',fontSize:'var(--fs-small)'}}>{String(aiSlice).split('\n').map((line,idx)=><div key={idx}>{linkify(line,jiraBase)}</div>)}</div>}
          </div>
          <button type="button" className="cfdcfi-v2-btn" ref={closeRef} onClick={onClose} aria-label="Close drill">Close ✕</button>
        </div>
        <p className="cfdcfi-v2-mono" style={{marginBottom:12}}>{truncated?<span>Showing {displayRows.length} of {total} in-panel · </span>:null}{jiraUrl?<a href={jiraUrl} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a>:'No JQL'}</p>
        {displayRows.length===0?<p style={{color:'var(--muted)'}}>No tickets in this view for the current sample.</p>:(
          <div className="cfdcfi-v2-table-wrap">
            <table className="cfdcfi-v2-table">
              <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Age</th><th>Component</th><th>FixVersion</th></tr></thead>
              <tbody>
                {displayRows.slice(0,80).map(r=>{ const comps=r.components||r.fields?.components||(r.component?[r.component]:[]); const compNames=(Array.isArray(comps)?comps:[]).map(c=>typeof c==='string'?c:c.name||'').filter(Boolean).join(', '); const fvs=r.fixVersions||r.fields?.fixVersions||r.fixVersion||[]; const fvNames=(Array.isArray(fvs)?fvs:[fvs]).map(v=>typeof v==='string'?v:v.name||'').filter(Boolean).join(', '); return <tr key={r.key}><td><a href={ticketHref(jiraBase,r.key)} target="_blank" rel="noopener noreferrer">{r.key}</a></td><td>{r.summary||'—'}</td><td>{r.status||'—'}</td><td>{r.priority||'—'}</td><td>{r.assignee||'—'}</td><td>{r.ageDays!=null?`${r.ageDays}d`:r.cycleDays!=null?`${r.cycleDays}d`:'—'}</td><td>{compNames||'—'}</td><td>{fvNames||'—'}</td></tr>; })}
              </tbody>
            </table>
          </div>
        )}
        {jql?<p className="cfdcfi-v2-mono" style={{marginTop:12,color:'var(--muted-faint)'}}>{jql}</p>:null}
      </div>
    </div>
  );
}
function pickBreakdowns(dash){
  const b=dash?.breakdowns||dash||{};
  const byComponent=b.byComponent||b.componentBreakdown||dash?.byComponent||[];
  const byRelease=b.byRelease||b.byFixVersion||b.releaseBreakdown||dash?.byRelease||dash?.byFixVersion||[];
  const ageBuckets=b.ageBuckets||b.ageBreakdown||dash?.ageBuckets||[];
  const customerFound=b.customerFound||dash?.customerFound||[];
  const testEscape=b.testEscape||b.testEscapeBreakdown||dash?.testEscape||[];
  const rootCause=b.rootCause||b.rootCauseBreakdown||dash?.rootCause||[];
  const linkage=b.linkage||b.thLinkage||dash?.linkage||null;
  const boomerang=b.boomerang||dash?.boomerang||dash?.deferredBoomerang||null;
  return { byComponent, byRelease, ageBuckets, customerFound, testEscape, rootCause, linkage, boomerang };
}
function buildChipList(dash, breakdowns){
  const chips=[];
  const {byComponent,byRelease,boomerang,customerFound}=breakdowns;
  (byComponent||[]).slice(0,8).forEach(row=>{ const name=row.component||row.name||row.key||''; if(!name) return; chips.push({kind:'component',value:name,label:name,count:row.count??row.openCount??row.open??row.total,jql:row.jql}); });
  (byRelease||[]).slice(0,6).forEach(row=>{ const name=row.fixVersion||row.version||row.release||row.name||row.key||''; if(!name) return; chips.push({kind:'fixVersion',value:name,label:name,count:row.open??row.count??row.total,jql:row.jql}); });
  (customerFound||[]).forEach(row=>{ const key=row.key||row.label||''; const label=row.label||row.key||''; if(!key) return; chips.push({kind:'customerFound',value:key,label,count:row.count,jql:row.jql}); });
  const typeBuckets=dash?.byIssueType||dash?.issueTypeBreakdown||breakdowns.byIssueType;
  if(Array.isArray(typeBuckets)){ typeBuckets.forEach(r=>chips.push({kind:'type',value:r.name||r.type||r.key,label:r.name||r.type,count:r.count,jql:r.jql})); }
  else { const cfdCount=dash?.hero?.cfdOpen?.count??dash?.hero?.bugOpen?.count; const cfiCount=dash?.hero?.cfiOpen?.count??dash?.hero?.improvementOpen?.count; if(cfdCount!=null) chips.push({kind:'type',value:'Bug',label:'CFD (Bug)',count:cfdCount,jql:dash?.hero?.cfdOpen?.jql}); if(cfiCount!=null) chips.push({kind:'type',value:'Improvement',label:'CFI (Improvement)',count:cfiCount,jql:dash?.hero?.cfiOpen?.jql}); }
  if(boomerang){ const count=boomerang.count??boomerang.total??(Array.isArray(boomerang.keys)?boomerang.keys.length:null); if(count!=null&&count>0) chips.push({kind:'boomerang',value:'boomerang',label:'⚡ Boomerang',count,jql:boomerang.jql}); else if(boomerang.rate!=null||boomerang.jql) chips.push({kind:'boomerang',value:'boomerang',label:'⚡ Boomerang',count:count??(boomerang.rate!=null?`${boomerang.rate}%`:undefined),jql:boomerang.jql}); }
  const bmKeys=dash?.gapMeta?.boomerangKeys;
  if(Array.isArray(bmKeys)&&bmKeys.length&&!chips.some(c=>c.kind==='boomerang')){ chips.push({kind:'boomerang',value:'boomerang',label:'⚡ Boomerang',count:bmKeys.length,jql:dash?.boomerang?.jql||dash?.hero?.boomerang?.jql||null}); }
  return chips;
}
export default function CfdCfiV2Page(){
  const { selectedTeamId, hasTeamSelected } = useTeam();
  const { timeframe, setTimeframe, data, loading, refreshing, error, refresh, aiConcern, aiConcernState, aiConcernError, generateConcern, aiSlice, aiSliceState, aiSliceError, aiSliceView, generateSlice, resetAiSlice } = useCfdcfiV2(selectedTeamId,'7d');
  const [drill,setDrill]=useState(null); const [activeChip,setActiveChip]=useState(null);
  const closeDrill=useCallback(()=>{ setDrill(null); resetAiSlice(); },[resetAiSlice]);
  const openDrill=useCallback((mode,opts={})=>{ const {label,scope='open',jql,count}=opts; setDrill({mode,label:label||mode,scope,jql:jql||null,count:count??null}); if(mode&&data){ const keys=deriveKeysForView(mode,data,data.agedOpenDays??14); const meta={count:count??keys.length,agedDays:data.agedOpenDays??14,timeframe,teamId:selectedTeamId,activeChip,throughput:data.health?.throughput??null,mttrMedian:data.health?.mttrMedian??null}; generateSlice(mode,keys,meta); } },[data,generateSlice,timeframe,selectedTeamId,activeChip]);
  useEffect(()=>{ setActiveChip(null); },[timeframe]);
  const jiraBase=data?.jiraBaseUrl||''; const agedDays=data?.agedOpenDays??14; const rag=data?.rag||null; const health=data?.health||{}; const hero=data?.hero||{};
  const breakdowns=useMemo(()=>pickBreakdowns(data),[data]);
  const chips=useMemo(()=>buildChipList(data||{},breakdowns),[data,breakdowns]);
  const openTicketsArr=useMemo(()=>{ if(!data) return []; const ot=data.openTickets; if(Array.isArray(ot)) return ot; if(ot&&Array.isArray(ot.issues)) return ot.issues; if(ot&&Array.isArray(ot.tickets)) return ot.tickets; if(data.openTicketsList&&Array.isArray(data.openTicketsList)) return data.openTicketsList; return data.stacksPreview||[]; },[data]);
  const closedPreview=data?.closedStacksPreview||data?.closedPreview||[];
  if(!hasTeamSelected) return <TeamRequiredGate title="Select a team for CFD / CFI" description="CFD/CFI follows the selected team and global timeframe. Pick a team in the sidebar." />;
  return (
    <div className="cfdcfi-v2-page">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
        <h1>CFD / CFI</h1>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {data?.asOf&&<span className="oc-chip">as of {new Date(data.asOf).toLocaleString()}</span>}
          <button type="button" className="cfdcfi-v2-btn" onClick={refresh} disabled={loading||refreshing}>{refreshing?'Pulling...':'Pull from JIRA'}</button>
          <button type="button" className="cfdcfi-v2-btn cfdcfi-v2-btn-primary" onClick={generateConcern} disabled={aiConcernState==='loading'||loading}>{aiConcernState==='loading'?'Generating...':'Regenerate AI Concern'}</button>
        </div>
      </div>
      <PillBar timeframe={timeframe} setTimeframe={setTimeframe} />
      {error&&<p className="oc-error">{error}</p>}
      {loading&&!data&&<PageLoading message="Loading CFD/CFI..." />}
      {data&&(
        <>
          {rag&&<div className={`cfdcfi-v2-rag ${rag.level}`} title={rag.why}>{rag.level} — {rag.why}</div>}
          <div className="cfdcfi-v2-ai-card">
            <h3 style={{margin:'0 0 8px'}}>AI Concern — {timeframe}</h3>
            {aiConcernState==='idle'&&<p className="oc-muted">Concern generates after metrics load.</p>}
            {aiConcernState==='loading'&&<p className="oc-muted">Fusing quant+hotspot...</p>}
            {aiConcernState==='error'&&<p className="oc-error">{aiConcernError}</p>}
            {aiConcernState==='done'&&aiConcern&&<div>{linkify(aiConcern,jiraBase)}</div>}
            {aiConcernState==='done'&&!aiConcern&&<p className="oc-muted">No concern generated.</p>}
          </div>
          <div className="cfdcfi-v2-heroes">
            <ExplainHero label="Open now" cell={hero.open} meta="current stock" explain="All open CFD/CFI in scope" jiraBase={jiraBase} onOpen={()=>openDrill('open',{label:'Open now',scope:'open',jql:hero.open?.jql,count:hero.open?.count})} />
            <ExplainHero label={`Aged >${agedDays}d`} cell={hero.agedOpen} meta={`${agedDays}d threshold from config`} explain="Open longer than aged threshold — needs owner chase" jiraBase={jiraBase} onOpen={()=>openDrill('agedOpen',{label:`Aged >${agedDays}d`,scope:'open',jql:hero.agedOpen?.jql,count:hero.agedOpen?.count})} />
            <ExplainHero label="Closed in window" cell={hero.closedInWindow} meta={`window: ${timeframe}`} explain={timeframe==='Overall'?'All closed (no date filter)':`Resolved in ${timeframe}`} jiraBase={jiraBase} onOpen={()=>openDrill('closedInWindow',{label:'Closed in window',scope:'past',jql:hero.closedInWindow?.jql,count:hero.closedInWindow?.count})} />
            <ExplainHero label="P0 open" cell={hero.p0Open||hero.p0||data?.pulse?.heroes?.p0Open} meta="Blocker" explain="P0 CFD/CFI still open — highest severity" jiraBase={jiraBase} onOpen={()=>openDrill('p0Open',{label:'P0 open',scope:'open',jql:(hero.p0Open||hero.p0||data?.pulse?.heroes?.p0Open)?.jql,count:(hero.p0Open||hero.p0||data?.pulse?.heroes?.p0Open)?.count})} />
            <ExplainHero label="P1 open" cell={hero.p1Open||hero.p1||data?.pulse?.heroes?.p1Open} meta="Critical" explain="P1 CFD/CFI still open" jiraBase={jiraBase} onOpen={()=>openDrill('p1Open',{label:'P1 open',scope:'open',jql:(hero.p1Open||hero.p1||data?.pulse?.heroes?.p1Open)?.jql,count:(hero.p1Open||hero.p1||data?.pulse?.heroes?.p1Open)?.count})} />
          </div>
          <div className="cfdcfi-v2-health-row">
            <ExplainHero label="MTTR median" cell={{count:health.mttrMedian!=null?`${health.mttrMedian}d`:'—',jql:data.pulse?.mttr?.jql||data.pulse?.heroes?.mttrMedian?.jql}} meta="created → resolved" explain="Typical time to clear" jiraBase={jiraBase} onOpen={()=>openDrill('mttr',{label:'MTTR median',scope:'past',jql:data.pulse?.mttr?.jql})} />
            <ExplainHero label="MTTR p90" cell={{count:health.p90!=null?`${health.p90}d`:health.mttrP90!=null?`${health.mttrP90}d`:'—',jql:data.pulse?.mttr?.jql}} meta="slow tail" explain="90th percentile wait" jiraBase={jiraBase} onOpen={()=>openDrill('mttrP90',{label:'MTTR p90',scope:'past',jql:data.pulse?.mttr?.jql})} />
            <ExplainHero label="Throughput" cell={{count:health.throughput??0,jql:data.pulse?.heroes?.resolvedWindow?.jql||data.pulse?.mttr?.jql}} meta={`net ${health.net??0}`} explain="Resolved in window" jiraBase={jiraBase} onOpen={()=>openDrill('throughput',{label:'Throughput',scope:'past',jql:data.pulse?.heroes?.resolvedWindow?.jql})} />
            <ExplainHero label="Aged share" cell={{count:`${health.agedShare??0}%`,jql:hero.agedOpen?.jql}} meta={`${hero.agedOpen?.count??0} of ${hero.open?.count??0} open`} explain="Aged / open ratio" jiraBase={jiraBase} onOpen={()=>openDrill('agedOpen',{label:'Aged share',scope:'open',jql:hero.agedOpen?.jql,count:hero.agedOpen?.count})} />
          </div>
          <ChipRow chips={chips} activeChip={activeChip} setActiveChip={setActiveChip} />
          {breakdowns.byComponent&&breakdowns.byComponent.length>0&&(
            <>
              <h3 className="cfdcfi-v2-section-title">By component</h3>
              <div className="cfdcfi-v2-table-wrap">
                <table className="cfdcfi-v2-table">
                  <thead><tr><th>Component</th><th>Open</th><th>Median age</th><th>Oldest</th><th>Priority mix</th><th>JQL proof</th></tr></thead>
                  <tbody>
                    {breakdowns.byComponent.map((row,idx)=>{ const name=row.component||row.name||row.key||`row-${idx}`; const count=row.count??row.openCount??row.open??row.total??0; const jql=row.jql||row.query||null; const mode=`component:${name}`; return <tr key={name} className="row-click" onClick={()=>openDrill(mode,{label:`Component: ${name}`,scope:'open',jql,count})}><td>{name}</td><td>{count}</td><td>{row.medianAge!=null?`${row.medianAge}d`:row.median!=null?`${row.median}d`:'—'}</td><td>{row.oldestKey?<a href={ticketHref(jiraBase,row.oldestKey)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>{row.oldestKey}</a>:row.oldest||'—'}{row.oldestAge!=null?` · ${row.oldestAge}d`:''}</td><td>{row.priorityMix? (typeof row.priorityMix==='string'?row.priorityMix:Object.entries(row.priorityMix).map(([k,v])=>`${k}:${v}`).join(' ')):row.p0!=null?`P0:${row.p0} P1:${row.p1??0}`:'—'}</td><td>{jql?<a href={jiraHref(jiraBase,jql)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>Open in JIRA ↗</a>:'—'}</td></tr>; })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {breakdowns.byRelease&&breakdowns.byRelease.length>0&&(
            <>
              <h3 className="cfdcfi-v2-section-title">By release / fixVersion</h3>
              <div className="cfdcfi-v2-table-wrap">
                <table className="cfdcfi-v2-table">
                  <thead><tr><th>Release</th><th>Total</th><th>Open</th><th>Closed</th><th>Median age</th><th>JQL proof</th></tr></thead>
                  <tbody>
                    {breakdowns.byRelease.map((row,idx)=>{ const name=row.fixVersion||row.version||row.release||row.name||row.key||`row-${idx}`; const jql=row.jql||null; const mode=`fixVersion:${name}`; return <tr key={name} className="row-click" onClick={()=>openDrill(mode,{label:`Release: ${name}`,scope:'open',jql,count:row.open??row.count})}><td>{name}</td><td>{row.total??'—'}</td><td>{row.open??row.count??'—'}</td><td>{row.closed??'—'}</td><td>{row.medianAge!=null?`${row.medianAge}d`:'—'}</td><td>{jql?<a href={jiraHref(jiraBase,jql)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>Open in JIRA ↗</a>:'—'}</td></tr>; })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {breakdowns.ageBuckets&&breakdowns.ageBuckets.length>0?(
            <>
              <h3 className="cfdcfi-v2-section-title">Age buckets</h3>
              <div className="cfdcfi-v2-table-wrap">
                <table className="cfdcfi-v2-table">
                  <thead><tr><th>Bucket</th><th>Count</th><th>Median age</th><th>JQL proof</th></tr></thead>
                  <tbody>
                    {breakdowns.ageBuckets.map(row=>{ const label=row.label||row.bucket||row.range||''; const count=row.count??0; const jql=row.jql||null; const mode=`ageBucket:${label}`; return <tr key={label} className="row-click" onClick={()=>openDrill(mode,{label:`Age ${label}`,scope:'open',jql,count})}><td>{label}</td><td>{count}</td><td>{row.medianAge!=null?`${row.medianAge}d`:row.median!=null?`${row.median}d`:'—'}</td><td>{jql?<a href={jiraHref(jiraBase,jql)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>Open in JIRA ↗</a>:'—'}</td></tr>; })}
                  </tbody>
                </table>
              </div>
            </>
          ): openTicketsArr.length>0 && (
            <>
              <h3 className="cfdcfi-v2-section-title">Age buckets</h3>
              <div className="cfdcfi-v2-table-wrap">
                <table className="cfdcfi-v2-table">
                  <thead><tr><th>Bucket</th><th>Count</th><th>JQL proof</th></tr></thead>
                  <tbody>
                    {[{label:'0-7',lo:0,hi:7},{label:'8-30',lo:8,hi:30},{label:'31-90',lo:31,hi:90},{label:'90d+',lo:90,hi:9999}].map(b=>{ const cnt=openTicketsArr.filter(t=>{ const ad=t.ageDays??0; return ad>=b.lo&&ad<=b.hi; }).length; return <tr key={b.label} className="row-click" onClick={()=>openDrill(`ageBucket:${b.label}`,{label:`Age ${b.label}`,scope:'open',count:cnt})}><td>{b.label}</td><td>{cnt}</td><td><span style={{color:'var(--muted)'}}>—</span></td></tr>; })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {(breakdowns.customerFound&&breakdowns.customerFound.length>0)&&(
            <>
              <h3 className="cfdcfi-v2-section-title">Customer found categories</h3>
              <p className="cfdcfi-v2-mono" style={{color:'var(--muted)',marginBottom:8}}>Which Top-CFD/CFI trigger produced each open CFD/CFI — ONCALL link, SF cases, labels, Impact, NPS. Counts are open scope + sub-clause; JQL proof = baseScope + clause.</p>
              <div className="cfdcfi-v2-table-wrap">
                <table className="cfdcfi-v2-table">
                  <thead><tr><th>Category</th><th>Count</th><th>JQL proof</th></tr></thead>
                  <tbody>
                    {breakdowns.customerFound.map(row=>{ const label=row.label||row.key||''; const count=row.count??0; const jql=row.jql||null; const mode=`customerFound:${row.key||label}`; return <tr key={label} className="row-click" onClick={()=>openDrill(mode,{label:`Customer found: ${label}`,scope:'open',jql,count})}><td>{label}</td><td>{count}</td><td>{jql?<a href={jiraHref(jiraBase,jql)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>Open in JIRA ↗</a>:'—'}</td></tr>; })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {(breakdowns.testEscape?.length>0||breakdowns.rootCause?.length>0)&&(
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))',gap:'var(--space-3)'}}>
              {breakdowns.testEscape?.length>0&&(
                <div>
                  <h3 className="cfdcfi-v2-section-title">Test escape</h3>
                  <div className="cfdcfi-v2-table-wrap">
                    <table className="cfdcfi-v2-table">
                      <thead><tr><th>Value</th><th>Count</th><th>JQL proof</th></tr></thead>
                      <tbody>
                        {breakdowns.testEscape.map((row,idx)=>{ const val=row.value||row.name||row.key||`row-${idx}`; const jql=row.jql||null; return <tr key={val} className="row-click" onClick={()=>openDrill(`testEscape:${val}`,{label:`Test escape: ${val}`,scope:'open',jql,count:row.count})}><td>{val}</td><td>{row.count??0}</td><td>{jql?<a href={jiraHref(jiraBase,jql)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>Open in JIRA ↗</a>:'—'}</td></tr>; })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {breakdowns.rootCause?.length>0&&(
                <div>
                  <h3 className="cfdcfi-v2-section-title">Root cause</h3>
                  <div className="cfdcfi-v2-table-wrap">
                    <table className="cfdcfi-v2-table">
                      <thead><tr><th>Value</th><th>Count</th><th>JQL proof</th></tr></thead>
                      <tbody>
                        {breakdowns.rootCause.map((row,idx)=>{ const val=row.value||row.name||row.key||`row-${idx}`; const jql=row.jql||null; return <tr key={val} className="row-click" onClick={()=>openDrill(`rootCause:${val}`,{label:`Root cause: ${val}`,scope:'open',jql,count:row.count})}><td>{val}</td><td>{row.count??0}</td><td>{jql?<a href={jiraHref(jiraBase,jql)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>Open in JIRA ↗</a>:'—'}</td></tr>; })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          {breakdowns.linkage&&(
            <>
              <h3 className="cfdcfi-v2-section-title">TH / TechPubs linkage</h3>
              <div className="cfdcfi-v2-table-wrap">
                <table className="cfdcfi-v2-table">
                  <thead><tr><th>Link type</th><th>Count</th><th>JQL proof</th></tr></thead>
                  <tbody>
                    {Array.isArray(breakdowns.linkage)? breakdowns.linkage.map(row=><tr key={row.label||row.name}><td>{row.label||row.name}</td><td>{row.count??0}</td><td>{row.jql?<a href={jiraHref(jiraBase,row.jql)} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a>:'—'}</td></tr>) : (
                      <>
                        <tr><td>TH linked</td><td>{breakdowns.linkage.thLinked??breakdowns.linkage.withTH??'—'}</td><td>{breakdowns.linkage.thJql?<a href={jiraHref(jiraBase,breakdowns.linkage.thJql)} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a>:'—'}</td></tr>
                        <tr><td>TechPubs linked</td><td>{breakdowns.linkage.techPubsLinked??breakdowns.linkage.withTechPubs??'—'}</td><td>{breakdowns.linkage.techPubsJql?<a href={jiraHref(jiraBase,breakdowns.linkage.techPubsJql)} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a>:'—'}</td></tr>
                        <tr><td>SR linked</td><td>{breakdowns.linkage.srLinked??'—'}</td><td>{breakdowns.linkage.srJql?<a href={jiraHref(jiraBase,breakdowns.linkage.srJql)} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a>:'—'}</td></tr>
                        <tr><td>No linkage</td><td>{breakdowns.linkage.none??breakdowns.linkage.unlinked??'—'}</td><td>{breakdowns.linkage.noneJql?<a href={jiraHref(jiraBase,breakdowns.linkage.noneJql)} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a>:'—'}</td></tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {breakdowns.boomerang?(
            <div className="cfdcfi-v2-boomerang">
              <h3>⚡ Deferred boomerang {breakdowns.boomerang.rate!=null?` · ${breakdowns.boomerang.rate}%`:''} {breakdowns.boomerang.count!=null?` · ${breakdowns.boomerang.count} tickets`:breakdowns.boomerang.total!=null?` · ${breakdowns.boomerang.total} tickets`:''}</h3>
              <p className="cfdcfi-v2-mono" style={{color:'var(--muted)',marginBottom:12}}>CFD/CFI that were deferred (ndb-*-deferred) and resurfaced — sweep across all deferred labels, intersected by key. Rate = boomerangs / total deferred per release.</p>
              <div className="cfdcfi-v2-boomerang-grid">
                <ExplainHero label="Boomerang" cell={{count:breakdowns.boomerang.count??breakdowns.boomerang.total??(breakdowns.boomerang.keys?.length??0),jql:breakdowns.boomerang.jql}} explain="Deferred → reopened as CFD/CFI" jiraBase={jiraBase} onOpen={()=>openDrill('boomerang',{label:'Boomerang',scope:'open',jql:breakdowns.boomerang.jql,count:breakdowns.boomerang.count??breakdowns.boomerang.total})} meta={breakdowns.boomerang.rate!=null?`${breakdowns.boomerang.rate}% rate`:null} />
                {breakdowns.boomerang.byComponent?.length>0&&<div className="cfdcfi-v2-table-wrap"><table className="cfdcfi-v2-table"><thead><tr><th>Component</th><th>Boomerangs</th></tr></thead><tbody>{breakdowns.boomerang.byComponent.map(r=><tr key={r.component||r.name}><td>{r.component||r.name}</td><td>{r.count??0}</td></tr>)}</tbody></table></div>}
                {breakdowns.boomerang.byRelease?.length>0&&<div className="cfdcfi-v2-table-wrap"><table className="cfdcfi-v2-table"><thead><tr><th>Release</th><th>Boomerangs</th><th>Rate</th></tr></thead><tbody>{breakdowns.boomerang.byRelease.map(r=><tr key={r.release||r.fixVersion||r.name}><td>{r.release||r.fixVersion||r.name}</td><td>{r.count??0}</td><td>{r.rate!=null?`${r.rate}%`:'—'}</td></tr>)}</tbody></table></div>}
              </div>
              {breakdowns.boomerang.jql&&<p className="cfdcfi-v2-mono" style={{color:'var(--muted-faint)'}}>{breakdowns.boomerang.jql}</p>}
            </div>
          ): data?.gapMeta?.boomerangKeys?.length?(
            <div className="cfdcfi-v2-boomerang">
              <h3>⚡ Deferred boomerang · {data.gapMeta.boomerangKeys.length} tickets</h3>
              <p className="cfdcfi-v2-mono" style={{color:'var(--muted)'}}>Deferred labels intersected with CFD/CFI keys.</p>
              <ExplainHero label="Boomerang" cell={{count:data.gapMeta.boomerangKeys.length,jql:data.boomerang?.jql||null}} explain="Deferred → boomerang" jiraBase={jiraBase} onOpen={()=>openDrill('boomerang',{label:'Boomerang',scope:'open',jql:data.boomerang?.jql,count:data.gapMeta.boomerangKeys.length})} />
            </div>
          ):null}
          <KpiPulseBand pulse={data.pulse} jiraBaseUrl={jiraBase} title={`CFD/CFI pulse · ${timeframe}`} domainHint="CFD/CFI" hideResolved={false} loading={loading&&!data.pulse} error={data.errors?.pulse||null} />
          <div style={{position:'sticky',bottom:0,zIndex:5,background:'var(--surface)',padding:'4px 0'}}><PillBar timeframe={timeframe} setTimeframe={setTimeframe} /></div>
          <CfdCfiDrill mode={drill?.mode} label={drill?.label} tickets={drill?.scope==='past'?closedPreview:openTicketsArr} jiraBase={jiraBase} jql={drill?.jql||(drill?(data.hero?.[drill.mode]?.jql||null):null)} cellCount={drill?.count??(drill?(data.hero?.[drill.mode]?.count??null):null)} scope={drill?.scope||'open'} gapMeta={data.gapMeta} agedDays={agedDays} teamId={selectedTeamId} timeframe={timeframe} aiSlice={aiSlice} aiSliceState={aiSliceState} aiSliceError={aiSliceError} aiSliceView={aiSliceView} onClose={closeDrill} activeChip={activeChip} />
        </>
      )}
    </div>
  );
}
export { deriveKeysForView };
