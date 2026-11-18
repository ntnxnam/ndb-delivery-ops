import React from 'react';
import EmailSenderPulledExtras from './EmailSenderPulledExtras';
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
            { field: jiraData.customfield_13860, fallback: 'Rqmnts Done Date' },
            { field: jiraData.customfield_13861, fallback: 'FS/DS Done Date' },
            { field: jiraData.customfield_11068, fallback: 'Test Plan Date' },
            { field: jiraData.customfield_11067, fallback: 'Code Complete Date' },
            { field: jiraData.customfield_35863, fallback: 'Commit Gate Ready Estimation Date' },
            { field: jiraData.customfield_35864, fallback: 'Promotion Gate Ready Estimation Date' },
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
        {jiraData.customfield_14463?.name || jiraData.customfield_31460?.name || jiraData.customfield_14464?.name || jiraData.customfield_14465?.name ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
            <tbody>
              <tr>
                {jiraData.customfield_14463?.name && (
                  <>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                      {jiraData.customfield_14463.name}
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6', 
                      width: '12.5%',
                      backgroundColor: jiraData.customfield_14463?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                      fontWeight: jiraData.customfield_14463?.value?.type === 'notSet' ? 600 : 'normal'
                    }}>
                      {jiraData.customfield_14463?.value?.type === 'link' ? (
                        <a 
                          href={jiraData.customfield_14463.value.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#0065ff', textDecoration: 'none' }}
                        >
                          {jiraData.customfield_14463.value.display}
                        </a>
                      ) : (
                        jiraData.customfield_14463?.value?.display || 'Not Set'
                      )}
                    </td>
                  </>
                )}
                {jiraData.customfield_14464?.name && (
                  <>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                      {jiraData.customfield_14464.name}
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6', 
                      width: '12.5%',
                      backgroundColor: jiraData.customfield_14464?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                      fontWeight: jiraData.customfield_14464?.value?.type === 'notSet' ? 600 : 'normal'
                    }}>
                      {jiraData.customfield_14464?.value?.type === 'link' ? (
                        <a 
                          href={jiraData.customfield_14464.value.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#0065ff', textDecoration: 'none' }}
                        >
                          {jiraData.customfield_14464.value.display}
                        </a>
                      ) : (
                        jiraData.customfield_14464?.value?.display || 'Not Set'
                      )}
                    </td>
                  </>
                )}
                {jiraData.customfield_14465?.name && (
                  <>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                      {jiraData.customfield_14465.name}
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6', 
                      width: '12.5%',
                      backgroundColor: jiraData.customfield_14465?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                      fontWeight: jiraData.customfield_14465?.value?.type === 'notSet' ? 600 : 'normal'
                    }}>
                      {jiraData.customfield_14465?.value?.type === 'link' ? (
                        <a 
                          href={jiraData.customfield_14465.value.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#0065ff', textDecoration: 'none' }}
                        >
                          {jiraData.customfield_14465.value.display}
                        </a>
                      ) : (
                        jiraData.customfield_14465?.value?.display || 'Not Set'
                      )}
                    </td>
                  </>
                )}
                {jiraData.customfield_31460?.name && (
                  <>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '12.5%' }}>
                      {jiraData.customfield_31460.name}
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6', 
                      width: '12.5%',
                      backgroundColor: jiraData.customfield_31460?.value?.type === 'notSet' ? '#fff3cd' : 'transparent',
                      fontWeight: jiraData.customfield_31460?.value?.type === 'notSet' ? 600 : 'normal'
                    }}>
                      {jiraData.customfield_31460?.value?.type === 'link' ? (
                        <a 
                          href={jiraData.customfield_31460.value.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#0065ff', textDecoration: 'none' }}
                        >
                          {jiraData.customfield_31460.value.display}
                        </a>
                      ) : (
                        jiraData.customfield_31460?.value?.display || 'Not Set'
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
              {jiraData.customfield_23073 && !isDateField(jiraData.customfield_23073) && (
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '10px', color: '#1a1a1a' }}>
                    {jiraData.customfield_23073.name}
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
                      __html: formatJiraWikiMarkup(jiraData.customfield_23073.value || 'Not Set')
                    }}
                  />
                </div>
              )}

              {/* Row for cf[45660] - Only show if it's not a date field */}
              {jiraData.customfield_45660 && !isDateField(jiraData.customfield_45660) && (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '30%' }}>{jiraData.customfield_45660.name}</td>
                      <td style={{ 
                        padding: '8px', 
                        border: '1px solid #dee2e6',
                        backgroundColor: (!jiraData.customfield_45660.value || jiraData.customfield_45660.value === 'Not Set') ? '#fff3cd' : 'transparent',
                        fontWeight: (!jiraData.customfield_45660.value || jiraData.customfield_45660.value === 'Not Set') ? 600 : 'normal'
                      }}>
                        {jiraData.customfield_45660.value || 'Not Set'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}

              {/* Note: customfield_23560 (Risk Indicator) is already displayed in Row 1, so we skip it here */}

              {/* Row for cf[11068] - Only show if it's not a date field */}
              {jiraData.customfield_11068 && !isDateField(jiraData.customfield_11068) && (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '30%' }}>{jiraData.customfield_11068.name}</td>
                      <td style={{ 
                        padding: '8px', 
                        border: '1px solid #dee2e6',
                        backgroundColor: (!jiraData.customfield_11068.value || jiraData.customfield_11068.value === 'Not Set') ? '#fff3cd' : 'transparent',
                        fontWeight: (!jiraData.customfield_11068.value || jiraData.customfield_11068.value === 'Not Set') ? 600 : 'normal'
                      }}>
                        {jiraData.customfield_11068.value || 'Not Set'}
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
          jiraData.customfield_15968 || jiraData.customfield_10860 || jiraData.customfield_11065 || jiraData.customfield_11861 || jiraData.customfield_11260 || jiraData.customfield_27764 || jiraData.customfield_51460) && (
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
                {jiraData.customfield_15968 && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                      UX Owner
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {typeof jiraData.customfield_15968 === 'string' 
                        ? jiraData.customfield_15968
                        : (jiraData.customfield_15968.displayName || jiraData.customfield_15968.name || jiraData.customfield_15968.emailAddress || jiraData.customfield_15968.email || 'N/A')}
                      {jiraData.customfield_15968 && typeof jiraData.customfield_15968 !== 'string' && jiraData.customfield_15968.emailAddress && (
                        <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                          ({jiraData.customfield_15968.emailAddress})
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {(jiraData.customfield_10860 || jiraData.customfield_11065) && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px', verticalAlign: 'top' }}>
                      QA Contact / Test Lead
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {jiraData.customfield_10860 && (
                          <div>
                            <span style={{ fontWeight: 500, color: '#666', fontSize: '12px' }}>QA Contact:</span>{' '}
                            {typeof jiraData.customfield_10860 === 'string' 
                              ? jiraData.customfield_10860
                              : (jiraData.customfield_10860.displayName || jiraData.customfield_10860.name || jiraData.customfield_10860.emailAddress || jiraData.customfield_10860.email || 'N/A')}
                            {jiraData.customfield_10860 && typeof jiraData.customfield_10860 !== 'string' && jiraData.customfield_10860.emailAddress && (
                              <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                                ({jiraData.customfield_10860.emailAddress})
                              </span>
                            )}
                          </div>
                        )}
                        {jiraData.customfield_11065 && (
                          <div>
                            <span style={{ fontWeight: 500, color: '#666', fontSize: '12px' }}>Test Lead:</span>{' '}
                            {typeof jiraData.customfield_11065 === 'string' 
                              ? jiraData.customfield_11065
                              : (jiraData.customfield_11065.displayName || jiraData.customfield_11065.name || jiraData.customfield_11065.emailAddress || jiraData.customfield_11065.email || 'N/A')}
                            {jiraData.customfield_11065 && typeof jiraData.customfield_11065 !== 'string' && jiraData.customfield_11065.emailAddress && (
                              <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                                ({jiraData.customfield_11065.emailAddress})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {jiraData.customfield_11861 && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                      GUI Lead
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {typeof jiraData.customfield_11861 === 'string' 
                        ? jiraData.customfield_11861
                        : (jiraData.customfield_11861.displayName || jiraData.customfield_11861.name || jiraData.customfield_11861.emailAddress || jiraData.customfield_11861.email || 'N/A')}
                      {jiraData.customfield_11861 && typeof jiraData.customfield_11861 !== 'string' && jiraData.customfield_11861.emailAddress && (
                        <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                          ({jiraData.customfield_11861.emailAddress})
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {jiraData.customfield_11260 && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                      PM Owner
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {typeof jiraData.customfield_11260 === 'string' 
                        ? jiraData.customfield_11260
                        : (jiraData.customfield_11260.displayName || jiraData.customfield_11260.name || jiraData.customfield_11260.emailAddress || jiraData.customfield_11260.email || 'N/A')}
                      {jiraData.customfield_11260 && typeof jiraData.customfield_11260 !== 'string' && jiraData.customfield_11260.emailAddress && (
                        <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                          ({jiraData.customfield_11260.emailAddress})
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {jiraData.customfield_27764 && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px' }}>
                      Program Mgr
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {typeof jiraData.customfield_27764 === 'string' 
                        ? jiraData.customfield_27764
                        : (jiraData.customfield_27764.displayName || jiraData.customfield_27764.name || jiraData.customfield_27764.emailAddress || jiraData.customfield_27764.email || 'N/A')}
                      {jiraData.customfield_27764 && typeof jiraData.customfield_27764 !== 'string' && jiraData.customfield_27764.emailAddress && (
                        <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                          ({jiraData.customfield_27764.emailAddress})
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {jiraData.customfield_51460 && (
                  <tr>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 600, width: '20%', fontSize: '13px', verticalAlign: 'top' }}>
                      Team Members
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #dee2e6', fontSize: '13px' }}>
                      {Array.isArray(jiraData.customfield_51460) ? (
                        <div>
                          {jiraData.customfield_51460.map((member, index) => {
                            const name = typeof member === 'string' 
                              ? member 
                              : (member?.displayName || member?.name || member?.emailAddress || member?.email || 'N/A');
                            const email = typeof member === 'object' ? (member?.emailAddress || member?.email) : null;
                            return (
                              <div key={index} style={{ marginBottom: index < jiraData.customfield_51460.length - 1 ? '4px' : 0 }}>
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
                      ) : typeof jiraData.customfield_51460 === 'string' ? (
                        jiraData.customfield_51460
                      ) : (
                        <div>
                          {jiraData.customfield_51460.displayName || jiraData.customfield_51460.name || jiraData.customfield_51460.emailAddress || jiraData.customfield_51460.email || 'N/A'}
                          {jiraData.customfield_51460.emailAddress && (
                            <span style={{ color: '#666', marginLeft: '8px', fontSize: '12px' }}>
                              ({jiraData.customfield_51460.emailAddress})
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
