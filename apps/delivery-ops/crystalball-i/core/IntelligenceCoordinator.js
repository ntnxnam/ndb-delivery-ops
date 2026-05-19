/**
 * Intelligence Coordinator
 * 
 * Orchestrates multiple AI agents and synthesizes their outputs into
 * coherent responses. Routes queries to appropriate agents and combines
 * their intelligence for comprehensive analysis.
 */

const Logger = require('../utils/Logger');

class IntelligenceCoordinator {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger(config.logLevel || 'info');
        
        this.agents = new Map();
        this.agentCapabilities = new Map();
        this.routingRules = new Map();
        
        this.setupDefaultRoutingRules();
    }
    
    /**
     * Register an AI agent with capabilities
     */
    async registerAgent(agentName, agentInstance, capabilities = []) {
        this.agents.set(agentName, agentInstance);
        
        // Infer capabilities from agent if not provided
        if (capabilities.length === 0) {
            capabilities = this.inferAgentCapabilities(agentName, agentInstance);
        }
        
        this.agentCapabilities.set(agentName, capabilities);
        
        this.logger.info('🤖 Agent registered', { 
            agent: agentName, 
            capabilities 
        });
    }
    
    /**
     * Process a query by routing to appropriate agents
     */
    async processQuery(queryIntent, context) {
        this.logger.info('🎯 Processing query', { 
            intent: queryIntent.type,
            entities: Object.keys(queryIntent.entities)
        });
        
        try {
            // Determine which agents should handle this query
            const relevantAgents = await this.selectRelevantAgents(queryIntent, context);
            
            // Execute agents in parallel or sequence based on dependencies
            const agentResults = await this.executeAgents(relevantAgents, queryIntent, context);
            
            // Synthesize results into coherent response
            const synthesizedResponse = await this.synthesizeResults(
                agentResults, 
                queryIntent, 
                context
            );
            
            this.logger.info('✅ Query processed', { 
                agentsUsed: relevantAgents.map(a => a.name),
                confidence: synthesizedResponse.confidence
            });
            
            return synthesizedResponse;
            
        } catch (error) {
            this.logger.error('❌ Error processing query:', error);
            throw error;
        }
    }
    
    /**
     * Synthesize prediction results from multiple agents
     */
    async synthesizePrediction(analysisComponents) {
        this.logger.info('🔮 Synthesizing prediction from components');
        
        const synthesis = {
            predictedDate: analysisComponents.prediction.predictedDate,
            confidence: analysisComponents.prediction.confidence,
            
            // Combine insights from all agents
            keyFactors: [
                ...analysisComponents.prediction.keyFactors || [],
                ...this.extractVelocityFactors(analysisComponents.velocity || {}),
                ...this.extractNDBContextFactors(analysisComponents.ndbContext || {})
            ],
            
            // Risk assessment from multiple sources
            riskAnalysis: this.combineRiskAnalyses([
                analysisComponents.prediction.riskAnalysis,
                analysisComponents.ndbContext?.riskAnalysis
            ].filter(Boolean)),
            
            // Combined recommendations
            recommendations: this.combineRecommendations([
                analysisComponents.prediction.recommendations,
                this.generateContextualRecommendations(analysisComponents.ndbContext)
            ].filter(Boolean)),
            
            // Methodology explanation
            methodology: 'Multi-agent synthesis with NDB context intelligence',
            
            // Component breakdown for transparency
            components: {
                prediction: analysisComponents.prediction.methodology,
                velocity: analysisComponents.velocity ? 'Team velocity analysis' : null,
                ndbContext: analysisComponents.ndbContext ? 'NDB context intelligence' : null
            },
            
            synthesisTimestamp: new Date()
        };
        
        // Adjust confidence based on component agreement
        synthesis.confidence = this.calculateSynthesisConfidence(analysisComponents);
        
        return synthesis;
    }
    
    /**
     * Setup default routing rules for different query types
     */
    setupDefaultRoutingRules() {
        this.routingRules.set('RELEASE_LANDING', {
            primaryAgents: ['prediction'],
            supportingAgents: ['velocity', 'conversational'],
            requiresNDBContext: true,
            parallel: false
        });
        
        this.routingRules.set('RISK_ASSESSMENT', {
            primaryAgents: ['prediction'],
            supportingAgents: ['conversational'],
            requiresNDBContext: true,
            parallel: true
        });
        
        this.routingRules.set('TEAM_VELOCITY', {
            primaryAgents: ['velocity'],
            supportingAgents: ['conversational'],
            requiresNDBContext: false,
            parallel: true
        });
        
        this.routingRules.set('FEATURE_STATUS', {
            primaryAgents: ['prediction'],
            supportingAgents: ['conversational'],
            requiresNDBContext: true,
            parallel: true
        });
        
        // Default rule for unknown intents
        this.routingRules.set('DEFAULT', {
            primaryAgents: ['conversational'],
            supportingAgents: [],
            requiresNDBContext: false,
            parallel: true
        });
    }
    
    /**
     * Select relevant agents for a query
     */
    async selectRelevantAgents(queryIntent, context) {
        const routingRule = this.routingRules.get(queryIntent.type) || 
                           this.routingRules.get('DEFAULT');
        
        const relevantAgents = [];
        
        // Add primary agents
        for (const agentName of routingRule.primaryAgents) {
            if (this.agents.has(agentName)) {
                relevantAgents.push({
                    name: agentName,
                    agent: this.agents.get(agentName),
                    role: 'primary',
                    capabilities: this.agentCapabilities.get(agentName)
                });
            }
        }
        
        // Add supporting agents
        for (const agentName of routingRule.supportingAgents) {
            if (this.agents.has(agentName)) {
                relevantAgents.push({
                    name: agentName,
                    agent: this.agents.get(agentName),
                    role: 'supporting',
                    capabilities: this.agentCapabilities.get(agentName)
                });
            }
        }
        
        this.logger.debug('Selected agents', { 
            intent: queryIntent.type,
            agents: relevantAgents.map(a => `${a.name}(${a.role})`)
        });
        
        return relevantAgents;
    }
    
    /**
     * Execute agents to get their analysis
     */
    async executeAgents(relevantAgents, queryIntent, context) {
        const results = new Map();
        
        // Separate primary and supporting agents
        const primaryAgents = relevantAgents.filter(a => a.role === 'primary');
        const supportingAgents = relevantAgents.filter(a => a.role === 'supporting');
        
        // Execute primary agents first (they provide core analysis)
        for (const agentInfo of primaryAgents) {
            try {
                this.logger.debug('Executing primary agent', { agent: agentInfo.name });
                
                const result = await this.executeAgent(agentInfo, queryIntent, context);
                results.set(agentInfo.name, {
                    ...result,
                    role: 'primary',
                    executedAt: new Date()
                });
                
            } catch (error) {
                this.logger.error('Primary agent execution failed', {
                    agent: agentInfo.name,
                    error: error.message
                });
                
                results.set(agentInfo.name, {
                    error: error.message,
                    role: 'primary',
                    failed: true
                });
            }
        }
        
        // Execute supporting agents (they enhance/format results)
        for (const agentInfo of supportingAgents) {
            try {
                this.logger.debug('Executing supporting agent', { agent: agentInfo.name });
                
                const result = await this.executeAgent(agentInfo, queryIntent, context, results);
                results.set(agentInfo.name, {
                    ...result,
                    role: 'supporting',
                    executedAt: new Date()
                });
                
            } catch (error) {
                this.logger.error('Supporting agent execution failed', {
                    agent: agentInfo.name,
                    error: error.message
                });
                // Supporting agent failures are non-fatal
            }
        }
        
        return results;
    }
    
    /**
     * Execute individual agent
     */
    async executeAgent(agentInfo, queryIntent, context, priorResults = new Map()) {
        const agent = agentInfo.agent;
        
        // Route to appropriate agent method based on query type and capabilities
        switch (queryIntent.type) {
            case 'RELEASE_LANDING':
                if (agentInfo.name === 'prediction') {
                    return await agent.predictLanding(context);
                } else if (agentInfo.name === 'velocity') {
                    return await agent.analyzeVelocity(context);
                }
                break;
                
            case 'TEAM_VELOCITY':
                if (agentInfo.name === 'velocity') {
                    return await agent.analyzeVelocity(context);
                }
                break;
                
            case 'RISK_ASSESSMENT':
                if (agentInfo.name === 'prediction') {
                    const prediction = await agent.predictLanding(context);
                    return { riskAnalysis: prediction.riskAnalysis };
                }
                break;
        }
        
        // Default: return agent status/capabilities
        return {
            agentType: agentInfo.name,
            capabilities: agentInfo.capabilities,
            status: 'executed'
        };
    }
    
    /**
     * Synthesize results from multiple agents
     */
    async synthesizeResults(agentResults, queryIntent, context) {
        const synthesis = {
            queryIntent: queryIntent.type,
            confidence: 0.5,
            timestamp: new Date(),
            agentsInvolved: Array.from(agentResults.keys())
        };
        
        // Get primary results
        const primaryResults = Array.from(agentResults.values())
            .filter(r => r.role === 'primary' && !r.failed);
        
        if (primaryResults.length === 0) {
            return {
                ...synthesis,
                confidence: 0.1,
                error: 'No primary agents executed successfully'
            };
        }
        
        // Synthesize based on query type
        switch (queryIntent.type) {
            case 'RELEASE_LANDING':
                return await this.synthesizeReleaseLandingResults(
                    agentResults, synthesis, queryIntent, context
                );
                
            case 'TEAM_VELOCITY':
                return await this.synthesizeTeamVelocityResults(
                    agentResults, synthesis, queryIntent, context
                );
                
            case 'RISK_ASSESSMENT':
                return await this.synthesizeRiskAssessmentResults(
                    agentResults, synthesis, queryIntent, context
                );
                
            default:
                return await this.synthesizeGenericResults(
                    agentResults, synthesis, queryIntent, context
                );
        }
    }
    
    /**
     * Synthesize release landing prediction results
     */
    async synthesizeReleaseLandingResults(agentResults, synthesis, queryIntent, context) {
        const predictionResult = agentResults.get('prediction');
        
        if (!predictionResult || predictionResult.failed) {
            synthesis.error = 'Prediction agent failed';
            synthesis.confidence = 0.1;
            return synthesis;
        }
        
        // Core prediction data
        synthesis.predictedDate = predictionResult.predictedDate;
        synthesis.confidence = predictionResult.confidence || 0.5;
        synthesis.keyFactors = predictionResult.keyFactors || [];
        synthesis.riskAnalysis = predictionResult.riskAnalysis || {};
        synthesis.recommendations = predictionResult.recommendations || [];
        
        // Enhance with velocity analysis if available
        const velocityResult = agentResults.get('velocity');
        if (velocityResult && !velocityResult.failed) {
            synthesis.velocityAnalysis = velocityResult;
            synthesis.keyFactors.push(`Team velocity: ${velocityResult.summary || 'analyzed'}`);
        }
        
        // Add methodology
        synthesis.methodology = predictionResult.methodology || 'AI prediction analysis';
        
        return synthesis;
    }
    
    /**
     * Synthesize team velocity results
     */
    async synthesizeTeamVelocityResults(agentResults, synthesis, queryIntent, context) {
        const velocityResult = agentResults.get('velocity');
        
        if (!velocityResult || velocityResult.failed) {
            synthesis.error = 'Velocity agent failed';
            synthesis.confidence = 0.1;
            return synthesis;
        }
        
        synthesis.velocityAnalysis = velocityResult;
        synthesis.confidence = 0.8; // Velocity analysis is typically reliable
        
        return synthesis;
    }
    
    /**
     * Synthesize risk assessment results
     */
    async synthesizeRiskAssessmentResults(agentResults, synthesis, queryIntent, context) {
        const predictionResult = agentResults.get('prediction');
        
        if (!predictionResult || predictionResult.failed) {
            synthesis.error = 'Prediction agent failed';
            synthesis.confidence = 0.1;
            return synthesis;
        }
        
        synthesis.riskAnalysis = predictionResult.riskAnalysis || predictionResult;
        synthesis.confidence = 0.7;
        
        return synthesis;
    }
    
    /**
     * Synthesize generic results
     */
    async synthesizeGenericResults(agentResults, synthesis, queryIntent, context) {
        // Collect all non-failed results
        const validResults = Array.from(agentResults.values())
            .filter(r => !r.failed);
        
        synthesis.results = validResults;
        synthesis.confidence = validResults.length > 0 ? 0.6 : 0.1;
        
        return synthesis;
    }
    
    // Helper methods for synthesis
    
    extractVelocityFactors(velocityAnalysis) {
        const factors = [];
        
        if (velocityAnalysis.averageVelocity) {
            factors.push(`Average velocity: ${velocityAnalysis.averageVelocity} points/sprint`);
        }
        
        if (velocityAnalysis.trend) {
            factors.push(`Velocity trend: ${velocityAnalysis.trend}`);
        }
        
        return factors;
    }
    
    extractNDBContextFactors(ndbContext) {
        const factors = [];
        
        if (ndbContext.insights) {
            factors.push(...ndbContext.insights.map(i => i.message));
        }
        
        return factors;
    }
    
    combineRiskAnalyses(riskAnalyses) {
        const combined = {
            highRiskFeatures: [],
            stuckFeatures: [],
            descopingCandidates: [],
            riskDistribution: { Green: 0, Yellow: 0, Red: 0, 'Not Set': 0 }
        };
        
        for (const analysis of riskAnalyses) {
            if (analysis.highRiskFeatures) {
                combined.highRiskFeatures.push(...analysis.highRiskFeatures);
            }
            if (analysis.stuckFeatures) {
                combined.stuckFeatures.push(...analysis.stuckFeatures);
            }
            if (analysis.descopingCandidates) {
                combined.descopingCandidates.push(...analysis.descopingCandidates);
            }
        }
        
        return combined;
    }
    
    combineRecommendations(recommendationArrays) {
        const combined = [];
        
        for (const recommendations of recommendationArrays) {
            if (Array.isArray(recommendations)) {
                combined.push(...recommendations);
            }
        }
        
        // Remove duplicates
        return [...new Set(combined)];
    }
    
    generateContextualRecommendations(ndbContext) {
        const recommendations = [];
        
        if (ndbContext?.descopingPrediction?.likelyDescopingActions?.length > 0) {
            recommendations.push('Consider proactive scope review with TPM team');
        }
        
        return recommendations;
    }
    
    calculateSynthesisConfidence(analysisComponents) {
        const confidences = [];
        
        if (analysisComponents.prediction?.confidence) {
            confidences.push(analysisComponents.prediction.confidence);
        }
        
        if (analysisComponents.velocity?.confidence) {
            confidences.push(analysisComponents.velocity.confidence);
        }
        
        if (confidences.length === 0) return 0.5;
        
        // Average confidence, slightly boosted for multiple components
        const avgConfidence = confidences.reduce((a, b) => a + b) / confidences.length;
        const multiComponentBoost = confidences.length > 1 ? 0.05 : 0;
        
        return Math.min(avgConfidence + multiComponentBoost, 1.0);
    }
    
    /**
     * Infer agent capabilities from agent name and instance
     */
    inferAgentCapabilities(agentName, agentInstance) {
        const capabilityMap = {
            prediction: ['release_landing', 'risk_assessment', 'date_prediction'],
            velocity: ['team_analysis', 'velocity_tracking', 'capacity_analysis'],
            conversational: ['natural_language', 'response_generation', 'query_parsing'],
            learning: ['pattern_recognition', 'model_improvement', 'accuracy_tracking']
        };
        
        return capabilityMap[agentName] || ['generic_analysis'];
    }
    
    /**
     * Get health status
     */
    async getHealth() {
        const agentHealth = {};
        
        for (const [name, agent] of this.agents) {
            try {
                agentHealth[name] = await agent.getHealth();
            } catch (error) {
                agentHealth[name] = { status: 'error', error: error.message };
            }
        }
        
        return {
            registeredAgents: this.agents.size,
            routingRules: this.routingRules.size,
            agentHealth,
            status: 'healthy'
        };
    }
}

module.exports = IntelligenceCoordinator;