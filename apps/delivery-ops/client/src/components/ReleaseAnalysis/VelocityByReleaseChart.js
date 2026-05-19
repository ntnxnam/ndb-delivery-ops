import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';

// Release colors for consistent visualization
const RELEASE_COLORS = {
  'NDB-2.8': '#007bff',
  'NDB-2.9': '#28a745', 
  'NDB-2.10': '#ffc107',
  'NDB-2.11': '#dc3545'
};

// Milestone colors (same as timeline)
const MILESTONE_COLORS = {
  'EC': '#007bff',
  'Code Complete': '#fd7e14',
  'CG': '#6f42c1',
  'Branch Cut': '#dc3545',
  'PG': '#28a745',
  'GA': '#343a40'
};

/**
 * Bar chart showing 3-week velocity grouped by release with milestone overlays
 * Supports progressive loading - shows empty chart initially and updates as data loads
 */
const VelocityByReleaseChart = ({ data, milestones, selectedReleases, isLoading = false, completedReleases = [] }) => {
  // Show empty chart structure during loading, even with no data yet
  if (!data || !data.bins || data.bins.length === 0) {
    if (isLoading) {
      return (
        <div className="progressive-chart-container">
          <div className="chart-placeholder loading">
            <div className="empty-chart-message">
              <span className="loading-spinner">⏳</span>
              <p>Preparing velocity chart...</p>
              {completedReleases.length > 0 && (
                <small>Data will appear as releases complete: {completedReleases.join(', ')}</small>
              )}
            </div>
            {/* Empty chart axes */}
            <div className="empty-chart-axes">
              <div className="y-axis-placeholder">
                <div className="axis-label">Tickets</div>
                <div className="tick-marks">
                  {[0, 10, 20, 30, 40, 50].map(tick => (
                    <div key={tick} className="tick">{tick}</div>
                  ))}
                </div>
              </div>
              <div className="x-axis-placeholder">
                <div className="axis-label">3-Week Periods</div>
                <div className="placeholder-bars">
                  {Array.from({length: 8}, (_, i) => (
                    <div key={i} className="placeholder-bar"></div>
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
        <p>No velocity data available</p>
      </div>
    );
  }

  // Filter milestones for selected releases
  const filteredMilestones = milestones?.filter(m => 
    selectedReleases.includes(m.release)
  ) || [];

  // Prepare chart data
  const chartData = data.bins.map(bin => {
    const binData = {
      binLabel: bin.binLabel,
      binStartDate: bin.binStartDate,
      totalTickets: bin.totalTickets,
      shortLabel: formatBinLabel(bin.binStartDate)
    };

    // Add release-specific counts
    selectedReleases.forEach(release => {
      binData[release] = bin.releases[release] || 0;
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
            {selectedReleases.map(release => (
              <div key={release} className="tooltip-item">
                <span 
                  className="tooltip-color" 
                  style={{ backgroundColor: RELEASE_COLORS[release] }}
                ></span>
                <span>{release}: {data[release] || 0}</span>
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
    <div className={`velocity-by-release-chart ${isLoading ? 'progressive-loading' : ''}`}>
      {isLoading && (
        <div className="progressive-indicator">
          <span className="progress-pulse">●</span>
          <span>Live data - updates as releases complete</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={500}>
        <BarChart
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

          {/* Render bars for each selected release */}
          {selectedReleases.map(release => (
            <Bar
              key={release}
              dataKey={release}
              stackId="releases"
              fill={RELEASE_COLORS[release]}
              name={release}
              radius={[2, 2, 0, 0]}
            />
          ))}

          {/* Add milestone reference lines */}
          {filteredMilestones.map(milestone => {
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
        </BarChart>
      </ResponsiveContainer>

      {/* Milestone indicators */}
      <div className="milestone-indicators">
        <h4>Milestone Markers</h4>
        <div className="indicator-grid">
          {filteredMilestones.map(milestone => (
            <div key={`${milestone.release}-${milestone.milestone}`} className="indicator-item">
              <div 
                className="indicator-line" 
                style={{ backgroundColor: milestone.color }}
              ></div>
              <span>{milestone.release} {milestone.milestone}</span>
              <small>{milestone.dateString}</small>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .velocity-by-release-chart {
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

        .milestone-indicators {
          margin-top: 24px;
          padding: 16px;
          background: #f8f9fa;
          border-radius: 8px;
        }

        .milestone-indicators h4 {
          margin: 0 0 12px 0;
          color: #495057;
          font-size: 16px;
        }

        .indicator-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 12px;
        }

        .indicator-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          background: white;
          border-radius: 4px;
          font-size: 12px;
        }

        .indicator-line {
          width: 20px;
          height: 2px;
          border-radius: 1px;
        }

        .indicator-item span {
          color: #495057;
          font-weight: 500;
        }

        .indicator-item small {
          color: #6c757d;
          margin-left: auto;
        }

        /* Progressive Loading Styles */
        .progressive-chart-container {
          position: relative;
          height: 500px;
        }

        .chart-placeholder.loading {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          padding: 40px 20px;
        }

        .empty-chart-message {
          text-align: center;
          margin-bottom: 40px;
        }

        .empty-chart-message .loading-spinner {
          font-size: 24px;
          margin-bottom: 12px;
          display: block;
          animation: pulse 2s ease-in-out infinite;
        }

        .empty-chart-message p {
          color: #495057;
          font-size: 16px;
          margin: 0 0 8px 0;
        }

        .empty-chart-message small {
          color: #6c757d;
          font-size: 12px;
        }

        .empty-chart-axes {
          display: flex;
          width: 100%;
          max-width: 600px;
          height: 300px;
        }

        .y-axis-placeholder {
          width: 60px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          align-items: flex-end;
          padding-right: 10px;
          border-right: 2px solid #e9ecef;
        }

        .axis-label {
          font-size: 12px;
          color: #6c757d;
          transform: rotate(-90deg);
          white-space: nowrap;
        }

        .tick-marks {
          display: flex;
          flex-direction: column-reverse;
          justify-content: space-between;
          height: 250px;
        }

        .tick {
          font-size: 11px;
          color: #adb5bd;
        }

        .x-axis-placeholder {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding-left: 20px;
        }

        .placeholder-bars {
          display: flex;
          align-items: flex-end;
          justify-content: space-around;
          height: 250px;
          border-bottom: 2px solid #e9ecef;
        }

        .placeholder-bar {
          width: 30px;
          height: 20px;
          background: #f8f9fa;
          border: 1px dashed #dee2e6;
          animation: shimmer 2s infinite;
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
          .indicator-grid {
            grid-template-columns: 1fr;
          }
          
          .progressive-indicator {
            position: static;
            margin-bottom: 16px;
            justify-content: center;
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

export default VelocityByReleaseChart;