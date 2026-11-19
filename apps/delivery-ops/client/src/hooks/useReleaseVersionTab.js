import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTeam } from '../contexts/TeamContext';
import { useReleaseData } from '../contexts/ReleaseDataContext';
import { useJiraConfig } from '../utils/jiraConfig';
import { logUserAction, UserActions } from '../utils/userActionLogger';
import { generateReleaseHighlights } from '../utils/generateReleaseHighlights';
import { fetchBreakdownsForKeys } from '../services/taskBreakdownService';
import { fetchReleaseContext, generateBriefing, sendReleaseVersionEmail, formatJiraWikiMarkup, extractExecutiveSummaryText, getExtensionLabelInfo, getExtensionColor } from '../services/releaseVersionService';
import { useReleaseVersions, useColumnConfig, useGanttConfig, useAllVersionsConfig, useReleaseItems, useCheckpointHistory, useEmailForm, useTcmsData } from './index';
import { useGateTimeline } from '../release/hooks/useGateTimeline';
import { useExecPageBriefing } from './useExecPageBriefing';
import { usePermissions } from '../auth/hooks/usePermissions';
import { applyFilters } from '../components/ReleaseVersionFilterBar';
import { generateTableHTMLForEmail } from '../utils/emailTableGenerator';
import { downloadGantt, downloadExcel, downloadHTML, downloadPDF, downloadBoth } from '../utils/downloadUtils';
import html2canvas from 'html2canvas';

