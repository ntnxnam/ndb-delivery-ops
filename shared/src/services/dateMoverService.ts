/**
 * dateMoverService — gate-date mutations with mandatory reason and
 * Confluence audit trail.
 *
 * Implements D30 in `DECISIONS.md`. The user-facing contract:
 *
 *   "When an authorised user moves a release gate date (Code Complete,
 *    Commit Gate, Promotion Gate) on a FEAT-tier ticket, the system
 *    MUST require a reason and append a structured audit row to
 *    Confluence in the same lifecycle."
 *
 * Mapping to fields (from `.cursor/rules/jira-date-hierarchy.mdc` and
 * the legacy ndb-date-mover/config/fields.json):
 *
 *   customfield_11067  Code Complete Date
 *   customfield_35863  Commit Gate Ready Estimation Date
 *   customfield_35864  Promotion Gate Ready Estimation Date
 *
 * Anything outside these three is rejected at the service boundary.
 *
 * Transactional shape:
 *
 *   1. Validate input (field is gate date, reason non-empty, date valid)
 *   2. Read current value (so we can roll back / audit before/after)
 *   3. Apply JIRA field update
 *   4. Append audit row to Confluence
 *   5. On Confluence failure: revert JIRA write, surface error
 *
 * This is "best-effort transactional" — the rollback can itself fail
 * (e.g. JIRA is now unreachable). When that happens the service emits
 * a structured error indicating an inconsistent state so the caller
 * can alert a human. We never silently swallow.
 */

import type { JiraConnector } from '../connectors/jiraConnector.js';
import {
  ConfluenceConnector,
  escapeXml,
  type ConfluenceErrorShape,
} from '../connectors/confluenceConnector.js';

// ── Domain constants ────────────────────────────────────────────────────────

/**
 * The 3 gate-date custom fields D30 governs. Hard-coded here, not env-driven:
 * these are stable Nutanix JIRA field IDs, baked into team workflow.
 *
 * If a future product (D1) uses different field ids, this map moves to
 * `productService.getGateDateFields(productId)` — but until that need is
 * concrete, keeping it inline avoids a layer of indirection.
 */
export const GATE_DATE_FIELDS = {
  customfield_11067: 'Code Complete Date',
  customfield_35863: 'Commit Gate Ready Date',
  customfield_35864: 'Promotion Gate Ready Date',
} as const;

export type GateDateFieldId = keyof typeof GATE_DATE_FIELDS;

/** Call-site aliases used by MCP / UI. Values are GATE_DATE_FIELDS keys. */
export const GATE_DATE_FIELD_ALIASES = {
  codeCompleteDate: 'customfield_11067',
  commitGateReadyDate: 'customfield_35863',
  promotionGateReadyDate: 'customfield_35864',
} as const;

export type GateDateFieldAlias = keyof typeof GATE_DATE_FIELD_ALIASES;

export function isGateDateField(fieldId: string): fieldId is GateDateFieldId {
  return Object.prototype.hasOwnProperty.call(GATE_DATE_FIELDS, fieldId);
}

// ── Inputs / outputs ────────────────────────────────────────────────────────

export interface MoveGateDateInput {
  /** JIRA ticket key (e.g. "FEAT-1001" or "ERA-12345"). */
  ticketKey: string;
  /** Which gate date is moving. Must be one of GATE_DATE_FIELDS. */
  fieldId: string;
  /** New ISO date (YYYY-MM-DD). Service rejects other formats. */
  newDate: string;
  /** Mandatory reason. Trimmed, must be non-empty after trim. */
  reason: string;
  /** Acting user — used in the audit row. */
  actor: {
    displayName: string;
    ldap: string;
  };
  /**
   * Confluence page that holds the audit table for this product/release,
   * and the anchor id of the table within the page.
   *
   * Resolution policy (D31, deferred): for now the caller supplies these
   * explicitly. When D31 lands the service will resolve them from
   * `productService` + the ticket's fixVersion.
   */
  audit: {
    confluencePageId: string;
    tableAnchorId: string;
  };
}

export interface MoveGateDateResult {
  ok: true;
  ticketKey: string;
  fieldId: string;
  fieldLabel: string;
  previousValue: string | null;
  newValue: string;
  audit: {
    pageId: string;
    confluenceVersion: number;
  };
}

export type MoveGateDateError = {
  ok: false;
  code:
    | 'invalid_field'
    | 'invalid_date'
    | 'empty_reason'
    | 'ticket_not_found'
    | 'jira_update_failed'
    | 'confluence_audit_failed'
    | 'inconsistent_state';
  message: string;
  /**
   * When the JIRA write succeeded but the Confluence audit failed AND
   * the rollback also failed, the system is in an inconsistent state:
   * the gate date moved but no audit row exists. The caller (route or
   * agent) MUST surface this loudly — it's the only way the human can
   * write a manual audit row.
   */
  inconsistentState?: {
    ticketKey: string;
    fieldId: string;
    appliedValue: string;
    previousValue: string | null;
  };
};

