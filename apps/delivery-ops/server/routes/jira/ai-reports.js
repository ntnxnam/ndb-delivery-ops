const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const aiReportService = require('../../services/aiReportService');

const naiHttpsAgent = new https.Agent({ rejectUnauthorized: false });

// Use validateJiraTokenMiddleware consistently throughout this file

/**
 * Simple diagnostic endpoint to test basic JIRA connectivity
 */
router.post('/validate-nai-key', async (req, res) => {
  try {
    console.log('[validate-nai-key] Request received');
    
    const { apiKey } = req.body;

    if (!apiKey || apiKey.trim() === '') {
      console.log('[validate-nai-key] ERROR: No API key provided');
      return res.status(400).json({
        success: false,
        error: 'NAI API key is required'
      });
    }

    console.log('[validate-nai-key] Testing NAI API key...');
    
    // Test the API key with a simple request
    const testResponse = await axios.post(
      'https://dpro-nai.corp.p10y.ntnxdpro.com/enterpriseai/v1/chat/completions',
      {
        model: 'eng-pool-05', // Default model for Nutanix NAI, other APIs may ignore this
        messages: [
          {
            role: 'user',
            content: 'Test connection - respond with "OK"'
          }
        ],
        max_tokens: 10,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000,
        httpsAgent: naiHttpsAgent
      }
    );

    if (testResponse.status === 200 && testResponse.data?.choices?.length > 0) {
      console.log('[validate-nai-key] NAI API key validated successfully');
      return res.json({
        success: true,
        message: 'NAI API key is valid'
      });
    } else {
      console.log('[validate-nai-key] NAI API returned unexpected response:', testResponse.status);
      return res.status(400).json({
        success: false,
        error: 'NAI API key validation failed - unexpected response'
      });
    }

  } catch (error) {
    console.error('[validate-nai-key] Error validating NAI API key:', error.message);
    
    // Handle specific error types
    if (error.response?.status === 401) {
      return res.status(400).json({
        success: false,
        error: 'Invalid NAI API key - authentication failed'
      });
    } else if (error.response?.status === 403) {
      return res.status(400).json({
        success: false,
        error: 'NAI API key does not have required permissions'
      });
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(500).json({
        success: false,
        error: 'Unable to reach NAI API - network connectivity issue'
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'NAI API key validation failed',
        message: error.message
      });
    }
  }
});

/**
 * Generate AI Team Executive Report using NAI API
 * POST /api/jira/generate-ai-vp-report
 * 
 * Generates a comprehensive Team Executive executive report using NAI LLM and existing executive summary data
 */

router.post('/generate-ai-vp-report', validateJiraTokenMiddleware, async (req, res) => {
  try {
    console.log('[generate-ai-vp-report] Request received');

    const { version, naiApiKey } = req.body;
    
    if (!version || version.trim() === '') {
      console.log('[generate-ai-vp-report] ERROR: No version parameter provided');
      return res.status(400).json({
        success: false,
        error: 'version parameter is required'
      });
    }

    if (!naiApiKey || naiApiKey.trim() === '') {
      console.log('[generate-ai-vp-report] ERROR: No NAI API key provided');
      return res.status(400).json({
        success: false,
        error: 'NAI API key is required'
      });
    }

    const jiraToken = req.headers.authorization?.replace('Bearer ', '');
    const data = await aiReportService.generateAiVpReport({ version, naiApiKey, jiraToken });
    return res.json({ success: true, data });

  } catch (error) {
    console.error('[generate-ai-vp-report] Error generating AI Team Executive report:', error.message);
    
    if (error.response?.status === 401) {
      return res.status(400).json({
        success: false,
        error: 'Invalid NAI API key'
      });
    } else if (error.response?.status === 429) {
      return res.status(429).json({
        success: false,
        error: 'NAI API rate limit exceeded - please try again later'
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate AI Team Executive report',
        message: error.message
      });
    }
  }
});

module.exports = router;
