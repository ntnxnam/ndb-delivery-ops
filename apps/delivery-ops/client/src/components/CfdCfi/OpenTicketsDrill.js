import React, { useEffect, useMemo, useRef } from 'react';
import {
  drillTitle,
  filterOpenTickets,
  modeHasOpenSample,
} from './openTicketsFilter';
import { TicketExtraHeaders, TicketExtraCells } from '../../utils/ticketDisplay';

function jiraIssuesHref(jiraBase, jql) {
  if (!jql) return null;
  const base = (jiraBase || 'https://jira.nutanix.com').replace(/\/$/, '');
  return `${base}/issues/?jql=${encodeURIComponent(jql)}`;
}

function ticketHref(jiraBase, key) {
  if (!key) return null;
  const base = (jiraBase || 'https://jira.nutanix.com').replace(/\/$/, '');
  return `${base}/browse/${key}`;
}

/**
 * Right-side drawer listing tickets for a pulse hero click.
 * Open-family heroes filter the openTickets sample; others rely on JIRA proof JQL.
 */
export default function OpenTicketsDrill({
  open,
  mode = 'openNow',
  kpiName,
  openTickets,
  heroCell,
  heroCount,
  agedDays = 14,
  jiraBase,
  onClose,
}) {
  const closeRef = useRef(null);
  const hasSampleFilter = modeHasOpenSample(mode);

  const filtered = useMemo(() => {
    if (!hasSampleFilter) return [];
    return filterOpenTickets(openTickets?.issues, mode, { agedDays });
  }, [hasSampleFilter, openTickets?.issues, mode, agedDays]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const proofJql = heroCell?.jql || openTickets?.jql || null;
  const jiraUrl = jiraIssuesHref(jiraBase, proofJql);
  const claimed = heroCount != null ? heroCount : openTickets?.total ?? filtered.length;
  const sampleTruncated = Boolean(openTickets?.truncated);
  const title = drillTitle(mode, kpiName);

  let lead;
  if (hasSampleFilter) {
    lead =
      claimed === 0
        ? `No tickets in this bucket for ${kpiName}.`
        : `${claimed} in this hero. Showing ${filtered.length} from the open sample` +
          (sampleTruncated || filtered.length < claimed ? ' (sample may be incomplete — use JIRA for full set)' : '') +
          '.';
  } else {
    lead = `This hero’s population is not in the open-ticket sample. Use Open in JIRA for the exact query (${claimed} claimed).`;
  }

  return (
    <div
      className="cfdcfi-drill-overlay open"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="cfdcfi-drill-panel" role="dialog" aria-label={title}>
        <div className="cfdcfi-drill-head">
          <div>
            <h3>{title}</h3>
            <p className="cfdcfi-drill-lead">{lead}</p>
          </div>
          <button
            type="button"
            className="cfdcfi-drill-close"
            ref={closeRef}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {jiraUrl ? (
          <p className="cfdcfi-drill-stats">
            <a href={jiraUrl} target="_blank" rel="noopener noreferrer">
              Open matching tickets in JIRA
            </a>
          </p>
        ) : (
          <p className="cfdcfi-muted">No JQL for this hero.</p>
        )}
        {hasSampleFilter && filtered.length === 0 ? (
          <p className="cfdcfi-muted">No sample rows in this filter.</p>
        ) : null}
        {filtered.length > 0 ? (
          <table className="cfdcfi-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Summary</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assignee</th>
                <th>Age</th>
                <TicketExtraHeaders />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.key}>
                  <td>
                    <a href={ticketHref(jiraBase, row.key)} target="_blank" rel="noopener noreferrer">
                      {row.key}
                    </a>
                  </td>
                  <td>{row.summary || '—'}</td>
                  <td>{row.status || '—'}</td>
                  <td>{row.priority || '—'}</td>
                  <td>{row.assignee || '—'}</td>
                  <td>{row.ageDays != null ? `${row.ageDays}d` : '—'}</td>
                  <TicketExtraCells row={row} />
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </aside>
    </div>
  );
}
