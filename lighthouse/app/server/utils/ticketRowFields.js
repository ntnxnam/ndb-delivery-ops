/**
 * Component / Due Date / Created fields shown on every ticket drill row.
 * Services append EXTRA_TICKET_FIELDS to their JIRA field list and spread
 * mapExtraTicketFields(issue.fields) into the row they return.
 */

const EXTRA_TICKET_FIELDS = ['components', 'duedate', 'created'];

function componentNames(list) {
  return Array.isArray(list)
    ? list.map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean)
    : [];
}

/** @returns {{ components: string[], dueDate: string|null, created: string|null }} */
function mapExtraTicketFields(fields) {
  const f = fields || {};
  return {
    components: componentNames(f.components),
    dueDate: f.duedate || null,
    created: f.created || null,
  };
}

/** Add the extra fields to a comma-joined JIRA `fields` string without duplicates. */
function withExtraTicketFields(fieldsCsv) {
  const have = new Set(
    String(fieldsCsv || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  EXTRA_TICKET_FIELDS.forEach((f) => have.add(f));
  return [...have].join(',');
}

module.exports = { EXTRA_TICKET_FIELDS, componentNames, mapExtraTicketFields, withExtraTicketFields };
