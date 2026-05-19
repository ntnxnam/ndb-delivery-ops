/**
 * Connectors — public API of @portfolio-delivery-ops/shared/connectors.
 *
 * Per D3, 5 connectors are first-class:
 *   1. jiraConnector       — implemented
 *   2. confluenceConnector — implemented (D30: get/update + appendStructuredRow)
 *   3. githubConnector     — Phase D2 (extract from leadershipCommitReport tool)
 *   4. slackConnector      — Phase D2
 *   5. emailConnector      — Phase D2 (partial nodemailer in apps/delivery-ops)
 */

export * from './env.js';
export * from './jiraConnector.js';
export * from './confluenceConnector.js';
