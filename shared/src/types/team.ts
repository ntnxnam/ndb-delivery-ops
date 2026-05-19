/**
 * Team types.
 *
 * Within a product, work is divided across multiple engineering teams.
 * Per the existing teamBoardConfig.json, "team" was the legacy name for
 * both products AND engineering teams; in the new model:
 *
 *   - a ProductConfig represents a PRODUCT (NDB, DataLens, NCM)
 *   - a Team represents an ENGINEERING TEAM within a product (e.g.
 *     "storage", "networking", "UI") — typically inferred from JIRA
 *     components or from a separate per-product team list.
 */

export interface Team {
  /** Stable ID (e.g. 'ndb-storage') */
  id: string;
  /** Display name (e.g. 'Storage') */
  name: string;
  /** Product this team belongs to */
  productId: string;
  /** JIRA component value(s) that identify this team's tickets */
  jiraComponents?: string[];
  /** Engineering Manager / Team Lead — used for owner resolution */
  emails?: string[];
  /** Slack channel for notifications */
  slackChannel?: string;
}
