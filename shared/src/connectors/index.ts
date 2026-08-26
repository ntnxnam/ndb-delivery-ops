/**
 * Connectors — public API of @portfolio-delivery-ops/shared/connectors.
 *
 * Per D3, 5 connectors are first-class:
 *   1. jiraConnector
 *   2. confluenceConnector
 *   3. githubConnector
 *   4. slackConnector — no caller yet; do not add a unused client
 *   5. emailConnector
 */

export * from './env.js';
export * from './jiraConnector.js';
export * from './confluenceConnector.js';
export * from './githubConnector.js';
export * from './emailConnector.js';
export * from './aiConnector.js';
