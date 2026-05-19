import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';

// Issue type colors for consistent visualization
const ISSUE_TYPE_COLORS = {
  'Bug': '#dc3545',
  'Improvement': '#28a745',
  'Test': '#ffc107', 
  'Other': '#6c757d'
};

// Milestone colors (same as other charts)
const MILESTONE_COLORS = {
  'EC': '#007bff',
  'Code Complete': '#fd7e14',
  'CG': '#6f42c1',
  'Branch Cut': '#dc3545',
  'PG': '#28a745',
  'GA': '#343a40'
};

/**
 * Line chart showing 3-week velocity trends by issue type with milestone overlays
 * Supports progressive loading - updates as each release completes
 */
const VelocityByIssueTypeChart = ({ data, milestones, selectedPeriod, isLoading = false, completedReleases = [] }) => {
  if (!data || !data.bins || data.bins.length === 0) {
    if (isLoading) {
      return (
        <div className="progressive-chart-container">
          <div className="chart-placeholder loading">
            <div className="empty-chart-message">
              <span className="loading-spinner">⏳</span>
              <p>Preparing issue type trends...</p>
              {completedReleases.length > 0 && (
                <small>Lines will appear as releases complete: {completedReleases.join(', ')}</small>
              )}
            </div>
            {/* Empty line chart axes */}
            <div className="empty-line-chart">
              <div className="y-axis-placeholder">
                <div className="axis-label">Tickets</div>
              </div>
              <div className="chart-area">
                <div className="legend-placeholder">
                  {['Bug', 'Improvement', 'Test', 'Other'].map(type => (
                    <div key={type} className="legend-item-placeholder">
                      <div className={`legend-color ${type.toLowerCase()}`}></div>
                      <span>{type}</span>
                    </div>
                  ))}
                </div>
                <div className="grid-lines">
                  {Array.from({length: 5}, (_, i) => (
                    <div key={i} className="grid-line"></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    return (
      <div className="chart-placeholder">
        <p>No velocity data by issue type available</p>
      </div>
    );
  }

  // Prepare chart data
  const chartData = data.bins.map(bin => {
    const binData = {
      binLabel: bin.binLabel,
      binStartDate: bin.binStartDate,
      totalTickets: bin.totalTickets,
      shortLabel: formatBinLabel(bin.binStartDate)
    };

    // Add issue type counts
    data.categories.forEach(category => {
      binData[category] = bin.categories[category] || 0;
    });

    return binData;
  });

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload;
      if (!data) return null;

      return (
        <div className="custom-tooltip">
          <p className="tooltip-label">{`Period: ${data.binLabel}`}</p>
          <p className="tooltip-total">{`Total Tickets: ${data.totalTickets}`}</p>
          <div className="tooltip-breakdown">
            {payload.map((entry, index) => (
              <div key={index} className="tooltip-item">
                <span 
                  className="tooltip-color" 
                  style={{ backgroundColor: entry.color }}
                ></span>
                <span>{entry.dataKey}: {entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomizedAxisTick = ({ x, y, payload }) => {
    return (
      <g transform={`translate(${x},${y})`}>
        <text 
          x={0} 
          y={0} 
          dy={16} 
          textAnchor="middle" 
          fill="#666"
          fontSize="12"
        >
          {payload.value}
        </text>
      </g>
    );
  };

  return (
    <div className={`velocity-by-issue-type-chart ${isLoading ? 'progressive-loading' : ''}`}>
      {isLoading && (
        <div className="progressive-indicator">
          <span className="progress-pulse">●</span>
          <span>Live trends - updating as data loads</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={500}>
        <LineChart
          data={chartData}
          margin={{
            top: 20,
            right: 30,
            left: 20,
            bottom: 60
          }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis 
            dataKey="shortLabel"
            tick={<CustomizedAxisTick />}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis 
            label={{ value: 'Number of Tickets', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{ paddingTop: '20px' }}
          />

          {/* Render lines for each issue type category */}
          {data.categories.map(category => (
            <Line
              key={category}
              type="monotone"
              dataKey={category}
              stroke={ISSUE_TYPE_COLORS[category]}
              strokeWidth={3}
              dot={{ fill: ISSUE_TYPE_COLORS[category], strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: ISSUE_TYPE_COLORS[category], strokeWidth: 2 }}
              name={category}
            />
          ))}

          {/* Add milestone reference lines */}
          {milestones?.map(milestone => {
            const binForMilestone = findBinForDate(chartData, milestone.dateString);
            if (binForMilestone) {
              return (
                <ReferenceLine
                  key={`${milestone.release}-${milestone.milestone}`}
                  x={binForMilestone.shortLabel}
                  stroke={milestone.color}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  label={{
                    value: `${milestone.release} ${milestone.milestone}`,
                    position: 'topLeft',
                    offset: 10,
                    style: { fontSize: '10px', fill: milestone.color }
                  }}
                />
              );
            }
            return null;
          })}
        </LineChart>
      </ResponsiveContainer>

      {/* Summary statistics */}
      <div className="velocity-summary">
        <h4>Issue Type Trends</h4>
        <div className="summary-grid">
          {data.categories.map(category => {
            const totalCount = chartData.reduce((sum, bin) => sum + (bin[category] || 0), 0);
            const avgPerPeriod = Math.round(totalCount / chartData.length * 10) / 10;
            
            return (
              <div key={category} className="summary-item">
                <div className="summary-header">
                  <div 
                    className="summary-color" 
                    style={{ backgroundColor: ISSUE_TYPE_COLORS[category] }}
                  ></div>
                  <span className="summary-label">{category}</span>
                </div>
                <div className="summary-stats">
                  <div className="stat">
                    <span className="stat-value">{totalCount}</span>
                    <span className="stat-label">Total</span>
                  </div>
                  <div className="stat">
                    <span className="stat-value">{avgPerPeriod}</span>
                    <span className="stat-label">Avg/Period</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Period filter info */}
      <div className="filter-info">
        <p><strong>Period:</strong> {getPeriodDescription(selectedPeriod)}</p>
        <p><strong>Data Points:</strong> {chartData.length} three-week periods</p>
      </div>

      <style>{`
        .velocity-by-issue-type-chart {
          width: 100%;
        }

        .chart-placeholder {
          height: 400px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f8f9fa;
          border-radius: 8px;
          color: #6c757d;
          font-style: italic;
        }

        .custom-tooltip {
          background: white;
          padding: 16px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          border: 1px solid #dee2e6;
          max-width: 300px;
        }

        .tooltip-label {
          font-weight: 600;
          color: #495057;
          margin: 0 0 8px 0;
          font-size: 14px;
        }

        .tooltip-total {
          font-weight: 500;
          color: #28a745;
          margin: 0 0 12px 0;
        }

        .tooltip-breakdown {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .tooltip-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: #495057;
        }

        .tooltip-color {
          width: 12px;
          height: 12px;
          border-radius: 2px;
        }

        .velocity-summary {
          margin-top: 24px;
          padding: 16px;
          background: #f8f9fa;
          border-radius: 8px;
        }

        .velocity-summary h4 {
          margin: 0 0 16px 0;
          color: #495057;
          font-size: 16px;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
        }

        .summary-item {
          background: white;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #dee2e6;
        }

        .summary-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }

        .summary-color {
          width: 16px;
          height: 16px;
          border-radius: 4px;
        }

        .summary-label {
          font-weight: 600;
          color: #495057;
        }

        .summary-stats {
          display: flex;
          gap: 24px;
        }

        .stat {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .stat-value {
          font-size: 20px;
          font-weight: 700;
          color: #007bff;
        }

        .stat-label {
          font-size: 12px;
          color: #6c757d;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .filter-info {
          margin-top: 16px;
          padding: 12px 16px;
          background: #e9ecef;
          border-radius: 6px;
          font-size: 14px;
          color: #495057;
        }

        .filter-info p {
          margin: 4px 0;
        }

        /* Progressive Loading for Line Chart */
        .empty-line-chart {
          display: flex;
          width: 100%;
          max-width: 600px;
          height: 300px;
        }

        .chart-area {
          flex: 1;
          position: relative;
          padding: 20px;
        }

        .legend-placeholder {
          display: flex;
          gap: 20px;
          margin-bottom: 20px;
          justify-content: center;
        }

        .legend-item-placeholder {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #6c757d;
        }

        .legend-color {
          width: 12px;
          height: 2px;
          border-radius: 1px;
        }

        .legend-color.bug { background: #dc3545; }
        .legend-color.improvement { background: #28a745; }
        .legend-color.test { background: #ffc107; }
        .legend-color.other { background: #6c757d; }

        .grid-lines {
          position: absolute;
          top: 40px;
          left: 20px;
          right: 20px;
          bottom: 20px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .grid-line {
          height: 1px;
          background: #f1f3f4;
          border-top: 1px dashed #e9ecef;
        }

        .progressive-loading {
          position: relative;
        }

        .progressive-indicator {
          position: absolute;
          top: 10px;
          right: 10px;
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(0, 123, 255, 0.1);
          padding: 6px 12px;
          border-radius: 15px;
          font-size: 12px;
          color: #007bff;
          font-weight: 500;
          z-index: 10;
        }

        .progress-pulse {
          animation: pulse 1.5s ease-in-out infinite;
        }

        @media (max-width: 768px) {
          .summary-grid {
            grid-template-columns: 1fr;
          }
          
          .summary-stats {
            gap: 16px;
          }
          
          .progressive-indicator {
            position: static;
            margin-bottom: 16px;
            justify-content: center;
          }
          
          .legend-placeholder {
            flex-direction: column;
            gap: 8px;
          }
        }
      `}</style>
    </div>
  );
};

/**
 * Format bin label to show just the start date
 */
const formatBinLabel = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

/**
 * Find which bin contains the given date
 */
const findBinForDate = (chartData, dateString) => {
  if (!dateString || !chartData) return null;
  
  const targetDate = new Date(dateString);
  
  return chartData.find(bin => {
    if (!bin.binStartDate) return false;
    
    // Parse bin date range from binLabel  
    const binStart = new Date(bin.binStartDate);
    const binEnd = new Date(binStart.getTime() + (21 * 24 * 60 * 60 * 1000)); // 3 weeks
    
    return targetDate >= binStart && targetDate <= binEnd;
  });
};

/**
 * Get description for the selected period filter
 */
const getPeriodDescription = (selectedPeriod) => {
  switch (selectedPeriod) {
    case 'all': return 'All Available Data';
    case 'post-code-complete': return 'Post Code Complete Only';
    case 'last-6-months': return 'Last 6 Months';
    case 'last-year': return 'Last Year';
    default: return 'All Available Data';
  }
};

export default VelocityByIssueTypeChart;