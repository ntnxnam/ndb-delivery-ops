/**
 * Gantt Chart Email Generator
 * 
 * Generates an SVG representation of the Gantt chart for email inclusion.
 * SVG is used because it's well-supported in email clients and can be embedded directly.
 */

/**
 * Escape HTML special characters for safe inclusion in SVG text
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate SVG Gantt chart for email
 * 
 * @param {Object} params
 * @param {Object} params.ganttConfig - Gantt configuration with EC date, GA dates, and gate dates
 * @param {string} params.selectedVersion - Currently selected release version
 * @param {Array} params.items - Array of commit items (only committed projects shown)
 * @param {string} params.jiraBaseUrl - JIRA base URL for links
 * @returns {string} - SVG string ready for embedding in HTML
 */
function generateGanttChartSVG({ ganttConfig, selectedVersion, items = [], jiraBaseUrl = 'https://jira.nutanix.com' }) {
  if (!ganttConfig || !selectedVersion || !ganttConfig.ecDate) {
    return '';
  }

  // Parse EC date
  const ec = new Date(ganttConfig.ecDate);
  if (isNaN(ec.getTime())) {
    return '';
  }

  // Collect all GA dates
  const gaDates = [];
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('ga') && /^\d+$/.test(key.replace('ga', ''))) {
      const gaData = ganttConfig[key];
      if (gaData && gaData.date) {
        const gateNumber = key.replace('ga', '');
        gaDates.push({
          date: new Date(gaData.date),
          label: `GA${gateNumber}`,
          color: gaData.color || '#28a745',
          number: parseInt(gateNumber, 10)
        });
      }
    }
  });

  if (gaDates.length === 0) {
    return '';
  }

  // Sort GA dates and use latest as timeline end
  gaDates.sort((a, b) => a.date.getTime() - b.date.getTime());
  const latestGA = gaDates[gaDates.length - 1];
  const ga = latestGA.date;

  const timelineStart = ec.getTime();
  const timelineEnd = ga.getTime();
  const timelineDuration = timelineEnd - timelineStart;

  if (timelineDuration <= 0) {
    return '';
  }

  // Calculate position percentage for a date
  const getPositionPercent = (date) => {
    if (!date) return null;
    const dateTime = date.getTime();
    if (dateTime <= timelineStart) return 0;
    if (dateTime >= timelineEnd) return 100;
    return Math.min(100, Math.max(0, ((dateTime - timelineStart) / timelineDuration) * 100));
  };

  // Collect gate markers
  const gateMarkers = [];
  
  // CCM gates
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('ccm') && key.includes('Gate')) {
      const gate = ganttConfig[key];
      if (gate) {
        if (Array.isArray(gate)) {
          gate.forEach((g, idx) => {
            if (g && g.date) {
              const gateDate = new Date(g.date);
              if (!isNaN(gateDate.getTime())) {
                const pos = getPositionPercent(gateDate);
                if (pos !== null) {
                  gateMarkers.push({
                    type: 'CCM',
                    date: gateDate,
                    position: pos,
                    label: g.label || `CCM${idx + 1}`,
                    number: idx + 1
                  });
                }
              }
            }
          });
        } else if (gate.date) {
          const gateDate = new Date(gate.date);
          if (!isNaN(gateDate.getTime())) {
            const pos = getPositionPercent(gateDate);
            if (pos !== null) {
              const gateNumber = key.replace('ccm', '').replace('Gate', '') || '1';
              gateMarkers.push({
                type: 'CCM',
                date: gateDate,
                position: pos,
                label: gate.label || `CCM${gateNumber}`,
                number: parseInt(gateNumber, 10) || 1
              });
            }
          }
        }
      }
    }
  });

  // Commit Gates
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('commitGate')) {
      const gate = ganttConfig[key];
      if (gate && gate.date) {
        const gateDate = new Date(gate.date);
        if (!isNaN(gateDate.getTime())) {
          const pos = getPositionPercent(gateDate);
          if (pos !== null) {
            const gateNumber = key.replace('commitGate', '') || '1';
            gateMarkers.push({
              type: 'Commit Gate',
              date: gateDate,
              position: pos,
              label: gate.label || `CG${gateNumber}`,
              number: parseInt(gateNumber, 10) || 1
            });
          }
        }
      }
    }
  });

  // Promotion Gates
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('promotionGate')) {
      const gate = ganttConfig[key];
      if (gate && gate.date) {
        const gateDate = new Date(gate.date);
        if (!isNaN(gateDate.getTime())) {
          const pos = getPositionPercent(gateDate);
          if (pos !== null) {
            const gateNumber = key.replace('promotionGate', '') || '1';
            gateMarkers.push({
              type: 'Promotion Gate',
              date: gateDate,
              position: pos,
              label: gate.label || `PG${gateNumber}`,
              number: parseInt(gateNumber, 10) || 1
            });
          }
        }
      }
    }
  });

  // Sort gate markers by position
  gateMarkers.sort((a, b) => a.position - b.position);

  // Process items - only committed items
  const processedItems = (items || [])
    .filter(item => item.customfield_11067) // Only items with Code Complete date
    .map(item => {
      const codeCompleteDate = new Date(item.customfield_11067);
      if (isNaN(codeCompleteDate.getTime())) {
        return null;
      }
      const pos = getPositionPercent(codeCompleteDate);
      return {
        key: item.key,
        summary: item.summary || '',
        codeCompleteDate,
        position: pos !== null ? pos : 0
      };
    })
    .filter(item => item !== null)
    .sort((a, b) => a.position - b.position); // Sort by position

  // SVG dimensions
  const width = 900;
  const timelineHeight = 40;
  const itemHeight = 25;
  const itemSpacing = 5;
  const labelWidth = 200;
  const chartWidth = width - labelWidth - 20;
  const headerHeight = 30;
  const totalHeight = headerHeight + timelineHeight + 20 + (processedItems.length * (itemHeight + itemSpacing));

  // Start SVG
  let svg = `<svg width="${width}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg" style="background-color: #f0f0f0; font-family: Arial, sans-serif;">
    <!-- Title -->
    <text x="${width / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#1a1a1a">
      Gantt Chart: ${escapeHtml(selectedVersion)} (Committed Projects Only)
    </text>
    
    <!-- Timeline container -->
    <g transform="translate(${labelWidth + 10}, ${headerHeight})">
      <!-- Timeline bar background -->
      <rect x="0" y="0" width="${chartWidth}" height="${timelineHeight}" fill="#f5f5f5" stroke="#ddd" stroke-width="1" rx="2"/>
      
      <!-- EC marker -->
      <line x1="0" y1="0" x2="0" y2="${timelineHeight}" stroke="#0066cc" stroke-width="3"/>
      <text x="0" y="${timelineHeight + 15}" text-anchor="middle" font-size="10" font-weight="600" fill="#0066cc">EC</text>
      
      <!-- GA markers -->
      ${gaDates.map(ga => {
        const pos = (getPositionPercent(ga.date) / 100) * chartWidth;
        return `
          <line x1="${pos}" y1="0" x2="${pos}" y2="${timelineHeight}" stroke="${ga.color}" stroke-width="2"/>
          <text x="${pos}" y="${timelineHeight + 15}" text-anchor="middle" font-size="10" font-weight="600" fill="${ga.color}">${ga.label}</text>
        `;
      }).join('')}
      
      <!-- CCM Gate markers - visible vertical lines with labels -->
      ${gateMarkers.filter(gate => gate.type === 'CCM').map(gate => {
        const pos = (gate.position / 100) * chartWidth;
        return `
          <line x1="${pos}" y1="0" x2="${pos}" y2="${timelineHeight}" stroke="#9370DB" stroke-width="2"/>
          <text x="${pos}" y="${timelineHeight + 15}" text-anchor="middle" font-size="10" font-weight="600" fill="#9370DB">${gate.label}</text>
        `;
      }).join('')}
      
      <!-- Other gate markers (Commit Gate, Promotion Gate) - dashed lines -->
      ${gateMarkers.filter(gate => gate.type !== 'CCM').map(gate => {
        const pos = (gate.position / 100) * chartWidth;
        const color = gate.type === 'Commit Gate' ? '#ff9800' : '#2196F3';
        return `
          <line x1="${pos}" y1="0" x2="${pos}" y2="${timelineHeight}" stroke="${color}" stroke-width="1" stroke-dasharray="3,3" opacity="0.7"/>
        `;
      }).join('')}
    </g>
    
    <!-- Items -->
    <g transform="translate(10, ${headerHeight + timelineHeight + 30})">
      ${processedItems.map((item, index) => {
        const y = index * (itemHeight + itemSpacing);
        const barWidth = (item.position / 100) * chartWidth;
        const barX = labelWidth;
        
        return `
          <!-- Item row -->
          <g>
            <!-- Item label -->
            <text x="0" y="${y + itemHeight / 2 + 4}" font-size="11" fill="#1a1a1a" text-anchor="start">
              <tspan font-weight="600">${escapeHtml(item.key)}:</tspan> ${escapeHtml(item.summary.substring(0, 30))}${item.summary.length > 30 ? '...' : ''}
            </text>
            
            <!-- Item bar container -->
            <rect x="${barX}" y="${y}" width="${chartWidth}" height="${itemHeight}" fill="#f5f5f5" stroke="#ddd" stroke-width="1" rx="2"/>
            
            <!-- Code Complete bar (purple) -->
            ${barWidth > 0 ? `
              <rect x="${barX}" y="${y}" width="${barWidth}" height="${itemHeight}" fill="#9370DB" opacity="0.8" rx="2"/>
            ` : ''}
          </g>
        `;
      }).join('')}
    </g>
    
    <!-- Legend -->
    <g transform="translate(10, ${headerHeight + timelineHeight + 30 + processedItems.length * (itemHeight + itemSpacing) + 20})">
      <text x="0" y="0" font-size="11" font-weight="600" fill="#495057">Legend:</text>
      <g transform="translate(0, 15)">
        <rect x="0" y="0" width="15" height="10" fill="#0066cc"/>
        <text x="20" y="8" font-size="10" fill="#1a1a1a">EC (Early Commitment)</text>
      </g>
      <g transform="translate(150, 15)">
        <rect x="0" y="0" width="15" height="10" fill="#28a745"/>
        <text x="20" y="8" font-size="10" fill="#1a1a1a">GA (General Availability)</text>
      </g>
      <g transform="translate(0, 30)">
        <rect x="0" y="0" width="15" height="10" fill="#9370DB" opacity="0.8"/>
        <text x="20" y="8" font-size="10" fill="#1a1a1a">Code Complete Bar</text>
      </g>
      <g transform="translate(150, 30)">
        <line x1="0" y1="5" x2="15" y2="5" stroke="#9370DB" stroke-width="1" stroke-dasharray="3,3" opacity="0.7"/>
        <text x="20" y="8" font-size="10" fill="#1a1a1a">CCM Gate (dashed)</text>
      </g>
    </g>
  </svg>`;

  return svg;
}