export function useReleaseVersionTab({ releaseVersionsEmailSenders = [] } = {}) {
  const { hasTeamSelected, isTransitioning, selectedTeamId } = useTeam();
  const { isExecAudience } = usePermissions();
  const {
    versions, activeVersions, inactiveVersions, selectedVersion, loadingVersions,
    showVersionDropdown, defaultVersion, setDefaultVersion, setSelectedVersion, refreshVersions,
    handleVersionChange: handleVersionChangeHook, error: versionsError, setError: setVersionsError
  } = useReleaseVersions();
  const { columnsConfig, defaultVersion: configDefaultVersion } = useColumnConfig();
  const { ganttConfig, sprintDates } = useGanttConfig(selectedVersion);
  const { allVersionsConfig } = useAllVersionsConfig();
  const { refreshRelease } = useReleaseData();
  const { items, loadingItems, error: itemsError, setError: setItemsError, fetchItemsForVersion, refreshItemsForVersion, setItems, sectionMetadata } = useReleaseItems();
  const { checkpointHistory, fetchHistoryForVersion, setCheckpointHistory } = useCheckpointHistory();
  const { tcmsDataMap, fetchCommitTcmsData, fetchLongTermTcmsData, resetTcmsData } = useTcmsData();
  const { sendingEmail, setSendingEmail, emailSuccess, setEmailSuccess, lowlights, setLowlights, highlights, setHighlights, callToAction, setCallToAction, emailRecipients, setEmailRecipients, emailRecipientsError, setEmailRecipientsError, lowlightsQuillRef, highlightsQuillRef, callToActionQuillRef, quillModules } = useEmailForm();
  const { jiraBaseUrl } = useJiraConfig();
  const error = versionsError || itemsError || '';
  const setError = useCallback((err) => {
    if (err) { setVersionsError(err); setItemsError(err); } else { setVersionsError(''); setItemsError(''); }
  }, [setItemsError, setVersionsError]);
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
  const { gates: gateTimelineGates, loading: gatesLoading } = useGateTimeline({ release: selectedVersion, jiraToken, username });
  const normalizedUsername = (username||'').trim().toLowerCase().replace(/@nutanix\.com$/i,'');
  const emailAccess = (process.env.REACT_APP_RELEASE_VERSIONS_EMAIL_ACCESS || 'allowlist').toLowerCase().trim();
  const allowedSendersNormalized = (releaseVersionsEmailSenders||[]).map(u=>(u||'').trim().toLowerCase().replace(/@nutanix\.com$/i,''));
  const isEmailSectionUser = emailAccess==='all'?true:emailAccess==='none'?false:allowedSendersNormalized.length>0 && allowedSendersNormalized.includes(normalizedUsername);
  const hasInitialSynced = useRef(false);
  const lastLoadedKeyRef = useRef('');
  const loadIdRef = useRef(0);
  const [downloading, setDownloading] = useState(false);
  const [refreshingLive, setRefreshingLive] = useState(false);
  const [breakdownDataMap, setBreakdownDataMap] = useState(new Map());
  const [loadingBreakdowns, setLoadingBreakdowns] = useState(false);
  const [releaseContext, setReleaseContext] = useState(null);
  const [briefingState, setBriefingState] = useState('idle');
  const [briefingSummary, setBriefingSummary] = useState(null);
  const [briefingIntelligence, setBriefingIntelligence] = useState(null);
  const [briefingError, setBriefingError] = useState(null);
  const { state: execBriefState, summary: execBriefSummary, meta: execBriefMeta, error: execBriefError, refresh: refreshExecBrief } = useExecPageBriefing({
    enabled: isExecAudience && hasTeamSelected,
    surface: 'release', version: selectedVersion,
    ready: Boolean(selectedVersion && !loadingItems && ((items.commit?.length||0)>0 || (items.longTermFunded?.length||0)>0)),
  });
  const [activeFilters, setActiveFilters] = useState({ risk:'', status:'', assignee:'', assigneeManager:'', staleness:'' });
  const [activeSection, setActiveSection] = useState('');
  const handleFilterChange = (k,v)=> setActiveFilters(p=>({...p,[k]:v}));
  const resetFilters = ()=> { setActiveFilters({ risk:'', status:'', assignee:'', assigneeManager:'', staleness:'' }); setActiveSection(''); };

  const fetchBreakdownData = useCallback(async (itemsData, itemType='all')=>{
    if (!itemsData) { if(itemType==='all') setBreakdownDataMap(new Map()); return; }
    let jiraKeys=[];
    if (itemType==='commit' && itemsData.commit?.length) jiraKeys=itemsData.commit.map(i=>i.key).filter(Boolean);
    else if (itemType==='longTermFunded' && itemsData.longTermFunded?.length) jiraKeys=itemsData.longTermFunded.map(i=>i.key).filter(Boolean);
    else if (itemType==='all') jiraKeys=[...(itemsData.commit||[]),...(itemsData.longTermFunded||[])].map(i=>i.key).filter(Boolean);
    if (!jiraKeys.length){ if(itemType==='all') setBreakdownDataMap(new Map()); return; }
    if (!jiraToken||!username) return;
    setLoadingBreakdowns(true);
    try {
      const m=await fetchBreakdownsForKeys(jiraKeys, jiraToken, username);
      setBreakdownDataMap(prev=>{ const n=new Map(prev); for(const [k,v] of m) n.set(k,v); return n; });
    } catch(e){ console.warn('[breakdown] fetch failed',e.message); }
    finally{ setLoadingBreakdowns(false); }
  },[jiraToken, username]);

  const enrichedItems = useMemo(()=>{
    if (!tcmsDataMap || !Object.keys(tcmsDataMap).length) return items;
    const enrich=arr=>arr.map(item=>{ const t=tcmsDataMap[item.key]; return t?{...item,tcmsQI:t.tcmsQI,tcmsQuality:t.tcmsQuality}:item; });
    return { commit: enrich(items.commit||[]), longTermFunded: enrich(items.longTermFunded||[]) };
  },[items,tcmsDataMap]);

  const filteredItems = useMemo(()=>{
    const cSrc=activeSection==='longTermFunded'?[]:(enrichedItems.commit||[]);
    const lSrc=activeSection==='commit'?[]:(enrichedItems.longTermFunded||[]);
    return { commit: applyFilters(cSrc, activeFilters), longTermFunded: applyFilters(lSrc, activeFilters) };
  },[enrichedItems, activeFilters, activeSection]);

  useEffect(()=>{
    if (configDefaultVersion && !hasInitialSynced.current){ setSelectedVersion(configDefaultVersion); setDefaultVersion(configDefaultVersion); hasInitialSynced.current=true; }
  },[configDefaultVersion, setSelectedVersion, setDefaultVersion]);

  useEffect(()=>{
    let cancelled=false;
    if (items.commit?.length>0 && selectedVersion){
      try {
        const { highlightsHtml, lowlightsHtml, callToActionHtml } = generateReleaseHighlights(items, selectedVersion, jiraBaseUrl);
        if(!cancelled){ setHighlights(highlightsHtml); setLowlights(lowlightsHtml); setCallToAction(callToActionHtml); }
      } catch(e){ console.warn(e.message); }
      const ck=items.commit.map(i=>i.key).filter(Boolean);
      if(ck.length) fetchCommitTcmsData(selectedVersion, ck).catch(()=>{});
      const lk=items.longTermFunded.map(i=>i.key).filter(Boolean);
      if(lk.length) fetchLongTermTcmsData(selectedVersion, lk).catch(()=>{});
      fetchBreakdownData(items,'commit').catch(()=>{});
      if (jiraToken && selectedVersion) fetchReleaseContext(selectedVersion,{jiraToken,username}).then(d=>{ if(!cancelled && d) setReleaseContext(d); }).catch(()=>{});
    }
    return ()=>{ cancelled=true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[items.commit, items.longTermFunded, selectedVersion, jiraBaseUrl, fetchBreakdownData, fetchCommitTcmsData, fetchLongTermTcmsData, setHighlights, setLowlights, setCallToAction, jiraToken, username]);

  useEffect(()=>{
    let cancelled=false;
    if (items.longTermFunded?.length>0 && selectedVersion){
      try {
        const { highlightsHtml, lowlightsHtml, callToActionHtml } = generateReleaseHighlights(items, selectedVersion, jiraBaseUrl);
        if(!cancelled){ setHighlights(highlightsHtml); setLowlights(lowlightsHtml); setCallToAction(callToActionHtml); }
      } catch(e){ console.warn(e.message); }
      const lk=items.longTermFunded.map(i=>i.key).filter(Boolean);
      if(lk.length) fetchLongTermTcmsData(selectedVersion, lk).catch(()=>{});
      fetchBreakdownData(items,'longTermFunded').catch(()=>{});
    }
    return ()=>{ cancelled=true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[items.longTermFunded, items.commit, selectedVersion, jiraBaseUrl, fetchBreakdownData, fetchLongTermTcmsData, setHighlights, setLowlights, setCallToAction]);

  const loadVersionData = useCallback(async (version, {userInitiated=false}={})=>{
    const loadId=++loadIdRef.current;
    if (!version){ setError('Please select a version'); return; }
    if (!jiraToken){ setError('JIRA token required'); return; }
    setError(''); setVersionsError(''); setItemsError('');
    resetFilters(); setItems({commit:[],longTermFunded:[]}); setCheckpointHistory({}); resetTcmsData(); setBreakdownDataMap(new Map());
    try {
      const r=await fetchItemsForVersion(version,{ignoreFailureCooldown:userInitiated});
      if(loadId!==loadIdRef.current) return;
      if(r) try{ await fetchHistoryForVersion(version); } catch(e){ console.warn(e?.message); }
    } catch(e){ if(loadId===loadIdRef.current) console.error(e); }
  },[fetchHistoryForVersion, fetchItemsForVersion, jiraToken, resetTcmsData, setCheckpointHistory, setError, setItems, setItemsError, setVersionsError]);

  // Auto-load on selectedVersion change removed — user must click Load or change version explicitly.
  // Previously this effect auto-fetched items whenever selectedVersion was set (including on page load via default).
  // Now fetch is only triggered via handleVersionChange (user picks dropdown) or fetchItems (Load button).

  const handleVersionChange = useCallback(async (event)=>{
    const nv=event.target.value;
    lastLoadedKeyRef.current = nv?`${selectedTeamId||''}::${nv}`:'';
    loadIdRef.current += 1;
    handleVersionChangeHook(event);
    setItems({commit:[],longTermFunded:[]}); setCheckpointHistory({}); setBreakdownDataMap(new Map()); setReleaseContext(null);
    setBriefingState('idle'); setBriefingSummary(null); setBriefingIntelligence(null); setBriefingError(null);
    await logUserAction(UserActions.VERSION_CHANGED, nv, {previousVersion:selectedVersion});
    if(nv) await loadVersionData(nv,{userInitiated:true});
  },[selectedTeamId, handleVersionChangeHook, setCheckpointHistory, setItems, selectedVersion, loadVersionData]);

  const handleGenerateBriefing = useCallback(async ()=>{
    if (!selectedVersion||!jiraToken) return;
    setBriefingState('loading'); setBriefingError(null);
    try {
      const p=await generateBriefing(selectedVersion,{jiraToken, username});
      setBriefingSummary(p.summary); setBriefingIntelligence(p.intelligence); setBriefingState('done');
    } catch(err){ setBriefingError(err.response?.data?.error||err.message||'Failed to generate release briefing'); setBriefingState('error'); }
  },[selectedVersion, jiraToken, username]);

  const fetchItems = async ()=>{
    await logUserAction(UserActions.FETCH_ITEMS_CLICKED, selectedVersion);
    if(selectedVersion) lastLoadedKeyRef.current=`${selectedTeamId||''}::${selectedVersion}`;
    await loadVersionData(selectedVersion,{userInitiated:true});
  };

  const handleRefreshNow = useCallback(async ()=>{
    setRefreshingLive(true); setError('');
    try {
      if(typeof refreshVersions==='function') await refreshVersions();
      if(selectedVersion) await refreshItemsForVersion(selectedVersion);
      if(typeof refreshRelease==='function') await refreshRelease();
    } catch(err){ setError(err?.message||'Failed to refresh live data'); }
    finally{ setRefreshingLive(false); }
  },[refreshItemsForVersion, refreshRelease, refreshVersions, selectedVersion, setError]);

  // P0-1: email + download handlers (JSX-only component)
  const extractExecutiveSummary = useCallback((statusUpdate)=>{
    const lines=extractExecutiveSummaryText(statusUpdate);
    if(!lines) return null;
    const fullText=(statusUpdate||'').replace(/\{color:[^}]+\}(.*?)\{color\}/g,'$1').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\[([^\]]+)\|([^\]]+)\]/g,'').replace(/\[([^\]]+)\]/g,'').replace(/\{[^}]+\}/g,'').replace(/\s+/g,' ').trim();
    return { lines, fullText };
  },[]);

  const fmtJira = useCallback((text)=> formatJiraWikiMarkup(text, jiraBaseUrl), [jiraBaseUrl]);

  const handleDownload = useCallback(async (type, refs={})=>{
    if (downloading) return;
    setDownloading(true); setError('');
    try {
      const opts={ filteredItems, checkpointHistory, version: selectedVersion, jiraBaseUrl };
      if (type==='gantt') await downloadGantt(refs.ganttRef, selectedVersion);
      else if (type==='excel') downloadExcel(opts);
      else if (type==='html') downloadHTML(opts);
      else if (type==='pdf') await downloadPDF(refs.pdfRef, selectedVersion);
      else if (type==='both') await downloadBoth({ ganttRef: refs.ganttRef, ...opts });
    } catch(err){ setError('Download failed: '+(err.message||'Unknown error')); }
    finally{ setDownloading(false); }
  },[downloading, filteredItems, checkpointHistory, selectedVersion, jiraBaseUrl, setError]);

  const handleSendEmail = useCallback(async (previewOnly=false, refs={})=>{
    if (!previewOnly) await logUserAction(UserActions.EMAIL_SEND_CLICKED, selectedVersion, { hasHighlights:!!highlights, hasLowlights:!!lowlights, hasCallToAction:!!callToAction, recipientsCount: emailRecipients?emailRecipients.split(/[,;]/).filter(r=>r.trim()).length:0 });
    if (!username){ if(!previewOnly) setError('User email is required to send email'); if(previewOnly) throw new Error('User email is required'); return; }
    if ((items.commit?.length||0)===0 && (items.longTermFunded?.length||0)===0){ if(!previewOnly) setError('No items to send in email'); if(previewOnly) throw new Error('No items to send in email'); return; }
    if (!previewOnly){ setSendingEmail(true); setError(''); setEmailSuccess(false); }
    try {
      if (emailRecipients?.trim()){
        const recipients=emailRecipients.split(',').map(r=>r.trim()).filter(Boolean);
        const uRx=/^[a-z0-9._-]+$/i, eRx=/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
        for(let i=0;i<recipients.length;i++){ const r=recipients[i]; const ok=r.includes('@')?eRx.test(r):uRx.test(r); if(!ok){ setError(`Invalid recipient format at position ${i+1}: "${r}".`); setSendingEmail(false); return; } }
      }
      if (!columnsConfig){ setError('Column configuration not loaded. Please refresh the page.'); setSendingEmail(false); return; }
      const execSummaryFn=(text)=>{
        const res=extractExecutiveSummary(text);
        if(!res) return '<span style="background:#fff3cd;font-weight:600">Not Set</span>';
        return `<div>${res.lines.join('<br/>')}</div>`;
      };
      const tableHTML=generateTableHTMLForEmail(items, checkpointHistory, selectedVersion, columnsConfig, fmtJira, execSummaryFn, getExtensionLabelInfo, getExtensionColor, jiraBaseUrl, sectionMetadata);
      let ganttChartImageData=null;
      if (refs.ganttRef?.current && ganttConfig){
        try { const canvas=await html2canvas(refs.ganttRef.current,{backgroundColor:'#f0f0f0',scale:2,logging:false,useCORS:true,allowTaint:false}); ganttChartImageData=canvas.toDataURL('image/png'); } catch {}
      }
      const payload={ selectedVersion, tableHTML, lowlights, highlights, callToAction, emailRecipients: emailRecipients||'', ganttConfig, items: enrichedItems.commit||[], ganttChartImageData };
      if (previewOnly){ const {ganttChartImageData:_,...pp}=payload; const pr=await sendReleaseVersionEmail({...pp,previewOnly:true},{jiraToken,username}); return pr; }
      const response=await sendReleaseVersionEmail(payload,{jiraToken,username});
      if (response.success){ setEmailSuccess(true); setTimeout(()=>setEmailSuccess(false),5000); } else setError(response.error||'Failed to send email');
    } catch(err){ if(!previewOnly) setError(err.response?.data?.error||err.message||'Failed to send email'); if(previewOnly) throw err; }
    finally{ if(!previewOnly) setSendingEmail(false); }
  },[selectedVersion, highlights, lowlights, callToAction, emailRecipients, username, items, setError, setSendingEmail, setEmailSuccess, columnsConfig, checkpointHistory, ganttConfig, enrichedItems, jiraToken, jiraBaseUrl, sectionMetadata, fmtJira, extractExecutiveSummary]);

  return {
    hasTeamSelected, isTransitioning, selectedTeamId,
    versions, activeVersions, inactiveVersions, selectedVersion, loadingVersions, showVersionDropdown, defaultVersion,
    columnsConfig, ganttConfig, sprintDates, allVersionsConfig, refreshVersions,
    items, loadingItems, itemsError, versionsError, error, setError, setVersionsError, setItemsError,
    checkpointHistory, tcmsDataMap, sectionMetadata,
    sendingEmail, setSendingEmail, emailSuccess, setEmailSuccess, lowlights, setLowlights, highlights, setHighlights, callToAction, setCallToAction, emailRecipients, setEmailRecipients, emailRecipientsError, setEmailRecipientsError, lowlightsQuillRef, highlightsQuillRef, callToActionQuillRef, quillModules,
    jiraBaseUrl, jiraToken, username, gateTimelineGates, gatesLoading, isEmailSectionUser,
    downloading, setDownloading, refreshingLive,
    breakdownDataMap, loadingBreakdowns, releaseContext,
    briefingState, briefingSummary, briefingIntelligence, briefingError,
    execBriefState, execBriefSummary, execBriefMeta, execBriefError, refreshExecBrief,
    enrichedItems, filteredItems, activeFilters, activeSection, setActiveSection, handleFilterChange,
    fetchBreakdownData, loadVersionData, handleVersionChange, handleGenerateBriefing, fetchItems, handleRefreshNow,
    fetchItemsForVersion, refreshItemsForVersion, setItems, setCheckpointHistory, resetTcmsData,
    isExecAudience, handleSendEmail, handleDownload, fmtJira, extractExecutiveSummary,
  };
}
