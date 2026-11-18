/**
 * Executive Summary Generation Prompt (Generic)
 * 
 * This is a GENERIC prompt that can be used with any LLM to generate executive summaries.
 * It describes the logic and approach without project-specific details.
 * 
 * The actual implementation in generateExecutiveSummary.js contains project-specific
 * field mappings, terminology, and business logic.
 * 
 * CONTEXT:
 * - We have project items with checkpoint dates and status information
 * - Each item should have its own tailored executive summary
 * - Summary should be a few lines written for leadership
 * - Summary should indicate overall status: GREEN / YELLOW / RED per item
 * 
 * GENERIC DATA SHAPE (per item):
 * - key: string (unique identifier)
 * - summary: string (item description)
 * - status: string (current status)
 * - priority: string (priority level)
 * - labels: string[] (array of label strings)
 * - Various date fields (ISO date strings or null)
 * - Various link/document fields (URL strings or null)
 * 
 * GENERIC LOGIC RULES:
 * 1. MISSING DATES are HARD BLOCKERS:
 *    - If critical prerequisite dates are missing (null/undefined) → Status MUST be at least YELLOW
 *    - Missing dates should be explicitly called out: "Prerequisites incomplete: [date name] not set"
 *    - Distinguish between missing dates (not set) vs future dates (set but not yet reached)
 * 
 * 2. CONDITIONAL CHECKS:
 *    - Some prerequisites should ONLY be checked after a milestone date has passed
 *    - This prevents false positives before certain stages are reached
 * 
 * 3. PREREQUISITE STATUS:
 *    - "Prerequisites met": All dates exist, are in past, and links exist
 *    - "Prerequisites incomplete: [missing dates] not set": If dates are missing (not set)
 *    - "Prerequisites on track": Dates exist but may be in future, or links missing
 * 
 * GENERIC RISK SCORING APPROACH:
 * - Calculate risk scores for each milestone/gate
 * - Missing critical dates add significant risk (hard blockers)
 * - Dates in the future add moderate risk
 * - Missing links/documents add minor risk
 * - Urgency increases as milestone dates approach (<= 7 days = critical, <= 14 days = warning)
 * - Additional penalty if any critical date is missing (ensures at least YELLOW)
 * 
 * GENERIC RAG DETERMINATION:
 * - RED if any gate riskScore >= threshold (e.g., 7)
 * - YELLOW if max riskScore in [4..6] OR if critical prerequisite dates are missing (hard blocker)
 * - GREEN otherwise (only if all prerequisites are met/on track AND no missing critical dates)
 * 
 * GENERIC OUTPUT FORMAT:
 * - Keep to a few lines (brief and concise)
 * - Start with: "[GREEN/YELLOW/RED]:"
 * - Then key blockers or status:
 *   - For GREEN: "[Milestone] achievable. Prerequisites met." 
 *     OR "[Milestone] achievable. Prerequisites on track." (if dates exist but in future)
 *     - Can ONLY be GREEN if critical prerequisite dates are both set
 *   - For YELLOW: "[Milestone] at risk: [top 2 blockers]"
 *     OR "[Milestone] at risk. Prerequisites incomplete: [missing dates] not set."
 *     - MUST be YELLOW if critical prerequisite dates are missing
 *   - For RED: "[top 2-3 critical blockers]"
 * - Include missing gate dates if not provided
 * - Include status update availability if stale
 * - Include a "Call to Action" section with specific, actionable items:
 *   - Intelligently identify missing dates that need to be set
 *   - Intelligently identify missing links/documents that need to be added
 *   - Consolidate similar actions to remove repeated words
 *   - Prioritize actions: Missing critical dates > Critical blockers > Missing links > Other tickets > Monitoring
 *   - For RED: Critical actions with "immediately" suffix
 *   - For YELLOW: Warning actions with "urgently" suffix
 *   - For GREEN: Maintenance actions (no urgency suffix)
 *   - Consider urgency based on days to milestone: <= 7 days = critical, <= 14 days = warning
 *   - Always specify where dates and links need to be added/updated
 *   - Only suggest conditional prerequisites if the prerequisite milestone has passed
 * - Be brief and specific - no verbose explanations
 * - Never say "some issues" - always cite concrete blockers with numbers
 * - If data is missing, say "data missing: <field>" but still provide best-effort summary
 * - Tailor every detail to THIS specific item's data
 */

