/**
 * ganttService — pure domain derives for ReleaseVersionGantt.
 * No React, no axios/fetch. Consumes ganttConfig/teamBoardConfig shaped
 * data; preserves D1 tenancy via caller-supplied config.
 */

export function formatDateLabel(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day}/${months[d.getMonth()]}/${d.getFullYear()}`;
}

export function computeGaDates(ganttConfig) {
  if (!ganttConfig) return [];
  const out = [];
  Object.keys(ganttConfig).forEach((key) => {
    if (key.startsWith('ga') && /^\d+$/.test(key.replace('ga',''))) {
      const gaData = ganttConfig[key];
      if (gaData && gaData.date) {
        const num = key.replace('ga','');
        out.push({ date: new Date(gaData.date), label: `GA${num}`, color: gaData.color || '#28a745', style: gaData.style || 'solid', fieldName: key, number: parseInt(num,10) });
      }
    }
  });
  out.sort((a,b)=>a.date.getTime()-b.date.getTime());
  return out;
}

export function computeScaledWidths(timelineDuration, allVersionsConfig, ganttConfig) {
  const currentDays = timelineDuration / (24*60*60*1000);
  let baseDays = 139;
  if (allVersionsConfig && Object.keys(allVersionsConfig).length>0) {
    const durs = Object.entries(allVersionsConfig).map(([,cfg])=>{
      if (!cfg.ecDate) return null;
      const gaKeys = Object.keys(cfg).filter(k=>k.startsWith('ga') && /^\d+$/.test(k.replace('ga','')));
      if (!gaKeys.length) return null;
      const latest = gaKeys.map(k=>new Date(cfg[k].date)).sort((a,b)=>b.getTime()-a.getTime())[0];
      return (latest.getTime()-new Date(cfg.ecDate).getTime())/(24*60*60*1000);
    }).filter(d=>d!=null && d>0).sort((a,b)=>a-b);
    if (durs.length) baseDays=durs[0];
  }
  const scale = Math.max(0.8, Math.min(1.6, currentDays/baseDays));
  return {
    scaledMarkerWidth: Math.max(2, Math.round(3*scale)),
    scaledECWidth: Math.max(3, Math.round(4*scale)),
    scaledThinMarkerWidth: Math.max(1, Math.round(2*scale)),
  };
}

export function getPositionPercent(date, timelineStart, timelineDuration, timelineEnd) {
  if (!date) return null;
  const t = date.getTime();
  if (t <= timelineStart) return 0;
  if (t >= timelineEnd) return 100;
  return Math.min(100, Math.max(0, ((t - timelineStart)/timelineDuration)*100));
}

export function computeValidSprintDates(sprintDates, timelineStart, timelineEnd, getPos) {
  return (sprintDates||[]).filter(d=>{
    const t = (d instanceof Date?d:new Date(d)).getTime();
    return t>=timelineStart && t<=timelineEnd;
  }).map(d=>{
    const date = d instanceof Date?d:new Date(d);
    return { date, position: getPos(date) };
  });
}

export function computeWeeklyMarkers(sprintDates, timelineStart, timelineEnd, getPos) {
  const oneWeek = 7*24*60*60*1000;
  const all = (sprintDates||[]).map(d=>d instanceof Date?d:new Date(d));
  const out=[];
  all.forEach(s=>{
    [1,2].forEach(w=>{
      const wd=new Date(s.getTime()+w*oneWeek);
      if (wd.getTime()>=timelineStart && wd.getTime()<=timelineEnd) out.push({ date: wd, position: getPos(wd) });
    });
  });
  out.sort((a,b)=>a.date.getTime()-b.date.getTime());
  return out;
}

export function computeGateMarkers(ganttConfig, timelineStart, timelineEnd) {
  const markers=[];
  Object.keys(ganttConfig).forEach(key=>{
    if (key.startsWith('ccm') && key.includes('Gate')) {
      const gate=ganttConfig[key];
      if (!gate) return;
      const arr=Array.isArray(gate)?gate:[gate];
      arr.forEach(c=>{
        if (c && c.date) {
          const gd=new Date(c.date);
          const maxMargin=6*30*24*60*60*1000;
          if (gd.getTime() <= (timelineEnd+maxMargin)) {
            const n=key.match(/\d+/)?.[0]||'1';
            markers.push({ date: gd, label: `CCM${n}`, color: c.color||'#de350b', style: c.style||'solid', type: 'CCM' });
          }
        }
      });
    }
  });
  Object.keys(ganttConfig).forEach(key=>{
    if (key.startsWith('commitGate') && /^\d+$/.test(key.replace('commitGate',''))) {
      const g=ganttConfig[key];
      if (g && g.date) {
        const gd=new Date(g.date);
        if (gd.getTime()>=timelineStart && gd.getTime()<=timelineEnd) {
          const n=key.replace('commitGate','');
          markers.push({ date: gd, label:`CG${n}`, color:g.color||'#ffc400', style:g.style||'solid', type:'Commit Gate' });
        }
      }
    }
  });
  Object.keys(ganttConfig).forEach(key=>{
    if (key.startsWith('promotionGate') && /^\d+$/.test(key.replace('promotionGate',''))) {
      const g=ganttConfig[key];
      if (g && g.date) {
        const gd=new Date(g.date);
        if (gd.getTime()>=timelineStart && gd.getTime()<=timelineEnd) {
          const n=key.replace('promotionGate','');
          markers.push({ date: gd, label:`PG${n}`, color:g.color||'#ffd700', style:g.style||'solid', type:'Promotion Gate' });
        }
      }
    }
  });
  markers.sort((a,b)=>a.date.getTime()-b.date.getTime());
  return markers;
}

export function buildGateDateRows(ganttConfig) {
  if (!ganttConfig) return [];
  const rows=[];
  if (ganttConfig.ecDate) rows.push({ type:'EC Date', family:'EC', fieldName:'ecDate', date:ganttConfig.ecDate, color:'#0066cc', style:'solid', description:'Early Commitment (Release Start)' });
  Object.keys(ganttConfig).filter(k=>k.startsWith('ga') && /^\d+$/.test(k.replace('ga',''))).sort((a,b)=>parseInt(a.replace('ga',''),10)-parseInt(b.replace('ga',''),10)).forEach(key=>{
    const ga=ganttConfig[key];
    if (ga && ga.date) rows.push({ type:`GA${key.replace('ga','')}`, family:'GA', fieldName:key, date:ga.date, color:ga.color||'#28a745', style:(ga.style||'solid').toLowerCase(), description:`General Availability ${key.replace('ga','')}` });
  });
  Object.keys(ganttConfig).filter(k=>k.startsWith('ccm') && k.includes('Gate')).sort((a,b)=>parseInt(a.match(/\d+/)?.[0]||'1',10)-parseInt(b.match(/\d+/)?.[0]||'1',10)).forEach(key=>{
    const gate=ganttConfig[key];
    if (!gate) return;
    const arr=Array.isArray(gate)?gate:[gate];
    arr.forEach((c,idx)=>{
      if (c && c.date) {
        const n=key.match(/\d+/)?.[0]||'1';
        const suffix=arr.length>1?` (${idx+1})`:'';
        rows.push({ type:`CCM${n}${suffix}`, family:'CCM', fieldName:`${key}${suffix}`, date:c.date, color:c.color||'#de350b', style:(c.style||'solid').toLowerCase(), description:`Code Complete Milestone ${n}${suffix}` });
      }
    });
  });
  Object.keys(ganttConfig).filter(k=>k.startsWith('commitGate') && /^\d+$/.test(k.replace('commitGate',''))).sort((a,b)=>parseInt(a.replace('commitGate',''),10)-parseInt(b.replace('commitGate',''),10)).forEach(key=>{
    const g=ganttConfig[key];
    if (g && g.date) rows.push({ type:`CG${key.replace('commitGate','')}`, family:'CG', fieldName:key, date:g.date, color:g.color||'#ffc400', style:(g.style||'solid').toLowerCase(), description:`Commit Gate ${key.replace('commitGate','')}` });
  });
  Object.keys(ganttConfig).filter(k=>k.startsWith('promotionGate') && /^\d+$/.test(k.replace('promotionGate',''))).sort((a,b)=>parseInt(a.replace('promotionGate',''),10)-parseInt(b.replace('promotionGate',''),10)).forEach(key=>{
    const g=ganttConfig[key];
    if (g && g.date) rows.push({ type:`PG${key.replace('promotionGate','')}`, family:'PG', fieldName:key, date:g.date, color:g.color||'#ffd700', style:(g.style||'solid').toLowerCase(), description:`Promotion Gate ${key.replace('promotionGate','')}` });
  });
  if (!rows.length) return [];
  const groups=rows.reduce((acc,r)=>{ (acc[r.family]=acc[r.family]||[]).push(r); return acc; },{});
  Object.values(groups).forEach(rs=>{
    const solids=rs.filter(r=>r.style==='solid');
    const pool=solids.length?solids:rs;
    const binding=pool.reduce((latest,cur)=> new Date(cur.date).getTime()>new Date(latest.date).getTime()?cur:latest);
    rs.forEach(r=>{ r.isBinding=(r===binding); });
  });
  return rows;
}

export const TICK_COLOR_BY_STATUS = {
  'code complete met': '#c62828',
  'commit gate met': '#e65100',
  'promotion gate met': '#6a1b9a',
  'closed': '#1b5e20',
};

export function getTickStyleForStatus(statusStr, codeCompletePos, commitGatePos, promotionGatePos, statusesWithTick) {
  if (!statusStr || !Array.isArray(statusesWithTick) || !statusesWithTick.length) return null;
  const norm=String(statusStr).trim().toLowerCase();
  if (!statusesWithTick.some(s=>String(s).trim().toLowerCase()===norm)) return null;
  const color=TICK_COLOR_BY_STATUS[norm];
  if (!color) return null;
  let left=null;
  if (norm==='code complete met' && codeCompletePos!=null) left=codeCompletePos;
  else if (norm==='commit gate met' && commitGatePos!=null) left=commitGatePos;
  else if (norm==='promotion gate met' && promotionGatePos!=null) left=promotionGatePos;
  else if (norm==='closed') left=promotionGatePos ?? commitGatePos ?? codeCompletePos ?? 100;
  if (left==null) left=100;
  return { color, leftPercent:left };
}
