/**
 * VooDoo Integration
 * 
 * Integration layer between CrystalBallI and VooDoo application.
 * Provides React components, API endpoints, and WebSocket connections
 * for seamless integration of conversational AI into VooDoo.
 */

const express = require('express');
const WebSocket = require('ws');
const CrystalBallI = require('../core/CrystalBallI');
const Logger = require('../utils/Logger');

class VooDooIntegration {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger(config.logLevel || 'info');
        
        // Initialize CrystalBallI instance
        this.crystalBallI = new CrystalBallI({
            team: 'NDB',
            enabled: true,
            learningEnabled: true,
            ...config.crystalBallI
        });
        
        this.activeConnections = new Map();
        this.conversationSessions = new Map();
        
        this.logger.info('🔗 VooDoo Integration initialized');
    }
    
    async initialize() {
        await this.crystalBallI.initialize();
        this.logger.info('✅ VooDoo Integration ready');
    }
    
    /**
     * Create Express router with CrystalBallI endpoints
     */
    createAPIRouter() {
        const router = express.Router();
        
        // Chat endpoint - main conversational interface
        router.post('/chat', async (req, res) => {
            try {
                const { question, context = {} } = req.body;
                
                if (!question) {
                    return res.status(400).json({
                        error: 'Question is required',
                        example: { question: "When will this release land?" }
                    });
                }
                
                this.logger.info('💬 Chat request', { question, context });
                
                // Enhance context with VooDoo-specific data
                const enhancedContext = await this.buildVooDooContext(context, req);
                
                // Process with CrystalBallI
                const response = await this.crystalBallI.ask(question, enhancedContext);
                
                // Format response for VooDoo UI
                const voodooResponse = this.formatResponseForVooDoo(response, context);
                
                res.json(voodooResponse);
                
            } catch (error) {
                this.logger.error('❌ Chat error:', error);
                res.status(500).json({
                    error: 'Failed to process question',
                    message: error.message,
                    fallback: "I'm experiencing technical difficulties. Please try again."
                });
            }
        });
        
        // Prediction endpoint - specific release predictions
        router.post('/predict-release', async (req, res) => {
            try {
                const { releaseVersion, targetDate, features = [] } = req.body;
                
                if (!releaseVersion) {
                    return res.status(400).json({
                        error: 'Release version is required',
                        example: { releaseVersion: 'NDB-2.11' }
                    });
                }
                
                this.logger.info('🎯 Release prediction request', { releaseVersion, targetDate });
                
                const releaseContext = {
                    releaseVersion,
                    targetDate: targetDate || this.inferTargetDate(releaseVersion),
                    features,
                    timestamp: new Date()
                };
                
                const prediction = await this.crystalBallI.predictReleaseLanding(
                    releaseVersion,
                    releaseContext.targetDate,
                    releaseContext
                );
                
                res.json({
                    success: true,
                    prediction,
                    requestId: this.generateRequestId()
                });
                
            } catch (error) {
                this.logger.error('❌ Prediction error:', error);
                res.status(500).json({
                    error: 'Failed to generate prediction',
                    message: error.message
                });
            }
        });
        
        // Status endpoint - CrystalBallI health and metrics
        router.get('/status', async (req, res) => {
            try {
                const status = await this.crystalBallI.getStatus();
                
                res.json({
                    crystalBallI: status,
                    voodooIntegration: {
                        activeConnections: this.activeConnections.size,
                        conversationSessions: this.conversationSessions.size,
                        uptime: process.uptime()
                    },
                    timestamp: new Date()
                });
                
            } catch (error) {
                this.logger.error('❌ Status error:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        // Learning endpoint - update intelligence
        router.post('/learn', async (req, res) => {
            try {
                const { domain, intelligence } = req.body;
                
                if (!domain || !intelligence) {
                    return res.status(400).json({
                        error: 'Domain and intelligence data required',
                        example: {
                            domain: 'field_semantics',
                            intelligence: { 'new-field': 'meaning' }
                        }
                    });
                }
                
                const result = await this.crystalBallI.updateIntelligence(domain, intelligence);
                
                res.json({
                    success: true,
                    result,
                    message: 'Intelligence updated successfully'
                });
                
            } catch (error) {
                this.logger.error('❌ Learning error:', error);
                res.status(500).json({
                    error: 'Failed to update intelligence',
                    message: error.message
                });
            }
        });
        
        return router;
    }
    
    /**
     * Create WebSocket server for real-time updates
     */
    createWebSocketServer(server) {
        const wss = new WebSocket.Server({ 
            server,
            path: '/crystalball-i/ws'
        });
        
        wss.on('connection', (ws, req) => {
            const connectionId = this.generateConnectionId();
            this.activeConnections.set(connectionId, {
                ws,
                connectedAt: new Date(),
                lastActivity: new Date()
            });
            
            this.logger.info('🔌 WebSocket connected', { connectionId });
            
            // Send welcome message
            ws.send(JSON.stringify({
                type: 'connection',
                message: 'Connected to CrystalBallI',
                connectionId,
                capabilities: ['chat', 'predictions', 'real-time-updates']
            }));
            
            // Handle incoming messages
            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    await this.handleWebSocketMessage(connectionId, data, ws);
                } catch (error) {
                    this.logger.error('❌ WebSocket message error:', error);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Failed to process message',
                        error: error.message
                    }));
                }
            });
            
            // Handle disconnection
            ws.on('close', () => {
                this.activeConnections.delete(connectionId);
                this.logger.info('🔌 WebSocket disconnected', { connectionId });
            });
            
            ws.on('error', (error) => {
                this.logger.error('❌ WebSocket error:', error);
                this.activeConnections.delete(connectionId);
            });
        });
        
        this.logger.info('🌐 WebSocket server created');
        return wss;
    }
    
    /**
     * Handle WebSocket messages
     */
    async handleWebSocketMessage(connectionId, data, ws) {
        const connection = this.activeConnections.get(connectionId);
        if (!connection) return;
        
        connection.lastActivity = new Date();
        
        switch (data.type) {
            case 'chat':
                await this.handleWebSocketChat(connectionId, data, ws);
                break;
                
            case 'subscribe_release':
                await this.handleReleaseSubscription(connectionId, data, ws);
                break;
                
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', timestamp: new Date() }));
                break;
                
            default:
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Unknown message type: ${data.type}`
                }));
        }
    }
    
    /**
     * Handle real-time chat via WebSocket
     */
    async handleWebSocketChat(connectionId, data, ws) {
        try {
            const { question, context = {} } = data;
            
            // Send typing indicator
            ws.send(JSON.stringify({
                type: 'typing',
                message: 'CrystalBallI is thinking...'
            }));
            
            // Process question
            const enhancedContext = await this.buildVooDooContext(context);
            enhancedContext.connectionId = connectionId;
            
            const response = await this.crystalBallI.ask(question, enhancedContext);
            
            // Send response
            ws.send(JSON.stringify({
                type: 'chat_response',
                response: this.formatResponseForVooDoo(response, context),
                timestamp: new Date()
            }));
            
        } catch (error) {
            this.logger.error('❌ WebSocket chat error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to process chat message',
                error: error.message
            }));
        }
    }
    
    /**
     * Build VooDoo-specific context from request
     */
    async buildVooDooContext(inputContext, req = null) {
        const context = {
            source: 'voodoo',
            team: 'NDB',
            timestamp: new Date(),
            ...inputContext
        };
        
        // Add user context if available
        if (req && req.user) {
            context.user = {
                username: req.user.username,
                role: this.determineUserRole(req.user.username)
            };
        }
        
        // Extract JIRA credentials from request headers for API calls
        if (req) {
            context.jiraCredentials = {
                token: req.headers['x-jira-token'] || req.headers['authorization'] || '',
                username: req.headers['x-username'] || req.headers['x-jira-username'] || ''
            };
        }
        
        // Add release context if available
        if (inputContext.releaseVersion) {
            this.logger.info('🔍 Processing release context', { 
                releaseVersion: inputContext.releaseVersion,
                hasFeatures: !!(inputContext.features),
                featureCount: inputContext.features ? inputContext.features.length : 0,
                featuresType: typeof inputContext.features
            });
            
            // If features are already provided in context, use them directly
            if (inputContext.features && inputContext.features.length > 0) {
                context.releaseContext = {
                    releaseVersion: inputContext.releaseVersion,
                    targetDate: inputContext.targetDate || this.inferTargetDate(inputContext.releaseVersion),
                    features: inputContext.features,
                    team: 'NDB',
                    contextBuiltAt: new Date(),
                    dataSource: 'voodoo_frontend'
                };
                this.logger.info('✅ Using features from frontend context', { 
                    releaseVersion: inputContext.releaseVersion, 
                    featureCount: inputContext.features.length 
                });
            } else {
                this.logger.info('⚠️  No features in context, fetching from JIRA', {
                    hasFeatures: !!(inputContext.features),
                    featureCount: inputContext.features ? inputContext.features.length : 0
                });
                // Fallback to fetching from JIRA
                context.releaseContext = await this.buildReleaseContext(inputContext.releaseVersion, context.jiraCredentials);
            }
        }
        
        // Add conversation continuity
        if (inputContext.conversationId) {
            const session = this.conversationSessions.get(inputContext.conversationId);
            if (session) {
                context.conversationHistory = session.history;
            }
        }
        
        return context;
    }
    
    /**
     * Format AI response for VooDoo UI
     */
    formatResponseForVooDoo(response, originalContext) {
        return {
            answer: response.answer,
            confidence: Math.round(response.confidence * 100),
            reasoning: response.reasoning,
            
            // UI-friendly sections
            keyInsights: this.extractKeyInsights(response),
            recommendations: response.actionableInsights || [],
            followUpQuestions: response.followUpQuestions || [],
            
            // Metadata for VooDoo
            intent: response.intent,
            conversationId: response.conversationId,
            timestamp: response.timestamp,
            
            // UI styling hints
            confidenceLevel: this.getConfidenceLevel(response.confidence),
            urgency: this.assessResponseUrgency(response),
            
            // Additional context
            sources: ['CrystalBallI', 'NDB Context Intelligence', 'VooDoo JIRA Data'],
            canAskFollowUp: true
        };
    }
    
    /**
     * Extract key insights for UI display
     */
    extractKeyInsights(response) {
        const insights = [];
        
        // Extract from answer text
        const lines = response.answer.split('\n');
        for (const line of lines) {
            if (line.includes('**') || line.includes('•') || line.includes('⚠️')) {
                insights.push({
                    text: line.replace(/[*•⚠️]/g, '').trim(),
                    type: this.classifyInsightType(line)
                });
            }
        }
        
        return insights.slice(0, 5); // Max 5 key insights
    }
    
    classifyInsightType(text) {
        if (text.includes('risk') || text.includes('⚠️') || text.includes('concern')) return 'risk';
        if (text.includes('recommend') || text.includes('📋')) return 'recommendation';
        if (text.includes('predict') || text.includes('will')) return 'prediction';
        return 'insight';
    }
    
    getConfidenceLevel(confidence) {
        if (confidence >= 0.8) return 'high';
        if (confidence >= 0.6) return 'medium';
        return 'low';
    }
    
    assessResponseUrgency(response) {
        const text = response.answer.toLowerCase();
        
        if (text.includes('immediate') || text.includes('urgent') || text.includes('critical')) {
            return 'high';
        }
        
        if (text.includes('soon') || text.includes('watch') || text.includes('concern')) {
            return 'medium';
        }
        
        return 'low';
    }
    
    /**
     * Build release context for analysis
     */
    async buildReleaseContext(releaseVersion, jiraCredentials = {}) {
        try {
            this.logger.info('🔍 Building release context', { releaseVersion });
            
            // Use VooDoo's existing JIRA integration to fetch real data
            const axios = require('axios');
            
            // Get JIRA credentials from context or environment
            const jiraToken = jiraCredentials.token || process.env.JIRA_TOKEN || '';
            const username = jiraCredentials.username || process.env.JIRA_USERNAME || process.env.username || '';
            
            if (!jiraToken) {
                this.logger.warn('⚠️  No JIRA token available, using mock data');
                return this.createMockReleaseContext(releaseVersion);
            }
            
            // Call VooDoo's existing release items endpoint
            const response = await axios.post('http://localhost:6001/api/jira/release-items-commit', {
                fixVersion: releaseVersion
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${jiraToken}`,
                    'X-Username': username
                },
                timeout: 10000
            });
            
            if (response.data && response.data.success) {
                const features = response.data.data?.items || [];
                this.logger.info('✅ Fetched real JIRA data', { 
                    releaseVersion, 
                    featureCount: features.length 
                });
                
                return {
                    releaseVersion,
                    targetDate: this.inferTargetDate(releaseVersion),
                    features,
                    team: 'NDB',
                    contextBuiltAt: new Date(),
                    dataSource: 'voodoo_jira'
                };
            } else {
                throw new Error(`JIRA API returned error: ${response.data?.error || 'Unknown error'}`);
            }
            
        } catch (error) {
            this.logger.error('❌ Failed to fetch JIRA data:', error.message);
            
            // Return mock data as fallback
            return this.createMockReleaseContext(releaseVersion);
        }
    }
    
    /**
     * Create mock release context when JIRA data is unavailable
     */
    createMockReleaseContext(releaseVersion) {
        return {
            releaseVersion,
            targetDate: this.inferTargetDate(releaseVersion),
            features: [], // Empty for now - CrystalBallI will indicate limited data
            team: 'NDB',
            contextBuiltAt: new Date(),
            dataSource: 'mock',
            limitedData: true
        };
    }
    
    /**
     * Determine user role based on username
     */
    determineUserRole(username) {
        const tpmUsers = ['namratha.singh', 'sneha.xyz'];
        
        if (tpmUsers.includes(username)) {
            return 'TPM';
        }
        
        // Could extend with more sophisticated role detection
        return 'Developer';
    }
    
    /**
     * Infer target date from release version
     */
    inferTargetDate(releaseVersion) {
        // Simple heuristic - in real implementation would look up actual dates
        const match = releaseVersion.match(/(\d+)\.(\d+)/);
        if (match) {
            const major = parseInt(match[1]);
            const minor = parseInt(match[2]);
            
            // Assume releases every ~3 months
            const date = new Date();
            date.setMonth(date.getMonth() + 2);
            return date.toISOString().split('T')[0];
        }
        
        return new Date().toISOString().split('T')[0];
    }
    
    // Utility methods
    
    generateConnectionId() {
        return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Broadcast updates to subscribed connections
     */
    broadcastUpdate(releaseVersion, update) {
        for (const [connectionId, connection] of this.activeConnections) {
            if (connection.subscribedReleases?.includes(releaseVersion)) {
                connection.ws.send(JSON.stringify({
                    type: 'release_update',
                    releaseVersion,
                    update,
                    timestamp: new Date()
                }));
            }
        }
    }
    
    /**
     * Cleanup inactive connections
     */
    cleanupConnections() {
        const now = new Date();
        const timeoutMs = 30 * 60 * 1000; // 30 minutes
        
        for (const [connectionId, connection] of this.activeConnections) {
            if (now - connection.lastActivity > timeoutMs) {
                connection.ws.close();
                this.activeConnections.delete(connectionId);
                this.logger.info('🧹 Cleaned up inactive connection', { connectionId });
            }
        }
    }
    
    async cleanup() {
        // Close all WebSocket connections
        for (const [connectionId, connection] of this.activeConnections) {
            connection.ws.close();
        }
        this.activeConnections.clear();
        
        // Cleanup CrystalBallI
        if (this.crystalBallI) {
            await this.crystalBallI.cleanup();
        }
        
        this.logger.info('✅ VooDoo Integration cleanup complete');
    }
}

module.exports = VooDooIntegration;