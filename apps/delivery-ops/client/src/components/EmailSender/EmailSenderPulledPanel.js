import React from 'react';
import EmailSenderPulledExtras from './EmailSenderPulledExtras';
import { getFieldValue, getFieldId } from '../../utils/jiraFields';
import {
  EXTRA_FETCH_FIELDS,
  renderFetchedFieldValue,
} from './emailSenderHelpers';

export default function EmailSenderPulledPanel({
  jiraData,
  jiraBaseUrl,
  jiraKey,
  pulledTicketDataOpen,
  setPulledTicketDataOpen,
  formatJiraWikiMarkup,
  featureDashExtras,
  epics,
  fetchingEpics,
  issueBreakdown,
  fetchingBreakdown,
  workItems,
  payloadJql,
  sprintGanttData,
  fetchingSprintGantt,
}) {
  if (!jiraData) return null;
  return (
      <details
        className="email-sender-more"
        open={pulledTicketDataOpen}
        onToggle={(e) => setPulledTicketDataOpen(e.currentTarget.open)}
      >
        <summary>Pulled ticket data — dates, status update, users, epics, breakdown, sprint</summary>
        <div className="email-sender-more-body">
        <h3 className="email-sender-more-title">Jira ticket details</h3>
        
        {/* Row 1: Key, Summary, Status, Fix Version, Labels - all in one row */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
          <tbody>
            <tr>
              <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 600, width: '6%' }}>Key</td>
              <td style={{ padding: '10px', border: '1px solid #dee2e6', width: '10%' }}>
                <a 
                  href={`${jiraBaseUrl}/browse/${jiraData.key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#0065ff', textDecoration: 'none' }}
                >
                  {jiraData.key}
                </a>
              </td>
              <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 600, width: '8%' }}>Summary</td>
              <td style={{ padding: '10px', border: '1px solid #dee2e6', width: '25%' }}>{jiraData.summary}</td>
              <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 600, width: '7%' }}>Status</td>
              <td style={{ padding: '10px', border: '1px solid #dee2e6', width: '12%' }}>{jiraData.status}</td>
              <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 600, width: '9%' }}>Fix Version</td>
              <td style={{ padding: '10px', border: '1px solid #dee2e6', width: '13%' }}>{jiraData.fixVersions || 'N/A'}</td>
            </tr>
            <tr>
              <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 600, width: '6%' }}>Labels</td>
              <td style={{ padding: '10px', border: '1px solid #dee2e6', width: '94%' }} colSpan={7}>{jiraData.labels || 'N/A'}</td>
            </tr>
          </tbody>
        </table>

        {/* Date fields row (fixed order): Requirements Done → FS/DS → Test Plan → Code Complete → CG → PG */}
        {(() => {
          const dateCells = [
            { field: getFieldValue(jiraData,'requirementsDone'), fallback: 'Rqmnts Done Date' },
            { field: getFieldValue(jiraData,'fsdsDone'), fallback: 'FS/DS Done Date' },
            { field: getFieldValue(jiraData,'testPlan'), fallback: 'Test Plan Date' },
            { field: getFieldValue(jiraData,'codeComplete'), fallback: 'Code Complete Date' },
            { field: getFieldValue(jiraData,'commitGate'), fallback: 'Commit Gate Ready Estimation Date' },
            { field: getFieldValue(jiraData,'promotionGate'), fallback: 'Promotion Gate Ready Estimation Date' },
          ];
          const isUnset = (f) => !f || !f.value || f.value === 'Not Set' || f.value === 'N/A' || f.value === 'NA';
          const cellStyle = { padding: '8px', border: '1px solid #dee2e6', width: '8.33%' };

          return (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
              <tbody>
                <tr>
                  {dateCells.map(({ field, fallback }) => {
                    const unset = isUnset(field);
                    return (
                      <React.Fragment key={fallback}>
                        <td style={{ ...cellStyle, fontWeight: 600 }}>
                          {field?.name || fallback}
                        </td>
                        <td style={{
                          ...cellStyle,
                          backgroundColor: unset ? '#fff3cd' : 'transparent',
                          fontWeight: unset ? 600 : 'normal',
                        }}>
                          {unset ? 'Not Set' : field.value}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          );
        })()}


        {EXTRA_FETCH_FIELDS.some(([id]) => jiraData[id]?.name) && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
            <tbody>
              <tr>
                {EXTRA_FETCH_FIELDS.map(([id, fallback]) => (
                  jiraData[id]?.name ? (
                    <React.Fragment key={id}>
                      <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                        {jiraData[id].name || fallback}
                      </td>
                      <td style={{
                        padding: '8px',
                        border: '1px solid #dee2e6',
                        width: '12.5%',
                        backgroundColor: (jiraData[id]?.value?.type === 'notSet' || jiraData[id]?.value === 'Not Set') ? '#fff3cd' : 'transparent',
                        fontWeight: (jiraData[id]?.value?.type === 'notSet' || jiraData[id]?.value === 'Not Set') ? 600 : 'normal'
                      }}>
                        {renderFetchedFieldValue(jiraData[id].value)}
                      </td>
                    </React.Fragment>
                  ) : null
                ))}
              </tr>
            </tbody>
          </table>
        )}

        {/* Row for cf[14463], cf[14464], cf[14465], cf[31460] TCMS */}
        {getFieldValue(jiraData,'requirementsLink')?.name || getFieldValue(jiraData,'tcmsLink')?.name || getFieldValue(jiraData,'designDocLink')?.name || getFieldValue(jiraData,'testPlanLink')?.name ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
            <tbody>
              <tr>
                {getFieldValue(jiraData,'requirementsLink')?.name && (
                  <>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                      {getFieldValue(jiraData,'requirementsLink').name}
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6', 
                      width: '12.5%',
                      backgroundColor: getFieldValue(jiraData,'requirementsLink')?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                      fontWeight: getFieldValue(jiraData,'requirementsLink')?.value?.type === 'notSet' ? 600 : 'normal'
                    }}>
                      {getFieldValue(jiraData,'requirementsLink')?.value?.type === 'link' ? (
                        <a 
                          href={getFieldValue(jiraData,'requirementsLink').value.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#0065ff', textDecoration: 'none' }}
                        >
                          {getFieldValue(jiraData,'requirementsLink').value.display}
                        </a>
                      ) : (
                        getFieldValue(jiraData,'requirementsLink')?.value?.display || 'Not Set'
                      )}
                    </td>
                  </>
                )}
                {getFieldValue(jiraData,'designDocLink')?.name && (
                  <>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                      {getFieldValue(jiraData,'designDocLink').name}
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6', 
                      width: '12.5%',
                      backgroundColor: getFieldValue(jiraData,'designDocLink')?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                      fontWeight: getFieldValue(jiraData,'designDocLink')?.value?.type === 'notSet' ? 600 : 'normal'
                    }}>
                      {getFieldValue(jiraData,'designDocLink')?.value?.type === 'link' ? (
                        <a 
                          href={getFieldValue(jiraData,'designDocLink').value.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#0065ff', textDecoration: 'none' }}
                        >
                          {getFieldValue(jiraData,'designDocLink').value.display}
                        </a>
                      ) : (
                        getFieldValue(jiraData,'designDocLink')?.value?.display || 'Not Set'
                      )}
                    </td>
                  </>
                )}
                {getFieldValue(jiraData,'testPlanLink')?.name && (
                  <>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                      {getFieldValue(jiraData,'testPlanLink').name}
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6', 
                      width: '12.5%',
                      backgroundColor: getFieldValue(jiraData,'testPlanLink')?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                      fontWeight: getFieldValue(jiraData,'testPlanLink')?.value?.type === 'notSet' ? 600 : 'normal'
                    }}>
                      {getFieldValue(jiraData,'testPlanLink')?.value?.type === 'link' ? (
                        <a 
                          href={getFieldValue(jiraData,'testPlanLink').value.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#0065ff', textDecoration: 'none' }}
                        >
                          {getFieldValue(jiraData,'testPlanLink').value.display}
                        </a>
                      ) : (
                        getFieldValue(jiraData,'testPlanLink')?.value?.display || 'Not Set'
                      )}
                    </td>
                  </>
                )}
                {getFieldValue(jiraData,'tcmsLink')?.name && (
                  <>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                      {getFieldValue(jiraData,'tcmsLink').name}
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6', 
                      width: '12.5%',
                      backgroundColor: getFieldValue(jiraData,'tcmsLink')?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                      fontWeight: getFieldValue(jiraData,'tcmsLink')?.value?.type === 'notSet' ? 600 : 'normal'
                    }}>
                      {getFieldValue(jiraData,'tcmsLink')?.value?.type === 'link' ? (
                        <a 
                          href={getFieldValue(jiraData,'tcmsLink').value.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#0065ff', textDecoration: 'none' }}
                        >
                          {getFieldValue(jiraData,'tcmsLink').value.display}
                        </a>
                      ) : (
                        getFieldValue(jiraData,'tcmsLink')?.value?.display || 'Not Set'
                      )}
                    </td>
                  </>
                )}
              </tr>
            </tbody>
          </table>
        ) : null}

        {/* Helper function to check if a field is a date field already displayed */}
        {(() => {
          const isDateField = (field) => {
            if (!field || !field.name) return false;
            const nameLower = field.name.toLowerCase();
            return nameLower.includes('code complete') ||
                   nameLower.includes('fs/ds done') ||
                   nameLower.includes('fs done') ||
                   nameLower.includes('ds done') ||
                   nameLower.includes('test plan') ||
                   nameLower.includes('commit gate') ||
                   nameLower.includes('promotion gate');
          };

          return (
            <>
              {/* Row for cf[23073] - Only show if it's not a date field */}
              {getFieldValue(jiraData,'statusUpdate') && !isDateField(getFieldValue(jiraData,'statusUpdate')) && (
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '10px', color: '#1a1a1a' }}>
                    {getFieldValue(jiraData,'statusUpdate').name}
                  </h3>
                  <div 
                    style={{ 
                      backgroundColor: '#f8f9fa',
                      padding: '15px',
                      borderLeft: '4px solid #0066cc',
                      borderRadius: '4px',
                      fontSize: '14px',
                      lineHeight: '1.8',
                      color: '#333333'
                    }}
                    dangerouslySetInnerHTML={{ 
                      __html: formatJiraWikiMarkup(getFieldValue(jiraData,'statusUpdate').value || 'Not Set')
                    }}
                  />
                </div>
              )}

              {/* Row for cf[45660] - Only show if it's not a date field */}
              {getFieldValue(jiraData,'statusUpdateDate') && !isDateField(getFieldValue(jiraData,'statusUpdateDate')) && (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '30%' }}>{getFieldValue(jiraData,'statusUpdateDate').name}</td>
                      <td style={{ 
                        padding: '8px', 
                        border: '1px solid #dee2e6',
                        backgroundColor: (!getFieldValue(jiraData,'statusUpdateDate').value || getFieldValue(jiraData,'statusUpdateDate').value === 'Not Set') ? '#fff3cd' : 'transparent',
                        fontWeight: (!getFieldValue(jiraData,'statusUpdateDate').value || getFieldValue(jiraData,'statusUpdateDate').value === 'Not Set') ? 600 : 'normal'
                      }}>
                        {getFieldValue(jiraData,'statusUpdateDate').value || 'Not Set'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}

              {/* Note: riskIndicator (Risk Indicator) is already displayed in Row 1, so we skip it here */}

              {/* Row for cf[11068] - Only show if it's not a date field */}
              {getFieldValue(jiraData,'testPlan') && !isDateField(getFieldValue(jiraData,'testPlan')) && (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '30%' }}>{getFieldValue(jiraData,'testPlan').name}</td>
                      <td style={{ 
                        padding: '8px', 
                        border: '1px solid #dee2e6',
                        backgroundColor: (!getFieldValue(jiraData,'testPlan').value || getFieldValue(jiraData,'testPlan').value === 'Not Set') ? '#fff3cd' : 'transparent',
                        fontWeight: (!getFieldValue(jiraData,'testPlan').value || getFieldValue(jiraData,'testPlan').value === 'Not Set') ? 600 : 'normal'
                      }}>
                        {getFieldValue(jiraData,'testPlan').value || 'Not Set'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </>
          );
        })()}

        {/* JIRA Users Section - Display all people who will be CC'd */}
        {(jiraData.reporter || jiraData.assignee || jiraData.watchers || 
          getFieldValue(jiraData,'uxOwner') || getFieldValue(jiraData,'qaContact') || getFieldValue(jiraData,'testLead') || getFieldValue(jiraData,'guiLead') || getFieldValue(jiraData,'pmOwner') || getFieldValue(jiraData,'tpmOwner') || getFieldValue(jiraData,'teamMembers')) && (
          <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #dee2e6' }}>
            <h4 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>
              JIRA Users (will be included in CC)
            </h4>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {jiraData.assignee && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                      Assignee
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {jiraData.assignee.displayName || jiraData.assignee.name || jiraData.assignee.emailAddress || jiraData.assignee.email || 'N/A'}
                      {jiraData.assignee.emailAddress && (
                        <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                          ({jiraData.assignee.emailAddress})
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {getFieldValue(jiraData,'uxOwner') && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                      UX Owner
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {typeof getFieldValue(jiraData,'uxOwner') === 'string' 
                        ? getFieldValue(jiraData,'uxOwner')
                        : (getFieldValue(jiraData,'uxOwner').displayName || getFieldValue(jiraData,'uxOwner').name || getFieldValue(jiraData,'uxOwner').emailAddress || getFieldValue(jiraData,'uxOwner').email || 'N/A')}
                      {getFieldValue(jiraData,'uxOwner') && typeof getFieldValue(jiraData,'uxOwner') !== 'string' && getFieldValue(jiraData,'uxOwner').emailAddress && (
                        <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                          ({getFieldValue(jiraData,'uxOwner').emailAddress})
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {(getFieldValue(jiraData,'qaContact') || getFieldValue(jiraData,'testLead')) && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px', verticalAlign: 'top' }}>
                      QA Contact / Test Lead
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {getFieldValue(jiraData,'qaContact') && (
                          <div>
                            <span style={{ fontWeight: 500, color: '#666', fontSize: '12px' }}>QA Contact:</span>{' '}
                            {typeof getFieldValue(jiraData,'qaContact') === 'string' 
                              ? getFieldValue(jiraData,'qaContact')
                              : (getFieldValue(jiraData,'qaContact').displayName || getFieldValue(jiraData,'qaContact').name || getFieldValue(jiraData,'qaContact').emailAddress || getFieldValue(jiraData,'qaContact').email || 'N/A')}
                            {getFieldValue(jiraData,'qaContact') && typeof getFieldValue(jiraData,'qaContact') !== 'string' && getFieldValue(jiraData,'qaContact').emailAddress && (
                              <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                                ({getFieldValue(jiraData,'qaContact').emailAddress})
                              </span>
                            )}
                          </div>
                        )}
                        {getFieldValue(jiraData,'testLead') && (
                          <div>
                            <span style={{ fontWeight: 500, color: '#666', fontSize: '12px' }}>Test Lead:</span>{' '}
                            {typeof getFieldValue(jiraData,'testLead') === 'string' 
                              ? getFieldValue(jiraData,'testLead')
                              : (getFieldValue(jiraData,'testLead').displayName || getFieldValue(jiraData,'testLead').name || getFieldValue(jiraData,'testLead').emailAddress || getFieldValue(jiraData,'testLead').email || 'N/A')}
                            {getFieldValue(jiraData,'testLead') && typeof getFieldValue(jiraData,'testLead') !== 'string' && getFieldValue(jiraData,'testLead').emailAddress && (
                              <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                                ({getFieldValue(jiraData,'testLead').emailAddress})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {getFieldValue(jiraData,'guiLead') && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                      GUI Lead
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {typeof getFieldValue(jiraData,'guiLead') === 'string' 
                        ? getFieldValue(jiraData,'guiLead')
                        : (getFieldValue(jiraData,'guiLead').displayName || getFieldValue(jiraData,'guiLead').name || getFieldValue(jiraData,'guiLead').emailAddress || getFieldValue(jiraData,'guiLead').email || 'N/A')}
                      {getFieldValue(jiraData,'guiLead') && typeof getFieldValue(jiraData,'guiLead') !== 'string' && getFieldValue(jiraData,'guiLead').emailAddress && (
                        <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                          ({getFieldValue(jiraData,'guiLead').emailAddress})
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {getFieldValue(jiraData,'pmOwner') && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                      PM Owner
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {typeof getFieldValue(jiraData,'pmOwner') === 'string' 
                        ? getFieldValue(jiraData,'pmOwner')
                        : (getFieldValue(jiraData,'pmOwner').displayName || getFieldValue(jiraData,'pmOwner').name || getFieldValue(jiraData,'pmOwner').emailAddress || getFieldValue(jiraData,'pmOwner').email || 'N/A')}
                      {getFieldValue(jiraData,'pmOwner') && typeof getFieldValue(jiraData,'pmOwner') !== 'string' && getFieldValue(jiraData,'pmOwner').emailAddress && (
                        <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                          ({getFieldValue(jiraData,'pmOwner').emailAddress})
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {getFieldValue(jiraData,'tpmOwner') && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                      Program Mgr
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {typeof getFieldValue(jiraData,'tpmOwner') === 'string' 
                        ? getFieldValue(jiraData,'tpmOwner')
                        : (getFieldValue(jiraData,'tpmOwner').displayName || getFieldValue(jiraData,'tpmOwner').name || getFieldValue(jiraData,'tpmOwner').emailAddress || getFieldValue(jiraData,'tpmOwner').email || 'N/A')}
                      {getFieldValue(jiraData,'tpmOwner') && typeof getFieldValue(jiraData,'tpmOwner') !== 'string' && getFieldValue(jiraData,'tpmOwner').emailAddress && (
                        <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                          ({getFieldValue(jiraData,'tpmOwner').emailAddress})
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {getFieldValue(jiraData,'teamMembers') && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px', verticalAlign: 'top' }}>
                      Team Members
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {Array.isArray(getFieldValue(jiraData,'teamMembers')) ? (
                        <div>
                          {getFieldValue(jiraData,'teamMembers').map((member, index) => {
                            const name = typeof member === 'string' 
                              ? member 
                              : (member?.displayName || member?.name || member?.emailAddress || member?.email || 'N/A');
                            const email = typeof member === 'object' ? (member?.emailAddress || member?.email) : null;
                            return (
                              <div key={index} style={{ marginBottom: index < getFieldValue(jiraData,'teamMembers').length - 1 ? '4px' : 0 }}>
                                {name}
                                {email && (
                                  <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                                    ({email})
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : typeof getFieldValue(jiraData,'teamMembers') === 'string' ? (
                        getFieldValue(jiraData,'teamMembers')
                      ) : (
                        <div>
                          {getFieldValue(jiraData,'teamMembers').displayName || getFieldValue(jiraData,'teamMembers').name || getFieldValue(jiraData,'teamMembers').emailAddress || getFieldValue(jiraData,'teamMembers').email || 'N/A'}
                          {getFieldValue(jiraData,'teamMembers').emailAddress && (
                            <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                              ({getFieldValue(jiraData,'teamMembers').emailAddress})
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                {jiraData.reporter && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                      Reporter
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {jiraData.reporter.displayName || jiraData.reporter.name || jiraData.reporter.emailAddress || jiraData.reporter.email || 'N/A'}
                      {jiraData.reporter.emailAddress && (
                        <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                          ({jiraData.reporter.emailAddress})
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {jiraData.watchers && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px', verticalAlign: 'top' }}>
                      Watchers
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {(() => {
                        // Handle different watchers structures
                        let watchersList = [];
                        
                        if (jiraData.watchers.watchers && Array.isArray(jiraData.watchers.watchers)) {
                          // Standard JIRA watchers structure: { watchers: [...] }
                          watchersList = jiraData.watchers.watchers;
                        } else if (Array.isArray(jiraData.watchers)) {
                          // If watchers is directly an array
                          watchersList = jiraData.watchers;
                        } else if (jiraData.watchers) {
                          // If it's a single watcher object
                          watchersList = [jiraData.watchers];
                        }
                        
                        if (watchersList.length === 0) {
                          return <span style={{ color: '#666', fontStyle: 'italic' }}>No watchers</span>;
                        }
                        
                        return watchersList.map((watcher, index) => (
                          <div key={index} style={{ marginBottom: index < watchersList.length - 1 ? '4px' : '0' }}>
                            {typeof watcher === 'string' 
                              ? watcher
                              : (watcher.displayName || watcher.name || watcher.emailAddress || watcher.email || 'N/A')}
                            {watcher && typeof watcher !== 'string' && watcher.emailAddress && (
                              <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                                ({watcher.emailAddress})
                              </span>
                            )}
                          </div>
                        ));
                      })()}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p style={{ marginTop: '10px', fontSize: '12px', color: '#666', fontStyle: 'italic' }}>
              These users will be automatically added to the email CC list.
            </p>
          </div>
        )}


        <EmailSenderPulledExtras
          jiraBaseUrl={jiraBaseUrl}
          jiraKey={jiraKey}
          featureDashExtras={featureDashExtras}
          epics={epics}
          fetchingEpics={fetchingEpics}
          issueBreakdown={issueBreakdown}
          fetchingBreakdown={fetchingBreakdown}
          workItems={workItems}
          payloadJql={payloadJql}
          sprintGanttData={sprintGanttData}
          fetchingSprintGantt={fetchingSprintGantt}
        />
            </div>
      </details>

  );
}