export const EXECUTIVE_SUMMARY_PROMPT = `
You are generating an executive summary for a single project item. The summary should be a few lines written for leadership, starting with overall status: GREEN / YELLOW / RED.

CONTEXT:
- Each item has its own checkpoint dates and status information
- Each item should have a tailored summary based on its specific data
- Item key, dates, links, labels, and status are available
- Distinguish between missing dates (not set) vs future dates (set but not yet reached)

GENERIC LOGIC RULES:
1. MISSING DATES are HARD BLOCKERS:
   - If critical prerequisite dates are missing (null/undefined) → Status MUST be at least YELLOW
   - Missing dates should be explicitly called out: "Prerequisites incomplete: [date name] not set"

2. CONDITIONAL CHECKS:
   - Some prerequisites should ONLY be checked when certain conditions are met
   - Security and Legal tickets (SDL, LEG projects) are required 3 weeks (21 days) before the last available Commit Gate (CG) date
   - If we're more than 3 weeks away from the last CG date, do NOT flag Security/Legal as missing
   - This ensures tickets are created in time for CG readiness

3. PREREQUISITE STATUS:
   - "Prerequisites met": All dates exist, are in past, and links exist
   - "Prerequisites incomplete: [missing dates] not set": If dates are missing (not set)
   - "Prerequisites on track": Dates exist but may be in future, or links missing

RISK SCORING APPROACH:
- Calculate risk scores for each milestone/gate
- Missing critical dates (not set) add significant risk (+2) - hard blocker
- Dates in the future add moderate risk (+2)
- Missing links/documents add minor risk (+1 each)
- Urgency increases as milestone dates approach: <= 7 days = critical (+3), <= 14 days = warning (+2)
- Additional penalty (+2) if any critical date is missing (ensures at least YELLOW)

OVERALL RAG DETERMINATION:
- RED if any gate riskScore >= threshold (e.g., 7)
- YELLOW if max riskScore in [4..6] OR if critical prerequisite dates are missing (hard blocker)
- GREEN otherwise (only if all prerequisites are met/on track AND no missing critical dates)

OUTPUT FORMAT - KEEP CONCISE:
- Keep to a few lines (brief and concise)
- Start with: "[GREEN/YELLOW/RED]:"
- Then key blockers or status:
  - For GREEN: "[Milestone] achievable with [X] days remaining. Prerequisites met." 
    OR "[Milestone] achievable. Prerequisites on track." (if dates exist but in future)
    - Can ONLY be GREEN if critical prerequisite dates are both set
  - For YELLOW: "[Milestone] at risk: [top 2 blockers, e.g., 'Prerequisite pending, 5 days to milestone']"
    OR "[Milestone] at risk. Prerequisites incomplete: [missing dates] not set."
    - MUST be YELLOW if critical prerequisite dates are missing
  - For RED: "[top 2-3 critical blockers, e.g., 'Prerequisite missing, 3 days to milestone, high priority items open']"
- Include missing gate dates if not provided
- Include status update availability if stale (> 10 days old)
- Include a "Call to Action" section at the end with specific, actionable items based on blockers:
  - Intelligently identify missing dates that need to be set
  - Intelligently identify missing links/documents that need to be added
  - Consolidate similar actions to remove repeated words (e.g., "Set Gate A and Gate B Dates")
  - Prioritize actions: Missing critical dates > Critical blockers > Missing links > Other tickets > Monitoring
  - For RED: Critical actions with "immediately" suffix
  - For YELLOW: Warning actions with "urgently" suffix
  - For GREEN: Maintenance actions (no urgency suffix)
  - Consider urgency based on days to milestone: <= 7 days = critical, <= 14 days = warning
  - Always specify where dates and links need to be added/updated
  - Only suggest conditional prerequisites if the prerequisite milestone has passed
- Be brief and specific - no verbose explanations
- Never say "some issues" - always cite concrete blockers with numbers
- If data is missing, say "data missing: <field>" but still provide best-effort summary
- Tailor every detail to THIS specific item's data
`.trim();

/**
 * Risk Scoring Configuration (Project-Specific)
 * 
 * This configuration is specific to this project and contains:
 * - Field mappings to JIRA custom fields
 * - Company-specific terminology
 * - Business logic thresholds
 * 
 * Update these thresholds to adjust risk scoring sensitivity.
 * The actual field IDs and terminology are defined in the implementation.
 */
export const RISK_SCORING_CONFIG = {
  // Days thresholds
  criticalDaysToGate: 7,  // Days before gate that triggers critical risk
  warningDaysToGate: 14, // Days before gate that triggers warning
  
  // Risk score weights
  ccRisk: {
    criticalDaysMissingPrereq: 3,  // +3 if daysToCC <= 7 AND prerequisites missing
    techDesignMissing: 2,          // +2 if Tech Design not done
    testPlanMissing: 2,             // +2 if Test Plan not done
    designDocMissing: 1,           // +1 if Design Doc link missing
    requirementsMissing: 1,         // +1 if Requirements link missing
    testPlanLinkMissing: 1,        // +1 if Test Plan link missing
    closeToDate: 2                 // +2 if status not Done and daysToCC <= 14
  },
  cgRisk: {
    criticalDaysMissingPrereq: 3,  // +3 if daysToCG <= 7 AND Security/Legal not filed (only if within 3 weeks of last CG)
    securityNotFiled: 2,           // +2 if Security not filed (only if within 3 weeks of last CG)
    legalNotFiled: 2,              // +2 if Legal not filed (only if within 3 weeks of last CG)
    manualTestsOpen: 2             // +2 if manual test items still open
  },
  pgRisk: {
    p0p1BugsOpen: 4,               // +4 if P0/P1 bugs open
    securityNotClosed: 3,          // +3 if Security not closed (only if within 3 weeks of last CG)
    legalNotClosed: 3,             // +3 if Legal not closed (only if within 3 weeks of last CG)
    docsIncomplete: 2              // +2 if docs incomplete
  },
  
  // RAG thresholds
  ragThresholds: {
    red: 7,    // RED if any gate riskScore >= 7
    yellow: 4   // YELLOW if max riskScore in [4..6], GREEN otherwise
  },
  
  // Label keywords for detection (project-specific)
  labelKeywords: {
    security: ['security', 'sec', 'sec-review', 'security-review'],
    legal: ['legal', 'legal-review', 'compliance']
  }
};

/**
 * Get the executive summary generation prompt (generic, LLM-agnostic)
 * @returns {string} The generic prompt text
 */
export function getExecutiveSummaryPrompt() {
  return EXECUTIVE_SUMMARY_PROMPT;
}

/**
 * Get the risk scoring configuration (project-specific)
 * @returns {Object} The risk scoring config object
 */
export function getRiskScoringConfig() {
  return RISK_SCORING_CONFIG;
}
