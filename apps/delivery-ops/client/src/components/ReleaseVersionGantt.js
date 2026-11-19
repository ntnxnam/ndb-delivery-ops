import React from 'react';
import { getFieldValue } from '../utils/jiraFields';
import { useJiraConfig } from '../utils/jiraConfig';
import { hasCodeCompleteExtensionLabel } from '../utils/releaseVersionUtils';
import { useGanttData } from '../hooks/useGanttData';
import { useTeam } from '../contexts/TeamContext';
import { buildTcmsQueryUrl, getTcmsVersionNum } from '../utils/tcmsUtils';

/**
 * ReleaseVersionGantt — JSX only (minimal-architecture). Derives via useGanttData + ganttService.
 */
function ReleaseVersionGantt({ ganttConfig, selectedVersion, items, checkpointHistory, sortItems, sprintDates = [], allVersionsConfig = null, statusesWithTick = [], timelineOnly = false }) {
  const { jiraBaseUrl } = useJiraConfig();
  const { selectedTeam } = useTeam();
  const d = useGanttData({ ganttConfig, selectedVersion, items, checkpointHistory, sortItems, sprintDates, allVersionsConfig, statusesWithTick });

  if (!ganttConfig || !selectedVersion) return null;
  if (!ganttConfig.ecDate) return null;
  if (!d.gaDates.length) return null;
  if (!d.hasValidTimeline) return null;

  const { ec, gaDates, scaledMarkerWidth, scaledECWidth, scaledThinMarkerWidth, getPositionPercent, formatDateLabel, validSprintDates, weeklyMarkers, gateMarkers, gateDateRows, commitItemsSorted } = d;

  const renderGanttItemBar = (item, isLongTerm=false) => {
    const codeCompleteDate = getFieldValue(item,'codeComplete') ? new Date(getFieldValue(item,'codeComplete')) : null;
    const commitGateDate = getFieldValue(item,'commitGate') ? new Date(getFieldValue(item,'commitGate')) : null;
    const promotionGateDate = getFieldValue(item,'promotionGate') ? new Date(getFieldValue(item,'promotionGate')) : null;
    const ccPosRaw = codeCompleteDate ? getPositionPercent(codeCompleteDate) : null;
    const ccPos = codeCompleteDate ? Math.min(100,Math.max(0,ccPosRaw)) : null;
    const cgPos = commitGateDate ? Math.min(100,Math.max(0,getPositionPercent(commitGateDate))) : null;
    const pgPos = promotionGateDate ? Math.min(100,Math.max(0,getPositionPercent(promotionGateDate))) : null;
    const getAllDates=()=>{
      const key=item.key?item.key.trim():'';
      const hist=checkpointHistory?.[key]?.codeComplete||[];
      const all=[];
      hist.forEach(e=>{ if(e?.date){ try{ const h=new Date(e.date); if(!isNaN(h.getTime())) all.push(h);}catch{}}});
      if(codeCompleteDate){ try{ const cur=codeCompleteDate instanceof Date?codeCompleteDate:new Date(codeCompleteDate); if(!isNaN(cur.getTime())){ const cs=cur.toISOString().split('T')[0]; if(!all.some(x=>x.toISOString().split('T')[0]===cs)) all.push(cur);} }catch{}}
      all.sort((a,b)=>a.getTime()-b.getTime());
      return all;
    };
    const allHist=getAllDates();
    const hasExt=hasCodeCompleteExtensionLabel(item);
    const statusStr = d.helpers.getItemStatusDisplay(item);
    const tick=d.getTickStyleForStatus(statusStr, ccPos, cgPos, pgPos);
    return (
      <>
        {codeCompleteDate && ccPos!==null && (
          <>
            <div style={{position:'absolute',left:'0%',top:'14px',width:`${ccPos}%`,height:'10px',backgroundColor:'#FFB3BA',borderRadius:'2px',border:hasExt?'3px solid #ff9800':'none',zIndex:2,cursor:'pointer',title:hasExt?`Code Complete: ${formatDateLabel(codeCompleteDate)} (from JIRA) - Extension granted`:`Code Complete: ${formatDateLabel(codeCompleteDate)} (from JIRA)`}} />
            {allHist.map((h,idx)=>{
              const p=getPositionPercent(h);
              if(p>=0 && p<=ccPos){
                const isCur=codeCompleteDate && h.toISOString().split('T')[0]===(codeCompleteDate instanceof Date?codeCompleteDate:new Date(codeCompleteDate)).toISOString().split('T')[0];
                const style=isCur?'solid':'dotted';
                return <div key={`hist-cc-${isLongTerm?'ltf-':''}${idx}`} style={{position:'absolute',left:`${p}%`,top:'10px',width:style==='dotted'?'0px':'4px',height:'18px',backgroundColor:style==='solid'?'#de350b':'transparent',borderLeft:style==='dotted'?'4px dashed #de350b':'none',zIndex:3,opacity:0.85,borderRadius:'1px',title:isCur?`Current Code Complete: ${formatDateLabel(h)}`:`Historical Code Complete: ${formatDateLabel(h)}`}} />;
              }
              return null;
            })}
          </>
        )}
        {ccPos!==null && cgPos!==null && (()=>{ const w=Math.max(0,cgPos-ccPos); if(w>0&&cgPos<=100) return <div style={{position:'absolute',left:`${ccPos}%`,top:'14px',width:`${w}%`,height:'10px',backgroundColor:'#FFD4A3',borderRadius:'2px',zIndex:3,cursor:'pointer',title:`Code Complete to Commit Gate: ${formatDateLabel(codeCompleteDate)} → ${formatDateLabel(commitGateDate)}`}} />; return null; })()}
        {pgPos!==null && cgPos!==null && (()=>{ const w=Math.max(0,pgPos-cgPos); if(w>0&&pgPos<=100) return <div style={{position:'absolute',left:`${cgPos}%`,top:'14px',width:`${w}%`,height:'10px',backgroundColor:'#E1BEE7',borderRadius:'2px',zIndex:4,cursor:'pointer',title:`Promotion Gate: ${formatDateLabel(promotionGateDate)}`}} />; return null; })()}
        {tick && (()=>{ const atRight=tick.leftPercent>=100; return <div style={{position:'absolute',...(atRight?{right:'6px',left:'auto'}:{left:`${tick.leftPercent}%`}),top:'50%',transform:atRight?'translateY(-50%)':'translate(-50%, -50%)',display:'inline-flex',alignItems:'center',justifyContent:'center',width:'22px',height:'22px',borderRadius:'50%',backgroundColor:'rgba(255,255,255,0.95)',boxShadow:'0 0 0 1px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.2)',color:tick.color,fontWeight:'bold',fontSize:'14px',lineHeight:1,zIndex:10,pointerEvents:'none',textShadow:'0 0 1px rgba(255,255,255,0.8)'}} title={`JIRA status: ${statusStr}`}>✓</div>; })()}
        {!codeCompleteDate && !commitGateDate && !promotionGateDate && <div style={{position:'absolute',left:'0%',top:'14px',right:'0%',width:'100%',minWidth:'100%',height:'10px',backgroundColor:'transparent',border:'1px dashed #ccc',borderRadius:'2px',zIndex:1,boxSizing:'border-box'}} title="No checkpoint dates set" />}
      </>
    );
  };

  const renderGanttItem = (item, isLongTerm=false) => {
    const tcmsRaw=getFieldValue(item,'tcmsLink')??item.customfield_31460;
    const manualTcmsUrl=tcmsRaw?.value?.url || (typeof tcmsRaw==='string'&&/^https?:\/\//i.test(tcmsRaw)?tcmsRaw:null);
    const tcmsVer=getTcmsVersionNum(selectedVersion, selectedTeam);
    const constructedTcmsUrl=tcmsVer?buildTcmsQueryUrl(item.key, selectedVersion, selectedTeam):null;
    const sStr=(typeof item.status==='string'?item.status:item.status?.name||'').toLowerCase().trim();
    const isAdv=['code complete met','commit gate met','promotion gate met','closed'].includes(sStr);
    const warn=isAdv&&!manualTcmsUrl;
    const qi=item.tcmsQI;
    return (
      <div key={item.key} style={{display:'flex',alignItems:'center',marginBottom:'6px',padding:'6px 0',borderBottom:'1px solid #e9ecef',borderLeft:warn?'3px solid #fd7e14':'none',backgroundColor:warn?'#fff8f0':'transparent',minHeight:'50px'}}>
        <div style={{width:'var(--gantt-label-w)',flex:'0 0 var(--gantt-label-w)',fontSize:'10px',marginRight:'8px',marginLeft:'calc(-1 * (var(--gantt-label-w) + 8px))',display:'flex',flexDirection:'column',justifyContent:'center',boxSizing:'border-box'}}>
          <div style={{fontWeight:600,marginBottom:'2px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><a href={`${jiraBaseUrl}/browse/${item.key}`} target="_blank" rel="noopener noreferrer" style={{color:'#0065ff',textDecoration:'none',fontWeight:600}} onClick={e=>e.stopPropagation()}>{item.key}</a></div>
          <div style={{fontSize:'9px',color:'#6c757d',overflow:'hidden',textOverflow:'ellipsis',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',lineHeight:'1.2'}}>{item.summary||'No summary'}</div>
          <div style={{fontSize:'8px',marginTop:'3px',display:'flex',flexDirection:'column',gap:'1px'}}>
            {constructedTcmsUrl && <a href={constructedTcmsUrl} target="_blank" rel="noopener noreferrer" style={{color:'#0052cc',textDecoration:'none'}} onClick={e=>e.stopPropagation()} title="View test cases linked to this feature in TCMS">🔍 TCMS Tests</a>}
            {manualTcmsUrl ? <a href={manualTcmsUrl} target="_blank" rel="noopener noreferrer" style={{color:'#5a6776',textDecoration:'none'}} onClick={e=>e.stopPropagation()} title="TCMS suite link from Jira ticket">🔗 TCMS Suite</a> : (warn && <span style={{color:'#fd7e14',fontWeight:600}}>⚠ TCMS not set</span>)}
          </div>
          {qi && <div style={{fontSize:'8px',color:'#888',marginTop:'3px',borderTop:'1px dashed #e0e0e0',paddingTop:'3px',lineHeight:'1.5'}}>
            {qi.master && <div><span style={{color:'#555',fontWeight:600}}>master: </span>{qi.master.qi!=null?<span style={{color:qi.master.qi>=80?'#28a745':qi.master.qi>=60?'#fd7e14':'#dc3545',fontWeight:600}}>QI {Math.round(qi.master.qi)}%</span>:<span style={{color:'#aaa'}}>QI N/A</span>}{qi.master.total!=null && <span style={{color:'#aaa'}}> · {qi.master.passed??'?'}/{qi.master.total}</span>}</div>}
            {!isLongTerm && qi.branch && <div><span style={{color:'#555',fontWeight:600}}>{selectedVersion}: </span>{qi.branch.qi!=null?<span style={{color:qi.branch.qi>=80?'#28a745':qi.branch.qi>=60?'#fd7e14':'#dc3545',fontWeight:600}}>QI {Math.round(qi.branch.qi)}%</span>:<span style={{color:'#aaa'}}>QI N/A</span>}{qi.branch.total!=null && <span style={{color:'#aaa'}}> · {qi.branch.passed??'?'}/{qi.branch.total}</span>}</div>}
            {(qi.master?.components||qi.branch?.components||[]).slice(0,3).map((c,i)=>{ const cc=c.qi==null?'#aaa':c.qi>=80?'#28a745':c.qi>=60?'#fd7e14':'#dc3545'; return <div key={i} style={{fontSize:'7px',color:'#999'}}><span>{c.name}: </span>{c.qi!=null?<span style={{color:cc,fontWeight:600}}>{Math.round(c.qi)}%</span>:<span>N/A</span>}{c.total!=null && <span style={{color:'#bbb'}}> ({c.passed??'?'}/{c.total})</span>}</div>; })}
          </div>}
        </div>
        <div style={{flex:1,position:'relative',height:'38px',backgroundColor:'#f5f5f5',border:'1px solid #ddd',borderRadius:'2px',boxSizing:'border-box',overflow:'visible',minWidth:0}}>{renderGanttItemBar(item,isLongTerm)}</div>
      </div>
    );
  };

  const renderGateDatesTimeline = (rows) => {
    if(!rows||!rows.length) return null;
    const pts=rows.map(r=>({...r,time:new Date(r.date).getTime()})).filter(p=>!isNaN(p.time)).sort((a,b)=>a.time-b.time);
    if(!pts.length) return null;
    const min=pts[0].time, max=pts[pts.length-1].time, span=Math.max(max-min,1), pct=t=>((t-min)/span)*100;
    const today=Date.now(), inRange=today>=min&&today<=max, todayPct=inRange?pct(today):null;
    const labels=pts.map((_,i)=>i%2===0?'above':'below');
    return (
      <div style={{marginTop:'16px',paddingTop:'12px',borderTop:'1px dashed #dee2e6'}}>
        <div style={{fontSize:'12px',fontWeight:600,color:'#495057',marginBottom:'8px'}}>Timeline</div>
        <div style={{position:'relative',height:'110px',padding:'0 24px',boxSizing:'border-box'}}>
          <div style={{position:'absolute',left:'24px',right:'24px',top:'55px',height:'2px',backgroundColor:'#cfd4da',borderRadius:'1px'}} />
          {inRange && <div title={`Today: ${formatDateLabel(new Date(today))}`} style={{position:'absolute',left:`calc(24px + (100% - 48px) * ${todayPct/100})`,top:'20px',bottom:'20px',width:'2px',backgroundColor:'#212529',transform:'translateX(-1px)'}}><div style={{position:'absolute',top:'-14px',left:'50%',transform:'translateX(-50%)',fontSize:'10px',fontWeight:700,color:'#212529',whiteSpace:'nowrap'}}>Today</div></div>}
          {pts.map((p,idx)=>{ const left=`calc(24px + (100% - 48px) * ${pct(p.time)/100})`; const above=labels[idx]==='above'; const soft=p.isBinding===false; const sz=soft?9:14; return <React.Fragment key={`${p.fieldName}-${idx}`}><div title={`${p.type}: ${formatDateLabel(new Date(p.date))}${soft?' (soft checkpoint)':''}`} style={{position:'absolute',left,top:`${49+(14-sz)/2}px`,width:`${sz}px`,height:`${sz}px`,backgroundColor:soft?'#fff':p.color,border:`2px ${soft?'dashed':'solid'} ${soft?p.color:'#fff'}`,borderRadius:'50%',boxShadow:soft?'none':'0 0 0 1px rgba(0,0,0,0.2)',transform:`translateX(-${sz/2}px)`,opacity:soft?0.45:1,zIndex:soft?0:1}} /><div style={{position:'absolute',left,top:above?'30px':'63px',height:'20px',width:'1px',backgroundColor:p.color,opacity:soft?0.2:0.5,transform:'translateX(-0.5px)'}} /><div style={{position:'absolute',left,top:above?'4px':'83px',transform:'translateX(-50%)',textAlign:'center',fontSize:soft?'9px':'10px',lineHeight:'1.2',whiteSpace:'nowrap',opacity:soft?0.5:1}}><div style={{color:p.color,fontWeight:soft?400:700,fontStyle:soft?'italic':'normal'}}>{p.type}</div><div style={{color:'#6c757d',fontFamily:'monospace',fontSize:'9px'}}>{formatDateLabel(new Date(p.date))}</div></div></React.Fragment>; })}
        </div>
      </div>
    );
  };

  const renderGateDatesTable = () => {
    if(!gateDateRows.length) return null;
    return (
      <div style={{marginBottom:'16px',padding:'12px',backgroundColor:'#fff',border:'1px solid #ddd',borderRadius:'4px',width:'100%',maxWidth:'100%',boxSizing:'border-box',overflowX:'auto'}}>
        <h4 style={{marginTop:0,marginBottom:'12px',fontSize:'14px',color:'#495057'}}>Gate Dates Configuration for {selectedVersion}</h4>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
          <thead><tr style={{backgroundColor:'#f8f9fa'}}><th style={{padding:'8px 12px',borderBottom:'2px solid #dee2e6',textAlign:'left',fontWeight:600,color:'#495057'}}>Gate Type</th><th style={{padding:'8px 12px',borderBottom:'2px solid #dee2e6',textAlign:'left',fontWeight:600,color:'#495057'}}>Date</th><th style={{padding:'8px 12px',borderBottom:'2px solid #dee2e6',textAlign:'left',fontWeight:600,color:'#495057'}}>Config Field</th><th style={{padding:'8px 12px',borderBottom:'2px solid #dee2e6',textAlign:'left',fontWeight:600,color:'#495057'}}>Description</th></tr></thead>
          <tbody>{gateDateRows.map((row,idx)=>{ const soft=row.isBinding===false; return <tr key={idx} style={{borderBottom:'1px solid #dee2e6',backgroundColor:idx%2===0?'#fff':'#f8f9fa',opacity:soft?0.45:1}}><td style={{padding:'8px 12px',verticalAlign:'middle'}}><div style={{display:'flex',alignItems:'center'}}><span style={{display:'inline-block',width:'12px',height:'12px',marginRight:'8px',borderRadius:'2px',backgroundColor:soft?'transparent':row.color,border:soft?`1px dashed ${row.color}`:'none'}}></span><strong style={{color:row.color,fontWeight:soft?500:700}}>{row.type}</strong>{soft && <span style={{marginLeft:'8px',fontSize:'10px',fontWeight:500,color:'#6c757d',fontStyle:'italic'}}>soft checkpoint</span>}</div></td><td style={{padding:'8px 12px',verticalAlign:'middle',fontFamily:'monospace',fontWeight:soft?400:600}}>{formatDateLabel(new Date(row.date))}</td><td style={{padding:'8px 12px',verticalAlign:'middle',fontFamily:'monospace',fontSize:'11px',color:'#6c757d'}}>{row.fieldName}</td><td style={{padding:'8px 12px',verticalAlign:'middle',color:'#6c757d'}}>{row.description}</td></tr>; })}</tbody>
        </table>
        {renderGateDatesTimeline(gateDateRows)}
      </div>
    );
  };

  const ganttLegendBlock = (
    <div style={{marginBottom:'16px',padding:'12px',backgroundColor:'#f5f5f5',fontSize:'11px'}}>
      <strong style={{display:'block',marginBottom:'10px',color:'#495057',fontSize:'12px'}}>Gantt Legend:</strong>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))',gap:'15px'}}>
        <div><strong style={{display:'block',marginBottom:'6px',color:'#495057',fontSize:'11px',fontWeight:600}}>Bars (Pastel):</strong>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'24px',height:'10px',backgroundColor:'#FFB3BA',marginRight:'8px',borderRadius:'2px',border:'1px solid #ddd'}}></span><span style={{fontSize:'11px'}}>Code Complete</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'24px',height:'10px',backgroundColor:'#FFD4A3',marginRight:'8px',borderRadius:'2px',border:'1px solid #ddd'}}></span><span style={{fontSize:'11px'}}>Code Complete to Commit Gate</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'24px',height:'10px',backgroundColor:'#E1BEE7',marginRight:'8px',borderRadius:'2px',border:'1px solid #ddd'}}></span><span style={{fontSize:'11px'}}>Promotion Gate</span></div>
        </div>
        <div><strong style={{display:'block',marginBottom:'6px',color:'#495057',fontSize:'11px',fontWeight:600}}>Date Markers (Bright):</strong>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'3px',height:'12px',backgroundColor:'#de350b',marginRight:'8px',borderRadius:'1px'}}></span><span style={{fontSize:'11px'}}>Code Complete (CCM)</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'3px',height:'12px',backgroundColor:'#ff9800',marginRight:'8px',borderRadius:'1px'}}></span><span style={{fontSize:'11px'}}>Commit Gate (CG)</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'3px',height:'12px',backgroundColor:'#9c27b0',marginRight:'8px',borderRadius:'1px'}}></span><span style={{fontSize:'11px'}}>Promotion Gate (PG)</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'3px',height:'12px',backgroundColor:'#0066cc',marginRight:'8px',borderRadius:'1px'}}></span><span style={{fontSize:'11px'}}>EC Date</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'3px',height:'12px',backgroundColor:'#28a745',marginRight:'8px',borderRadius:'1px'}}></span><span style={{fontSize:'11px'}}>GA Date(s)</span></div>
        </div>
        <div><strong style={{display:'block',marginBottom:'6px',color:'#495057',fontSize:'11px',fontWeight:600}}>Code Complete Bar:</strong><div style={{marginBottom:'8px',padding:'6px',backgroundColor:'#f8f9fa',borderRadius:'3px',fontSize:'10px'}}><div style={{marginBottom:'4px'}}>Bar extends from EC date to current Code Complete date (from JIRA)</div><div>Mini markers show all historical date changes within the bar</div></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'4px',height:'18px',borderLeft:'4px dashed #de350b',marginRight:'8px'}}></span><span style={{fontSize:'11px'}}>Historical Code Complete (dotted)</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'4px',height:'18px',backgroundColor:'#de350b',marginRight:'8px',borderRadius:'1px'}}></span><span style={{fontSize:'11px'}}>Current Code Complete (solid)</span></div>
        </div>
        <div><strong style={{display:'block',marginBottom:'6px',color:'#495057',fontSize:'11px',fontWeight:600}}>Status tick (✓):</strong><div style={{marginBottom:'6px',fontSize:'10px',color:'#6c757d'}}>Circle on the bar = JIRA status reached. Position = when met (or field date).</div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:'18px',height:'18px',borderRadius:'50%',backgroundColor:'#fff',boxShadow:'0 0 0 1px rgba(0,0,0,0.2)',color:'#c62828',fontWeight:'bold',fontSize:'11px',marginRight:'8px'}}>✓</span><span style={{fontSize:'11px'}}>Code Complete Met</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:'18px',height:'18px',borderRadius:'50%',backgroundColor:'#fff',boxShadow:'0 0 0 1px rgba(0,0,0,0.2)',color:'#e65100',fontWeight:'bold',fontSize:'11px',marginRight:'8px'}}>✓</span><span style={{fontSize:'11px'}}>Commit Gate Met</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:'18px',height:'18px',borderRadius:'50%',backgroundColor:'#fff',boxShadow:'0 0 0 1px rgba(0,0,0,0.2)',color:'#6a1b9a',fontWeight:'bold',fontSize:'11px',marginRight:'8px'}}>✓</span><span style={{fontSize:'11px'}}>Promotion Gate Met</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:'18px',height:'18px',borderRadius:'50%',backgroundColor:'#fff',boxShadow:'0 0 0 1px rgba(0,0,0,0.2)',color:'#1b5e20',fontWeight:'bold',fontSize:'11px',marginRight:'8px'}}>✓</span><span style={{fontSize:'11px'}}>Closed</span></div>
        </div>
        <div><strong style={{display:'block',marginBottom:'6px',color:'#495057',fontSize:'11px',fontWeight:600}}>Other:</strong>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'2px',height:'12px',backgroundColor:'#9e9e9e',marginRight:'8px',borderRadius:'1px',opacity:0.8}}></span><span style={{fontSize:'11px'}}>Weekly Markers</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'2px',height:'12px',borderLeft:'2px dashed',borderColor:'#666',marginRight:'8px'}}></span><span style={{fontSize:'11px'}}>Old Gate (dotted)</span></div>
          <div style={{display:'flex',alignItems:'center',marginBottom:'5px'}}><span style={{display:'inline-block',width:'2px',height:'12px',borderLeft:'2px solid',borderColor:'#666',marginRight:'8px'}}></span><span style={{fontSize:'11px'}}>Current Gate (solid)</span></div>
        </div>
      </div>
    </div>
  );

  if (timelineOnly) {
    if (!gateDateRows.length) return null;
    return <div style={{padding:'0.75rem',backgroundColor:'#fff',border:'1px solid #ddd',borderRadius:'4px',boxSizing:'border-box'}}>{renderGateDatesTimeline(gateDateRows)}</div>;
  }

  return (
    <div style={{marginBottom:'0.75rem',padding:'0.75rem',backgroundColor:'#f0f0f0',width:'100%',maxWidth:'100%',overflowX:'auto',boxSizing:'border-box'}}>
      <h3 style={{marginTop:0,marginBottom:'0.5rem',fontSize:'1rem'}}>Gantt Chart: {selectedVersion} (Committed Projects Only)</h3>
      {renderGateDatesTable()}
      {ganttLegendBlock}
      <div style={{'--gantt-label-w':'clamp(140px, 12vw, 220px)',position:'relative',marginLeft:'calc(var(--gantt-label-w) + 8px)',width:'calc(100% - var(--gantt-label-w) - 8px)',minWidth:'720px',boxSizing:'border-box',minHeight:'200px',overflow:'visible'}}>
        <div style={{position:'absolute',left:'0%',top:'0px',fontSize:'12px',color:'#0066cc',fontWeight:600,whiteSpace:'nowrap',transform:'translateX(-50%)',backgroundColor:'#ffffff',padding:'3px 6px',borderRadius:'2px',border:'1px solid #0066cc',opacity:0.9,zIndex:8}}>EC</div>
        <div style={{position:'absolute',left:'0%',top:'24px',fontSize:'11px',color:'#1a1a1a',fontWeight:500,whiteSpace:'nowrap',transform:'translateX(-50%)',backgroundColor:'#ffffff',padding:'2px 5px',borderRadius:'2px',zIndex:8}}>{formatDateLabel(ec)}</div>
        {gaDates.map((g,i)=>{ const p=getPositionPercent(g.date); return <React.Fragment key={`ga-label-top-${i}`}><div style={{position:'absolute',left:`${p}%`,top:'0px',fontSize:'12px',color:g.color||'#28a745',fontWeight:600,whiteSpace:'nowrap',transform:'translateX(-50%)',backgroundColor:'#ffffff',padding:'3px 6px',borderRadius:'2px',border:`1px solid ${g.color||'#28a745'}`,opacity:0.9,zIndex:12}}>{g.label}</div><div style={{position:'absolute',left:`${p}%`,top:'24px',fontSize:'11px',color:'#1a1a1a',fontWeight:500,whiteSpace:'nowrap',transform:'translateX(-50%)',backgroundColor:'#ffffff',padding:'2px 5px',borderRadius:'2px',zIndex:12}}>{formatDateLabel(g.date)}</div></React.Fragment>; })}
        {gateMarkers.map((gm,i)=>{ const p=getPositionPercent(gm.date); return <React.Fragment key={`gate-label-top-${i}`}><div style={{position:'absolute',left:`${p}%`,top:'0px',fontSize:'12px',color:gm.color,fontWeight:600,whiteSpace:'nowrap',transform:'translateX(-50%)',backgroundColor:'#ffffff',padding:'3px 6px',borderRadius:'2px',border:`1px solid ${gm.color}`,opacity:0.9,zIndex:12}}>{gm.label}</div><div style={{position:'absolute',left:`${p}%`,top:'24px',fontSize:'11px',color:'#1a1a1a',fontWeight:500,whiteSpace:'nowrap',transform:'translateX(-50%)',backgroundColor:'#ffffff',padding:'2px 5px',borderRadius:'2px',zIndex:12}}>{formatDateLabel(gm.date)}</div></React.Fragment>; })}
        <div style={{position:'absolute',left:'0%',top:'0px',bottom:'0px',width:`${scaledECWidth}px`,backgroundColor:'#0066cc',zIndex:9,opacity:0.8,pointerEvents:'none',boxShadow:'0 0 2px rgba(0, 102, 204, 0.5)'}} />
        {gaDates.map((g,i)=>{ const p=getPositionPercent(g.date); const dotted=g.style==='dotted'; const before=p<=0.1; const eff=before?'dotted':(dotted?'dotted':'solid'); return <div key={`ga-line-${i}`} style={{position:'absolute',left:`${p}%`,top:'0px',bottom:'0px',width:eff==='dotted'?`${scaledThinMarkerWidth}px`:`${scaledMarkerWidth}px`,backgroundColor:eff==='dotted'?'transparent':g.color||'#28a745',borderLeft:eff==='dotted'?`${scaledThinMarkerWidth}px dashed ${g.color||'#28a745'}`:'none',zIndex:10,opacity:eff==='dotted'?0.5:0.6,pointerEvents:'none'}} />; })}
        {gateMarkers.map((gm,i)=>{ const p=getPositionPercent(gm.date); const dotted=gm.style==='dotted'; const before=p<=0.1; const eff=before?'dotted':(dotted?'dotted':'solid'); return <div key={`gate-line-${i}`} style={{position:'absolute',left:`${p}%`,top:'0px',bottom:'0px',width:eff==='dotted'?`${scaledThinMarkerWidth}px`:`${scaledMarkerWidth}px`,backgroundColor:eff==='dotted'?'transparent':gm.color,borderLeft:eff==='dotted'?`${scaledThinMarkerWidth}px dashed ${gm.color}`:'none',zIndex:10,opacity:eff==='dotted'?0.5:0.6,pointerEvents:'none'}} />; })}
        {(()=>{ const today=new Date(); today.setHours(0,0,0,0); const tp=getPositionPercent(today); if(tp!==null&&tp>=0&&tp<=100) return <React.Fragment key="today-marker"><div style={{position:'absolute',left:`${tp}%`,top:'0px',bottom:'0px',width:'2px',backgroundColor:'#333333',zIndex:11,opacity:0.7,pointerEvents:'none',borderLeft:'2px dashed #333333'}} /><div style={{position:'absolute',left:`${tp}%`,top:'40px',transform:'translateX(-50%)',zIndex:13,display:'flex',flexDirection:'column',alignItems:'center',pointerEvents:'none'}}><div style={{width:'24px',height:'24px',borderRadius:'50%',backgroundColor:'#333333',border:'3px solid #ffffff',boxShadow:'0 2px 6px rgba(0, 0, 0, 0.3)',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:'4px'}}><div style={{width:'10px',height:'10px',borderRadius:'50%',backgroundColor:'#ffffff'}} /></div><div style={{fontSize:'11px',fontWeight:600,color:'#333333',backgroundColor:'#ffffff',padding:'3px 8px',borderRadius:'4px',border:'1px solid #333333',whiteSpace:'nowrap',boxShadow:'0 2px 4px rgba(0, 0, 0, 0.15)'}}>Today</div><div style={{fontSize:'10px',color:'#666666',backgroundColor:'#ffffff',padding:'2px 6px',borderRadius:'3px',marginTop:'2px',border:'1px solid #e0e0e0',whiteSpace:'nowrap'}}>{formatDateLabel(today)}</div></div></React.Fragment>; return null; })()}
        <div style={{position:'relative',height:'120px',marginBottom:'10px',boxSizing:'border-box',zIndex:2}}>
          <div style={{position:'absolute',left:'0%',top:'100px',width:'100%',height:'6px',backgroundColor:'#e9ecef',border:'1px solid #d0d0d0',borderRadius:'3px',zIndex:1,boxSizing:'border-box'}} />
          {weeklyMarkers.map((w,i)=><div key={`week-${i}`} style={{position:'absolute',left:`${w.position}%`,top:'98px',width:`${scaledThinMarkerWidth}px`,height:'9px',backgroundColor:'#9e9e9e',zIndex:2,opacity:0.8,borderRadius:'1px'}} />)}
          {validSprintDates.map((s,i)=>{ const show=validSprintDates.length<=12||i%2===0; return <React.Fragment key={`sprint-${i}`}><div style={{position:'absolute',left:`${s.position}%`,top:'99px',width:`${scaledMarkerWidth}px`,height:'8px',backgroundColor:'#6c757d',borderRadius:'1px',zIndex:2,opacity:0.8}} />{show && <div style={{position:'absolute',left:`${s.position}%`,top:'75px',fontSize:'11px',color:'#495057',fontWeight:600,whiteSpace:'nowrap',transform:'translateX(-50%)',backgroundColor:'#ffffff',padding:'2px 5px',borderRadius:'2px',border:'1px solid #e9ecef'}}>{formatDateLabel(s.date)}</div>}</React.Fragment>; })}
        </div>
        <div style={{width:'100%',boxSizing:'border-box',overflow:'visible',position:'relative',zIndex:2}}>{commitItemsSorted.map(item=>renderGanttItem(item,false))}</div>
      </div>
    </div>
  );
}

export default ReleaseVersionGantt;
