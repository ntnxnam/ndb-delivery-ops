/**
 * IssueTypeBreakdownTable — displays 6 issue type groups breakdown.
 *
 * Takes the engineering payload JQL from synopsis and generates
 * a table with issue type group distribution using the issue-type-breakdown skill.
 *
 * Per the skill: always output all 6 groups (including zero-count rows).
 */

import React from 'react';
import { SectionPanel, Pill } from '../../design-system';
import { jiraSearchUrl } from '../services/releaseBriefService';

export function IssueTypeBreakdownTable({ synopsis, jiraBaseUrl, selectedRelease }) {
  if (!synopsis || !synopsis.total) {
    return (
      <SectionPanel
        title="Issue Type Breakdown"
        caption={selectedRelease ? 'Loading…' : 'No data available.'}
      >
        <div style={{ color: '#666', fontSize: '0.9rem', padding: '1rem' }}>
          No issue type data available.
        </div>
      </SectionPanel>
    );
  }

  // Get issue type group breakdown from synopsis (server-computed in /synopsis endpoint)
  const groups = (synopsis.issueTypeGroups || []).map((group) => ({
    name: group.label,
    count: group.count,
    jql: group.jql,
    error: group.error,
    url: group.jql && jiraBaseUrl ? jiraSearchUrl(jiraBaseUrl, group.jql) : '',
  }));

  if (groups.length === 0) {
    return null;
  }

  const totalCount = synopsis.total.count || 0;

  return (
    <SectionPanel
      title="Issue Type Breakdown"
      caption={
        selectedRelease
          ? `6-group classification for ${selectedRelease} release payload (${totalCount} total issues)`
          : 'Loading…'
      }
    >
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.9rem',
          }}
        >
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', backgroundColor: '#f5f5f5' }}>
              <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>
                Issue Type Group
              </th>
              <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600 }}>
                Count
              </th>
              <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600 }}>
                % of Total
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, idx) => {
              const count = typeof group.count === 'number' ? group.count : 0;
              const percentage = totalCount > 0 ? ((count / totalCount) * 100).toFixed(1) : '0.0';

              return (
                <tr
                  key={group.name}
                  style={{
                    borderBottom: '1px solid #eee',
                    backgroundColor: idx % 2 === 0 ? '#fff' : '#f9f9f9',
                  }}
                >
                  <td style={{ padding: '0.75rem' }}>
                    <a
                      href={group.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#0066cc', textDecoration: 'none' }}
                      title={group.error ? `Error: ${group.error}` : group.jql}
                    >
                      {group.name}
                    </a>
                  </td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 500 }}>
                    {group.error ? '!' : count.toLocaleString()}
                  </td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', color: '#666' }}>
                    {group.error ? '—' : `${percentage}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#666' }}>
        <Pill tone="muted">
          Click each group to view matching issues in JIRA
        </Pill>
      </div>
    </SectionPanel>
  );
}
