import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageLoading } from '../shared/components/PageLoading';
import html2canvas from 'html2canvas';
import { createPortal } from 'react-dom';
import { authenticatedPost } from '../shared/services/apiService';
import { generateTableHTMLForEmail } from '../utils/emailTableGenerator';
import { logUserAction, UserActions } from '../utils/userActionLogger';
import { useReleaseVersionTab } from '../hooks/useReleaseVersionTab';
import ReleaseVersionSelector from './ReleaseVersionSelector';
import ReleaseVersionNotes from './ReleaseVersionNotes';
import ReleaseVersionEmailForm from './ReleaseVersionEmailForm';
import ReleaseVersionGantt from './ReleaseVersionGantt';
import ReleaseVersionTableSection, { sortItems } from './ReleaseVersionTableSection';
import ReleaseVersionLegend from './ReleaseVersionLegend';
import ReleaseVersionFilterBar from './ReleaseVersionFilterBar';
import { downloadGantt, downloadExcel, downloadHTML, downloadPDF, downloadBoth } from '../utils/downloadUtils';
import { GateChipStrip } from '../design-system';
import ReleaseSummaryPanel from './ReleaseSummaryPanel';
import ExecPageBriefing from './ExecPageBriefing';
import { TeamRequiredGate } from '../layout/components/TeamRequiredGate';
import { checkReleaseLevelMissingDates, formatJiraWikiMarkup, extractExecutiveSummaryText, getExtensionLabelInfo, getExtensionColor } from '../services/releaseVersionService';
import './ReleaseVersionTab.css';
import './EmailSender/EmailSender.css';

