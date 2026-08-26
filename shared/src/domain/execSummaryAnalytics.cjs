/**
 * Executive-summary analytics — shared SoT (Wave 3 / D41).
 *
 * Pure. Callers inject gateDates + formatDate so this file never reads
 * app JSON (releaseVersionsEmailConfig) or customfield maps.
 *
 * CJS so Express routes can require() it.
 */

function extractRiskText(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') return String(raw.value ?? raw.name ?? '');
  return String(raw);
}

function defaultFormatDate(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function getItemPriority(item) {
  if (item.priority) return item.priority;
  if (item.fields?.priority?.name) return item.fields.priority.name;
  return undefined;
}

function getItemStatus(item) {
  if (item.status) return String(item.status).toLowerCase();
  if (item.fields?.status?.name) return String(item.fields.status.name).toLowerCase();
  return '';
}

function getItemDueDate(item) {
  if (item.dueDate) return item.dueDate;
  if (item.fields?.duedate) return item.fields.duedate;
  return undefined;
}

function getRiskFromItem(item, riskFieldId) {
  let risk;
  if (item.riskIndicator) {
    risk = item.riskIndicator;
  } else if (item.fields) {
    risk = item.fields[riskFieldId] || item.fields.customfield_23560;
  } else {
    return 'not set';
  }
  if (!risk) return 'not set';
  const value = extractRiskText(risk).toLowerCase().trim();
  return value || 'not set';
}

function calculateRiskBreakdown(items, options = {}) {
  const riskFieldId = options.riskFieldId || 'customfield_23560';

  const reds = items.filter((item) => {
    const risk = getRiskFromItem(item, riskFieldId);
    return risk.includes('red') || risk.includes('big risk') || risk.includes('critical');
  });

  const yellows = items.filter((item) => {
    const risk = getRiskFromItem(item, riskFieldId);
    return (
      risk.includes('yellow') ||
      risk.includes('slight risk') ||
      risk.includes('at risk') ||
      risk.includes('moderate')
    );
  });

  const greens = items.filter((item) => {
    const risk = getRiskFromItem(item, riskFieldId);
    return risk.includes('green') || risk.includes('on track') || risk.includes('low risk');
  });

  const notSet = items.filter((item) => {
    const risk = getRiskFromItem(item, riskFieldId);
    return risk.includes('not set') || risk === '' || !(item[riskFieldId] || item.customfield_23560);
  });

  return {
    green: greens.length,
    yellow: yellows.length,
    red: reds.length,
    notSet: notSet.length,
    total: items.length,
  };
}

function calculateFeatVsNonFeatBreakdown(featItems, nonFeatItems) {
  const calculateWorkMetrics = (items) => {
    const total = items.length;

    const p0p1Outstanding = items.filter((item) => {
      const priority = getItemPriority(item);
      const status = getItemStatus(item);
      const isHighPriority =
        priority === 'Highest' ||
        priority === 'High' ||
        priority === 'Blocker' ||
        (priority &&
          (String(priority).toLowerCase().includes('p0') ||
            String(priority).toLowerCase().includes('p1')));
      const isOutstanding =
        !status.includes('resolved') && !status.includes('closed') && !status.includes('done');
      return Boolean(isHighPriority && isOutstanding);
    }).length;

    const postCCCreated = items.filter(() => false).length;

    const overdue = items.filter((item) => {
      const dueDate = getItemDueDate(item);
      if (dueDate && new Date(dueDate) < new Date()) return true;
      return false;
    }).length;

    const inProgress = items.filter((item) => {
      const status = getItemStatus(item);
      return status.includes('progress') || status.includes('development') || status.includes('review');
    }).length;

    return { total, p0p1Outstanding, postCCCreated, overdue, inProgress };
  };

  const featMetrics = calculateWorkMetrics(featItems);
  const nonFeatMetrics = calculateWorkMetrics(nonFeatItems);

  return {
    featTotal: featMetrics.total,
    featP0P1: featMetrics.p0p1Outstanding,
    featPostCC: featMetrics.postCCCreated,
    featOverdue: featMetrics.overdue,
    featInProgress: featMetrics.inProgress,
    nonFeatTotal: nonFeatMetrics.total,
    nonFeatP0P1: nonFeatMetrics.p0p1Outstanding,
    nonFeatPostCC: nonFeatMetrics.postCCCreated,
    nonFeatOverdue: nonFeatMetrics.overdue,
    nonFeatInProgress: nonFeatMetrics.inProgress,
  };
}

function calculateDateMetrics(_featItems, _nonFeatItems, version, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const versionConfig = options.gateDates || null;
  const formatMilestoneDate = (date) => {
    if (!date) return null;
    const fmt = typeof options.formatDate === 'function' ? options.formatDate : defaultFormatDate;
    return fmt(date);
  };

  if (!versionConfig) {
    return {
      daysToPG: null,
      currentCCDate: null,
      currentCGDate: null,
      currentPGDate: null,
      milestones: {
        codeComplete: [],
        commitGate: [],
        promotionGate: [],
        generalAvailability: [],
      },
    };
  }

  const processMilestones = (gatePrefix) => {
    const milestones = [];
    let currentDate = null;
    let gateNum = 1;

    while (true) {
      const gateKey = gatePrefix === 'ccm' ? `${gatePrefix}${gateNum}Gate` : `${gatePrefix}${gateNum}`;
      const gate = versionConfig[gateKey];
      if (!gate) break;

      if (Array.isArray(gate)) {
        gate.forEach((milestone) => {
          milestones.push({
            label: milestone.label,
            date: milestone.date,
            formattedDate: formatMilestoneDate(new Date(milestone.date)),
            isStrikeThrough: milestone.style === 'dotted',
            isCurrent: milestone.style === 'solid',
          });
          if (milestone.style === 'solid') {
            currentDate = formatMilestoneDate(new Date(milestone.date));
          }
        });
      } else {
        milestones.push({
          label: gate.label,
          date: gate.date,
          formattedDate: formatMilestoneDate(new Date(gate.date)),
          isStrikeThrough: gate.style === 'dotted',
          isCurrent: gate.style === 'solid',
        });
        if (gate.style === 'solid') {
          currentDate = formatMilestoneDate(new Date(gate.date));
        }
      }
      gateNum += 1;
    }

    return { milestones, currentDate };
  };

  const codeComplete = processMilestones('ccm');
  const commitGate = processMilestones('commitGate');
  const promotionGate = processMilestones('promotionGate');
  const generalAvailability = processMilestones('ga');

  let daysToPG = null;
  const currentPGMilestone = promotionGate.milestones.find((m) => m.isCurrent);
  if (currentPGMilestone) {
    const pgDate = new Date(currentPGMilestone.date);
    daysToPG = Math.ceil((pgDate - now) / (1000 * 60 * 60 * 24));
  }

  void version;
  return {
    daysToPG,
    currentCCDate: codeComplete.currentDate,
    currentCGDate: commitGate.currentDate,
    currentPGDate: promotionGate.currentDate,
    milestones: {
      codeComplete: codeComplete.milestones,
      commitGate: commitGate.milestones,
      promotionGate: promotionGate.milestones,
      generalAvailability: generalAvailability.milestones,
    },
  };
}

function calculateEnhancedAnalytics(version, featItems, nonFeatItems, options = {}) {
  const allItems = [...featItems, ...nonFeatItems];
  const riskCounts = calculateRiskBreakdown(allItems, options);

  const p0BugsCount = allItems.filter((item) => {
    const priority = getItemPriority(item);
    return (
      priority === 'Highest' ||
      priority === 'Blocker' ||
      (priority &&
        (String(priority).toLowerCase().includes('p0') ||
          String(priority).toLowerCase().includes('critical')))
    );
  }).length;

  const dateMetrics = calculateDateMetrics(featItems, nonFeatItems, version, options);
  const featVsNonFeat = calculateFeatVsNonFeatBreakdown(featItems, nonFeatItems);

  return {
    version,
    daysFromCutoff: dateMetrics.daysToPG,
    daysFromPG: dateMetrics.daysToPG,
    currentCCDate: dateMetrics.currentCCDate,
    currentCGDate: dateMetrics.currentCGDate,
    currentPGDate: dateMetrics.currentPGDate,
    p0BugsCount,
    riskCounts,
    featVsNonFeat,
    milestones: dateMetrics.milestones,
  };
}

function generateEnhancedExecutiveSummary(version, featItems, nonFeatItems, analytics) {
  const allItems = [...featItems, ...nonFeatItems];
  return {
    totalProjects: allItems.length,
    daysFromCutoff: analytics.daysToPG ?? analytics.daysFromCutoff,
    currentCCDate: analytics.currentCCDate || 'TBD',
    currentCGDate: analytics.currentCGDate || 'TBD',
    currentPGDate: analytics.currentPGDate || 'TBD',
    riskCounts: analytics.riskCounts,
    p0BugsCount: analytics.p0BugsCount,
    featVsNonFeat: analytics.featVsNonFeat,
    milestones: analytics.milestones,
    generatedAt: new Date().toISOString(),
    version,
  };
}

module.exports = {
  calculateEnhancedAnalytics,
  calculateDateMetrics,
  calculateFeatVsNonFeatBreakdown,
  calculateRiskBreakdown,
  generateEnhancedExecutiveSummary,
};
