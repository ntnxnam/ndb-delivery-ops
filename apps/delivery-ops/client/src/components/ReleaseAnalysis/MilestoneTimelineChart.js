import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

// Milestone color mapping
const MILESTONE_COLORS = {
  'EC': '#007bff',           // Blue
  'Code Complete': '#fd7e14', // Orange
  'CG': '#6f42c1',          // Purple
  'Branch Cut': '#dc3545',   // Red
  'PG': '#28a745',          // Green
  'GA': '#343a40'           // Black/Dark Grey
};

/**
 * Timeline chart showing all release milestones in a Gantt-style view
 * Shows milestones for all selected releases, highlights completed ones during loading
 */
const MilestoneTimelineChart = ({ data, selectedReleases, isLoading = false, completedReleases = [] }) => {
  if (!data || data.length === 0) {
    return (
      <div className="chart-placeholder">
        <p>No milestone data available</p>
      </div>
    );
  }

  // Filter data for selected releases
  const filteredData = data.filter(milestone => 
    selectedReleases.includes(milestone.release)
  );

  // Group milestones by release for better visualization
  const releaseGroups = {};
  filteredData.forEach(milestone => {
    if (!releaseGroups[milestone.release]) {
      releaseGroups[milestone.release] = [];
    }
    releaseGroups[milestone.release].push(milestone);
  });

  // Convert to timeline format for visualization
  const timelineData = [];
  const allDates = filteredData.map(m => m.date.getTime()).sort((a, b) => a - b);
  const minDate = new Date(allDates[0]);
  const maxDate = new Date(allDates[allDates.length - 1]);

  // Create timeline entries
  Object.entries(releaseGroups).forEach(([release, milestones]) => {
    milestones.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    milestones.forEach((milestone, index) => {
      const daysSinceStart = Math.floor((milestone.date.getTime() - minDate.getTime()) / (24 * 60 * 60 * 1000));
      
      timelineData.push({
        id: `${release}-${milestone.milestone}`,
        release: release,
        milestone: milestone.milestone,
        date: milestone.dateString,
        daysSinceStart,
        color: milestone.color,
        fullLabel: `${release} - ${milestone.milestone}`
      });
    });
  });

  // Sort by date
  timelineData.sort((a, b) => a.daysSinceStart - b.daysSinceStart);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="custom-tooltip">
          <p className="tooltip-label">{`${data.release} - ${data.milestone}`}</p>
          <p className="tooltip-date">{`Date: ${data.date}`}</p>
          <p className="tooltip-days">{`Day ${data.daysSinceStart} from start`}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`milestone-timeline-chart ${isLoading ? 'progressive-loading' : ''}`}>
      {isLoading && (
        <div className="progressive-indicator">
          <span className="progress-pulse">●</span>
          <span>Timeline ready - data loading for releases</span>
        </div>
      )}
      <div className="timeline-visualization">
        {/* Custom timeline visualization */}
        <div className="timeline-container">
          <div className="timeline-axis">
            {timelineData.map((item, index) => {
              const isReleaseCompleted = completedReleases.includes(item.release);
              const isLoadingAndNotCompleted = isLoading && !isReleaseCompleted;
              
              return (
                <div 
                  key={item.id}
                  className={`timeline-milestone ${isLoadingAndNotCompleted ? 'pending-data' : ''} ${isReleaseCompleted ? 'has-data' : ''}`}
                  style={{
                    left: `${(item.daysSinceStart / Math.max(...timelineData.map(t => t.daysSinceStart))) * 100}%`,
                    backgroundColor: item.color,
                    opacity: isLoadingAndNotCompleted ? 0.5 : 1
                  }}
                  title={`${item.fullLabel}${isLoadingAndNotCompleted ? ' (waiting for data...)' : ''}`}
                >
                <div className="milestone-marker" style={{ backgroundColor: item.color }}>
                  <div className="milestone-line"></div>
                  <div className="milestone-label">
                    <strong>{item.release}</strong>
                    <span>{item.milestone}</span>
                    <small>{item.date}</small>
                    {isLoadingAndNotCompleted && <div className="pending-indicator">⏳</div>}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="milestone-legend">
        <h4>Milestone Types</h4>
        <div className="legend-items">
          {Object.entries(MILESTONE_COLORS).map(([milestone, color]) => (
            <div key={milestone} className="legend-item">
              <div className="legend-color" style={{ backgroundColor: color }}></div>
              <span>{milestone}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .milestone-timeline-chart {
          height: 400px;
          width: 100%;
        }

        .timeline-visualization {
          height: 300px;
          position: relative;
          margin-bottom: 40px;
        }

        .timeline-container {
          position: relative;
          height: 100%;
          background: linear-gradient(to right, #f8f9fa 0%, #e9ecef 100%);
          border-radius: 8px;
          overflow-x: auto;
          padding: 20px;
        }

        .timeline-axis {
          position: relative;
          height: 100%;
          width: 100%;
          border-bottom: 2px solid #dee2e6;
        }

        .timeline-milestone {
          position: absolute;
          top: 0;
          height: 100%;
          width: 2px;
          z-index: 1;
        }

        .milestone-marker {
          position: relative;
          height: 100%;
          width: 2px;
        }

        .milestone-line {
          position: absolute;
          top: 0;
          left: 0;
          width: 2px;
          height: 100%;
          background: inherit;
        }

        .milestone-label {
          position: absolute;
          top: -10px;
          left: 5px;
          background: white;
          padding: 8px 12px;
          border-radius: 6px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          border: 1px solid #dee2e6;
          min-width: 120px;
          font-size: 12px;
          z-index: 2;
        }

        .milestone-label strong {
          display: block;
          color: #495057;
          font-weight: 600;
          margin-bottom: 2px;
        }

        .milestone-label span {
          display: block;
          color: #6c757d;
          font-weight: 500;
          margin-bottom: 2px;
        }

        .milestone-label small {
          display: block;
          color: #868e96;
          font-size: 11px;
        }

        .pending-indicator {
          position: absolute;
          top: -5px;
          right: -5px;
          font-size: 8px;
          animation: pulse 2s ease-in-out infinite;
        }

        .timeline-milestone.pending-data {
          animation: pendingPulse 2s ease-in-out infinite;
        }

        .timeline-milestone.has-data {
          animation: dataComplete 0.5s ease-in;
        }

        .progressive-loading .timeline-milestone.pending-data .milestone-label {
          background: #f8f9fa;
          border-color: #dee2e6;
          opacity: 0.8;
        }

        .progressive-indicator {
          position: absolute;
          top: -40px;
          right: 20px;
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

        @keyframes pendingPulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 0.8; }
        }

        @keyframes dataComplete {
          from { transform: scale(0.9); opacity: 0.5; }
          to { transform: scale(1); opacity: 1; }
        }

        .milestone-legend {
          margin-top: 20px;
          padding: 16px;
          background: #f8f9fa;
          border-radius: 8px;
        }

        .milestone-legend h4 {
          margin: 0 0 12px 0;
          color: #495057;
          font-size: 16px;
        }

        .legend-items {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          color: #495057;
        }

        .legend-color {
          width: 16px;
          height: 16px;
          border-radius: 2px;
          border: 1px solid #dee2e6;
        }

        .chart-placeholder {
          height: 300px;
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
          padding: 12px;
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          border: 1px solid #dee2e6;
        }

        .tooltip-label {
          font-weight: 600;
          color: #495057;
          margin: 0 0 4px 0;
        }

        .tooltip-date, .tooltip-days {
          font-size: 12px;
          color: #6c757d;
          margin: 2px 0;
        }

        @media (max-width: 768px) {
          .timeline-container {
            padding: 10px;
          }
          
          .milestone-label {
            min-width: 100px;
            font-size: 11px;
            padding: 6px 8px;
          }
          
          .legend-items {
            gap: 12px;
          }
        }
      `}</style>
    </div>
  );
};

export default MilestoneTimelineChart;