function ReleaseVersionTab({ releaseVersionsEmailSenders = [] }) {
  const h = useReleaseVersionTab({ releaseVersionsEmailSenders });
  const refreshButtonContainerRef = useRef(null);
  const ganttChartRef = useRef(null);
  const pdfContentRef = useRef(null);

  useEffect(() => {
    const c = document.getElementById('refresh-versions-button-container');
    if (c) refreshButtonContainerRef.current = c;
  }, []);

  const renderNotSet = () => <span style={{ backgroundColor: '#fff3cd', fontWeight: 600 }}>Not Set</span>;

  const extractExecutiveSummary = (statusUpdate) => {
    const lines = extractExecutiveSummaryText(statusUpdate);
    if (!lines) return renderNotSet();
    const fullText = (statusUpdate || '').replace(/\{color:[^}]+\}(.*?)\{color\}/g,'$1').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\[([^\]]+)\|([^\]]+)\]/g,'').replace(/\[([^\]]+)\]/g,'').replace(/\{[^}]+\}/g,'').replace(/\s+/g,' ').trim();
    return (
      <div title={fullText.length > lines.join(' ').length ? fullText : undefined} style={{ fontSize:'12px', lineHeight:'1.5', color:'#212529', cursor: fullText.length>lines.join(' ').length?'help':'default' }}>
        {lines.map((line,idx)=><div key={idx} style={{ marginBottom: idx<lines.length-1?'6px':'0', paddingBottom: idx<lines.length-1?'4px':'0', borderBottom: idx<lines.length-1?'1px solid #e9ecef':'none' }}>{line}</div>)}
      </div>
    );
  };

  const fmtJira = (text) => formatJiraWikiMarkup(text, h.jiraBaseUrl);

  const handleDownload = async (type) => {
    if (h.downloading) return;
    h.setDownloading(true); h.setError('');
    try {
      const opts={ filteredItems: h.filteredItems, checkpointHistory: h.checkpointHistory, version: h.selectedVersion, jiraBaseUrl: h.jiraBaseUrl };
      if (type==='gantt') await downloadGantt(ganttChartRef, h.selectedVersion);
      else if (type==='excel') downloadExcel(opts);
      else if (type==='html') downloadHTML(opts);
      else if (type==='pdf') await downloadPDF(pdfContentRef, h.selectedVersion);
      else if (type==='both') await downloadBoth({ ganttRef: ganttChartRef, ...opts });
    } catch(err){ h.setError('Download failed: '+(err.message||'Unknown error')); }
    finally{ h.setDownloading(false); }
  };

  const handleSendEmail = async (previewOnly=false) => {
    if (!previewOnly) await logUserAction(UserActions.EMAIL_SEND_CLICKED, h.selectedVersion, { hasHighlights:!!h.highlights, hasLowlights:!!h.lowlights, hasCallToAction:!!h.callToAction, recipientsCount: h.emailRecipients?h.emailRecipients.split(/[,;]/).filter(r=>r.trim()).length:0 });
    if (!h.username){ if(!previewOnly) h.setError('User email is required to send email'); if(previewOnly) throw new Error('User email is required'); return; }
    if ((h.items.commit?.length||0)===0 && (h.items.longTermFunded?.length||0)===0){ if(!previewOnly) h.setError('No items to send in email'); if(previewOnly) throw new Error('No items to send in email'); return; }
    if (!previewOnly){ h.setSendingEmail(true); h.setError(''); h.setEmailSuccess(false); }
    try {
      if (h.emailRecipients?.trim()){
        const recipients=h.emailRecipients.split(',').map(r=>r.trim()).filter(Boolean);
        const uRx=/^[a-z0-9._-]+$/i, eRx=/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
        for(let i=0;i<recipients.length;i++){ const r=recipients[i]; const ok=r.includes('@')?eRx.test(r):uRx.test(r); if(!ok){ h.setError(`Invalid recipient format at position ${i+1}: "${r}".`); h.setSendingEmail(false); return; } }
      }
      if (!h.columnsConfig){ h.setError('Column configuration not loaded. Please refresh the page.'); h.setSendingEmail(false); return; }
      const tableHTML=generateTableHTMLForEmail(h.items, h.checkpointHistory, h.selectedVersion, h.columnsConfig, fmtJira, extractExecutiveSummary, getExtensionLabelInfo, getExtensionColor, h.jiraBaseUrl, h.sectionMetadata);
      let ganttChartImageData=null;
      if (ganttChartRef.current && h.ganttConfig){
        try { const canvas=await html2canvas(ganttChartRef.current,{backgroundColor:'#f0f0f0',scale:2,logging:false,useCORS:true,allowTaint:false}); ganttChartImageData=canvas.toDataURL('image/png'); } catch{}
      }
      const payload={ selectedVersion: h.selectedVersion, tableHTML, lowlights: h.lowlights, highlights: h.highlights, callToAction: h.callToAction, emailRecipients: h.emailRecipients||'', ganttConfig: h.ganttConfig, items: h.enrichedItems.commit||[], ganttChartImageData };
      if (previewOnly){ const {ganttChartImageData:_,...pp}=payload; const pr=await authenticatedPost('/api/email/send-release-versions',{...pp,previewOnly:true},{jiraToken:h.jiraToken,username:h.username}); return pr.data; }
      const response=await authenticatedPost('/api/email/send-release-versions',payload,{jiraToken:h.jiraToken,username:h.username});
      if (response.data.success){ h.setEmailSuccess(true); setTimeout(()=>h.setEmailSuccess(false),5000); } else h.setError(response.data.error||'Failed to send email');
    } catch(err){ if(!previewOnly) h.setError(err.response?.data?.error||err.message||'Failed to send email'); if(previewOnly) throw err; }
    finally{ if(!previewOnly) h.setSendingEmail(false); }
  };

  const totalCount=(h.items.commit?.length||0)+(h.items.longTermFunded?.length||0);
  const filteredCount=(h.filteredItems.commit?.length||0)+(h.filteredItems.longTermFunded?.length||0);

  if (!h.hasTeamSelected) return <TeamRequiredGate selectorId="project-status-team-select" description="Project Status shows payload tracking, Gantt charts, and email generation for the selected team's base query." />;
  if (h.isTransitioning) return <div style={{padding:'2rem',textAlign:'center'}}><div style={{backgroundColor:'#e7f3ff',padding:'2rem',borderRadius:'8px',maxWidth:'400px',margin:'0 auto'}}><h3 style={{color:'#0c5460',margin:'0 0 1rem 0'}}>Switching Teams</h3><p style={{color:'#0c5460',margin:0}}>⏳ Please wait while we load data for the selected team...</p></div></div>;

  return (
    <div className="release-version-tab" style={{padding:'0.5rem',width:'100%',minWidth:0,maxWidth:'none',margin:0,boxSizing:'border-box',overflow:'visible'}}>
      <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
      {refreshButtonContainerRef.current && createPortal(
        <button onClick={async()=>{ h.setError(''); h.setVersionsError(''); h.setItemsError(''); await logUserAction(UserActions.FETCH_VERSIONS_CLICKED,'release-versions'); h.refreshVersions(); }} disabled={h.loadingVersions||!h.jiraToken} style={{padding:'0.4rem 0.8rem',backgroundColor:'#0066cc',color:'white',border:'none',borderRadius:0,cursor:h.loadingVersions||!h.jiraToken?'not-allowed':'pointer',opacity:h.loadingVersions||!h.jiraToken?0.6:1,fontSize:'0.85rem'}}>{h.loadingVersions?'Loading...':'Refresh Versions'}</button>,
        refreshButtonContainerRef.current)}
      {h.error && <div style={{marginBottom:'0.75rem',padding:'0.5rem',borderRadius:0,backgroundColor:'#f5f5f5',color:'#721c24',fontSize:'0.85rem',borderLeft:'3px solid #c33'}}><span style={{display:'block',marginBottom:'0.5rem'}}>{h.error}</span><button type="button" onClick={()=>{ h.setVersionsError(''); h.setItemsError(''); h.refreshVersions(); if(h.selectedVersion) h.fetchItems(); }} style={{padding:'0.35rem 0.75rem',fontSize:'0.85rem',cursor:'pointer',backgroundColor:'#721c24',color:'white',border:'none',borderRadius:'2px'}}>Try again</button></div>}
      <div style={{backgroundColor:'#f8f9fa',padding:'0.75rem',marginBottom:'0.75rem'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5rem',gap:'0.75rem',flexWrap:'wrap'}}><span style={{fontSize:'0.8rem',color:'#495057'}}>Live JIRA for this team's base filter</span><button onClick={h.handleRefreshNow} disabled={h.refreshingLive||h.loadingItems||h.loadingVersions} style={{padding:'0.3rem 0.7rem',backgroundColor:'#495057',color:'white',border:'none',cursor:h.refreshingLive||h.loadingItems||h.loadingVersions?'not-allowed':'pointer',opacity:h.refreshingLive||h.loadingItems||h.loadingVersions?0.6:1,fontSize:'0.8rem'}}>{h.refreshingLive?'Refreshing live…':'Refresh Now'}</button></div>
        <ReleaseVersionSelector activeVersions={h.activeVersions} inactiveVersions={h.inactiveVersions} versions={h.versions} selectedVersion={h.selectedVersion} defaultVersion={h.defaultVersion} showVersionDropdown={h.showVersionDropdown} loadingVersions={h.loadingVersions} loadingItems={h.loadingItems} jiraToken={h.jiraToken} onVersionChange={h.handleVersionChange} onFetchItems={h.fetchItems} hasData={totalCount>0} hasGanttChart={!!h.ganttConfig} downloading={h.downloading} onDownload={handleDownload} onGenerateBriefing={h.handleGenerateBriefing} briefingState={h.briefingState} />
      </div>
      {h.isEmailSectionUser && !h.loadingItems && h.selectedVersion && ((h.items.commit?.length||0)>0 || (h.items.longTermFunded?.length||0)>0) && (
        <><ReleaseVersionNotes highlights={h.highlights} lowlights={h.lowlights} callToAction={h.callToAction} setHighlights={h.setHighlights} setLowlights={h.setLowlights} setCallToAction={h.setCallToAction} highlightsQuillRef={h.highlightsQuillRef} lowlightsQuillRef={h.lowlightsQuillRef} callToActionQuillRef={h.callToActionQuillRef} quillModules={h.quillModules} /><ReleaseVersionEmailForm emailRecipients={h.emailRecipients} emailRecipientsError={h.emailRecipientsError} sendingEmail={h.sendingEmail} emailSuccess={h.emailSuccess} username={h.username} setEmailRecipients={h.setEmailRecipients} setEmailRecipientsError={h.setEmailRecipientsError} onSendEmail={()=>handleSendEmail(false)} getPreview={async()=>handleSendEmail(true)} /></>
      )}
      {h.loadingItems && <div style={{backgroundColor:'#f8f9fa',padding:'0.75rem',marginBottom:'0.75rem'}}><PageLoading inline message="Loading committed items…" />{h.sectionMetadata.loadingLongTerm===false && h.items.commit?.length>0 && <p style={{margin:0,fontSize:'0.85rem',color:'#28a745'}}>✓ Committed items loaded ({h.items.commit.length} items)</p>}{h.sectionMetadata.loadingLongTerm && <p style={{margin:'5px 0 0 0',fontSize:'0.85rem',color:'#6c757d'}}>Loading long-term funded items...</p>}</div>}
      {!h.loadingItems && h.selectedVersion && (h.items.commit?.length||0)===0 && (h.items.longTermFunded?.length||0)===0 && <div style={{padding:'0.75rem',textAlign:'center',color:'#6c757d',backgroundColor:'#f8f9fa',fontSize:'0.85rem'}}><p style={{margin:0}}>Select a release version to load data, or click &quot;Load&quot; to refresh.</p></div>}
      {!h.loadingItems && h.sectionMetadata.loadingLongTerm && h.items.commit?.length>0 && <div style={{backgroundColor:'#e7f3ff',padding:'0.5rem',marginBottom:'0.75rem',fontSize:'0.85rem',borderLeft:'4px solid #007bff'}}>Loading long-term funded items in background... ({h.items.commit.length} committed items already displayed)</div>}
      {!h.loadingItems && h.selectedVersion && ((h.items.commit?.length||0)>0 || (h.items.longTermFunded?.length||0)>0) && (
        <div ref={pdfContentRef} style={{marginBottom:'0.75rem',width:'100%',maxWidth:'100%',boxSizing:'border-box'}}>
          <ExecPageBriefing state={h.execBriefState} summary={h.execBriefSummary} meta={h.execBriefMeta} error={h.execBriefError} onRetry={h.refreshExecBrief} jiraBase={h.jiraBaseUrl||'https://jira.nutanix.com'} />
          {h.briefingState!=='idle' && <ReleaseSummaryPanel state={h.briefingState} summary={h.briefingSummary} intelligence={h.briefingIntelligence} error={h.briefingError} />}
          <ReleaseVersionFilterBar items={h.items} activeFilters={h.activeFilters} onFilterChange={h.handleFilterChange} activeSection={h.activeSection} onSectionChange={h.setActiveSection} totalCount={totalCount} filteredCount={filteredCount} />
          {h.selectedVersion && (h.gateTimelineGates.length>0 || h.gatesLoading) && <div className="ds-scope" style={{marginBottom:'0.5rem'}}><GateChipStrip gates={h.gateTimelineGates} /></div>}
          {h.ganttConfig && <div ref={ganttChartRef}><ReleaseVersionGantt ganttConfig={h.ganttConfig} selectedVersion={h.selectedVersion} items={h.filteredItems} checkpointHistory={h.checkpointHistory} sortItems={sortItems} sprintDates={h.sprintDates} allVersionsConfig={h.allVersionsConfig} statusesWithTick={h.columnsConfig?.statusesWithTick||[]} /></div>}
          <ReleaseVersionLegend columnsConfig={h.columnsConfig} />
          {(()=>{ const m=checkReleaseLevelMissingDates(h.ganttConfig); return m.length>0?<div style={{padding:'0.75rem',marginBottom:'1rem',backgroundColor:'#fff3cd',borderLeft:'4px solid #ffc107',fontSize:'0.875rem',color:'#856404'}}><strong>Release-Level Notice:</strong> {m.join(', ')}. This applies to all items in this release.</div>:null; })()}
          {h.activeSection!=='longTermFunded' && <ReleaseVersionTableSection title={`Section 1: Commit${h.activeSection==='commit'&&filteredCount<totalCount?` (${h.filteredItems.commit.length} of ${h.items.commit?.length||0})`:''}`} description="Items with fixVersion matching selected version(s)" items={h.filteredItems.commit||[]} columnsConfig={h.columnsConfig} selectedVersion={h.selectedVersion} checkpointHistory={h.checkpointHistory} jiraBaseUrl={h.jiraBaseUrl} ganttConfig={h.ganttConfig} breakdownDataMap={h.breakdownDataMap} loadingBreakdowns={h.loadingBreakdowns} releaseContext={h.releaseContext} />}
          {h.activeSection!=='commit' && <ReleaseVersionTableSection title={`Section 2: Long-term-funded${h.activeSection==='longTermFunded'&&filteredCount<totalCount?` (${h.filteredItems.longTermFunded.length} of ${h.items.longTermFunded?.length||0})`:''}`} description={`Items with label matching "${h.selectedVersion.toLowerCase()}-long-term-funded"`} items={h.filteredItems.longTermFunded||[]} columnsConfig={h.columnsConfig} selectedVersion={h.selectedVersion} checkpointHistory={h.checkpointHistory} jiraBaseUrl={h.jiraBaseUrl} ganttConfig={h.ganttConfig} breakdownDataMap={h.breakdownDataMap} loadingBreakdowns={h.loadingBreakdowns} releaseContext={h.releaseContext} />}
          {h.selectedVersion && <p style={{marginTop:'1rem',fontSize:'0.9rem'}}><Link to={`/release-trends?version=${encodeURIComponent(h.selectedVersion)}`}>View release trends</Link></p>}
        </div>
      )}
    </div>
  );
}
export default ReleaseVersionTab;
