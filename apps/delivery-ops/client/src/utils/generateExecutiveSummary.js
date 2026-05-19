/**
 * Generate Executive Summary for a Single Feature/Project
 * 
 * Generic function that analyzes a single Feature's data to generate a concise executive summary
 * indicating whether the Feature is 'green' (on track), 'yellow' (at risk), or 'red' (high risk).
 * 
 * Can be used from any page/component that has access to Feature data.
 * 
 * The generation logic follows the prompt defined in executiveSummaryPrompt.js
 * See that file to update the prompt/requirements for summary generation.
 * 
 * @param {Object} params
 * @param {Object} params.item - Single Feature/item object with JIRA fields
 * @param {string} [params.releaseVersion] - Release version (optional, for display purposes)
 * @param {Object} [params.ganttConfig] - Gantt configuration with dates (optional)
 * @returns {string} Generated executive summary (few lines) tailored to this Feature
 * 
 * @see executiveSummaryPrompt.js - Update the prompt there to change generation requirements
 */

import { RISK_SCORING_CONFIG } from './executiveSummaryPrompt';
import { isDateOlderThan } from './releaseVersionUtils';

export function generateExecutiveSummary({ 
  item, 
  releaseVersion: _releaseVersion = null, 
  ganttConfig = null 
}) {
  if (!item || !item.key) {
    return 'No item data available.';
  }

  const config = RISK_SCORING_CONFIG;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Helper to safely extract string value from custom fields (can be string, object, or null)
  const getStringValue = (field) => {
    if (!field) return '';
    if (typeof field === 'string') return field.trim();
    if (typeof field === 'object') {
      return (field.value || field.name || field.content || '').toString().trim();
    }
    return String(field).trim();
  };

  // Parse dates - use getStringValue first to handle object formats
  const parseDate = (dateField) => {
    const dateStr = getStringValue(dateField);
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;
      date.setHours(0, 0, 0, 0);
      return date;
    } catch {
      return null;
    }
  };

  // Helper to extract extension date from label (format: <release>-<ddmmyyyy>-code-complete-extension-recieved)
  // Example: ndb-2.11-28feb2026-code-complete-extension-recieved
  const getExtensionDateFromLabel = (item) => {
    if (!item || !item.labels) return null;
    
    // Handle labels - can be array, comma-separated string, or space-separated
    let labels = [];
    if (Array.isArray(item.labels)) {
      labels = item.labels;
    } else if (typeof item.labels === 'string') {
      labels = item.labels.includes(',') 
        ? item.labels.split(',').map(l => l.trim())
        : item.labels.split(/\s+/).map(l => l.trim());
    }
    
    const extensionSuffix = 'code-complete-extension-recieved';
    const monthMap = {
      'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
      'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };
    
    for (const label of labels) {
      if (!label) continue;
      const labelLower = String(label).toLowerCase().trim();
      if (labelLower.endsWith(extensionSuffix)) {
        // Extract date part: <release>-<ddmmyyyy>-code-complete-extension-recieved
        // Remove the suffix and split by '-'
        const withoutSuffix = labelLower.replace(`-${extensionSuffix}`, '');
        const parts = withoutSuffix.split('-');
        
        // Find the part that looks like a date (ddmmyyyy format, e.g., 28feb2026, 13mar2026)
        for (const part of parts) {
          // Match patterns like: 28feb2026, 13mar2026, 1jan2026, etc.
          // Day can be 1-2 digits, month is 3 letters, year is 4 digits
          const dateMatch = part.match(/^(\d{1,2})([a-z]{3})(\d{4})$/i);
          if (dateMatch) {
            const [, dayStr, monthStr, yearStr] = dateMatch;
            const day = parseInt(dayStr, 10);
            const year = parseInt(yearStr, 10);
            const month = monthMap[monthStr.toLowerCase()];
            
            // Validate: day must be 1-31, year must be reasonable (2000-2100), month must be valid
            if (month !== undefined && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
              try {
                // Create date in local timezone (month is 0-indexed in JS Date)
                const date = new Date(year, month, day);
                date.setHours(0, 0, 0, 0);
                
                // Validate the date is correct (handles invalid dates like Feb 30)
                if (!isNaN(date.getTime()) && 
                    date.getFullYear() === year && 
                    date.getMonth() === month && 
                    date.getDate() === day) {
                  return date;
                }
              } catch (e) {
                // Invalid date, continue to next part
                continue;
              }
            }
          }
        }
      }
    }
    return null;
  };

  // Get extension date if label exists
  const extensionDate = getExtensionDateFromLabel(item);
  // JIRA Code Complete Date (for overshoot comparison)
  const jiraCodeCompleteDate = parseDate(item.customfield_11067);
  // Use extension date for calculations if available, otherwise use JIRA date
  const codeCompleteDate = extensionDate || jiraCodeCompleteDate;
  const fsdsDoneDate = parseDate(item.customfield_13861);
  const testPlanDate = parseDate(item.customfield_11068);
  const commitGateDate = parseDate(item.customfield_35863);
  const promotionGateDate = parseDate(item.customfield_35864);
  const statusUpdateDate = parseDate(item.customfield_45660);

  // Helper to get latest marker date from ganttConfig for a given gate type
  const getLatestMarkerDate = (gatePrefix) => {
    if (!ganttConfig) return null;
    const markerDates = [];
    Object.keys(ganttConfig).forEach(key => {
      if (key.startsWith(gatePrefix)) {
        const gate = ganttConfig[key];
        if (gate) {
          // Handle arrays (like ccm1Gate, ccm2Gate)
          if (Array.isArray(gate)) {
            gate.forEach(g => {
              if (g && g.date) {
                const gateDate = parseDate(g.date);
                if (gateDate) markerDates.push(gateDate);
              }
            });
          } else if (gate.date) {
            // Handle single objects (like commitGate1, promotionGate1)
            const gateDate = parseDate(gate.date);
            if (gateDate) markerDates.push(gateDate);
          }
        }
      }
    });
    if (markerDates.length > 0) {
      return markerDates.reduce((latest, current) => 
        current.getTime() > latest.getTime() ? current : latest
      );
    }
    return null;
  };

  // Get latest marker dates from config
  const latestCCMMarkerDate = getLatestMarkerDate('ccm');
  const latestCGMarkerDate = getLatestMarkerDate('commitGate');
  const latestPGMarkerDate = getLatestMarkerDate('promotionGate');

  // Compare JIRA dates with marker dates and calculate overshoot/undershoot
  // IMPORTANT: For overshoot comparison, use the JIRA date (not extension date)
  // Extension date is only used for "days to" calculations
  const getDateComparison = (jiraDate, markerDate, gateName) => {
    if (!jiraDate || !markerDate) return null;
    const diffDays = Math.ceil((jiraDate.getTime() - markerDate.getTime()) / (1000 * 60 * 60 * 24));
    return {
      overshoot: diffDays > 0,
      days: Math.abs(diffDays),
      gateName
    };
  };

  // For overshoot comparison, use JIRA date (not extension date)
  const ccmComparison = jiraCodeCompleteDate && latestCCMMarkerDate 
    ? getDateComparison(jiraCodeCompleteDate, latestCCMMarkerDate, 'CCM')
    : null;
  const cgComparison = commitGateDate && latestCGMarkerDate
    ? getDateComparison(commitGateDate, latestCGMarkerDate, 'CG')
    : null;
  const pgComparison = promotionGateDate && latestPGMarkerDate
    ? getDateComparison(promotionGateDate, latestPGMarkerDate, 'PG')
    : null;

  // Find the last available CG date from either JIRA field or ganttConfig
  let lastCGDate = commitGateDate;
  if (ganttConfig) {
    const cgDates = [];
    Object.keys(ganttConfig).forEach(key => {
      if (key.startsWith('commitGate') && /^\d+$/.test(key.replace('commitGate', ''))) {
        const gate = ganttConfig[key];
        if (gate && gate.date) {
          const gateDate = parseDate(gate.date);
          if (gateDate) {
            cgDates.push(gateDate);
          }
        }
      }
    });
    if (cgDates.length > 0) {
      // Find the latest CG date
      const latestCGDate = cgDates.reduce((latest, current) => 
        current.getTime() > latest.getTime() ? current : latest
      );
      // Use the latest between JIRA field and config
      if (!lastCGDate || latestCGDate.getTime() > lastCGDate.getTime()) {
        lastCGDate = latestCGDate;
      }
    }
  }

  // Check if Status Update Date is > 10 days old
  const isStatusUpdateOld = statusUpdateDate ? isDateOlderThan(statusUpdateDate, 10) : true;
  const latestUpdateNotAvailable = !statusUpdateDate || isStatusUpdateOld;

  // Calculate days to gates
  const daysToCC = codeCompleteDate ? Math.ceil((codeCompleteDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;
  const daysToCG = commitGateDate ? Math.ceil((commitGateDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;
  const daysToLastCG = lastCGDate ? Math.ceil((lastCGDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;
  const daysToPG = promotionGateDate ? Math.ceil((promotionGateDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;
  
  // Security and Legal tickets (SDL, LEG projects) are required 3 weeks (21 days) before the last CG date
  // This ensures tickets are created in time for CG readiness
  // Require if: (1) CG date is in the future and within 21 days, OR (2) CG date has passed (tickets should exist by now)
  const securityLegalRequired = daysToLastCG !== null && (
    (daysToLastCG > 0 && daysToLastCG <= 21) || // Future date within 21 days
    daysToLastCG <= 0 // Past date - tickets should already exist
  );

  // Check readiness indicators
  const techDesignDone = fsdsDoneDate && fsdsDoneDate.getTime() <= today.getTime();
  const testPlanDone = testPlanDate && testPlanDate.getTime() <= today.getTime();
  
  // Check if critical prerequisite dates are missing (not set in JIRA)
  const fsdsDateMissing = !fsdsDoneDate;
  const testPlanDateMissing = !testPlanDate;
  
  const designDocExists = !!getStringValue(item.customfield_14464);
  const requirementsLinkExists = !!getStringValue(item.customfield_14463);
  const testPlanLinkExists = !!getStringValue(item.customfield_14465);

  // Check labels for security/legal
  const labels = Array.isArray(item.labels) ? item.labels : (item.labelsString ? item.labelsString.split(',').map(l => l.trim()) : []);
  const labelStrings = labels.map(l => l.toLowerCase());
  const securityFiled = config.labelKeywords.security.some(keyword => 
    labelStrings.some(label => label.includes(keyword))
  );
  const legalFiled = config.labelKeywords.legal.some(keyword => 
    labelStrings.some(label => label.includes(keyword))
  );

  // Check for P0/P1 bugs (if this item itself is a bug with high priority)
  const priority = (item.priority || '').toUpperCase();
  const status = (item.status || '').toLowerCase();
  const isDone = status.includes('done') || status.includes('closed') || status.includes('resolved');
  const p0p1BugsOpen = (priority === 'P0' || priority === 'P1') && !isDone ? 1 : 0;

  // Calculate risk scores
  let ccRiskScore = 0;
  
  // Date overshoots are critical - add significant risk
  if (ccmComparison && ccmComparison.overshoot) {
    // Overshoot by more than 7 days is very critical
    if (ccmComparison.days > 7) {
      ccRiskScore += config.ccRisk.criticalDaysMissingPrereq * 2; // Double penalty for significant overshoot
    } else {
      ccRiskScore += config.ccRisk.criticalDaysMissingPrereq; // Standard penalty for overshoot
    }
  }
  
  if (daysToCC !== null) {
    // Only apply time-based risk if date is in the future
    if (daysToCC > 0 && daysToCC <= config.criticalDaysToGate && (!techDesignDone || !testPlanDone)) {
      ccRiskScore += config.ccRisk.criticalDaysMissingPrereq;
    }
    // Missing dates (not set in JIRA) should contribute more risk
    if (fsdsDateMissing) ccRiskScore += config.ccRisk.techDesignMissing;
    else if (!techDesignDone) ccRiskScore += config.ccRisk.techDesignMissing;
    
    if (testPlanDateMissing) ccRiskScore += config.ccRisk.testPlanMissing;
    else if (!testPlanDone) ccRiskScore += config.ccRisk.testPlanMissing;
    
    if (!designDocExists) ccRiskScore += config.ccRisk.designDocMissing;
    if (!requirementsLinkExists) ccRiskScore += config.ccRisk.requirementsMissing;
    if (!testPlanLinkExists) ccRiskScore += config.ccRisk.testPlanLinkMissing;
    // Only add time pressure risk if date is in the future
    if (!isDone && daysToCC > 0 && daysToCC <= config.warningDaysToGate) {
      ccRiskScore += config.ccRisk.closeToDate;
    }
  } else {
    // Even without CC date, check prerequisites
    // Missing dates (not set in JIRA) should contribute more risk
    if (fsdsDateMissing) ccRiskScore += config.ccRisk.techDesignMissing;
    else if (!techDesignDone) ccRiskScore += config.ccRisk.techDesignMissing;
    
    if (testPlanDateMissing) ccRiskScore += config.ccRisk.testPlanMissing;
    else if (!testPlanDone) ccRiskScore += config.ccRisk.testPlanMissing;
    
    if (!designDocExists) ccRiskScore += config.ccRisk.designDocMissing;
    if (!requirementsLinkExists) ccRiskScore += config.ccRisk.requirementsMissing;
    if (!testPlanLinkExists) ccRiskScore += config.ccRisk.testPlanLinkMissing;
  }
  
  // Missing critical prerequisite dates should push to at least YELLOW
  // If Test Plan Date or FS/DS Done Date is missing, add additional risk
  if (testPlanDateMissing || fsdsDateMissing) {
    ccRiskScore += 2; // Additional penalty for missing dates
  }

  let cgRiskScore = 0;
  if (daysToCG !== null) {
    // Security/Legal tickets are required 3 weeks (21 days) before the last CG date
    // Check if: (1) Last CG date is in the future and within 21 days, OR (2) Last CG date has passed (tickets should exist)
    if (securityLegalRequired) {
      // If last CG date has passed, this is more critical - add higher risk
      if (daysToLastCG !== null && daysToLastCG <= 0 && (!securityFiled || !legalFiled)) {
        cgRiskScore += config.cgRisk.criticalDaysMissingPrereq; // Critical if past date and missing
      } else if (daysToLastCG !== null && daysToLastCG > 0 && daysToLastCG <= config.criticalDaysToGate && (!securityFiled || !legalFiled)) {
        cgRiskScore += config.cgRisk.criticalDaysMissingPrereq;
      }
      if (!securityFiled) cgRiskScore += config.cgRisk.securityNotFiled;
      if (!legalFiled) cgRiskScore += config.cgRisk.legalNotFiled;
    }
    // Manual tests open - inferred from status (only if date is in the future)
    if (!isDone && daysToCG > 0 && daysToCG <= config.warningDaysToGate) {
      cgRiskScore += config.cgRisk.manualTestsOpen;
    }
  } else {
    // Even without CG date from JIRA, check prerequisites if within 3 weeks (21 days) of last CG date OR if last CG date has passed
    if (securityLegalRequired) {
      if (!securityFiled) cgRiskScore += config.cgRisk.securityNotFiled;
      if (!legalFiled) cgRiskScore += config.cgRisk.legalNotFiled;
    }
  }

  let pgRiskScore = 0;
  
  // Date overshoots are critical - add significant risk
  if (pgComparison && pgComparison.overshoot) {
    // Overshoot by more than 7 days is very critical
    if (pgComparison.days > 7) {
      pgRiskScore += config.pgRisk.p0p1BugsOpen * 2; // Use similar penalty structure
    } else {
      pgRiskScore += config.pgRisk.p0p1BugsOpen; // Standard penalty for overshoot
    }
  }
  
  if (daysToPG !== null) {
    if (p0p1BugsOpen > 0) pgRiskScore += config.pgRisk.p0p1BugsOpen;
    // Security/Legal tickets are required 3 weeks (21 days) before the last CG date
    // For PG, we check if they're closed (not just filed) if within 3 weeks of last CG
    if (securityLegalRequired) {
      if (!securityFiled) pgRiskScore += config.pgRisk.securityNotClosed;
      if (!legalFiled) pgRiskScore += config.pgRisk.legalNotClosed;
    }
    if (!designDocExists || !requirementsLinkExists || !testPlanLinkExists) {
      pgRiskScore += config.pgRisk.docsIncomplete;
    }
  } else {
    // Even without PG date, check prerequisites
    if (p0p1BugsOpen > 0) pgRiskScore += config.pgRisk.p0p1BugsOpen;
    // Security/Legal tickets are required 3 weeks (21 days) before the last CG date
    if (securityLegalRequired) {
      if (!securityFiled) pgRiskScore += config.pgRisk.securityNotClosed;
      if (!legalFiled) pgRiskScore += config.pgRisk.legalNotClosed;
    }
    if (!designDocExists || !requirementsLinkExists || !testPlanLinkExists) {
      pgRiskScore += config.pgRisk.docsIncomplete;
    }
  }

  // Determine overall RAG
  const maxRiskScore = Math.max(ccRiskScore, cgRiskScore, pgRiskScore);
  let rag = 'GREEN';
  
  // Missing critical prerequisite dates (Test Plan Date, FS/DS Done Date) should push to at least YELLOW
  // These are hard blockers that prevent GREEN status
  if (testPlanDateMissing || fsdsDateMissing) {
    // If missing dates, ensure at least YELLOW status
    if (maxRiskScore >= config.ragThresholds.red) {
      rag = 'RED';
    } else {
      rag = 'YELLOW'; // Missing dates = at least YELLOW
    }
  } else {
    // Normal RAG determination
    if (maxRiskScore >= config.ragThresholds.red) {
      rag = 'RED';
    } else if (maxRiskScore >= config.ragThresholds.yellow) {
      rag = 'YELLOW';
    }
  }

  // Build risk drivers list - prioritize most critical issues
  const riskDrivers = [];
  
  // Critical blockers first (missing dates are hard blockers)
  if (fsdsDateMissing) riskDrivers.push('FS/DS Done Date not set');
  else if (!techDesignDone) riskDrivers.push('Tech Design not done');
  
  if (testPlanDateMissing) riskDrivers.push('Test Plan Date not set');
  else if (!testPlanDone) riskDrivers.push('Test Plan not done');
  
  // Date overshoots - if JIRA date is later than marker date, this is critical
  if (ccmComparison && ccmComparison.overshoot) {
    riskDrivers.push(`Code Complete Date overshoots ${ccmComparison.gateName} marker by ${ccmComparison.days} day${ccmComparison.days === 1 ? '' : 's'}`);
  }
  if (cgComparison && cgComparison.overshoot) {
    riskDrivers.push(`Commit Gate Date overshoots ${cgComparison.gateName} marker by ${cgComparison.days} day${cgComparison.days === 1 ? '' : 's'}`);
  }
  if (pgComparison && pgComparison.overshoot) {
    riskDrivers.push(`Promotion Gate Date overshoots ${pgComparison.gateName} marker by ${pgComparison.days} day${pgComparison.days === 1 ? '' : 's'}`);
  }
  
  // Time pressure - show days to dates
  // Format: "X days to code complete date called out in JIRA and X days to code complete gate date"
  if (codeCompleteDate && latestCCMMarkerDate) {
    const daysToMarker = Math.ceil((latestCCMMarkerDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysToCC !== null && daysToCC > 0 && daysToMarker > 0) {
      // Show both: days to JIRA date and days to marker date
      const jiraDateLabel = extensionDate ? 'extension date' : 'code complete date called out in JIRA';
      riskDrivers.push(`${daysToCC} day${daysToCC === 1 ? '' : 's'} to ${jiraDateLabel} and ${daysToMarker} day${daysToMarker === 1 ? '' : 's'} to code complete gate date`);
    } else if (daysToCC !== null && daysToCC > 0) {
      // Only show days to JIRA date if marker date has passed
      const jiraDateLabel = extensionDate ? 'extension date' : 'code complete date called out in JIRA';
      if (daysToCC <= 7) {
        riskDrivers.push(`${daysToCC} day${daysToCC === 1 ? '' : 's'} to ${jiraDateLabel}`);
      }
    }
  } else if (daysToCC !== null && daysToCC > 0 && daysToCC <= 7) {
    const jiraDateLabel = extensionDate ? 'extension date' : 'code complete date called out in JIRA';
    riskDrivers.push(`${daysToCC} day${daysToCC === 1 ? '' : 's'} to ${jiraDateLabel}`);
  }
  
  if (commitGateDate && latestCGMarkerDate) {
    if (cgComparison && !cgComparison.overshoot) {
      // Date is earlier than marker - show both
      if (daysToCG !== null && daysToCG > 0) {
        const daysToMarker = Math.ceil((latestCGMarkerDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        riskDrivers.push(`${daysToCG} day${daysToCG === 1 ? '' : 's'} to Commit Gate Date, ${daysToMarker} day${daysToMarker === 1 ? '' : 's'} to CG marker`);
      }
    } else if (daysToCG !== null && daysToCG > 0 && daysToCG <= 7) {
      riskDrivers.push(`${daysToCG} day${daysToCG === 1 ? '' : 's'} to Commit Gate`);
    }
  } else if (daysToCG !== null && daysToCG > 0 && daysToCG <= 7) {
    riskDrivers.push(`${daysToCG} day${daysToCG === 1 ? '' : 's'} to Commit Gate`);
  }
  
  if (promotionGateDate && latestPGMarkerDate) {
    if (pgComparison && !pgComparison.overshoot) {
      // Date is earlier than marker - show both
      if (daysToPG !== null && daysToPG > 0) {
        const daysToMarker = Math.ceil((latestPGMarkerDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        riskDrivers.push(`${daysToPG} day${daysToPG === 1 ? '' : 's'} to Promotion Gate Date, ${daysToMarker} day${daysToMarker === 1 ? '' : 's'} to PG marker`);
      }
    } else if (daysToPG !== null && daysToPG > 0 && daysToPG <= 7) {
      riskDrivers.push(`${daysToPG} day${daysToPG === 1 ? '' : 's'} to Promotion Gate`);
    }
  } else if (daysToPG !== null && daysToPG > 0 && daysToPG <= 7) {
    riskDrivers.push(`${daysToPG} day${daysToPG === 1 ? '' : 's'} to Promotion Gate`);
  }
  
  // Security/Legal tickets are required 3 weeks (21 days) before the last CG date
  // Flag if: (1) Within 7 days of last CG (truly urgent), OR (2) CG date has passed (tickets should exist)
  if (securityLegalRequired && daysToLastCG !== null) {
    const isUrgent = (daysToLastCG > 0 && daysToLastCG <= 7) || daysToLastCG <= 0;
    if (isUrgent) {
      if (!securityFiled) riskDrivers.push('Security not filed');
      if (!legalFiled) riskDrivers.push('Legal not filed');
    }
  }
  
  // P0/P1 bugs are always critical
  if (p0p1BugsOpen > 0) riskDrivers.push('P0/P1 bugs open');
  
  // Missing links are lower priority - only add if we don't have enough critical issues
  if (riskDrivers.length < 3) {
    if (!designDocExists) riskDrivers.push('Design Doc missing');
    if (!requirementsLinkExists && riskDrivers.length < 3) riskDrivers.push('Requirements link missing');
    if (!testPlanLinkExists && riskDrivers.length < 3) riskDrivers.push('Test Plan link missing');
  }

  // Note: Missing gate dates (CG/PG) are release-level issues, not item-specific
  // They are now displayed at the top of the table instead of in each summary

  // Determine Call to Action based on blockers and RAG status
  // Intelligently identifies missing dates, links, and blockers for CCM, CG, and PG gates
  const getCallToAction = () => {
    const actions = [];
    const urgency = rag === 'RED' ? 'immediately' : (rag === 'YELLOW' ? 'urgently' : '');
    const urgencySuffix = urgency ? ` ${urgency}` : '';
    
    // CCM (Code Commit Milestone) related actions
    if (!codeCompleteDate) {
      actions.push(`Set Code Commit Milestone Date in JIRA${urgencySuffix}`);
    }
    // Note: Escalation logic moved to end - only escalate if no actionable items exist
    
    // Tech Design (FS/DS Done Date) - prerequisite for CCM
    if (!techDesignDone) {
      if (!fsdsDoneDate) {
        actions.push(`Set FS/DS Done Date in JIRA${urgencySuffix}`);
      } else {
        actions.push(`Complete Tech Design${urgencySuffix}`);
      }
    }
    
    // Test Plan Date - prerequisite for CCM
    if (!testPlanDone) {
      if (!testPlanDate) {
        actions.push(`Set Test Plan Date in JIRA${urgencySuffix}`);
      } else {
        actions.push(`Complete Test Plan${urgencySuffix}`);
      }
    }
    
    // Document links - prerequisites for CCM and PG
    if (!designDocExists) {
      actions.push(`Add Design Doc link in JIRA${urgencySuffix}`);
    }
    if (!requirementsLinkExists) {
      actions.push(`Add Requirements link in JIRA${urgencySuffix}`);
    }
    if (!testPlanLinkExists) {
      actions.push(`Add Test Plan link in JIRA${urgencySuffix}`);
    }
    
    // Commit Gate (CG) related actions
    if (!commitGateDate) {
      actions.push(`Set Commit Gate Date in JIRA${urgencySuffix}`);
    }
    // Note: Escalation logic moved to end - only escalate if no actionable items exist
    
    // Security and Legal - prerequisites for CG and PG
    // Required 3 weeks (21 days) before the last CG date to ensure tickets (SDL, LEG projects) are created in time
    // If CG date has passed, this is critical - tickets should already exist
    if (securityLegalRequired) {
      if (!securityFiled) {
        // Urgent if: within 7 days of future CG date OR CG date has passed
        if (daysToLastCG !== null && (daysToLastCG <= 7 || daysToLastCG <= 0)) {
          actions.push(`File Security ticket${urgencySuffix}`);
        } else {
          actions.push('File Security ticket');
        }
      }
      if (!legalFiled) {
        // Urgent if: within 7 days of future CG date OR CG date has passed
        if (daysToLastCG !== null && (daysToLastCG <= 7 || daysToLastCG <= 0)) {
          actions.push(`File Legal ticket${urgencySuffix}`);
        } else {
          actions.push('File Legal ticket');
        }
      }
    }
    
    // Promotion Gate (PG) related actions
    if (!promotionGateDate) {
      actions.push(`Set Promotion Gate Date in JIRA${urgencySuffix}`);
    }
    // Note: Escalation logic moved to end - only escalate if no actionable items exist
    
    // P0/P1 bugs - critical for PG
    if (p0p1BugsOpen > 0) {
      actions.push(`Resolve P0/P1 bugs${urgencySuffix}`);
    }
    
    // Status Update
    if (latestUpdateNotAvailable) {
      actions.push(`Update Status Update in JIRA${urgencySuffix}`);
    }
    
    // Prioritize actions: most critical first, limit to top 3-4 actionable items
    // Priority order: Missing critical dates > Critical blockers > Missing links > Security/Legal > Status updates
    const prioritizedActions = [];
    
    // First: Missing critical dates (CCM, CG, PG)
    prioritizedActions.push(...actions.filter(a => a.includes('Set') && (a.includes('CCM') || a.includes('Commit Gate') || a.includes('Promotion Gate'))));
    
    // Second: Critical blockers (Tech Design, Test Plan, P0/P1 bugs)
    prioritizedActions.push(...actions.filter(a => a.includes('Complete') || a.includes('Resolve P0/P1')));
    
    // Third: Missing dates (FS/DS, Test Plan Date)
    prioritizedActions.push(...actions.filter(a => a.includes('Set') && !prioritizedActions.includes(a)));
    
    // Fourth: Missing links
    prioritizedActions.push(...actions.filter(a => a.includes('link in JIRA')));
    
    // Fifth: Security/Legal tickets
    prioritizedActions.push(...actions.filter(a => a.includes('Security') || a.includes('Legal')));
    
    // Sixth: Status updates
    prioritizedActions.push(...actions.filter(a => a.includes('Status Update')));
    
    // Escalation: Only escalate for the MOST IMMEDIATE gate if there are no actionable items
    // and we're truly at risk. Don't escalate for all gates at once.
    const actionableItems = prioritizedActions.filter(a => 
      !a.includes('Monitor') && !a.includes('Escalate')
    );
    
    // Only escalate if there are no actionable items OR if we're within 3 days of a critical gate
    if (actionableItems.length === 0 || rag === 'RED') {
      // Find the most immediate gate that's at risk (only future dates)
      const gateRisks = [];
      if (daysToCC !== null && daysToCC > 0 && daysToCC <= 7 && rag === 'RED') {
        gateRisks.push({ days: daysToCC, gate: 'CCM', action: 'Escalate to leadership - CCM date at risk' });
      }
      if (daysToCG !== null && daysToCG > 0 && daysToCG <= 7 && rag === 'RED') {
        gateRisks.push({ days: daysToCG, gate: 'CG', action: 'Escalate to leadership - CG date at risk' });
      }
      if (daysToPG !== null && daysToPG > 0 && daysToPG <= 7 && rag === 'RED') {
        gateRisks.push({ days: daysToPG, gate: 'PG', action: 'Escalate to leadership - PG date at risk' });
      }
      
      // Only escalate for the most immediate gate (lowest days)
      if (gateRisks.length > 0) {
        gateRisks.sort((a, b) => a.days - b.days);
        prioritizedActions.push(gateRisks[0].action);
      }
    }
    
    // Remove duplicates while preserving order
    const uniqueActions = [];
    const seen = new Set();
    for (const action of prioritizedActions) {
      if (!seen.has(action)) {
        seen.add(action);
        uniqueActions.push(action);
      }
    }
    
    // If no prioritized actions, use original actions list
    const finalActions = uniqueActions.length > 0 ? uniqueActions : actions;
    
    // Consolidate similar actions to remove repeated words
    const consolidateActions = (actionsList) => {
      const consolidated = [];
      const groups = {
        setDates: [],
        addLinks: [],
        fileTickets: [],
        completeTasks: [],
        other: []
      };
      
      for (const action of actionsList) {
        if (action.startsWith('Set ') && action.includes('Date in JIRA')) {
          groups.setDates.push(action);
        } else if (action.includes('Add ') && action.includes('link in JIRA')) {
          groups.addLinks.push(action);
        } else if (action.includes('File ') && action.includes('ticket')) {
          groups.fileTickets.push(action);
        } else if (action.startsWith('Complete ')) {
          groups.completeTasks.push(action);
        } else {
          groups.other.push(action);
        }
      }
      
      // Consolidate "Set X Date in JIRA" actions
      if (groups.setDates.length > 0) {
        const dates = groups.setDates.map(a => {
          // Extract the date name (e.g., "Code Commit Milestone", "Commit Gate", "FS/DS Done", "Test Plan")
          if (a.includes('Code Commit Milestone')) return 'Code Commit Milestone';
          if (a.includes('Commit Gate')) return 'Commit Gate';
          if (a.includes('Promotion Gate')) return 'Promotion Gate';
          if (a.includes('FS/DS Done')) return 'FS/DS Done';
          if (a.includes('Test Plan')) return 'Test Plan';
          return null;
        }).filter(Boolean);
        
        const urgencyMatch = groups.setDates[0].match(/\s+(immediately|urgently)$/);
        const urgency = urgencyMatch ? urgencyMatch[1] : '';
        const urgencySuffix = urgency ? ` ${urgency}` : '';
        
        if (dates.length === 1) {
          consolidated.push(groups.setDates[0]);
        } else {
          const lastDate = dates.pop();
          const dateList = dates.length > 0 ? dates.join(', ') + ' and ' + lastDate : lastDate;
          consolidated.push(`Set ${dateList} Dates in JIRA${urgencySuffix}`);
        }
      }
      
      // Consolidate "Add X link in JIRA" actions
      if (groups.addLinks.length > 0) {
        const links = groups.addLinks.map(a => {
          if (a.includes('Design Doc')) return 'Design Doc';
          if (a.includes('Requirements')) return 'Requirements';
          if (a.includes('Test Plan')) return 'Test Plan';
          return null;
        }).filter(Boolean);
        
        const urgencyMatch = groups.addLinks[0].match(/\s+(immediately|urgently)$/);
        const urgency = urgencyMatch ? urgencyMatch[1] : '';
        const urgencySuffix = urgency ? ` ${urgency}` : '';
        
        if (links.length === 1) {
          consolidated.push(groups.addLinks[0]);
        } else {
          const lastLink = links.pop();
          const linkList = links.length > 0 ? links.join(', ') + ' and ' + lastLink : lastLink;
          consolidated.push(`Add ${linkList} links in JIRA${urgencySuffix}`);
        }
      }
      
      // Consolidate "File X ticket" actions
      if (groups.fileTickets.length > 0) {
        const tickets = groups.fileTickets.map(a => {
          if (a.includes('Security')) return 'Security';
          if (a.includes('Legal')) return 'Legal';
          return null;
        }).filter(Boolean);
        
        const urgencyMatch = groups.fileTickets[0].match(/\s+(immediately|urgently)$/);
        const urgency = urgencyMatch ? urgencyMatch[1] : '';
        const urgencySuffix = urgency ? ` ${urgency}` : '';
        
        if (tickets.length === 1) {
          consolidated.push(groups.fileTickets[0]);
        } else {
          const ticketList = tickets.join(' and ');
          consolidated.push(`File ${ticketList} tickets${urgencySuffix}`);
        }
      }
      
      // Add complete tasks and other actions as-is
      consolidated.push(...groups.completeTasks);
      consolidated.push(...groups.other);
      
      return consolidated;
    };
    
    const consolidatedActions = consolidateActions(finalActions);
    
    // Limit to top 3-4 most critical actions to avoid being "hasty"
    // Focus on actionable items first, escalation only if truly critical
    const limitedActions = consolidatedActions.slice(0, 4);
    
    return limitedActions.length > 0 ? limitedActions.join('; ') : null;
  };

  const callToAction = getCallToAction();

  // Generate concise summary
  const topDrivers = riskDrivers.slice(0, 3);
  
  if (rag === 'GREEN') {
    let summary = `${rag}: `;
    if (codeCompleteDate && daysToCC !== null && daysToCC > 0) {
      summary += `CCM achievable with ${daysToCC} day${daysToCC === 1 ? '' : 's'} remaining. `;
    } else {
      summary += `CCM achievable. `;
    }
    // Check if prerequisites are actually met or if dates are missing
    if (techDesignDone && testPlanDone && !fsdsDateMissing && !testPlanDateMissing) {
      summary += `Prerequisites met.`;
    } else if (fsdsDateMissing || testPlanDateMissing) {
      // If dates are missing, prerequisites are not on track
      const missingPrereqs = [];
      if (fsdsDateMissing) missingPrereqs.push('FS/DS Done Date');
      if (testPlanDateMissing) missingPrereqs.push('Test Plan Date');
      summary += `Prerequisites incomplete: ${missingPrereqs.join(', ')} not set.`;
    } else {
      summary += `Prerequisites on track.`;
    }
    // Add status update availability
    if (latestUpdateNotAvailable) {
      summary += ` Latest update not available.`;
    }
    // Add call to action
    if (callToAction) {
      summary += ` Call to Action: ${callToAction}.`;
    }
    return summary;
  } else if (rag === 'YELLOW') {
    let summary = `${rag}: `;
    if (topDrivers.length > 0) {
      summary += `CCM at risk: ${topDrivers.slice(0, 2).join(', ')}`;
      if (daysToCC !== null && daysToCC > 0) {
        summary += `, ${daysToCC} day${daysToCC === 1 ? '' : 's'} to CCM`;
      }
      summary += `.`;
    } else {
      summary += `CCM at risk. Readiness items need attention.`;
    }
    // Add status update availability
    if (latestUpdateNotAvailable) {
      summary += ` Latest update not available.`;
    }
    // Add call to action
    if (callToAction) {
      summary += ` Call to Action: ${callToAction}.`;
    }
    return summary;
  } else { // RED
    let summary = `${rag}: `;
    if (topDrivers.length > 0) {
      summary += `${topDrivers.slice(0, 3).join(', ')}`;
      if (daysToCC !== null && daysToCC > 0) {
        summary += `, ${daysToCC} day${daysToCC === 1 ? '' : 's'} to CCM`;
      }
      summary += `.`;
    } else {
      summary += `Critical blockers present.`;
    }
    // Add status update availability
    if (latestUpdateNotAvailable) {
      summary += ` Latest update not available.`;
    }
    // Add call to action
    if (callToAction) {
      summary += ` Call to Action: ${callToAction}.`;
    }
    return summary;
  }
}
