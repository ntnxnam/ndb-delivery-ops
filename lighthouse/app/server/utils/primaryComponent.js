/**
 * Primary Component — a cascading select whose parent value is a JIRA
 * component and whose child value is the sub-component.
 * Raw shape: { value: "NKP", child: { value: "NKP-Core" } }.
 */

const { getFieldId } = require('./jiraFieldsConfig');

function getPrimaryComponentField() {
  return getFieldId('primaryComponent');
}

function parsePrimaryComponent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const parent = raw.value || null;
  const child = raw.child?.value || null;
  if (!parent && !child) return null;
  return { parent, child };
}

module.exports = {
  getPrimaryComponentField,
  parsePrimaryComponent,
};
