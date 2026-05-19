import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

function ReleaseDatePrediction({ predictions, loading, error }) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <span className="mr-2">📊</span>
          AI Completion Predictions
        </h3>
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-500">Analyzing feature completion patterns...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <span className="mr-2">📊</span>
          AI Completion Predictions
        </h3>
        <div className="bg-red-50 border border-red-200 rounded p-3">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!predictions || !predictions.features || predictions.features.length === 0) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <span className="mr-2">📊</span>
          AI Completion Predictions
        </h3>
        <div className="text-center text-gray-500 py-8">
          <p>Load release data to generate completion predictions</p>
        </div>
      </div>
    );
  }

  // Prepare data for visualizations
  const completionData = predictions.features.map(feature => ({
    name: feature.key || 'Unknown',
    probability: Math.round((feature.estimatedCompletion?.probability || 0) * 100),
    confidence: Math.round((feature.confidence || 0) * 100),
    riskLevel: feature.riskLevel || 'unknown'
  }));

  // Risk distribution for pie chart
  const riskCounts = { low: 0, medium: 0, high: 0, unknown: 0 };
  predictions.features.forEach(feature => {
    const risk = feature.riskLevel || 'unknown';
    riskCounts[risk]++;
  });

  const riskData = Object.entries(riskCounts)
    .filter(([_, count]) => count > 0)
    .map(([risk, count]) => ({
      name: risk.charAt(0).toUpperCase() + risk.slice(1),
      value: count,
      percentage: Math.round((count / predictions.features.length) * 100)
    }));

  const RISK_COLORS = {
    'Low': '#22c55e',
    'Medium': '#eab308', 
    'High': '#ef4444',
    'Unknown': '#94a3b8'
  };

  // Overall health metrics
  const healthMetrics = predictions.overallHealth || {};
  const healthScore = healthMetrics.score || 0;
  const healthLevel = healthMetrics.level || 'unknown';

  const getHealthColor = (level) => {
    switch (level) {
      case 'excellent': return 'text-green-600 bg-green-100';
      case 'good': return 'text-green-600 bg-green-100';
      case 'fair': return 'text-yellow-600 bg-yellow-100';
      case 'poor': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="bg-white rounded-lg p-6 shadow-sm">
      <div className="flex justify-between items-start mb-6">
        <h3 className="text-lg font-semibold flex items-center">
          <span className="mr-2">📊</span>
          AI Completion Predictions
        </h3>
        <div className="text-right">
          <div className={`px-3 py-1 rounded text-sm font-medium ${getHealthColor(healthLevel)}`}>
            Health: {healthLevel} ({healthScore}/100)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Risk Distribution Pie Chart */}
        <div>
          <h4 className="font-medium mb-3">Risk Distribution</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={riskData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {riskData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={RISK_COLORS[entry.name]} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value, name, props) => [
                    `${value} features (${props.payload.percentage}%)`,
                    `${name} Risk`
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center mt-2 space-x-4">
            {riskData.map((item, index) => (
              <div key={index} className="flex items-center text-xs">
                <div 
                  className="w-3 h-3 rounded mr-1"
                  style={{ backgroundColor: RISK_COLORS[item.name] }}
                ></div>
                <span>{item.name}: {item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Feature Completion Probabilities */}
        <div>
          <h4 className="font-medium mb-3">Completion Probability (Top 5)</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={completionData.slice(0, 5)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="name" 
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  fontSize={10}
                />
                <YAxis 
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                  fontSize={10}
                />
                <Tooltip 
                  formatter={(value) => [`${value}%`, 'Completion Probability']}
                  labelFormatter={(label) => `Feature: ${label}`}
                />
                <Bar 
                  dataKey="probability" 
                  fill="#3b82f6"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Health Factors */}
      {healthMetrics.factors && healthMetrics.factors.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <h4 className="font-medium mb-3">Health Factors</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {healthMetrics.factors.map((factor, index) => (
              <div key={index} className="bg-gray-50 rounded p-3">
                <p className="text-sm text-gray-700">{factor}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confidence and Generation Info */}
      <div className="mt-4 text-xs text-gray-400 border-t pt-3 flex justify-between">
        <span>
          Analyzed {predictions.features.length} features
        </span>
        <span>
          Confidence: {Math.round((predictions.confidence || 0) * 100)}%
        </span>
      </div>
    </div>
  );
}

export default ReleaseDatePrediction;