/**
 * Feature flags and defaults for Email Sender (e.g. Executive Summary / Highlights and Lowlights).
 * Set SHOW_EXECUTIVE_SUMMARY_ACTIONS to true to show Generate, Push to JIRA, and Clear buttons.
 */
export const SHOW_EXECUTIVE_SUMMARY_ACTIONS = false;

/**
 * Required section headers that must appear in Highlights and Lowlights (validation).
 * Risk Assessment and Path to Green are separate JIRA-backed boxes below this editor.
 */
export const HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS = [
  'Highlights',
  'Lowlights',
  'Support needed from leaders'
];

/**
 * Default prepopulation template for Highlights and Lowlights (HTML).
 */
export const HIGHLIGHTS_LOWLIGHTS_TEMPLATE = [
  '<h2>Highlights:</h2>',
  '<p><br></p>',
  '<p><br></p>',
  '<h2>Lowlights:</h2>',
  '<p><br></p>',
  '<p><br></p>',
  '<h2>Support needed from leaders:</h2>',
  '<p><br></p>',
  '<p><br></p>'
].join('');
