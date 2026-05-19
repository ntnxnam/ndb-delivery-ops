import React, { useState } from 'react';

function CrystalBallInsights({ 
  trendAnalysis, 
  predictions, 
  forecast, 
  loading, 
  error, 
  onRefresh 
}) {
  const [expandedInsight, setExpandedInsight] = useState(null);

  if (loading) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <span className="mr-2">🔮</span>
          Crystal Ball Insights
        </h3>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <span className="mr-2">🔮</span>
          Crystal Ball Insights
        </h3>
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-700 text-sm mb-3">{error}</p>
          <button
            onClick={onRefresh}
            className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Collect all insights from different sources
  const allInsights = [];

  // Insights from trend analysis
  if (trendAnalysis?.insights) {
    trendAnalysis.insights.forEach((insight, index) => {
      allInsights.push({
        id: `trend-${index}`,
        type: 'trend',
        icon: '📈',
        title: 'Trend Analysis',
        content: insight,
        priority: 'medium'
      });
    });
  }

  // Insights from predictions
  if (predictions?.overallHealth) {
    const health = predictions.overallHealth;
    allInsights.push({
      id: 'health-overall',
      type: 'health',
      icon: health.level === 'excellent' ? '✅' : health.level === 'good' ? '👍' : 
            health.level === 'fair' ? '⚠️' : '🚨',
      title: 'Release Health',
      content: `Release health is ${health.level} (${health.score}/100). ${
        health.level === 'excellent' ? 'All systems performing optimally.' :
        health.level === 'good' ? 'Most metrics are on track with minor areas for improvement.' :
        health.level === 'fair' ? 'Some concerns detected that require attention.' :
        'Multiple issues need immediate attention to avoid delays.'
      }`,
      priority: health.level === 'poor' ? 'high' : health.level === 'fair' ? 'medium' : 'low',
      details: health.factors
    });
  }

  // Insights from risk forecast
  if (forecast?.recommendations) {
    forecast.recommendations.forEach((rec, index) => {
      allInsights.push({
        id: `forecast-${index}`,
        type: 'forecast',
        icon: '🎯',
        title: 'Risk Forecast',
        content: rec,
        priority: 'high'
      });
    });
  }

  // Velocity insights from trend analysis
  if (trendAnalysis?.trends?.velocity) {
    const velocity = trendAnalysis.trends.velocity;
    const trend = velocity.trend === 'improving' ? 'improving' : 'declining';
    allInsights.push({
      id: 'velocity-trend',
      type: 'velocity',
      icon: trend === 'improving' ? '🚀' : '⚡',
      title: 'Team Velocity',
      content: `Team velocity is ${trend}. Current: ${velocity.current} points, Average: ${velocity.average} points.`,
      priority: trend === 'declining' ? 'medium' : 'low',
      details: [`Confidence: ${Math.round(velocity.confidence * 100)}%`]
    });
  }

  // Quality insights
  if (trendAnalysis?.trends?.quality) {
    const quality = trendAnalysis.trends.quality;
    allInsights.push({
      id: 'quality-trend',
      type: 'quality',
      icon: '🏗️',
      title: 'Code Quality',
      content: `Code quality is ${quality.trend}. Bug rate: ${(quality.bugRate * 100).toFixed(1)}%, Test coverage: ${(quality.testCoverage * 100).toFixed(1)}%.`,
      priority: quality.bugRate > 0.1 ? 'medium' : 'low',
      details: [`Rework rate: ${(quality.reworkRate * 100).toFixed(1)}%`]
    });
  }

  // Sort insights by priority
  const priorityOrder = { high: 3, medium: 2, low: 1 };
  allInsights.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'border-red-200 bg-red-50';
      case 'medium': return 'border-yellow-200 bg-yellow-50';
      case 'low': return 'border-green-200 bg-green-50';
      default: return 'border-gray-200 bg-gray-50';
    }
  };

  const getPriorityTextColor = (priority) => {
    switch (priority) {
      case 'high': return 'text-red-800';
      case 'medium': return 'text-yellow-800';
      case 'low': return 'text-green-800';
      default: return 'text-gray-800';
    }
  };

  if (allInsights.length === 0) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <span className="mr-2">🔮</span>
          Crystal Ball Insights
        </h3>
        <div className="text-center text-gray-500 py-8">
          <p>Generate predictions to see AI-powered insights</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold flex items-center">
          <span className="mr-2">🔮</span>
          Crystal Ball Insights
        </h3>
        <button
          onClick={onRefresh}
          className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-3">
        {allInsights.map((insight, index) => (
          <div
            key={insight.id}
            className={`border rounded-lg p-4 transition-all ${getPriorityColor(insight.priority)}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center mb-2">
                  <span className="text-lg mr-2">{insight.icon}</span>
                  <span className="text-sm font-medium text-gray-600">
                    {insight.title}
                  </span>
                  <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                    insight.priority === 'high' ? 'bg-red-100 text-red-700' :
                    insight.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-green-100 text-green-700'
                  }`}>
                    {insight.priority}
                  </span>
                </div>
                <p className={`text-sm ${getPriorityTextColor(insight.priority)}`}>
                  {insight.content}
                </p>
                
                {insight.details && expandedInsight === insight.id && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <ul className="text-xs text-gray-600 space-y-1">
                      {insight.details.map((detail, detailIndex) => (
                        <li key={detailIndex} className="flex items-center">
                          <span className="w-1 h-1 bg-gray-400 rounded-full mr-2"></span>
                          {detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              
              {insight.details && (
                <button
                  onClick={() => setExpandedInsight(
                    expandedInsight === insight.id ? null : insight.id
                  )}
                  className="ml-2 text-gray-400 hover:text-gray-600"
                >
                  {expandedInsight === insight.id ? '▼' : '▶'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-xs text-gray-400 border-t pt-3">
        {allInsights.length} insights generated • AI-powered analysis
      </div>
    </div>
  );
}

export default CrystalBallInsights;