// ── Validation helpers ──────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateInput(input: MoveGateDateInput): MoveGateDateError | null {
  if (!isGateDateField(input.fieldId)) {
    return {
      ok: false,
      code: 'invalid_field',
      message: `Field ${input.fieldId} is not a gate date. Allowed: ${Object.keys(
        GATE_DATE_FIELDS
      ).join(', ')}`,
    };
  }
  if (!ISO_DATE.test(input.newDate)) {
    return {
      ok: false,
      code: 'invalid_date',
      message: `newDate must be ISO YYYY-MM-DD. Got: ${input.newDate}`,
    };
  }
  // Sanity: parse it so an impossible date like "2026-02-30" is caught
  const parsed = new Date(`${input.newDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      code: 'invalid_date',
      message: `newDate is not a real calendar date: ${input.newDate}`,
    };
  }
  if (!input.reason || !input.reason.trim()) {
    return {
      ok: false,
      code: 'empty_reason',
      message:
        'reason is required and must be non-empty (D30: every gate-date move must be justified)',
    };
  }
  return null;
}

// ── Audit row composition ──────────────────────────────────────────────────

/**
 * Build the Confluence storage-format `<tr>` for a single gate-date
 * move. Column order is hard-coded; the destination page table is
 * expected to declare a matching header. When D31 lands and the
 * destination is concrete, this row format may be revised — keep
 * single-source-of-truth here.
 *
 * Columns:
 *   Timestamp (UTC ISO) | Actor | Ticket | Field | Old | New | Reason
 */
export function buildAuditRow(args: {
  timestampIso: string;
  actor: { displayName: string; ldap: string };
  ticketKey: string;
  fieldLabel: string;
  previousValue: string | null;
  newValue: string;
  reason: string;
  jiraBaseUrl: string;
}): string {
  const {
    timestampIso,
    actor,
    ticketKey,
    fieldLabel,
    previousValue,
    newValue,
    reason,
    jiraBaseUrl,
  } = args;
  const ticketUrl = `${jiraBaseUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(
    ticketKey
  )}`;
  const prev = previousValue ?? '(unset)';
  return (
    `<tr>` +
    `<td>${escapeXml(timestampIso)}</td>` +
    `<td>${escapeXml(actor.displayName)} (${escapeXml(actor.ldap)})</td>` +
    `<td><a href="${escapeXml(ticketUrl)}">${escapeXml(ticketKey)}</a></td>` +
    `<td>${escapeXml(fieldLabel)}</td>` +
    `<td>${escapeXml(prev)}</td>` +
    `<td>${escapeXml(newValue)}</td>` +
    `<td>${escapeXml(reason.trim())}</td>` +
    `</tr>`
  );
}

// ── Service ─────────────────────────────────────────────────────────────────

export interface DateMoverDeps {
  jira: JiraConnector;
  confluence: ConfluenceConnector;
  jiraBaseUrl: string;
  /** Optional clock — injectable for tests. */
  now?: () => Date;
}

export class DateMoverService {
  constructor(private readonly deps: DateMoverDeps) {}

  /**
   * Move a single gate date, with mandatory reason and Confluence audit.
   * See module-level docs for the transactional contract.
   */
  async moveGateDate(
    input: MoveGateDateInput
  ): Promise<MoveGateDateResult | MoveGateDateError> {
    const validation = validateInput(input);
    if (validation) return validation;

    const fieldId = input.fieldId as GateDateFieldId;
    const fieldLabel = GATE_DATE_FIELDS[fieldId];

    // Step 1: read current value (for audit + rollback)
    let previousValue: string | null = null;
    try {
      const issue = await this.deps.jira.getIssue(input.ticketKey, [fieldId]);
      previousValue =
        (issue.fields?.[fieldId] as string | null | undefined) ?? null;
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      if (e.statusCode === 404) {
        return {
          ok: false,
          code: 'ticket_not_found',
          message: `JIRA ticket ${input.ticketKey} not found or inaccessible`,
        };
      }
      return {
        ok: false,
        code: 'jira_update_failed',
        message: `Failed to read current value of ${fieldLabel} on ${input.ticketKey}: ${e.message}`,
      };
    }

    // Step 2: write the new value to JIRA
    try {
      await this.deps.jira.updateIssue(input.ticketKey, {
        [fieldId]: input.newDate,
      });
    } catch (err) {
      const e = err as Error;
      return {
        ok: false,
        code: 'jira_update_failed',
        message: `JIRA update failed for ${input.ticketKey} ${fieldLabel}: ${e.message}`,
      };
    }

    // Step 3: append audit row to Confluence
    const timestampIso = (this.deps.now ? this.deps.now() : new Date()).toISOString();
    const rowMarkup = buildAuditRow({
      timestampIso,
      actor: input.actor,
      ticketKey: input.ticketKey,
      fieldLabel,
      previousValue,
      newValue: input.newDate,
      reason: input.reason,
      jiraBaseUrl: this.deps.jiraBaseUrl,
    });

    try {
      const updated = await this.deps.confluence.appendStructuredRow({
        pageId: input.audit.confluencePageId,
        tableMarkerId: input.audit.tableAnchorId,
        rowStorageFormat: rowMarkup,
      });
      return {
        ok: true,
        ticketKey: input.ticketKey,
        fieldId,
        fieldLabel,
        previousValue,
        newValue: input.newDate,
        audit: {
          pageId: updated.id,
          confluenceVersion: updated.version,
        },
      };
    } catch (confErr) {
      // Step 4: roll back JIRA. If rollback fails, we are inconsistent.
      const confluenceErr = confErr as ConfluenceErrorShape;
      try {
        await this.deps.jira.updateIssue(input.ticketKey, {
          [fieldId]: previousValue,
        });
        return {
          ok: false,
          code: 'confluence_audit_failed',
          message:
            `Confluence audit row could not be written (${confluenceErr.message}). ` +
            `JIRA change has been rolled back; please retry after Confluence is reachable.`,
        };
      } catch (rollbackErr) {
        const rb = rollbackErr as Error;
        return {
          ok: false,
          code: 'inconsistent_state',
          message:
            `INCONSISTENT STATE: JIRA was updated, Confluence audit failed ` +
            `(${confluenceErr.message}), and rollback also failed (${rb.message}). ` +
            `Manual remediation required.`,
          inconsistentState: {
            ticketKey: input.ticketKey,
            fieldId,
            appliedValue: input.newDate,
            previousValue,
          },
        };
      }
    }
  }
}