/**
 * Generate HTML table-based Gantt chart for email (email-client compatible)
 * 
 * @param {Object} params
 * @param {Object} params.ganttConfig - Gantt configuration
 * @param {string} params.selectedVersion - Selected version
 * @param {Array} params.items - Items array
 * @param {string} params.jiraBaseUrl - JIRA base URL
 * @returns {string} - HTML string with table-based Gantt chart
 */
function generateGanttChartHTMLTable({ ganttConfig, selectedVersion, items = [], jiraBaseUrl = 'https://jira.nutanix.com' }) {
  if (!ganttConfig || !selectedVersion || !ganttConfig.ecDate) {
    return '';
  }

  // Parse EC date
  const ec = new Date(ganttConfig.ecDate);
  if (isNaN(ec.getTime())) {
    return '';
  }

  // Collect all GA dates
  const gaDates = [];
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('ga') && /^\d+$/.test(key.replace('ga', ''))) {
      const gaData = ganttConfig[key];
      if (gaData && gaData.date) {
        const gateNumber = key.replace('ga', '');
        gaDates.push({
          date: new Date(gaData.date),
          label: `GA${gateNumber}`,
          color: gaData.color || '#28a745',
          number: parseInt(gateNumber, 10)
        });
      }
    }
  });

  if (gaDates.length === 0) {
    return '';
  }

  // Sort GA dates and use latest as timeline end
  gaDates.sort((a, b) => a.date.getTime() - b.date.getTime());
  const latestGA = gaDates[gaDates.length - 1];
  const ga = latestGA.date;

  const timelineStart = ec.getTime();
  const timelineEnd = ga.getTime();
  const timelineDuration = timelineEnd - timelineStart;

  if (timelineDuration <= 0) {
    return '';
  }

  // Calculate position percentage for a date
  const getPositionPercent = (date) => {
    if (!date) return null;
    const dateTime = date.getTime();
    if (dateTime <= timelineStart) return 0;
    if (dateTime >= timelineEnd) return 100;
    return Math.min(100, Math.max(0, ((dateTime - timelineStart) / timelineDuration) * 100));
  };

  // Collect CCM gate markers
  const ccmGates = [];
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('ccm') && key.includes('Gate')) {
      const gate = ganttConfig[key];
      if (gate) {
        if (Array.isArray(gate)) {
          gate.forEach((g, idx) => {
            if (g && g.date) {
              const gateDate = new Date(g.date);
              if (!isNaN(gateDate.getTime())) {
                const pos = getPositionPercent(gateDate);
                if (pos !== null) {
                  ccmGates.push({
                    date: gateDate,
                    position: pos,
                    label: `CCM${idx + 1}`, // Always use CCM format
                    number: idx + 1
                  });
                }
              }
            }
          });
        } else if (gate.date) {
          const gateDate = new Date(gate.date);
          if (!isNaN(gateDate.getTime())) {
            const pos = getPositionPercent(gateDate);
            if (pos !== null) {
              const gateNumber = key.replace('ccm', '').replace('Gate', '') || '1';
              ccmGates.push({
                date: gateDate,
                position: pos,
                label: `CCM${gateNumber}`, // Always use CCM format
                number: parseInt(gateNumber, 10) || 1
              });
            }
          }
        }
      }
    }
  });
  
  // Sort CCM gates by position
  ccmGates.sort((a, b) => a.position - b.position);

  // Collect Commit Gate markers (CG1, CG2, etc.)
  const commitGates = [];
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('commitGate')) {
      const gate = ganttConfig[key];
      if (gate && gate.date) {
        const gateDate = new Date(gate.date);
        if (!isNaN(gateDate.getTime())) {
          const pos = getPositionPercent(gateDate);
          if (pos !== null) {
            const gateNumber = key.replace('commitGate', '') || '1';
            commitGates.push({
              date: gateDate,
              position: pos,
              label: `CG${gateNumber}`, // Always use CG format
              number: parseInt(gateNumber, 10) || 1
            });
          }
        }
      }
    }
  });
  
  // Sort Commit gates by position
  commitGates.sort((a, b) => a.position - b.position);

  // Collect Promotion Gate markers (PG1, PG2, etc.)
  const promotionGates = [];
  Object.keys(ganttConfig).forEach(key => {
    if (key.startsWith('promotionGate')) {
      const gate = ganttConfig[key];
      if (gate && gate.date) {
        const gateDate = new Date(gate.date);
        if (!isNaN(gateDate.getTime())) {
          const pos = getPositionPercent(gateDate);
          if (pos !== null) {
            const gateNumber = key.replace('promotionGate', '') || '1';
            promotionGates.push({
              date: gateDate,
              position: pos,
              label: `PG${gateNumber}`, // Always use PG format
              number: parseInt(gateNumber, 10) || 1
            });
          }
        }
      }
    }
  });
  
  // Sort Promotion gates by position
  promotionGates.sort((a, b) => a.position - b.position);

  // Get today's date marker
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to start of day for comparison
  const todayPosition = getPositionPercent(today);
  const todayLabel = 'Today';

  // Process items - only committed items with Code Complete date
  const processedItems = (items || [])
    .filter(item => item.customfield_11067) // Only items with Code Complete date
    .map(item => {
      const codeCompleteDate = new Date(item.customfield_11067);
      if (isNaN(codeCompleteDate.getTime())) {
        return null;
      }
      const codeCompletePos = getPositionPercent(codeCompleteDate);
      
      // Get Commit Gate date for this item (customfield_35863)
      let commitGatePos = null;
      if (item.customfield_35863) {
        const commitGateDate = new Date(item.customfield_35863);
        if (!isNaN(commitGateDate.getTime())) {
          commitGatePos = getPositionPercent(commitGateDate);
        }
      }
      
      // Get Promotion Gate date for this item (customfield_35864)
      let promotionGatePos = null;
      if (item.customfield_35864) {
        const promotionGateDate = new Date(item.customfield_35864);
        if (!isNaN(promotionGateDate.getTime())) {
          promotionGatePos = getPositionPercent(promotionGateDate);
        }
      }
      
      return {
        key: item.key,
        summary: item.summary || '',
        codeCompleteDate,
        codeCompletePosition: codeCompletePos !== null ? codeCompletePos : 0,
        commitGateDate: item.customfield_35863 ? new Date(item.customfield_35863) : null,
        commitGatePosition: commitGatePos !== null ? commitGatePos : null,
        promotionGateDate: item.customfield_35864 ? new Date(item.customfield_35864) : null,
        promotionGatePosition: promotionGatePos !== null ? promotionGatePos : null
      };
    })
    .filter(item => item !== null)
    .sort((a, b) => a.codeCompletePosition - b.codeCompletePosition); // Sort by Code Complete position

  if (processedItems.length === 0) {
    return '';
  }

  // Format date for display
  const formatDate = (date) => {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Build timeline header row
  const timelineCells = [];
  const numSegments = 20; // Divide timeline into 20 segments
  for (let i = 0; i <= numSegments; i++) {
    const percent = (i / numSegments) * 100;
    const segmentDate = new Date(timelineStart + (percent / 100) * timelineDuration);
    const isEC = i === 0;
    const isGA = gaDates.some(ga => Math.abs(getPositionPercent(ga.date) - percent) < 2.5);
    const gaLabel = isGA ? gaDates.find(ga => Math.abs(getPositionPercent(ga.date) - percent) < 2.5)?.label : '';
    const isCCM = ccmGates.some(ccm => Math.abs(ccm.position - percent) < 2.5);
    const ccmLabel = isCCM ? ccmGates.find(ccm => Math.abs(ccm.position - percent) < 2.5)?.label : '';
    const isCG = commitGates.some(cg => Math.abs(cg.position - percent) < 2.5);
    const cgLabel = isCG ? commitGates.find(cg => Math.abs(cg.position - percent) < 2.5)?.label : '';
    const isPG = promotionGates.some(pg => Math.abs(pg.position - percent) < 2.5);
    const pgLabel = isPG ? promotionGates.find(pg => Math.abs(pg.position - percent) < 2.5)?.label : '';
    const isToday = todayPosition !== null && Math.abs(todayPosition - percent) < 2.5;
    
    // Determine border style - add right border for gates and today to create visible markers
    let borderStyle = 'border: 1px solid #dee2e6;';
    if (isCCM) {
      borderStyle = 'border-left: 1px solid #dee2e6; border-top: 1px solid #dee2e6; border-right: 2px solid #9370DB; border-bottom: 1px solid #dee2e6;';
    } else if (isCG) {
      borderStyle = 'border-left: 1px solid #dee2e6; border-top: 1px solid #dee2e6; border-right: 2px solid #ff9800; border-bottom: 1px solid #dee2e6;';
    } else if (isPG) {
      borderStyle = 'border-left: 1px solid #dee2e6; border-top: 1px solid #dee2e6; border-right: 2px solid #2196F3; border-bottom: 1px solid #dee2e6;';
    } else if (isToday) {
      borderStyle = 'border-left: 1px solid #dee2e6; border-top: 1px solid #dee2e6; border-right: 2px solid #dc3545; border-bottom: 1px solid #dee2e6;';
    }
    
    let cellStyle = `${borderStyle} padding: 4px; text-align: center; font-size: 9px; vertical-align: bottom; `;
    if (isEC) {
      cellStyle += 'background-color: #0066cc; color: white; font-weight: bold;';
    } else if (isGA) {
      cellStyle += 'background-color: #28a745; color: white; font-weight: bold;';
    } else if (isCCM) {
      cellStyle += 'background-color: #f0e6ff; color: #9370DB; font-weight: bold;';
    } else if (isCG) {
      cellStyle += 'background-color: #fff3e0; color: #ff9800; font-weight: bold;';
    } else if (isPG) {
      cellStyle += 'background-color: #e3f2fd; color: #2196F3; font-weight: bold;';
    } else if (isToday) {
      cellStyle += 'background-color: #ffeaea; color: #dc3545; font-weight: bold;';
    } else {
      cellStyle += 'background-color: #f5f5f5;';
    }
    
    timelineCells.push(`
      <td style="${cellStyle}">
        ${isEC ? 'EC' : isGA ? gaLabel : isCCM ? ccmLabel : isCG ? cgLabel : isPG ? pgLabel : isToday ? todayLabel : ''}
      </td>
    `);
  }

  // Build item rows
  const itemRows = processedItems.map(item => {
    const barCells = [];
    for (let i = 0; i <= numSegments; i++) {
      const percent = (i / numSegments) * 100;
      
      // Determine bar color based on position
      // Purple from start (0) to Code Complete date
      // Orange from Code Complete to Commit Gate date (if exists)
      // Blue from Commit Gate to Promotion Gate date (if exists)
      let barColor = '#f5f5f5'; // Default: no bar
      if (percent <= item.codeCompletePosition) {
        barColor = '#9370DB'; // Purple for EC to Code Complete
      } else if (item.commitGatePosition !== null && percent <= item.commitGatePosition) {
        barColor = '#ff9800'; // Orange for Code Complete to Commit Gate
      } else if (item.promotionGatePosition !== null && percent <= item.promotionGatePosition) {
        barColor = '#2196F3'; // Blue for Commit Gate to Promotion Gate
      }
      
      const isFilled = barColor !== '#f5f5f5';
      const isCCM = ccmGates.some(ccm => Math.abs(ccm.position - percent) < 2.5);
      const isCG = commitGates.some(cg => Math.abs(cg.position - percent) < 2.5);
      const isPG = promotionGates.some(pg => Math.abs(pg.position - percent) < 2.5);
      const isToday = todayPosition !== null && Math.abs(todayPosition - percent) < 2.5;
      
      // Add right border for gates and today to create visible vertical markers
      let borderStyle = 'border: 1px solid #dee2e6;';
      if (isCCM) {
        borderStyle = 'border-left: 1px solid #dee2e6; border-top: 1px solid #dee2e6; border-right: 2px solid #9370DB; border-bottom: 1px solid #dee2e6;';
      } else if (isCG) {
        borderStyle = 'border-left: 1px solid #dee2e6; border-top: 1px solid #dee2e6; border-right: 2px solid #ff9800; border-bottom: 1px solid #dee2e6;';
      } else if (isPG) {
        borderStyle = 'border-left: 1px solid #dee2e6; border-top: 1px solid #dee2e6; border-right: 2px solid #2196F3; border-bottom: 1px solid #dee2e6;';
      } else if (isToday) {
        borderStyle = 'border-left: 1px solid #dee2e6; border-top: 1px solid #dee2e6; border-right: 2px solid #dc3545; border-bottom: 1px solid #dee2e6;';
      }
      
      const opacity = barColor === '#9370DB' ? '0.8' : (barColor === '#ff9800' ? '0.8' : (barColor === '#2196F3' ? '0.8' : '1'));
      barCells.push(`
        <td style="${borderStyle} padding: 0; height: 20px; background-color: ${barColor}; opacity: ${opacity};">
        </td>
      `);
    }
    
    return `
      <tr>
        <td style="border: 1px solid #dee2e6; padding: 6px; background-color: #ffffff; font-size: 11px;">
          <a href="${jiraBaseUrl}/browse/${escapeHtml(item.key)}" style="color: #0065ff; text-decoration: none; font-weight: 600;">${escapeHtml(item.key)}</a>: ${escapeHtml(item.summary.length > 50 ? item.summary.substring(0, 50) + '...' : item.summary)}
        </td>
        ${barCells.join('')}
      </tr>
    `;
  });

  return `
    <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 1rem; font-weight: 600; color: #1a1a1a;">
        Gantt Chart: ${escapeHtml(selectedVersion)} (Committed Projects Only)
      </h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; background-color: #ffffff; border: 1px solid #dee2e6;">
        <thead>
          <tr>
            <th style="border: 1px solid #dee2e6; padding: 6px; background-color: #e9ecef; font-size: 11px; font-weight: 600; text-align: left; width: 200px;">
              Project
            </th>
            ${timelineCells.join('')}
          </tr>
        </thead>
        <tbody>
          ${itemRows.join('')}
        </tbody>
      </table>
      <div style="margin-top: 10px; font-size: 10px; color: #666;">
        <strong>Legend:</strong>
        <span style="display: inline-block; margin-left: 10px; margin-right: 20px;">
          <span style="display: inline-block; width: 15px; height: 10px; background-color: #0066cc; vertical-align: middle; margin-right: 5px;"></span>
          EC (Early Commitment)
        </span>
        <span style="display: inline-block; margin-right: 20px;">
          <span style="display: inline-block; width: 15px; height: 10px; background-color: #28a745; vertical-align: middle; margin-right: 5px;"></span>
          GA (General Availability)
        </span>
        <span style="display: inline-block; margin-right: 20px;">
          <span style="display: inline-block; width: 15px; height: 10px; background-color: #9370DB; opacity: 0.8; vertical-align: middle; margin-right: 5px;"></span>
          Code Complete Bar (EC to Code Complete)
        </span>
        <span style="display: inline-block; margin-right: 20px;">
          <span style="display: inline-block; width: 15px; height: 10px; background-color: #ff9800; opacity: 0.8; vertical-align: middle; margin-right: 5px;"></span>
          Code Complete to CG Bar
        </span>
        <span style="display: inline-block; margin-right: 20px;">
          <span style="display: inline-block; width: 3px; height: 10px; background-color: #9370DB; vertical-align: middle; margin-right: 5px;"></span>
          CCM Gates
        </span>
        <span style="display: inline-block; margin-right: 20px;">
          <span style="display: inline-block; width: 3px; height: 10px; background-color: #ff9800; vertical-align: middle; margin-right: 5px;"></span>
          CG (Commit Gates)
        </span>
        <span style="display: inline-block; margin-right: 20px;">
          <span style="display: inline-block; width: 3px; height: 10px; background-color: #2196F3; vertical-align: middle; margin-right: 5px;"></span>
          PG (Promotion Gates)
        </span>
        <span style="display: inline-block; margin-right: 20px;">
          <span style="display: inline-block; width: 15px; height: 10px; background-color: #ff9800; opacity: 0.8; vertical-align: middle; margin-right: 5px;"></span>
          Code Complete to CG Bar
        </span>
        <span style="display: inline-block; margin-right: 20px;">
          <span style="display: inline-block; width: 15px; height: 10px; background-color: #2196F3; opacity: 0.8; vertical-align: middle; margin-right: 5px;"></span>
          CG to PG Bar
        </span>
        <span style="display: inline-block; margin-right: 20px;">
          <span style="display: inline-block; width: 3px; height: 10px; background-color: #dc3545; vertical-align: middle; margin-right: 5px;"></span>
          Today
        </span>
      </div>
    </div>
  `;
}

/**
 * Generate HTML with embedded Gantt chart (uses table-based approach for email compatibility)
 * 
 * @param {Object} params
 * @param {Object} params.ganttConfig - Gantt configuration
 * @param {string} params.selectedVersion - Selected version
 * @param {Array} params.items - Items array
 * @param {string} params.jiraBaseUrl - JIRA base URL
 * @returns {string} - HTML string with embedded Gantt chart
 */
function generateGanttChartHTML(params) {
  // Use table-based approach for better email client compatibility
  const tableHTML = generateGanttChartHTMLTable(params);
  
  if (!tableHTML) {
    return '';
  }

  return tableHTML;
}

module.exports = {
  generateGanttChartSVG,
  generateGanttChartHTML
};

