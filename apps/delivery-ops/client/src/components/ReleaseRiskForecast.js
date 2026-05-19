import React from 'react';

function ReleaseRiskForecast({ forecast, loading, error }) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <span className="mr-2">🔮</span>
          AI Risk Forecast
        </h3>
        <div className="flex justify-center items-center h-32">
          <div className="text-gray-500">Analyzing risk factors...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <span className="mr-2">🔮</span>
          AI Risk Forecast
        </h3>
        <div className="bg-red-50 border border-red-200 rounded p-3">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!forecast) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <span className="mr-2">🔮</span>
          AI Risk Forecast
        </h3>
        <div className="text-center text-gray-500 py-8">
          <p>Select a release version to generate risk forecast</p>
        </div>
      </div>
    );
  }

  const getRiskColor = (level) => {
    switch (level) {
      case 'low': return 'text-green-600 bg-green-100';
      case 'medium': return 'text-yellow-600 bg-yellow-100';
      case 'high': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getProbabilityColor = (probability) => {
    if (probability >= 0.8) return 'text-green-600';
    if (probability >= 0.6) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="bg-white rounded-lg p-6 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold flex items-center">
          <span className="mr-2">🔮</span>
          AI Risk Forecast
        </h3>
        <div className="text-xs text-gray-500">
          Confidence: {Math.round((forecast.confidence || 0) * 100)}%
        </div>
      </div>

      {/* Milestones */}
      <div className="space-y-4 mb-6">
        <h4 className="font-medium text-gray-900">Upcoming Milestones</h4>
        {forecast.milestones?.map((milestone, index) => (
          <div key={index} className="border rounded-lg p-4">
            <div className="flex justify-between items-start mb-2">
              <div>
                <h5 className="font-medium">{milestone.name}</h5>
                <p className="text-sm text-gray-600">
                  Target: {new Date(milestone.targetDate).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <span className={`px-2 py-1 rounded text-xs ${getRiskColor(milestone.riskLevel)}`}>
                  {milestone.riskLevel} risk
                </span>
                <p className={`text-sm font-medium mt-1 ${getProbabilityColor(milestone.probability)}`}>
                  {Math.round(milestone.probability * 100)}% likely
                </p>
              </div>
            </div>
            
            {milestone.factors && milestone.factors.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-gray-500 mb-1">Risk factors:</p>
                <ul className="text-xs text-gray-600">
                  {milestone.factors.map((factor, factorIndex) => (
                    <li key={factorIndex} className="flex items-center">
                      <span className="w-1 h-1 bg-gray-400 rounded-full mr-2"></span>
                      {factor}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Recommendations */}
      {forecast.recommendations && forecast.recommendations.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">AI Recommendations</h4>
          <div className="space-y-2">
            {forecast.recommendations.map((rec, index) => (
              <div key={index} className="flex items-start bg-blue-50 rounded p-3">
                <span className="text-blue-600 mr-2 mt-0.5">💡</span>
                <p className="text-sm text-blue-800">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-400 border-t pt-3">
        Generated: {forecast.generatedAt ? new Date(forecast.generatedAt).toLocaleString() : 'Unknown'}
        {forecast.forecastPeriod && ` • Forecast period: ${forecast.forecastPeriod}`}
      </div>
    </div>
  );
}

export default ReleaseRiskForecast;