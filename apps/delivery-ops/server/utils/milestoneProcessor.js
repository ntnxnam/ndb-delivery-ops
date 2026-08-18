/**
 * Milestone Processor Utility
 * 
 * Robust milestone processing logic for Executive Summary integration.
 * Handles complex date configurations from releaseVersionsEmailConfig.json
 * with support for both array and object formats.
 */

const path = require('path');
const { normalizeDateStr, formatDate: formatSharedDate } = require('./dateFormatter');

// Helper function to format date consistently
function formatDate(dateStr) {
  try {
    if (!dateStr) return null;

    const normalizedDate = normalizeDateStr(dateStr);
    if (!normalizedDate) {
      console.warn(`[milestoneProcessor] Invalid date: ${dateStr}`);
      return null;
    }

    const formatted = formatSharedDate(normalizedDate);
    return formatted === 'Not Set' ? null : formatted;
  } catch (error) {
    console.error(`[milestoneProcessor] Error formatting date ${dateStr}:`, error);
    return null;
  }
}

// Calculate days from today to a milestone date
function calculateDaysToMilestone(targetDate) {
  try {
    if (!targetDate) return null;
    
    const today = new Date();
    const target = new Date(targetDate);
    
    if (isNaN(target.getTime())) {
      console.warn(`[milestoneProcessor] Invalid target date for days calculation: ${targetDate}`);
      return null;
    }
    
    const diffTime = target - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  } catch (error) {
    console.error(`[milestoneProcessor] Error calculating days to milestone:`, error);
    return null;
  }
}

/**
 * Process milestones for a specific gate type (ccm, commitGate, promotionGate, ga)
 * Handles both array format (ccm1Gate, ccm2Gate) and object format (commitGate1, commitGate2)
 * 
 * @param {Object} versionConfig - Version configuration object
 * @param {string} gatePrefix - Gate prefix ('ccm', 'commitGate', 'promotionGate', 'ga')
 * @returns {Object} - {milestones: Array, currentDate: string}
 */
function processMilestonesForVersion(versionConfig, gatePrefix) {
  const milestones = [];
  let currentDate = null;

  try {
    if (!versionConfig) {
      console.warn(`[milestoneProcessor] No version config provided for ${gatePrefix}`);
      return { milestones, currentDate };
    }

    // Handle different naming patterns
    const gateKeys = [];
    
    if (gatePrefix === 'ccm') {
      // Look for ccm1Gate, ccm2Gate, ccm3Gate, etc.
      for (let i = 1; i <= 10; i++) {
        const key = `ccm${i}Gate`;
        if (versionConfig[key]) {
          gateKeys.push(key);
        }
      }
    } else if (gatePrefix === 'ga') {
      // General Availability - look for numbered variants
      for (let i = 1; i <= 10; i++) {
        const key = `ga${i}`;
        if (versionConfig[key]) {
          gateKeys.push(key);
        }
      }
    } else {
      // For commitGate and promotionGate, look for numbered variants
      for (let i = 1; i <= 10; i++) {
        const key = `${gatePrefix}${i}`;
        if (versionConfig[key]) {
          gateKeys.push(key);
        }
      }
    }

    for (const gateKey of gateKeys) {
      const gate = versionConfig[gateKey];
      
      if (!gate) {
        continue;
      }

      if (Array.isArray(gate)) {
        // Array format: [{ date: "2024-01-15", style: "dotted" }, ...]
        gate.forEach((milestone, index) => {
          if (milestone && milestone.date) {
            const formattedDate = formatDate(milestone.date);
            if (formattedDate) {
              const isStrikeThrough = milestone.style === 'dotted';
              const isCurrent = milestone.style === 'solid';
              
              milestones.push({
                date: milestone.date,
                formattedDate,
                isStrikeThrough,
                isCurrent,
                source: `${gateKey}[${index}]`
              });
              
              // Update current date if this milestone is marked as current
              if (isCurrent) {
                currentDate = formattedDate;
              }
              
            }
          }
        });
      } else if (typeof gate === 'object') {
        // Object format: { date: "2024-01-15", style: "solid" }
        if (gate.date) {
          const formattedDate = formatDate(gate.date);
          if (formattedDate) {
            const isStrikeThrough = gate.style === 'dotted';
            const isCurrent = gate.style === 'solid';
            
            milestones.push({
              date: gate.date,
              formattedDate,
              isStrikeThrough,
              isCurrent,
              source: gateKey
            });
            
            // Update current date if this milestone is marked as current
            if (isCurrent) {
              currentDate = formattedDate;
            }
            
          }
        }
      } else {
        console.warn(`[milestoneProcessor] Unexpected gate format for ${gateKey}:`, typeof gate, gate);
      }
    }

  } catch (error) {
    console.error(`[milestoneProcessor] Error processing milestones for ${gatePrefix}:`, error);
  }

  return { milestones, currentDate };
}

/**
 * Process all milestones from version configuration
 * 
 * @param {Object} versionConfig - Complete version configuration
 * @returns {Object} - Complete milestone data with metrics
 */
function processAllMilestones(versionConfig) {
  try {
    if (!versionConfig) {
      console.error('[milestoneProcessor] No version config provided');
      return {
        daysFromCutoff: null,
        currentCCDate: 'TBD',
        currentCGDate: 'TBD',
        currentPGDate: 'TBD',
        milestones: {
          codeComplete: [],
          commitGate: [],
          promotionGate: [],
          generalAvailability: []
        }
      };
    }

    // Process each gate type
    const ccm = processMilestonesForVersion(versionConfig, 'ccm');
    const commitGate = processMilestonesForVersion(versionConfig, 'commitGate');
    const promotionGate = processMilestonesForVersion(versionConfig, 'promotionGate');
    const ga = processMilestonesForVersion(versionConfig, 'ga');

    // Calculate days to Promotion Gate (PG)
    let daysToPG = null;
    if (promotionGate.milestones.length > 0) {
      // Find the current (non-strikethrough) PG date
      const currentPGMilestone = promotionGate.milestones.find(m => m.isCurrent && !m.isStrikeThrough);
      if (currentPGMilestone) {
        daysToPG = calculateDaysToMilestone(currentPGMilestone.date);
      }
    }

    const result = {
      daysFromCutoff: daysToPG,
      currentCCDate: ccm.currentDate || 'TBD',
      currentCGDate: commitGate.currentDate || 'TBD',
      currentPGDate: promotionGate.currentDate || 'TBD',
      milestones: {
        codeComplete: ccm.milestones,
        commitGate: commitGate.milestones,
        promotionGate: promotionGate.milestones,
        generalAvailability: ga.milestones
      }
    };

    return result;
    
  } catch (error) {
    console.error('[milestoneProcessor] Fatal error in processAllMilestones:', error);
    
    // Return safe fallback
    return {
      daysFromCutoff: null,
      currentCCDate: 'TBD',
      currentCGDate: 'TBD', 
      currentPGDate: 'TBD',
      milestones: {
        codeComplete: [],
        commitGate: [],
        promotionGate: [],
        generalAvailability: []
      }
    };
  }
}

module.exports = {
  processMilestonesForVersion,
  calculateDaysToMilestone,
  processAllMilestones,
  formatDate
};