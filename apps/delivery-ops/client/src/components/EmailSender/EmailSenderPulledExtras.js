import React from 'react';
import { FeatureAnalyticsRow } from '../../feature/FeatureAnalyticsWidgets';
import { ProjectPlanView } from '../../shared/components/ProjectPlanView';
import { getFieldValue } from '../../utils/jiraFields';
import IssueTypeBreakdownCompact from './IssueTypeBreakdownCompact';

export default function EmailSenderPulledExtras({
  jiraBaseUrl,
  jiraKey = '',
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
  return (
    <>
      {/* Epics Section */}
      {fetchingEpics && (
        <div className="form-group" style={{ marginTop: '20px', textAlign: 'center' }}>
          <small style={{ color: '#6c757d' }}>Loading epics...</small>
        </div>
      )}

      {epics && epics.length > 0 && (() => {
        // Map Status Sender epics (Feature → childEpics) to ProjectPlanView groups shape
        const groups = epics.map((feature) => ({
          key: feature.key,
          summary: feature.summary,
          status: feature.status,
          issueType: feature.issueType,
          duedate: feature.duedate,
          fixVersions: feature.fixVersions,
          assignee: feature.assignee,
          qaContact: (getFieldValue(feature, 'qaContact') ?? feature.customfield_10860)?.value || null,
          // ProjectPlanView accepts either childItems or childEpics
          childItems: (feature.childEpics || []).map((epic) => ({
            key: epic.key,
            summary: epic.summary,
            status: epic.status,
            issueType: epic.issueType,
            resolution: epic.resolution,
            assignee: epic.assignee,
            qaContact: (getFieldValue(epic, 'qaContact') ?? epic.customfield_10860)?.value || null,
            customfield_10860: getFieldValue(epic, 'qaContact') ?? epic.customfield_10860,
            duedate: epic.duedate,
            fixVersions: epic.fixVersions,
            priority: epic.priority || null,
          })),
        }));
        return (
          <div className="form-group" style={{ marginTop: '20px' }}>
            <div className="fd-section">
              <ProjectPlanView
                groups={groups}
                jiraBaseUrl={jiraBaseUrl}
                canonicalJql={payloadJql || `key = ${String(jiraKey || '').trim()}`}
                columns={['key', 'type', 'summary', 'status', 'resolution', 'assignee', 'qaContact', 'dueDate', 'fixVersions']}
                title="Epics"
              />
            </div>
          </div>
        );
      })()}

      {/* Compact issue-type × status (email + UI); analytics widgets are UI-only */}
      {(fetchingBreakdown || issueBreakdown) && (
        <div className="form-group" style={{ marginTop: '16px' }}>
          <IssueTypeBreakdownCompact
            issueBreakdown={issueBreakdown}
            loading={fetchingBreakdown && !issueBreakdown}
          />
        </div>
      )}

      {workItems && workItems.length > 0 && (
        <div className="form-group" style={{
          marginTop: '12px',
          padding: '12px',
          backgroundColor: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
        }}>
          <h3 style={{ marginTop: 0, marginBottom: '4px', fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>
            Payload analytics
          </h3>
          <p style={{ marginBottom: '10px', fontSize: '12px', color: '#6b7280' }}>
            {workItems.length} work items · same widgets as Feature Dashboard
          </p>
          <FeatureAnalyticsRow
            issues={workItems}
            canonicalJql={payloadJql || `key = ${jiraKey.trim()}`}
            jiraBaseUrl={jiraBaseUrl}
            teamKpiBoxes={featureDashExtras?.teamKpiBoxes || []}
          />
        </div>
      )}

      {/* Sprint Gantt Chart Section */}
      {fetchingSprintGantt && (
        <div className="form-group" style={{ marginTop: '20px', textAlign: 'center' }}>
          <small style={{ color: '#6c757d' }}>Loading sprint timeline...</small>
        </div>
      )}

      {sprintGanttData && sprintGanttData.sprintTickets && sprintGanttData.sprintTickets.length > 0 && (
        <div className="form-group" style={{
          marginTop: '20px',
          padding: '20px',
          backgroundColor: '#ffffff',
          border: '1px solid #1a1a1a'
        }}>
          <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px', fontWeight: 600, color: '#1a1a1a' }}>
            📅 Sprint Timeline - Project Tickets
          </h3>
          <p style={{ marginBottom: '15px', fontSize: '13px', color: '#666666' }}>
            Total Sprint Tickets: {sprintGanttData.sprintTickets.length} | 
            In Sprint: {sprintGanttData.sprintTickets.filter(t => t.sprintEndDate).length} | 
            Unassigned: {sprintGanttData.sprintTickets.filter(t => !t.sprintEndDate).length}
          </p>

          {/* Timeline Controls */}
          <div style={{ marginBottom: '15px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '13px', fontWeight: 500 }}>
              View: 
              <select 
                style={{ 
                  marginLeft: '5px', 
                  padding: '4px 8px', 
                  border: '1px solid #dee2e6', 
                  borderRadius: '4px',
                  fontSize: '13px'
                }}
                defaultValue="monthly"
                onChange={(_e) => {
                  // Update view mode - we'll implement this with state if needed
                }}
              >
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
          </div>

          {/* Gantt Chart */}
          <div style={{ overflowX: 'auto', border: '1px solid #dee2e6', borderRadius: '4px' }}>
            <table style={{ width: '100%', minWidth: '800px', borderCollapse: 'collapse', backgroundColor: '#ffffff' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ 
                    border: '1px solid #dee2e6', 
                    padding: '10px', 
                    textAlign: 'left', 
                    fontWeight: 600, 
                    fontSize: '13px',
                    minWidth: '200px',
                    position: 'sticky',
                    left: 0,
                    backgroundColor: '#f8f9fa',
                    zIndex: 1
                  }}>
                    Ticket
                  </th>
                  {sprintGanttData.timelineColumns && sprintGanttData.timelineColumns.map((col, index) => (
                    <th key={index} style={{ 
                      border: '1px solid #dee2e6', 
                      padding: '8px', 
                      textAlign: 'center', 
                      fontWeight: 600, 
                      fontSize: '11px',
                      minWidth: '80px',
                      backgroundColor: col.isToday ? '#fef2f2' : '#f8f9fa',
                      color: col.isToday ? '#dc2626' : '#1a1a1a'
                    }}>
                      {col.label}
                      {col.isToday && <div style={{ fontSize: '9px', color: '#dc2626' }}>TODAY</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sprintGanttData.sprintTickets.map((ticket, ticketIndex) => (
                  <tr key={ticket.key} style={{ 
                    backgroundColor: ticketIndex % 2 === 0 ? '#ffffff' : '#fafafa',
                    ':hover': { backgroundColor: '#f0f9ff' }
                  }}>
                    <td style={{ 
                      border: '1px solid #dee2e6', 
                      padding: '8px',
                      position: 'sticky',
                      left: 0,
                      backgroundColor: ticketIndex % 2 === 0 ? '#ffffff' : '#fafafa',
                      zIndex: 1
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div style={{ 
                          fontFamily: 'monospace', 
                          fontWeight: 500, 
                          color: '#0066cc', 
                          fontSize: '12px' 
                        }}>
                          {ticket.key}
                        </div>
                        <div style={{ 
                          fontSize: '11px', 
                          color: '#666666',
                          maxWidth: '180px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }} title={ticket.summary}>
                          {ticket.summary}
                        </div>
                        {ticket.sprintName && (
                          <div style={{ 
                            fontSize: '10px', 
                            color: '#059669',
                            fontWeight: 500
                          }}>
                            {ticket.sprintName}
                          </div>
                        )}
                      </div>
                    </td>
                    {sprintGanttData.timelineColumns && sprintGanttData.timelineColumns.map((col, colIndex) => {
                      const isInSprint = ticket.sprintStartDate && ticket.sprintEndDate &&
                        new Date(ticket.sprintStartDate) <= new Date(col.endDate) &&
                        new Date(ticket.sprintEndDate) >= new Date(col.startDate);
                      
                      const showTodayMarker = col.isToday;
                      
                      return (
                        <td key={colIndex} style={{ 
                          border: '1px solid #dee2e6', 
                          padding: '4px',
                          textAlign: 'center',
                          verticalAlign: 'middle',
                          position: 'relative',
                          backgroundColor: showTodayMarker ? '#fef2f2' : 'transparent'
                        }}>
                          {isInSprint ? (
                            <div style={{
                              height: '20px',
                              backgroundColor: '#059669',
                              borderRadius: '10px',
                              margin: '0 2px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '9px',
                              color: 'white',
                              fontWeight: 500,
                              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                            }} title={`Sprint: ${ticket.sprintName}\n${ticket.sprintStartDate} - ${ticket.sprintEndDate}`}>
                              SPRINT
                            </div>
                          ) : ticket.sprintEndDate ? null : (
                            showTodayMarker && (
                              <div style={{
                                width: '12px',
                                height: '12px',
                                backgroundColor: '#94a3b8',
                                borderRadius: '50%',
                                margin: '4px auto',
                                opacity: 0.7
                              }} title="No sprint assigned" />
                            )
                          )}
                          {showTodayMarker && (
                            <div style={{
                              position: 'absolute',
                              top: 0,
                              bottom: 0,
                              left: '50%',
                              width: '2px',
                              backgroundColor: '#dc2626',
                              transform: 'translateX(-50%)',
                              zIndex: 2
                            }} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div style={{ marginTop: '15px', display: 'flex', gap: '20px', fontSize: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '20px', height: '12px', backgroundColor: '#059669', borderRadius: '6px' }}></div>
              <span>Sprint Timeline</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '12px', height: '12px', backgroundColor: '#94a3b8', borderRadius: '50%', opacity: 0.7 }}></div>
              <span>No Sprint Assigned</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '2px', height: '12px', backgroundColor: '#dc2626' }}></div>
              <span>Today</span>
            </div>
          </div>

          {/* Sprint Statistics */}
          {sprintGanttData.sprintStats && (
            <div style={{ 
              marginTop: '15px', 
              padding: '12px', 
              backgroundColor: '#f8f9fa', 
              borderRadius: '4px',
              border: '1px solid #e9ecef'
            }}>
              <h4 style={{ marginTop: 0, marginBottom: '8px', fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>
                Sprint Statistics
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', fontSize: '13px' }}>
                <div>
                  <strong>Sprint Coverage:</strong> {sprintGanttData.sprintStats.sprintCoverage}%
                </div>
                <div>
                  <strong>Active Sprints:</strong> {sprintGanttData.sprintStats.activeSprints}
                </div>
                <div>
                  <strong>Avg Sprint Length:</strong> {sprintGanttData.sprintStats.avgSprintLength} days
                </div>
                <div>
                  <strong>Next Sprint End:</strong> {sprintGanttData.sprintStats.nextSprintEnd || 'N/A'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

    </>
  );
}
