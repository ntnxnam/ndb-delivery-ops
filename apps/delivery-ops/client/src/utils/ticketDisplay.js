import React from 'react';

/** Header labels for the Component / Due Date / Created drill columns. */
export const TICKET_EXTRA_HEADERS = ['Component', 'Due Date', 'Created'];

/** YYYY-MM-DD from an ISO timestamp or date; '—' when empty/invalid. */
export function formatTicketDate(value) {
  if (!value) return '—';
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '—';
}

export function formatComponents(list) {
  return Array.isArray(list) && list.length ? list.join(', ') : '—';
}

const DONE_STATUSES = new Set(['closed', 'resolved', 'done', 'complete']);

/** Due date is before today and the ticket is not finished. */
export function isOverdue(dueDate, status, now = new Date()) {
  if (!dueDate || DONE_STATUSES.has(String(status || '').toLowerCase())) return false;
  const today = now.toISOString().slice(0, 10);
  return String(dueDate).slice(0, 10) < today;
}

/** <th> cells for the three extra columns. */
export function TicketExtraHeaders() {
  return TICKET_EXTRA_HEADERS.map((h) => (
    <th key={h} scope="col">
      {h}
    </th>
  ));
}

/** <td> cells for the three extra columns; overdue due dates are red. */
export function TicketExtraCells({ row }) {
  const overdue = isOverdue(row?.dueDate, row?.status);
  return (
    <>
      <td>{formatComponents(row?.components)}</td>
      <td
        className={overdue ? 'ticket-due--overdue' : undefined}
        style={overdue ? { color: '#b91c1c', fontWeight: 600 } : undefined}
        title={overdue ? 'Overdue' : undefined}
      >
        {formatTicketDate(row?.dueDate)}
      </td>
      <td>{formatTicketDate(row?.created)}</td>
    </>
  );
}
