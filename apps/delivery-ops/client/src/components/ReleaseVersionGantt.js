import React from 'react';
import { useJiraConfig } from '../utils/jiraConfig';
import { hasCodeCompleteExtensionLabel } from '../utils/releaseVersionUtils';

/**
 * ReleaseVersionGantt Component
 * 
 * Renders a Gantt chart showing timeline bars for Code Complete, Commit Gate, and Promotion Gate dates.
 * 
 * @param {Object} props
 * @param {Object} props.ganttConfig - Gantt configuration with EC date, GA dates, and gate dates
 * @param {string} props.selectedVersion - Currently selected release version
 * @param {Object} props.items - Items object with commit and longTermFunded arrays
 * @param {Object} props.checkpointHistory - Checkpoint history data for historical markers
 * @param {Function} props.sortItems - Function to sort items array
 * @param {Array} props.sprintDates - Array of sprint dates to display on timeline
 */
function ReleaseVersionGantt({
  ganttConfig,
  selectedVersion,
  items,
  checkpointHistory,
  sortItems,
  sprintDates = [],
  allVersionsConfig = null,
  statusesWithTick = [],
  // When true, render ONLY the small proportional gate timeline (the
  // band labelled "Timeline" — EC, CCM, CG, PG, GA dots on a single axis
  // with a Today marker). The full title, gate dates configuration
  // table, legend, and project-row Gantt chart are skipped. Used by the
  // Release Brief page so both surfaces share one canonical timeline.
  timelineOnly = false
}) {
  // JIRA configuration
  const { jiraBaseUrl } = useJiraConfig();

  if (!ganttConfig || !selectedVersion) {
    return null;
  }

  const { ecDate } = ganttConfig;
  
  if (!ecDate) return null;

  // Collect all GA dates (ga1, ga2, etc.)
  const gaDates = [];
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('ga') && /^\d+$/.test(key.replace('ga', ''))) {
      const gaData = ganttConfig[key];
      if (gaData && gaData.date) {
        const gateNumber = key.replace('ga', '');
        gaDates.push({
          date: new Date(gaData.date),
          label: `GA${gateNumber}`, // Always use GA{number} format (e.g., "GA1", "GA2") - same logic as CG/PG
          color: gaData.color || '#28a745',
          style: gaData.style || 'solid',
          fieldName: key,
          number: parseInt(gateNumber, 10)
        });
      }
    }
  });

  // Sort GA dates chronologically
  gaDates.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Use the latest GA date as timeline end
  if (gaDates.length === 0) return null;
  const latestGA = gaDates[gaDates.length - 1];

  // Parse dates
  const ec = new Date(ecDate);
  const ga = latestGA.date;
  const timelineStart = ec.getTime();
  const timelineEnd = ga.getTime();
  const timelineDuration = timelineEnd - timelineStart;
  
  // Calculate marker width scaling factor based on timeline duration
  // Dynamically calculate base duration from all available versions (instead of hardcoding)
  // This makes the scaling adapt to new versions automatically
  const baseMarkerWidth = 3; // Base width in pixels
  const currentDurationDays = timelineDuration / (24 * 60 * 60 * 1000);
  
  // Calculate base duration dynamically from all versions
  let baseDurationDays = 139; // Fallback to 139 if allVersionsConfig not available
  if (allVersionsConfig && Object.keys(allVersionsConfig).length > 0) {
    // Calculate durations for all versions
    const allDurations = Object.entries(allVersionsConfig)
      .map(([version, config]) => {
        if (!config.ecDate) return null;
        // Find latest GA date for this version
        const gaKeys = Object.keys(config).filter(k => k.startsWith('ga') && /^\d+$/.test(k.replace('ga', '')));
        if (gaKeys.length === 0) return null;
        const gaDates = gaKeys.map(k => new Date(config[k].date)).sort((a, b) => b.getTime() - a.getTime());
        const latestGA = gaDates[0];
        const ec = new Date(config.ecDate);
        const duration = (latestGA.getTime() - ec.getTime()) / (24 * 60 * 60 * 1000);
        return { version, duration };
      })
      .filter(d => d !== null && d.duration > 0);
    
    if (allDurations.length > 0) {
      // Use shortest duration as base - this ensures shorter timelines get base-size markers
      // and longer timelines scale up proportionally (which is the desired behavior)
      const sortedDurations = allDurations.map(d => d.duration).sort((a, b) => a - b);
      baseDurationDays = sortedDurations[0]; // Use minimum (shortest timeline)
    }
  }
  
  // Linear scaling: longer timelines get proportionally wider markers
  // This ensures markers maintain visual proportion relative to timeline length
  const widthScaleFactor = Math.max(0.8, Math.min(1.6, currentDurationDays / baseDurationDays)); // Scale between 0.8x and 1.6x
  const scaledMarkerWidth = Math.max(2, Math.round(baseMarkerWidth * widthScaleFactor)); // Minimum 2px
  const scaledECWidth = Math.max(3, Math.round(4 * widthScaleFactor)); // EC is 4px base, minimum 3px
  const scaledThinMarkerWidth = Math.max(1, Math.round(2 * widthScaleFactor)); // Thin markers, minimum 1px

  if (timelineDuration <= 0) return null;

  // Calculate position percentage for a date (constrained to 0-100% for EC to last GA)
  const getPositionPercent = (date) => {
    if (!date) return null;
    const dateTime = date.getTime();
    if (dateTime <= timelineStart) return 0;
    if (dateTime >= timelineEnd) return 100;
    return Math.min(100, Math.max(0, ((dateTime - timelineStart) / timelineDuration) * 100));
  };

  // Helper to format date as dd/MMM/yyyy
  const formatDateLabel = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Filter sprint dates within timeline (for display)
  const validSprintDates = (sprintDates || [])
    .filter(sprintDate => {
      const sprintTime = sprintDate instanceof Date ? sprintDate.getTime() : new Date(sprintDate).getTime();
      return sprintTime >= timelineStart && sprintTime <= timelineEnd;
    })
    .map(sprintDate => {
      const date = sprintDate instanceof Date ? sprintDate : new Date(sprintDate);
      return {
        date,
        position: getPositionPercent(date)
      };
    });

  // Generate weekly markers relative to ALL sprint dates (even if sprint is before EC)
  // This ensures we show weekly markers for sprints that started before EC but their weekly markers fall within timeline
  const weeklyMarkers = [];
  const oneWeek = 7 * 24 * 60 * 60 * 1000; // milliseconds in a week
  
  // Process ALL sprint dates (not just validSprintDates) to generate weekly markers
  const allSprintDates = (sprintDates || []).map(sprintDate => {
    return sprintDate instanceof Date ? sprintDate : new Date(sprintDate);
  });
  
  // For each sprint date, add markers at +1 week and +2 weeks (if they fall within timeline)
  allSprintDates.forEach((sprintDate) => {
    // Marker at 1 week after sprint
    const week1Date = new Date(sprintDate.getTime() + oneWeek);
    if (week1Date.getTime() >= timelineStart && week1Date.getTime() <= timelineEnd) {
      weeklyMarkers.push({
        date: week1Date,
        position: getPositionPercent(week1Date)
      });
    }
    
    // Marker at 2 weeks after sprint
    const week2Date = new Date(sprintDate.getTime() + (2 * oneWeek));
    if (week2Date.getTime() >= timelineStart && week2Date.getTime() <= timelineEnd) {
      weeklyMarkers.push({
        date: week2Date,
        position: getPositionPercent(week2Date)
      });
    }
  });
  
  // Sort by date to ensure proper rendering order
  weeklyMarkers.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Collect gate dates from config for full-height vertical markers (CCM, Commit Gate, Promotion Gate)
  const gateMarkers = [];
  
  // CCM gates (can be array or single object)
  // Check for ccm1Gate, ccm2Gate, etc. (similar to commitGate and promotionGate)
  // CCM markers can be before EC, so we show them regardless of timeline bounds
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('ccm') && key.includes('Gate')) {
      const gate = ganttConfig[key];
      if (gate) {
        const ccmGates = Array.isArray(gate) ? gate : [gate];
        ccmGates.forEach((ccmGate, _idx) => {
          if (ccmGate && ccmGate.date) {
            const gateDate = new Date(ccmGate.date);
            // Show CCM markers regardless of timeline bounds (they can be before EC)
            // Only filter out if they're way beyond GA (more than 6 months after)
            const maxFutureMargin = 6 * 30 * 24 * 60 * 60 * 1000; // 6 months margin after GA
            if (gateDate.getTime() <= (timelineEnd + maxFutureMargin)) {
              const gateNumber = key.match(/\d+/)?.[0] || '1';
              const label = `CCM${gateNumber}`;
              gateMarkers.push({
                date: gateDate,
                label: label,
                color: ccmGate.color || '#de350b',
                style: ccmGate.style || 'solid',
                type: 'CCM'
              });
            }
          }
        });
      }
    }
  });

  // Commit Gates
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('commitGate') && /^\d+$/.test(key.replace('commitGate', ''))) {
      const gate = ganttConfig[key];
      if (gate && gate.date) {
        const gateDate = new Date(gate.date);
        if (gateDate.getTime() >= timelineStart && gateDate.getTime() <= timelineEnd) {
          const gateNumber = key.replace('commitGate', '');
          gateMarkers.push({
            date: gateDate,
            label: `CG${gateNumber}`,
            color: gate.color || '#ffc400',
            style: gate.style || 'solid',
            type: 'Commit Gate'
          });
        }
      }
    }
  });
  
  // Promotion Gates
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('promotionGate') && /^\d+$/.test(key.replace('promotionGate', ''))) {
      const gate = ganttConfig[key];
      if (gate && gate.date) {
        const gateDate = new Date(gate.date);
        if (gateDate.getTime() >= timelineStart && gateDate.getTime() <= timelineEnd) {
          const gateNumber = key.replace('promotionGate', '');
          gateMarkers.push({
            date: gateDate,
            label: `PG${gateNumber}`,
            color: gate.color || '#ffd700',
            style: gate.style || 'solid',
            type: 'Promotion Gate'
          });
        }
      }
    }
  });

  // Sort gate markers by date
  gateMarkers.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Collect items for horizontal bars: Commit items first (sorted by priority), then Long-term funded (sorted by priority)
  const commitItemsSorted = sortItems(items.commit || []);
  // Only show committed projects, not long-term funded
  // const longTermItemsSorted = sortItems(items.longTermFunded || []);
  // const allItems = [...commitItemsSorted, ...longTermItemsSorted];

  const getItemStatusDisplay = (item) => {
    const raw = item?.status;
    if (raw == null) return '';
    return typeof raw === 'string' ? raw : (raw?.name || raw?.value || '');
  };
  const isJiraStatusWithTick = (statusStr) => {
    if (!statusStr || !Array.isArray(statusesWithTick) || statusesWithTick.length === 0) return false;
    const normalized = String(statusStr).trim().toLowerCase();
    return statusesWithTick.some(s => String(s).trim().toLowerCase() === normalized);
  };

  /** Tick colors – darker than bar pastels so the tick is visible on the bar */
  const TICK_COLOR_BY_STATUS = {
    'code complete met': '#c62828',   // dark red – visible on pink bar
    'commit gate met': '#e65100',     // dark orange – visible on orange bar
    'promotion gate met': '#6a1b9a',  // dark purple – visible on purple bar
    'closed': '#1b5e20'               // dark green – visible on light backgrounds
  };

  const getTickStyleForStatus = (statusStr, codeCompletePos, commitGatePos, promotionGatePos) => {
    if (!statusStr || !isJiraStatusWithTick(statusStr)) return null;
    const normalized = String(statusStr).trim().toLowerCase();
    const color = TICK_COLOR_BY_STATUS[normalized];
    if (!color) return null;
    let leftPercent = null;
    if (normalized === 'code complete met' && codeCompletePos != null) leftPercent = codeCompletePos;
    else if (normalized === 'commit gate met' && commitGatePos != null) leftPercent = commitGatePos;
    else if (normalized === 'promotion gate met' && promotionGatePos != null) leftPercent = promotionGatePos;
    else if (normalized === 'closed') leftPercent = promotionGatePos ?? commitGatePos ?? codeCompletePos ?? 100;
    if (leftPercent == null) leftPercent = 100;
    return { color, leftPercent };
  };

  // Render just the bar portion of a Gantt item (without the label)
  const renderGanttItemBar = (item, isLongTerm = false) => {
    // Get checkpoint dates from item
    const codeCompleteDate = item.customfield_11067 ? new Date(item.customfield_11067) : null;
    const commitGateDate = item.customfield_35863 ? new Date(item.customfield_35863) : null;
    const promotionGateDate = item.customfield_35864 ? new Date(item.customfield_35864) : null;

    // Calculate bar positions (clamped to 0-100% to stay within timeline window)
    // Bar should be from EC (0%) to current Code Complete date from JIRA
    const codeCompletePosRaw = codeCompleteDate ? getPositionPercent(codeCompleteDate) : null;
    const codeCompletePos = codeCompleteDate ? Math.min(100, Math.max(0, codeCompletePosRaw)) : null;
    const commitGatePos = commitGateDate ? Math.min(100, Math.max(0, getPositionPercent(commitGateDate))) : null;
    const promotionGatePos = promotionGateDate ? Math.min(100, Math.max(0, getPositionPercent(promotionGateDate))) : null;

    // Get ALL historical Code Complete dates from history (oldest to newest, including current)
    const getAllCodeCompleteDates = () => {
      const normalizedKey = item.key ? item.key.trim() : '';
      const history = checkpointHistory[normalizedKey]?.['codeComplete'] || [];
      
      // Get all historical dates from history
      const allDates = [];
      history.forEach((entry) => {
        if (entry && entry.date) {
          try {
            const histDate = new Date(entry.date);
            if (!isNaN(histDate.getTime())) {
              // Include all dates from history (they represent all the changes)
              allDates.push(histDate);
            }
          } catch (e) {
            console.warn(`[Gantt] Failed to parse historical date for ${item.key}:`, entry, e);
          }
        }
      });
      
      // Add current date if it exists and is different from any historical date
      if (codeCompleteDate) {
        try {
          const currentDate = codeCompleteDate instanceof Date ? 
            codeCompleteDate : 
            new Date(codeCompleteDate);
          if (!isNaN(currentDate.getTime())) {
            const currentDateStr = currentDate.toISOString().split('T')[0];
            // Only add if it's not already in the historical dates
            const alreadyExists = allDates.some(d => d.toISOString().split('T')[0] === currentDateStr);
            if (!alreadyExists) {
              allDates.push(currentDate);
            }
          }
        } catch (e) {
          console.warn(`[Gantt] Failed to parse current date for ${item.key}:`, e);
        }
      }
      
      // Sort by date (oldest first) to show progression from oldest to current
      allDates.sort((a, b) => a.getTime() - b.getTime());
      
      return allDates;
    };

    const allHistoricalDates = getAllCodeCompleteDates();

    // Check if item has Code Complete extension label
    const hasExtension = hasCodeCompleteExtensionLabel(item);

    return (
      <>
          {/* Code Complete bar - ONE bar from EC (0%) to current Code Complete date from JIRA */}
          {codeCompleteDate && codeCompletePos !== null && (
            <>
              {/* Main horizontal bar from EC (0%) to current Code Complete date from JIRA */}
              {/* Bar always starts at EC (0%) and extends to the current Code Complete date position */}
              <div
                style={{
                  position: 'absolute',
                  left: '0%', // Always start at EC date (0%)
                  top: '14px',
                  width: `${codeCompletePos}%`, // Width from EC to current Code Complete date
                  height: '10px',
                  backgroundColor: '#FFB3BA', // Pastel red/pink for Code Complete bar (same family as red marker #de350b)
                  borderRadius: '2px',
                  border: hasExtension ? '3px solid #ff9800' : 'none', // Orange border for extension
                  zIndex: 2,
                  cursor: 'pointer',
                  title: hasExtension 
                    ? `Code Complete: ${formatDateLabel(codeCompleteDate)} (from JIRA) - Extension granted`
                    : `Code Complete: ${formatDateLabel(codeCompleteDate)} (from JIRA)`
                }}
              />
              
              {/* Mini markers for ALL historical dates from oldest to current - ONLY within the bar bounds */}
              {allHistoricalDates.map((histDate, idx) => {
                const histPos = getPositionPercent(histDate);
                // Show markers ONLY within the bar bounds (from EC 0% to current Code Complete date)
                // This ensures markers only appear on the Code Complete bar, not outside it
                if (histPos >= 0 && histPos <= codeCompletePos) {
                  const isCurrentDate = codeCompleteDate && 
                    histDate.toISOString().split('T')[0] === (codeCompleteDate instanceof Date ? codeCompleteDate : new Date(codeCompleteDate)).toISOString().split('T')[0];
                  
                  // Use same logic as gate markers: dotted for historical (older), solid for current
                  const markerStyle = isCurrentDate ? 'solid' : 'dotted';
                  const markerColor = '#de350b'; // Same color for all markers (red)
                  
                  return (
                    <div
                      key={`hist-cc-${isLongTerm ? 'ltf-' : ''}${idx}`}
                      style={{
                        position: 'absolute',
                        left: `${histPos}%`,
                        top: '10px', // Adjusted to center the taller marker
                        width: markerStyle === 'dotted' ? '0px' : '4px', // No width for dotted (uses border)
                        height: '18px', // Mini marker height
                        backgroundColor: markerStyle === 'solid' ? markerColor : 'transparent', // Solid uses background, dotted uses border
                        borderLeft: markerStyle === 'dotted' ? `4px dashed ${markerColor}` : 'none', // Dotted uses dashed border
                        zIndex: 3,
                        opacity: 0.85,
                        borderRadius: '1px',
                        title: isCurrentDate 
                          ? `Current Code Complete: ${formatDateLabel(histDate)}`
                          : `Historical Code Complete: ${formatDateLabel(histDate)}`
                      }}
                    />
                  );
                }
                return null;
              })}
            </>
          )}

          {/* Code Complete to Commit Gate bar - bright colored bar from Code Complete to Commit Gate */}
          {codeCompletePos !== null && commitGatePos !== null && (
            (() => {
              const startPos = codeCompletePos;
              const endPos = commitGatePos;
              const width = Math.max(0, endPos - startPos);
              
              // Only render if width is positive and within bounds
              if (width > 0 && endPos <= 100) {
                return (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${startPos}%`,
                      top: '14px',
                      width: `${width}%`,
                      height: '10px',
                      backgroundColor: '#FFD4A3', // Pastel orange for Code Complete to Commit Gate bar (same family as orange marker #ff9800)
                      borderRadius: '2px',
                      zIndex: 3,
                      cursor: 'pointer',
                      title: `Code Complete to Commit Gate: ${formatDateLabel(codeCompleteDate)} → ${formatDateLabel(commitGateDate)}`
                    }}
                  />
                );
              }
              return null;
            })()
          )}

          {/* Promotion Gate bar - always starts after Commit Gate */}
          {promotionGatePos !== null && commitGatePos !== null && (
            (() => {
              // Always start after Commit Gate
              const startPos = commitGatePos;
              const endPos = promotionGatePos;
              const width = Math.max(0, endPos - startPos);
              
              // Only render if width is positive and within bounds
              if (width > 0 && endPos <= 100) {
                return (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${startPos}%`,
                      top: '14px',
                      width: `${width}%`,
                      height: '10px',
                      backgroundColor: '#E1BEE7', // Pastel purple for Promotion Gate bar (same family as purple marker #9c27b0)
                      borderRadius: '2px',
                      zIndex: 4,
                      cursor: 'pointer',
                      title: `Promotion Gate: ${formatDateLabel(promotionGateDate)}`
                    }}
                  />
                );
              }
              return null;
            })()
          )}

          {/* Tick on the bar – dark color by status so it’s visible on pastel bars */}
          {(() => {
            const statusStr = getItemStatusDisplay(item);
            const tickStyle = getTickStyleForStatus(statusStr, codeCompletePos, commitGatePos, promotionGatePos);
            if (!tickStyle) return null;
            const atRight = tickStyle.leftPercent >= 100;
            return (
              <div
                style={{
                  position: 'absolute',
                  ...(atRight ? { right: '6px', left: 'auto' } : { left: `${tickStyle.leftPercent}%` }),
                  top: '50%',
                  transform: atRight ? 'translateY(-50%)' : 'translate(-50%, -50%)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.95)',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.2)',
                  color: tickStyle.color,
                  fontWeight: 'bold',
                  fontSize: '14px',
                  lineHeight: 1,
                  zIndex: 10,
                  pointerEvents: 'none',
                  textShadow: '0 0 1px rgba(255,255,255,0.8)'
                }}
                title={`JIRA status: ${statusStr}`}
              >
                ✓
              </div>
            );
          })()}

          {/* Placeholder if no dates - spans full timeline width */}
          {!codeCompleteDate && !commitGateDate && !promotionGateDate && (
            <div
              style={{
                position: 'absolute',
                left: '0%',
                top: '14px',
                right: '0%', // Ensure it spans to the right edge
                width: '100%',
                minWidth: '100%', // Force full width
                height: '10px',
                backgroundColor: 'transparent',
                border: '1px dashed #ccc',
                borderRadius: '2px',
                zIndex: 1,
                boxSizing: 'border-box'
              }}
              title="No checkpoint dates set"
            />
          )}
      </>
    );
  };

  // Render a single item row in the Gantt chart (full row with label and bar)
  const renderGanttItem = (item, isLongTerm = false) => {
    // Manual TCMS link from Jira ticket
    const tcmsRaw = item.customfield_31460;
    const manualTcmsUrl = tcmsRaw?.value?.url
      || (typeof tcmsRaw === 'string' && /^https?:\/\//i.test(tcmsRaw) ? tcmsRaw : null);

    // Constructed TCMS query URL — built client-side
    const tcmsVersion = (selectedVersion || '').replace(/^NDB-/i, '');
    const tcmsSearch = encodeURIComponent(JSON.stringify([
      { field: 'Requirements', op: '$eq', value: [item.key] }
    ]));
    const constructedTcmsUrl = tcmsVersion
      ? `https://tcms.eng.nutanix.com/#/testcases/NDB/${tcmsVersion}/qcow2?search=${tcmsSearch}&tab=package_type&type=All`
      : null;

    // Warning: advanced status but no manual TCMS link
    const statusStr = (typeof item.status === 'string' ? item.status : item.status?.name || '').toLowerCase().trim();
    const isAdvancedStatus = ['code complete met', 'commit gate met', 'promotion gate met', 'closed'].includes(statusStr);
    const shouldWarnTcms = isAdvancedStatus && !manualTcmsUrl;

    const qi = item.tcmsQI;

    return (
      <div
        key={item.key}
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: '6px',
          padding: '6px 0',
          borderBottom: '1px solid #e9ecef',
          borderLeft: shouldWarnTcms ? '3px solid #fd7e14' : 'none',
          backgroundColor: shouldWarnTcms ? '#fff8f0' : 'transparent',
          minHeight: '50px'
        }}
      >
        <div style={{ 
          minWidth: '200px', 
          maxWidth: '200px',
          fontSize: '10px', 
          marginRight: '8px',
          marginLeft: '-208px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}>
          {/* Jira key link */}
          <div style={{ fontWeight: 600, marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <a href={`${jiraBaseUrl}/browse/${item.key}`} target="_blank" rel="noopener noreferrer"
               style={{ color: '#0065ff', textDecoration: 'none', fontWeight: 600 }}
               onClick={(e) => e.stopPropagation()}>
              {item.key}
            </a>
          </div>

          {/* Summary */}
          <div style={{ fontSize: '9px', color: '#6c757d', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.2' }}>
            {item.summary || 'No summary'}
          </div>

          {/* TCMS links */}
          <div style={{ fontSize: '8px', marginTop: '3px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {constructedTcmsUrl && (
              <a href={constructedTcmsUrl} target="_blank" rel="noopener noreferrer"
                 style={{ color: '#0052cc', textDecoration: 'none' }}
                 onClick={(e) => e.stopPropagation()}
                 title="View test cases linked to this feature in TCMS">
                🔍 TCMS Tests
              </a>
            )}
            {manualTcmsUrl ? (
              <a href={manualTcmsUrl} target="_blank" rel="noopener noreferrer"
                 style={{ color: '#5a6776', textDecoration: 'none' }}
                 onClick={(e) => e.stopPropagation()}
                 title="TCMS suite link from Jira ticket">
                🔗 TCMS Suite
              </a>
            ) : (
              shouldWarnTcms && (
                <span style={{ color: '#fd7e14', fontWeight: 600 }}>⚠ TCMS not set</span>
              )
            )}
          </div>

          {/* QI + components (populated after background fetch) */}
          {qi && (
            <div style={{ fontSize: '8px', color: '#888', marginTop: '3px', borderTop: '1px dashed #e0e0e0', paddingTop: '3px', lineHeight: '1.5' }}>
              {qi.master && (
                <div>
                  <span style={{ color: '#555', fontWeight: 600 }}>master: </span>
                  {qi.master.qi != null
                    ? <span style={{ color: qi.master.qi >= 80 ? '#28a745' : qi.master.qi >= 60 ? '#fd7e14' : '#dc3545', fontWeight: 600 }}>QI {Math.round(qi.master.qi)}%</span>
                    : <span style={{ color: '#aaa' }}>QI N/A</span>
                  }
                  {qi.master.total != null && <span style={{ color: '#aaa' }}> · {qi.master.passed ?? '?'}/{qi.master.total}</span>}
                </div>
              )}
              {!isLongTerm && qi.branch && (
                <div>
                  <span style={{ color: '#555', fontWeight: 600 }}>{selectedVersion}: </span>
                  {qi.branch.qi != null
                    ? <span style={{ color: qi.branch.qi >= 80 ? '#28a745' : qi.branch.qi >= 60 ? '#fd7e14' : '#dc3545', fontWeight: 600 }}>QI {Math.round(qi.branch.qi)}%</span>
                    : <span style={{ color: '#aaa' }}>QI N/A</span>
                  }
                  {qi.branch.total != null && <span style={{ color: '#aaa' }}> · {qi.branch.passed ?? '?'}/{qi.branch.total}</span>}
                </div>
              )}
              {/* Top 3 components */}
              {(qi.master?.components || qi.branch?.components || []).slice(0, 3).map((c, i) => {
                const cColor = c.qi == null ? '#aaa' : c.qi >= 80 ? '#28a745' : c.qi >= 60 ? '#fd7e14' : '#dc3545';
                return (
                  <div key={i} style={{ fontSize: '7px', color: '#999' }}>
                    <span>{c.name}: </span>
                    {c.qi != null ? <span style={{ color: cColor, fontWeight: 600 }}>{Math.round(c.qi)}%</span> : <span>N/A</span>}
                    {c.total != null && <span style={{ color: '#bbb' }}> ({c.passed ?? '?'}/{c.total})</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{
          flex: 1,
          position: 'relative',
          height: '38px',
          backgroundColor: '#f5f5f5',
          border: '1px solid #ddd',
          borderRadius: '2px',
          boxSizing: 'border-box',
          overflow: 'visible',
          minWidth: 0
        }}>
          {renderGanttItemBar(item, isLongTerm)}
        </div>
      </div>
    );
  };

  // Build the gate-date row collection used by both the configuration
  // table and the proportional timeline. Extracted so `timelineOnly`
  // mode (Release Brief) and full mode (Project Status) share one
  // computation — no risk of the two surfaces drifting apart.
  const buildGateDateRows = () => {
    if (!ganttConfig) return [];

    const gateDateRows = [];

    // EC Date — always a single binding date, no family to compete with.
    if (ganttConfig.ecDate) {
      gateDateRows.push({
        type: 'EC Date',
        family: 'EC',
        fieldName: 'ecDate',
        date: ganttConfig.ecDate,
        color: '#0066cc',
        style: 'solid',
        description: 'Early Commitment (Release Start)'
      });
    }

    // GA Dates (ga1, ga2, etc.)
    Object.keys(ganttConfig)
      .filter(key => key.startsWith('ga') && /^\d+$/.test(key.replace('ga', '')))
      .sort((a, b) => {
        const numA = parseInt(a.replace('ga', ''), 10);
        const numB = parseInt(b.replace('ga', ''), 10);
        return numA - numB;
      })
      .forEach(key => {
        const gaData = ganttConfig[key];
        if (gaData && gaData.date) {
          const gateNumber = key.replace('ga', '');
          gateDateRows.push({
            type: `GA${gateNumber}`,
            family: 'GA',
            fieldName: key,
            date: gaData.date,
            color: gaData.color || '#28a745',
            style: (gaData.style || 'solid').toLowerCase(),
            description: `General Availability ${gateNumber}`
          });
        }
      });

    // CCM Gates
    Object.keys(ganttConfig)
      .filter(key => key.startsWith('ccm') && key.includes('Gate'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || '1', 10);
        const numB = parseInt(b.match(/\d+/)?.[0] || '1', 10);
        return numA - numB;
      })
      .forEach(key => {
        const gate = ganttConfig[key];
        if (gate) {
          const ccmGates = Array.isArray(gate) ? gate : [gate];
          ccmGates.forEach((ccmGate, idx) => {
            if (ccmGate && ccmGate.date) {
              const gateNumber = key.match(/\d+/)?.[0] || '1';
              const suffix = ccmGates.length > 1 ? ` (${idx + 1})` : '';
              gateDateRows.push({
                type: `CCM${gateNumber}${suffix}`,
                family: 'CCM',
                fieldName: `${key}${suffix}`,
                date: ccmGate.date,
                color: ccmGate.color || '#de350b',
                style: (ccmGate.style || 'solid').toLowerCase(),
                description: `Code Complete Milestone ${gateNumber}${suffix}`
              });
            }
          });
        }
      });

    // Commit Gates
    Object.keys(ganttConfig)
      .filter(key => key.startsWith('commitGate') && /^\d+$/.test(key.replace('commitGate', '')))
      .sort((a, b) => {
        const numA = parseInt(a.replace('commitGate', ''), 10);
        const numB = parseInt(b.replace('commitGate', ''), 10);
        return numA - numB;
      })
      .forEach(key => {
        const gate = ganttConfig[key];
        if (gate && gate.date) {
          const gateNumber = key.replace('commitGate', '');
          gateDateRows.push({
            type: `CG${gateNumber}`,
            family: 'CG',
            fieldName: key,
            date: gate.date,
            color: gate.color || '#ffc400',
            style: (gate.style || 'solid').toLowerCase(),
            description: `Commit Gate ${gateNumber}`
          });
        }
      });

    // Promotion Gates
    Object.keys(ganttConfig)
      .filter(key => key.startsWith('promotionGate') && /^\d+$/.test(key.replace('promotionGate', '')))
      .sort((a, b) => {
        const numA = parseInt(a.replace('promotionGate', ''), 10);
        const numB = parseInt(b.replace('promotionGate', ''), 10);
        return numA - numB;
      })
      .forEach(key => {
        const gate = ganttConfig[key];
        if (gate && gate.date) {
          const gateNumber = key.replace('promotionGate', '');
          gateDateRows.push({
            type: `PG${gateNumber}`,
            family: 'PG',
            fieldName: key,
            date: gate.date,
            color: gate.color || '#ffd700',
            style: (gate.style || 'solid').toLowerCase(),
            description: `Promotion Gate ${gateNumber}`
          });
        }
      });

    if (gateDateRows.length === 0) return [];

    // Mark the BINDING gate per family. Convention: style='solid' is the
    // final/binding gate; earlier dotted ones are soft checkpoints that
    // visually fade so the eye lands on the date that actually matters.
    // Fallback: if no solid entry exists in a family, the latest by date wins.
    const familyGroups = gateDateRows.reduce((acc, row) => {
      (acc[row.family] = acc[row.family] || []).push(row);
      return acc;
    }, {});
    Object.values(familyGroups).forEach(rows => {
      const solids = rows.filter(r => r.style === 'solid');
      const pool = solids.length > 0 ? solids : rows;
      const binding = pool.reduce((latest, cur) =>
        new Date(cur.date).getTime() > new Date(latest.date).getTime() ? cur : latest
      );
      rows.forEach(r => { r.isBinding = (r === binding); });
    });

    return gateDateRows;
  };

  // Generate gate dates table from config
  const renderGateDatesTable = () => {
    const gateDateRows = buildGateDateRows();
    if (gateDateRows.length === 0) return null;

    return (
      <div style={{ 
        marginBottom: '16px', 
        padding: '12px', 
        backgroundColor: '#fff',
        border: '1px solid #ddd',
        borderRadius: '4px'
      }}>
        <h4 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', color: '#495057' }}>
          Gate Dates Configuration for {selectedVersion}
        </h4>
        <table style={{ 
          width: '100%', 
          borderCollapse: 'collapse',
          fontSize: '12px'
        }}>
          <thead>
            <tr style={{ backgroundColor: '#f8f9fa' }}>
              <th style={{ 
                padding: '8px 12px', 
                borderBottom: '2px solid #dee2e6',
                textAlign: 'left',
                fontWeight: 600,
                color: '#495057'
              }}>Gate Type</th>
              <th style={{ 
                padding: '8px 12px', 
                borderBottom: '2px solid #dee2e6',
                textAlign: 'left',
                fontWeight: 600,
                color: '#495057'
              }}>Date</th>
              <th style={{ 
                padding: '8px 12px', 
                borderBottom: '2px solid #dee2e6',
                textAlign: 'left',
                fontWeight: 600,
                color: '#495057'
              }}>Config Field</th>
              <th style={{ 
                padding: '8px 12px', 
                borderBottom: '2px solid #dee2e6',
                textAlign: 'left',
                fontWeight: 600,
                color: '#495057'
              }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {gateDateRows.map((row, idx) => {
              // Soft (non-binding) gates fade hard so the binding date in
              // each family is the one the eye lands on first.
              const isSoft = row.isBinding === false;
              const rowOpacity = isSoft ? 0.45 : 1;
              return (
                <tr key={idx} style={{
                  borderBottom: '1px solid #dee2e6',
                  backgroundColor: idx % 2 === 0 ? '#fff' : '#f8f9fa',
                  opacity: rowOpacity
                }}>
                  <td style={{
                    padding: '8px 12px',
                    verticalAlign: 'middle'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{
                        display: 'inline-block',
                        width: '12px',
                        height: '12px',
                        marginRight: '8px',
                        borderRadius: '2px',
                        // Filled swatch for binding gates; hollow + dashed
                        // border for soft checkpoints so the distinction
                        // reads even at a glance.
                        backgroundColor: isSoft ? 'transparent' : row.color,
                        border: isSoft ? `1px dashed ${row.color}` : 'none'
                      }}></span>
                      <strong style={{
                        color: row.color,
                        fontWeight: isSoft ? 500 : 700
                      }}>
                        {row.type}
                      </strong>
                      {isSoft && (
                        <span style={{
                          marginLeft: '8px',
                          fontSize: '10px',
                          fontWeight: 500,
                          color: '#6c757d',
                          fontStyle: 'italic'
                        }}>
                          soft checkpoint
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{
                    padding: '8px 12px',
                    verticalAlign: 'middle',
                    fontFamily: 'monospace',
                    fontWeight: isSoft ? 400 : 600
                  }}>
                    {formatDateLabel(new Date(row.date))}
                  </td>
                  <td style={{
                    padding: '8px 12px',
                    verticalAlign: 'middle',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: '#6c757d'
                  }}>
                    {row.fieldName}
                  </td>
                  <td style={{
                    padding: '8px 12px',
                    verticalAlign: 'middle',
                    color: '#6c757d'
                  }}>
                    {row.description}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {renderGateDatesTimeline(gateDateRows)}
      </div>
    );
  };

  // Simple horizontal timeline of the gate dates shown in the table above.
  // Positions each gate proportionally between the earliest and latest date,
  // adds a "Today" marker, and stacks labels above/below to avoid overlap.
  const renderGateDatesTimeline = (gateDateRows) => {
    if (!gateDateRows || gateDateRows.length === 0) return null;

    const points = gateDateRows
      .map(row => ({ ...row, time: new Date(row.date).getTime() }))
      .filter(p => !isNaN(p.time))
      .sort((a, b) => a.time - b.time);

    if (points.length === 0) return null;

    const minTime = points[0].time;
    const maxTime = points[points.length - 1].time;
    const span = Math.max(maxTime - minTime, 1);
    const pct = t => ((t - minTime) / span) * 100;

    const today = Date.now();
    const todayInRange = today >= minTime && today <= maxTime;
    const todayPct = todayInRange ? pct(today) : null;

    // Alternate labels above/below to reduce collisions when dates are close.
    const labelPositions = points.map((_, idx) => (idx % 2 === 0 ? 'above' : 'below'));

    return (
      <div style={{
        marginTop: '16px',
        paddingTop: '12px',
        borderTop: '1px dashed #dee2e6'
      }}>
        <div style={{
          fontSize: '12px',
          fontWeight: 600,
          color: '#495057',
          marginBottom: '8px'
        }}>
          Timeline
        </div>
        <div style={{
          position: 'relative',
          height: '110px',
          padding: '0 24px',
          boxSizing: 'border-box'
        }}>
          {/* Baseline */}
          <div style={{
            position: 'absolute',
            left: '24px',
            right: '24px',
            top: '55px',
            height: '2px',
            backgroundColor: '#cfd4da',
            borderRadius: '1px'
          }} />

          {/* Today marker */}
          {todayInRange && (
            <div
              title={`Today: ${formatDateLabel(new Date(today))}`}
              style={{
                position: 'absolute',
                left: `calc(24px + (100% - 48px) * ${todayPct / 100})`,
                top: '20px',
                bottom: '20px',
                width: '2px',
                backgroundColor: '#212529',
                transform: 'translateX(-1px)'
              }}
            >
              <div style={{
                position: 'absolute',
                top: '-14px',
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '10px',
                fontWeight: 700,
                color: '#212529',
                whiteSpace: 'nowrap'
              }}>
                Today
              </div>
            </div>
          )}

          {/* Gate points — binding gates are bold + filled; soft checkpoints
              are smaller, hollow, and rendered at low opacity so the binding
              cutoff in each family is the one the eye locks onto. */}
          {points.map((p, idx) => {
            const leftCalc = `calc(24px + (100% - 48px) * ${pct(p.time) / 100})`;
            const labelAbove = labelPositions[idx] === 'above';
            const isSoft = p.isBinding === false;
            const dotSize = isSoft ? 9 : 14;
            const dotOpacity = isSoft ? 0.45 : 1;
            return (
              <React.Fragment key={`${p.fieldName}-${idx}`}>
                {/* Dot */}
                <div
                  title={`${p.type}: ${formatDateLabel(new Date(p.date))}${isSoft ? ' (soft checkpoint)' : ''}`}
                  style={{
                    position: 'absolute',
                    left: leftCalc,
                    top: `${49 + (14 - dotSize) / 2}px`,
                    width: `${dotSize}px`,
                    height: `${dotSize}px`,
                    backgroundColor: isSoft ? '#fff' : p.color,
                    border: `2px ${isSoft ? 'dashed' : 'solid'} ${isSoft ? p.color : '#fff'}`,
                    borderRadius: '50%',
                    boxShadow: isSoft ? 'none' : '0 0 0 1px rgba(0,0,0,0.2)',
                    transform: `translateX(-${dotSize / 2}px)`,
                    opacity: dotOpacity,
                    zIndex: isSoft ? 0 : 1
                  }}
                />
                {/* Connector */}
                <div style={{
                  position: 'absolute',
                  left: leftCalc,
                  top: labelAbove ? '30px' : '63px',
                  height: '20px',
                  width: '1px',
                  backgroundColor: p.color,
                  opacity: isSoft ? 0.2 : 0.5,
                  transform: 'translateX(-0.5px)'
                }} />
                {/* Label */}
                <div style={{
                  position: 'absolute',
                  left: leftCalc,
                  top: labelAbove ? '4px' : '83px',
                  transform: 'translateX(-50%)',
                  textAlign: 'center',
                  fontSize: isSoft ? '9px' : '10px',
                  lineHeight: '1.2',
                  whiteSpace: 'nowrap',
                  opacity: isSoft ? 0.5 : 1
                }}>
                  <div style={{
                    color: p.color,
                    fontWeight: isSoft ? 400 : 700,
                    fontStyle: isSoft ? 'italic' : 'normal'
                  }}>
                    {p.type}
                  </div>
                  <div style={{ color: '#6c757d', fontFamily: 'monospace', fontSize: '9px' }}>
                    {formatDateLabel(new Date(p.date))}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  };

  const ganttLegendBlock = (
    <div style={{ 
      marginBottom: '16px', 
      padding: '12px', 
      backgroundColor: '#f5f5f5',
      fontSize: '11px' 
    }}>
      <strong style={{ display: 'block', marginBottom: '10px', color: '#495057', fontSize: '12px' }}>Gantt Legend:</strong>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '15px' }}>
        <div>
          <strong style={{ display: 'block', marginBottom: '6px', color: '#495057', fontSize: '11px', fontWeight: 600 }}>Bars (Pastel):</strong>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '24px', height: '10px', backgroundColor: '#FFB3BA', marginRight: '8px', borderRadius: '2px', border: '1px solid #ddd' }}></span>
            <span style={{ fontSize: '11px' }}>Code Complete</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '24px', height: '10px', backgroundColor: '#FFD4A3', marginRight: '8px', borderRadius: '2px', border: '1px solid #ddd' }}></span>
            <span style={{ fontSize: '11px' }}>Code Complete to Commit Gate</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '24px', height: '10px', backgroundColor: '#E1BEE7', marginRight: '8px', borderRadius: '2px', border: '1px solid #ddd' }}></span>
            <span style={{ fontSize: '11px' }}>Promotion Gate</span>
          </div>
        </div>
        <div>
          <strong style={{ display: 'block', marginBottom: '6px', color: '#495057', fontSize: '11px', fontWeight: 600 }}>Date Markers (Bright):</strong>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '3px', height: '12px', backgroundColor: '#de350b', marginRight: '8px', borderRadius: '1px' }}></span>
            <span style={{ fontSize: '11px' }}>Code Complete (CCM)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '3px', height: '12px', backgroundColor: '#ff9800', marginRight: '8px', borderRadius: '1px' }}></span>
            <span style={{ fontSize: '11px' }}>Commit Gate (CG)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '3px', height: '12px', backgroundColor: '#9c27b0', marginRight: '8px', borderRadius: '1px' }}></span>
            <span style={{ fontSize: '11px' }}>Promotion Gate (PG)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '3px', height: '12px', backgroundColor: '#0066cc', marginRight: '8px', borderRadius: '1px' }}></span>
            <span style={{ fontSize: '11px' }}>EC Date</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '3px', height: '12px', backgroundColor: '#28a745', marginRight: '8px', borderRadius: '1px' }}></span>
            <span style={{ fontSize: '11px' }}>GA Date(s)</span>
          </div>
        </div>
        <div>
          <strong style={{ display: 'block', marginBottom: '6px', color: '#495057', fontSize: '11px', fontWeight: 600 }}>Code Complete Bar:</strong>
          <div style={{ marginBottom: '8px', padding: '6px', backgroundColor: '#f8f9fa', borderRadius: '3px', fontSize: '10px' }}>
            <div style={{ marginBottom: '4px' }}>Bar extends from EC date to current Code Complete date (from JIRA)</div>
            <div>Mini markers show all historical date changes within the bar</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '4px', height: '18px', borderLeft: '4px dashed #de350b', marginRight: '8px' }}></span>
            <span style={{ fontSize: '11px' }}>Historical Code Complete (dotted)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '4px', height: '18px', backgroundColor: '#de350b', marginRight: '8px', borderRadius: '1px' }}></span>
            <span style={{ fontSize: '11px' }}>Current Code Complete (solid)</span>
          </div>
        </div>
        <div>
          <strong style={{ display: 'block', marginBottom: '6px', color: '#495057', fontSize: '11px', fontWeight: 600 }}>Status tick (✓):</strong>
          <div style={{ marginBottom: '6px', fontSize: '10px', color: '#6c757d' }}>Circle on the bar = JIRA status reached. Position = when met (or field date).</div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.2)', color: '#c62828', fontWeight: 'bold', fontSize: '11px', marginRight: '8px' }}>✓</span>
            <span style={{ fontSize: '11px' }}>Code Complete Met</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.2)', color: '#e65100', fontWeight: 'bold', fontSize: '11px', marginRight: '8px' }}>✓</span>
            <span style={{ fontSize: '11px' }}>Commit Gate Met</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.2)', color: '#6a1b9a', fontWeight: 'bold', fontSize: '11px', marginRight: '8px' }}>✓</span>
            <span style={{ fontSize: '11px' }}>Promotion Gate Met</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.2)', color: '#1b5e20', fontWeight: 'bold', fontSize: '11px', marginRight: '8px' }}>✓</span>
            <span style={{ fontSize: '11px' }}>Closed</span>
          </div>
        </div>
        <div>
          <strong style={{ display: 'block', marginBottom: '6px', color: '#495057', fontSize: '11px', fontWeight: 600 }}>Other:</strong>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '2px', height: '12px', backgroundColor: '#9e9e9e', marginRight: '8px', borderRadius: '1px', opacity: 0.8 }}></span>
            <span style={{ fontSize: '11px' }}>Weekly Markers</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '2px', height: '12px', borderLeft: '2px dashed', borderColor: '#666', marginRight: '8px' }}></span>
            <span style={{ fontSize: '11px' }}>Old Gate (dotted)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ display: 'inline-block', width: '2px', height: '12px', borderLeft: '2px solid', borderColor: '#666', marginRight: '8px' }}></span>
            <span style={{ fontSize: '11px' }}>Current Gate (solid)</span>
          </div>
        </div>
      </div>
    </div>
  );

  // Slim mode (Release Brief): render ONLY the proportional gate timeline
  // — no h3 title, no gate dates configuration table, no legend, no
  // project-row Gantt chart. Same visual as the "Timeline" block at the
  // top of the full chart on Project Status, sourced from the same data.
  if (timelineOnly) {
    const gateDateRows = buildGateDateRows();
    if (gateDateRows.length === 0) return null;
    return (
      <div style={{
        padding: '0.75rem',
        backgroundColor: '#fff',
        border: '1px solid #ddd',
        borderRadius: '4px',
        boxSizing: 'border-box'
      }}>
        {renderGateDatesTimeline(gateDateRows)}
      </div>
    );
  }

  return (
    <div style={{ 
      marginBottom: '0.75rem', 
      padding: '0.75rem', 
      backgroundColor: '#f0f0f0',
      width: '100%',
      maxWidth: '100%',
      overflowX: 'auto',
      boxSizing: 'border-box'
    }}>
      <h3 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1rem' }}>Gantt Chart: {selectedVersion} (Committed Projects Only)</h3>
      
      {/* Gate Dates Configuration Table - shows dates used in this Gantt */}
      {renderGateDatesTable()}
      
      {/* Gantt Legend - above chart */}
      {ganttLegendBlock}
      
      {/* Container for timeline and bars with full-height vertical markers */}
      <div style={{
        position: 'relative',
        marginLeft: '208px', // Account for Y-axis label width (200px) + marginRight (8px)
        width: 'calc(100% - 208px)', // Must match bar container width
        minWidth: '800px', // Ensure minimum width for better visibility
        boxSizing: 'border-box',
        minHeight: '200px', // Ensure container has height for full-height markers (EC, GA, gates)
        overflow: 'visible' // Allow markers at edges (0% and 100%) to be visible
      }}>
        {/* EC Label - positioned at top where marker starts */}
        <div style={{
          position: 'absolute',
          left: '0%',
          top: '0px', // At the very top where marker starts
          fontSize: '12px',
          color: '#0066cc',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          transform: 'translateX(-50%)',
          backgroundColor: '#ffffff',
          padding: '3px 6px',
          borderRadius: '2px',
          border: '1px solid #0066cc',
          opacity: 0.9,
          zIndex: 8 // Above EC line (zIndex 7) and gate markers (zIndex 4-5)
        }}>
          EC
        </div>
        <div style={{
          position: 'absolute',
          left: '0%',
          top: '24px', // More space below the label
          fontSize: '11px',
          color: '#1a1a1a',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          transform: 'translateX(-50%)',
          backgroundColor: '#ffffff',
          padding: '2px 5px',
          borderRadius: '2px',
          zIndex: 8 // Above EC line (zIndex 7) and gate markers (zIndex 4-5)
        }}>
          {formatDateLabel(ec)}
        </div>
        
        {/* GA Labels - positioned at top where markers start */}
        {gaDates.map((ga, idx) => {
          const position = getPositionPercent(ga.date);
          return (
            <React.Fragment key={`ga-label-top-${idx}`}>
              <div style={{
                position: 'absolute',
                left: `${position}%`,
                top: '0px', // At the very top where marker starts
                fontSize: '12px',
                color: ga.color || '#28a745',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                transform: 'translateX(-50%)',
                backgroundColor: '#ffffff',
                padding: '3px 6px',
                borderRadius: '2px',
                border: `1px solid ${ga.color || '#28a745'}`,
                opacity: 0.9,
                zIndex: 12 // Above everything - date marker labels should be highest
              }}>
                {ga.label}
              </div>
              <div style={{
                position: 'absolute',
                left: `${position}%`,
                top: '24px', // More space below the label
                fontSize: '11px',
                color: '#1a1a1a',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                transform: 'translateX(-50%)',
                backgroundColor: '#ffffff',
                padding: '2px 5px',
                borderRadius: '2px',
                zIndex: 12 // Above everything - date marker labels should be highest
              }}>
                {formatDateLabel(ga.date)}
              </div>
            </React.Fragment>
          );
        })}
        
        {/* Gate Markers Labels (CCM, Commit Gate, Promotion Gate) - positioned at top where markers start */}
        {gateMarkers.map((gate, idx) => {
          const position = getPositionPercent(gate.date);
          return (
            <React.Fragment key={`gate-label-top-${idx}`}>
              <div style={{
                position: 'absolute',
                left: `${position}%`,
                top: '0px', // At the very top where markers start
                fontSize: '12px',
                color: gate.color,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                transform: 'translateX(-50%)',
                backgroundColor: '#ffffff',
                padding: '3px 6px',
                borderRadius: '2px',
                border: `1px solid ${gate.color}`,
                opacity: 0.9,
                zIndex: 12 // Above everything - date marker labels should be highest
              }}>
                {gate.label}
              </div>
              <div style={{
                position: 'absolute',
                left: `${position}%`,
                top: '24px', // More space below the label
                fontSize: '11px',
                color: '#1a1a1a',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                transform: 'translateX(-50%)',
                backgroundColor: '#ffffff',
                padding: '2px 5px',
                borderRadius: '2px',
                zIndex: 12 // Above everything - date marker labels should be highest
              }}>
                {formatDateLabel(gate.date)}
              </div>
            </React.Fragment>
          );
        })}
        
        {/* Full-height vertical markers for EC, GA, CCM, Commit Gate, Promotion Gate - spans entire chart */}
        {/* EC - Full height vertical line - spans from top to bottom of entire chart */}
        <div style={{
          position: 'absolute',
          left: '0%',
          top: '0px',
          bottom: '0px', // Extends to bottom of container
          width: `${scaledECWidth}px`, // Scaled based on timeline duration
          backgroundColor: '#0066cc',
          zIndex: 9, // EC line should be visible but below date marker labels
          opacity: 0.8, // Increased from 0.6 for better visibility
          pointerEvents: 'none', // Allow clicks to pass through
          boxShadow: '0 0 2px rgba(0, 102, 204, 0.5)' // Add subtle shadow for better visibility
        }} />
        
        {/* GA - Full height vertical lines - spans from top to bottom of entire chart */}
        {gaDates.map((ga, idx) => {
          const position = getPositionPercent(ga.date);
          const isDotted = ga.style === 'dotted';
          // If GA marker is at 0% (before EC), use dashed style to distinguish from EC
          const isBeforeEC = position <= 0.1; // Small threshold to account for floating point precision
          const effectiveStyle = isBeforeEC ? 'dotted' : (isDotted ? 'dotted' : 'solid');
          
          return (
            <div
              key={`ga-line-${idx}`}
              style={{
                position: 'absolute',
                left: `${position}%`,
                top: '0px',
                bottom: '0px', // Extends to bottom of container
                width: effectiveStyle === 'dotted' ? `${scaledThinMarkerWidth}px` : `${scaledMarkerWidth}px`, // Scaled based on timeline duration
                backgroundColor: effectiveStyle === 'dotted' ? 'transparent' : ga.color || '#28a745',
                borderLeft: effectiveStyle === 'dotted' ? `${scaledThinMarkerWidth}px dashed ${ga.color || '#28a745'}` : 'none', // Scaled border width
                zIndex: 10, // High z-index to ensure GA markers are always in foreground
                opacity: effectiveStyle === 'dotted' ? 0.5 : 0.6,
                pointerEvents: 'none'
              }}
            />
          );
        })}
        
        {/* CCM, Commit Gate, Promotion Gate - Full height vertical lines - spans from top to bottom of entire chart */}
        {gateMarkers.map((gate, idx) => {
          const position = getPositionPercent(gate.date);
          const isDotted = gate.style === 'dotted';
          // If gate marker is at 0% (before EC), use dashed style to distinguish from EC
          const isBeforeEC = position <= 0.1; // Small threshold to account for floating point precision
          const effectiveStyle = isBeforeEC ? 'dotted' : (isDotted ? 'dotted' : 'solid');
          const effectiveZIndex = isBeforeEC ? 10 : 10; // High z-index to ensure markers are always in foreground
          return (
            <div
              key={`gate-line-${idx}`}
              style={{
                position: 'absolute',
                left: `${position}%`,
                top: '0px',
                bottom: '0px', // Extends to bottom of container
                width: effectiveStyle === 'dotted' ? `${scaledThinMarkerWidth}px` : `${scaledMarkerWidth}px`, // Scaled based on timeline duration
                backgroundColor: effectiveStyle === 'dotted' ? 'transparent' : gate.color,
                borderLeft: effectiveStyle === 'dotted' ? `${scaledThinMarkerWidth}px dashed ${gate.color}` : 'none', // Scaled border width
                zIndex: effectiveZIndex, // Lower z-index when at 0% so EC (zIndex 7) is visible above
                opacity: effectiveStyle === 'dotted' ? 0.5 : 0.6,
                pointerEvents: 'none'
              }}
            />
          );
        })}
        
        {/* Today's Date Marker - Nice bubble */}
        {(() => {
          const today = new Date();
          today.setHours(0, 0, 0, 0); // Set to start of day for consistent positioning
          const todayPosition = getPositionPercent(today);
          
          // Only show if today is within the timeline range
          if (todayPosition !== null && todayPosition >= 0 && todayPosition <= 100) {
            return (
              <React.Fragment key="today-marker">
                {/* Vertical line for today */}
                <div
                  style={{
                    position: 'absolute',
                    left: `${todayPosition}%`,
                    top: '0px',
                    bottom: '0px',
                    width: '2px',
                    backgroundColor: '#333333',
                    zIndex: 11, // Above other markers
                    opacity: 0.7,
                    pointerEvents: 'none',
                    borderLeft: '2px dashed #333333'
                  }}
                />
                {/* Today bubble marker */}
                <div
                  style={{
                    position: 'absolute',
                    left: `${todayPosition}%`,
                    top: '40px',
                    transform: 'translateX(-50%)',
                    zIndex: 13, // Highest z-index for today marker
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    pointerEvents: 'none'
                  }}
                >
                  {/* Bubble circle */}
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: '#333333',
                      border: '3px solid #ffffff',
                      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '4px'
                    }}
                  >
                    <div
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: '#ffffff'
                      }}
                    />
                  </div>
                  {/* Today label */}
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#333333',
                      backgroundColor: '#ffffff',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid #333333',
                      whiteSpace: 'nowrap',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.15)'
                    }}
                  >
                    Today
                  </div>
                  {/* Date label */}
                  <div
                    style={{
                      fontSize: '10px',
                      color: '#666666',
                      backgroundColor: '#ffffff',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      marginTop: '2px',
                      border: '1px solid #e0e0e0',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {formatDateLabel(today)}
                  </div>
                </div>
              </React.Fragment>
            );
          }
          return null;
        })()}
        
        {/* Timeline header with date markers */}
        <div style={{ 
          position: 'relative', 
          height: '120px', 
          marginBottom: '10px',
          boxSizing: 'border-box',
          zIndex: 2 // Labels should be above vertical lines
        }}>
        {/* Timeline bar background - spans from EC (0%) to last GA (100%) - aligns with bar container */}
        <div style={{
          position: 'absolute',
          left: '0%',
          top: '100px',
          width: '100%',
          height: '6px',
          backgroundColor: '#e9ecef',
          border: '1px solid #d0d0d0',
          borderRadius: '3px',
          zIndex: 1,
          boxSizing: 'border-box'
        }} />
        
        {/* Weekly Markers - Visible tick marks - aligned with timeline bar */}
        {weeklyMarkers.map((week, idx) => (
          <div
            key={`week-${idx}`}
            style={{
              position: 'absolute',
              left: `${week.position}%`,
              top: '98px', // Slightly above timeline bar for visibility
              width: `${scaledThinMarkerWidth}px`, // Scaled based on timeline duration
              height: '9px', // Taller for better visibility
              backgroundColor: '#9e9e9e',
              zIndex: 2,
              opacity: 0.8,
              borderRadius: '1px'
            }}
          />
        ))}
        

        {/* Sprint Date Markers - Show every other sprint if too many - aligned with timeline bar */}
        {validSprintDates.map((sprint, idx) => {
          // Show all sprints, but adjust spacing if needed
          const showLabel = validSprintDates.length <= 12 || idx % 2 === 0;
          return (
            <React.Fragment key={`sprint-${idx}`}>
              <div style={{
                position: 'absolute',
                left: `${sprint.position}%`,
                top: '99px', // Slightly above for visibility
                width: `${scaledMarkerWidth}px`, // Scaled based on timeline duration
                height: '8px', // Taller for better visibility
                backgroundColor: '#6c757d',
                borderRadius: '1px',
                zIndex: 2,
                opacity: 0.8
              }} 
              />
              {showLabel && (
                <div style={{
                  position: 'absolute',
                  left: `${sprint.position}%`,
                  top: '75px',
                  fontSize: '11px',
                  color: '#495057',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  transform: 'translateX(-50%)',
                  backgroundColor: '#ffffff',
                  padding: '2px 5px',
                  borderRadius: '2px',
                  border: '1px solid #e9ecef'
                }}>
                  {formatDateLabel(sprint.date)}
                </div>
              )}
            </React.Fragment>
          );
        })}


        </div>

        {/* Items with horizontal bars */}
        <div style={{ 
          width: '100%',
          boxSizing: 'border-box',
          overflow: 'visible',
          position: 'relative',
          zIndex: 2 // Bars should be above the vertical lines
        }}>
        {/* Committed Projects Only */}
        {commitItemsSorted.map((item) => renderGanttItem(item, false))}
        </div>
      </div>
    </div>
  );
}

export default ReleaseVersionGantt;

