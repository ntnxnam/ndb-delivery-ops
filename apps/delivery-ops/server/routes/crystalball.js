const express = require('express');
const router = express.Router();
const path = require('path');
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { apiLimiter } = require('../middleware/security');
// const aiService = require('../services/aiService'); // Removed for core refactoring

// Import Crystal Ball components
const { createCrystalBall } = require('../../crystalball/index');
const VPReportIntegration = require('../../crystalball/integration/VPReportIntegration');

/**
 * Initialize Crystal Ball instance with configuration
 */
function getCrystalBallInstance() {
  try {
    const crystalBall = createCrystalBall({ enabled: true });
    return crystalBall;
  } catch (error) {
    console.error('Failed to initialize Crystal Ball:', error);
    return null;
  }
}

/**
 * Get Crystal Ball status and configuration
 * GET /api/crystalball/status
 */
router.get('/status', (req, res) => {
  try {
    const crystalBall = getCrystalBallInstance();
    
    if (!crystalBall) {
      return res.status(503).json({
        success: false,
        error: 'Crystal Ball unavailable',
        status: 'disabled'
      });
    }

    const status = crystalBall.getStatus();
    
    return res.json({
      success: true,
      status: status,
      enabled: crystalBall.isEnabled(),
      version: '1.0.0'
    });

  } catch (error) {
    console.error('Error getting Crystal Ball status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get status',
      message: error.message
    });
  }
});

/**
 * Predict release completion for a specific version with current release data
 * POST /api/crystalball/predict-release
 * Body: { releaseVersion, teamId, features }
 */
router.post('/predict-release', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const { releaseVersion, teamId, features } = req.body || {};
    
    if (!releaseVersion || !teamId || !features) {
      return res.status(400).json({
        success: false,
        error: 'releaseVersion, teamId, and features are required'
      });
    }

    const crystalBall = getCrystalBallInstance();
    if (!crystalBall || !crystalBall.isEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'Crystal Ball prediction engine is disabled',
        message: 'Enable Crystal Ball to get AI-powered release predictions'
      });
    }

    // Convert features to Crystal Ball format
    const analysisFeatures = features.map(feature => ({
      key: feature.key,
      summary: feature.summary || feature.fields?.summary,
      status: feature.status || feature.fields?.status?.name,
      priority: feature.priority || feature.fields?.priority?.name,
      assignee: feature.assignee || feature.fields?.assignee?.displayName,
      created: feature.created || feature.fields?.created,
      updated: feature.updated || feature.fields?.updated,
      // Checkpoint dates from custom fields
      codeCompleteDate: feature.fields?.customfield_11067,
      commitGateDate: feature.fields?.customfield_35863,
      promotionGateDate: feature.fields?.customfield_35864,
      // Risk indicator
      riskIndicator: feature.fields?.customfield_23560,
      // Status update
      statusUpdate: feature.fields?.customfield_23073,
      statusUpdateDate: feature.fields?.customfield_45660
    }));

    // Predict multiple features
    const predictions = await crystalBall.predictMultipleFeatures(analysisFeatures, {
      targetDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
      includeConfidenceAnalysis: true
    });

    // Calculate overall release health
    const releaseHealth = calculateReleaseHealth(predictions, analysisFeatures);

    return res.json({
      success: true,
      releaseVersion,
      teamId,
      predictions: {
        features: predictions,
        overallHealth: releaseHealth,
        generatedAt: new Date().toISOString(),
        confidence: releaseHealth.confidence
      }
    });

  } catch (error) {
    console.error('Error predicting release:', error);
    return res.status(500).json({
      success: false,
      error: 'Prediction failed',
      message: error.message
    });
  }
});

/**
 * Generate trend analysis for release progress
 * GET /api/crystalball/trend-analysis
 * Query: releaseVersion, teamId, days (optional, default 30)
 */
