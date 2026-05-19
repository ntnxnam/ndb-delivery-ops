/**
 * JIRA custom field ID constants — single source of truth for the client.
 *
 * Mirrors server/config/jiraFieldsConfig.json. Never write customfield_NNNNN
 * inline in a component, hook, or service — import from here instead.
 *
 * Organised by category to match the server config structure.
 */

// ── Checkpoint dates ──────────────────────────────────────────────────────────
export const FIELD_CODE_COMPLETE    = 'customfield_11067';
export const FIELD_TEST_PLAN        = 'customfield_11068';
export const FIELD_FSDS_DONE        = 'customfield_13861';
export const FIELD_COMMIT_GATE      = 'customfield_35863';
export const FIELD_PROMOTION_GATE   = 'customfield_35864';
export const FIELD_STATUS_UPDATE_DT = 'customfield_45660';

// ── People ────────────────────────────────────────────────────────────────────
export const FIELD_UX_OWNER     = 'customfield_15968';
export const FIELD_QA_CONTACT   = 'customfield_10860';
export const FIELD_TEST_LEAD    = 'customfield_11065';
export const FIELD_GUI_LEAD     = 'customfield_11861';
export const FIELD_TPM_OWNER    = 'customfield_27764';
export const FIELD_TEAM_MEMBERS = 'customfield_51460';
export const FIELD_PM_OWNER     = 'customfield_11260';
export const FIELD_PARTICIPANTS = 'customfield_11960';

// ── Content ───────────────────────────────────────────────────────────────────
export const FIELD_STATUS_UPDATE           = 'customfield_23073';
export const FIELD_EXECUTIVE_STATUS_UPDATE = 'customfield_38460';

// ── Links ─────────────────────────────────────────────────────────────────────
export const FIELD_REQUIREMENTS_LINK = 'customfield_14463';
export const FIELD_TCMS_LINK         = 'customfield_31460';
export const FIELD_DESIGN_DOC_LINK   = 'customfield_14464';
export const FIELD_TEST_PLAN_LINK    = 'customfield_14465';

// ── Indicators ────────────────────────────────────────────────────────────────
export const FIELD_RISK_INDICATOR = 'customfield_23560';

// ── Relationships ─────────────────────────────────────────────────────────────
export const FIELD_PARENT_LINK = 'customfield_20363';

// ── Agile ─────────────────────────────────────────────────────────────────────
export const FIELD_SPRINT  = 'customfield_10020';
export const FIELD_SPRINTS = 'customfield_10021';

// ── Grouped sets (for JIRA API `fields=` param) ───────────────────────────────
export const GANTT_FIELDS = [
  FIELD_CODE_COMPLETE,
  FIELD_COMMIT_GATE,
  FIELD_PROMOTION_GATE,
  FIELD_SPRINT,
].join(',');

export const TABLE_FIELDS = [
  FIELD_CODE_COMPLETE,
  FIELD_TEST_PLAN,
  FIELD_FSDS_DONE,
  FIELD_COMMIT_GATE,
  FIELD_PROMOTION_GATE,
  FIELD_STATUS_UPDATE_DT,
  FIELD_UX_OWNER,
  FIELD_QA_CONTACT,
  FIELD_TEST_LEAD,
  FIELD_GUI_LEAD,
  FIELD_TPM_OWNER,
  FIELD_TEAM_MEMBERS,
  FIELD_STATUS_UPDATE,
  FIELD_EXECUTIVE_STATUS_UPDATE,
  FIELD_RISK_INDICATOR,
  FIELD_SPRINT,
].join(',');

export const EMAIL_FIELDS = [
  ...TABLE_FIELDS.split(','),
  FIELD_PM_OWNER,
  FIELD_PARTICIPANTS,
  FIELD_REQUIREMENTS_LINK,
  FIELD_TCMS_LINK,
  FIELD_DESIGN_DOC_LINK,
  FIELD_TEST_PLAN_LINK,
].join(',');