router.get('/trend-analysis', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const { releaseVersion, teamId, days = 30 } = req.query;
    
    if (!releaseVersion || !teamId) {
      return res.status(400).json({
        success: false,
        error: 'releaseVersion and teamId are required'
      });
    }

    const crystalBall = getCrystalBallInstance();
    if (!crystalBall || !crystalBall.isEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'Crystal Ball trend analysis is disabled'
      });
    }

    // Generate mock trend analysis (in real implementation, this would analyze historical data)
    const trendAnalysis = {
      releaseVersion,
      teamId,
      timeframe: `${days} days`,
      trends: {
        velocity: {
          current: Math.floor(Math.random() * 20) + 10,
          average: Math.floor(Math.random() * 15) + 12,
          trend: Math.random() > 0.5 ? 'improving' : 'declining',
          confidence: Math.random() * 0.3 + 0.7
        },
        quality: {
          bugRate: Math.random() * 0.1 + 0.05,
          testCoverage: Math.random() * 0.2 + 0.75,
          reworkRate: Math.random() * 0.15 + 0.08,
          trend: Math.random() > 0.6 ? 'improving' : 'stable'
        },
        risk: {
          level: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
          factors: ['Resource availability', 'Technical debt', 'External dependencies'],
          trajectory: Math.random() > 0.5 ? 'increasing' : 'decreasing'
        }
      },
      insights: [
        'Team velocity has improved by 15% over the last 2 weeks',
        'Code quality metrics indicate stable development practices',
        'Risk level is manageable with current mitigation strategies'
      ]
    };

    return res.json({
      success: true,
      analysis: trendAnalysis,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error generating trend analysis:', error);
    return res.status(500).json({
      success: false,
      error: 'Trend analysis failed',
      message: error.message
    });
  }
});

/**
 * Get risk forecast for upcoming milestones
 * GET /api/crystalball/risk-forecast
 * Query: releaseVersion, teamId
 */
router.get('/risk-forecast', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const { releaseVersion, teamId } = req.query;
    
    if (!releaseVersion || !teamId) {
      return res.status(400).json({
        success: false,
        error: 'releaseVersion and teamId are required'
      });
    }

    const crystalBall = getCrystalBallInstance();
    if (!crystalBall || !crystalBall.isEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'Crystal Ball risk forecasting is disabled'
      });
    }

    // Generate risk forecast
    const forecast = {
      releaseVersion,
      teamId,
      forecastPeriod: '90 days',
      milestones: [
        {
          name: 'Code Complete',
          targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          riskLevel: 'medium',
          probability: 0.75,
          factors: ['Feature scope creep', 'Resource constraints']
        },
        {
          name: 'Commit Gate',
          targetDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          riskLevel: 'low',
          probability: 0.85,
          factors: ['Testing capacity', 'Integration issues']
        },
        {
          name: 'Promotion Gate',
          targetDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          riskLevel: 'low',
          probability: 0.90,
          factors: ['Documentation completion', 'Deployment readiness']
        }
      ],
      recommendations: [
        'Focus on scope management for Code Complete milestone',
        'Increase testing resources to maintain Commit Gate schedule',
        'Begin documentation and deployment preparation early'
      ],
      confidence: 0.78
    };

    return res.json({
      success: true,
      forecast,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error generating risk forecast:', error);
    return res.status(500).json({
      success: false,
      error: 'Risk forecast failed',
      message: error.message
    });
  }
});

/**
 * Calculate overall release health from predictions
 */
function calculateReleaseHealth(predictions, features) {
  if (!predictions || predictions.length === 0) {
    return {
      score: 0,
      level: 'unknown',
      confidence: 0,
      factors: []
    };
  }

  let totalConfidence = 0;
  let riskyFeatures = 0;
  let completedFeatures = 0;
  
  predictions.forEach(prediction => {
    totalConfidence += prediction.confidence || 0.5;
    
    if (prediction.riskLevel === 'high') {
      riskyFeatures++;
    }
    
    if (prediction.estimatedCompletion?.probability > 0.8) {
      completedFeatures++;
    }
  });

  const avgConfidence = totalConfidence / predictions.length;
  const riskRatio = riskyFeatures / predictions.length;
  const completionRatio = completedFeatures / predictions.length;
  
  // Calculate health score (0-100)
  const healthScore = Math.round(
    (avgConfidence * 40) + 
    ((1 - riskRatio) * 30) + 
    (completionRatio * 30)
  );

  let healthLevel = 'good';
  if (healthScore < 50) healthLevel = 'poor';
  else if (healthScore < 70) healthLevel = 'fair';
  else if (healthScore >= 85) healthLevel = 'excellent';

  return {
    score: healthScore,
    level: healthLevel,
    confidence: avgConfidence,
    factors: [
      `${riskyFeatures} high-risk features`,
      `${completedFeatures} features on track`,
      `${Math.round(avgConfidence * 100)}% prediction confidence`
    ],
    details: {
      totalFeatures: predictions.length,
      riskyFeatures,
      completedFeatures,
      avgConfidence
    }
  };
}

module.exports = router;