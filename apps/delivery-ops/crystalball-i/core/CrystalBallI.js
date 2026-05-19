/**
 * CrystalBallI - Main AI-Powered Release Prediction Orchestrator
 * 
 * The central intelligence coordinator for conversational release prediction.
 * Orchestrates specialized AI agents to provide intelligent, context-aware responses.
 * Built from scratch for NDB team intelligence with self-learning capabilities.
 */

const IntelligenceCoordinator = require('./IntelligenceCoordinator');
const ContextManager = require('./ContextManager');
const ConversationalAgent = require('../ai-agents/ConversationalAgent');
const ReleasePredictionAgent = require('../ai-agents/ReleasePredictionAgent');
const TeamVelocityAgent = require('../ai-agents/TeamVelocityAgent');
const LearningAgent = require('../ai-agents/LearningAgent');
const NDBContextIntelligence = require('../intelligence/NDBContextIntelligence');
const Logger = require('../utils/Logger');

class CrystalBallI {
    constructor(config = {}) {
        this.config = {
            team: config.team || 'NDB',
            enabled: config.enabled !== false,
            learningEnabled: config.learningEnabled !== false,
            logLevel: config.logLevel || 'info',
            ...config
        };
        
        this.logger = new Logger(this.config.logLevel);
        this.initialized = false;
        this.conversationHistory = new Map();
        this.activeContexts = new Map();
        
        if (this.config.enabled) {
            this.initialize();
        }
        
        this.logger.info('🔮 CrystalBallI initialized', {
            team: this.config.team,
            enabled: this.config.enabled,
            learning: this.config.learningEnabled
        });
    }
    
    async initialize() {
        this.logger.info('🚀 Initializing CrystalBallI intelligence system...');
        
        try {
            // Initialize core components
            this.contextManager = new ContextManager(this.config);
            this.intelligenceCoordinator = new IntelligenceCoordinator(this.config);
            
            // Initialize NDB-specific intelligence
            this.ndbIntelligence = new NDBContextIntelligence(this.config);
            await this.ndbIntelligence.initialize();
            
            // Initialize AI agents
            this.conversationalAgent = new ConversationalAgent(this.config);
            this.releasePredictionAgent = new ReleasePredictionAgent(this.config);
            this.teamVelocityAgent = new TeamVelocityAgent(this.config);
            
            if (this.config.learningEnabled) {
                this.learningAgent = new LearningAgent(this.config);
                await this.learningAgent.initialize();
            }
            
            // Register agents with intelligence coordinator
            await this.intelligenceCoordinator.registerAgent('conversational', this.conversationalAgent);
            await this.intelligenceCoordinator.registerAgent('prediction', this.releasePredictionAgent);
            await this.intelligenceCoordinator.registerAgent('velocity', this.teamVelocityAgent);
            
            if (this.learningAgent) {
                await this.intelligenceCoordinator.registerAgent('learning', this.learningAgent);
            }
            
            this.initialized = true;
            this.logger.info('✅ CrystalBallI initialization complete');
            
        } catch (error) {
            this.logger.error('❌ CrystalBallI initialization failed:', error);
            this.initialized = false;
            throw error;
        }
    }
    
    /**
     * Main conversational interface - answers questions about releases
     */
    async ask(question, context = {}) {
        if (!this.initialized) {
            throw new Error('CrystalBallI not initialized. Call initialize() first.');
        }
        
        const conversationId = context.conversationId || this.generateConversationId();
        const sessionContext = await this.buildSessionContext(context, conversationId);
        
        this.logger.info('💬 Processing question', { 
            question, 
            conversationId, 
            team: this.config.team 
        });
        
        try {
            // Parse the question and determine intent
            const queryIntent = await this.conversationalAgent.parseQuery(question, sessionContext);
            
            // Route to appropriate specialized agents
            const response = await this.intelligenceCoordinator.processQuery(queryIntent, sessionContext);
            
            // Generate conversational response
            this.logger.info('🔍 Context passed to conversational agent', {
                hasReleaseContext: !!sessionContext.releaseContext,
                releaseContextFeatures: sessionContext.releaseContext?.features?.length || 0,
                releaseContextDataSource: sessionContext.releaseContext?.dataSource,
                limitedData: sessionContext.releaseContext?.limitedData
            });
            
            const conversationalResponse = await this.conversationalAgent.generateResponse(
                response, 
                queryIntent, 
                sessionContext
            );
            
            // Store conversation history
            await this.storeConversationTurn(conversationId, question, conversationalResponse);
            
            // Trigger learning if enabled
            if (this.learningAgent) {
                await this.learningAgent.learnFromConversation(
                    question, 
                    conversationalResponse, 
                    sessionContext
                );
            }
            
            this.logger.info('✅ Question answered', { 
                conversationId, 
                intent: queryIntent.type,
                confidence: conversationalResponse.confidence 
            });
            
            return conversationalResponse;
            
        } catch (error) {
            this.logger.error('❌ Error processing question:', error);
            
            return {
                answer: "I encountered an error processing your question. Please try again or rephrase your query.",
                confidence: 0.0,
                reasoning: "Error in processing pipeline",
                error: error.message,
                conversationId
            };
        }
    }
    
    /**
     * Predict release landing date with full context
     */
    async predictReleaseLanding(releaseVersion, targetDate, context = {}) {
        if (!this.initialized) {
            throw new Error('CrystalBallI not initialized');
        }
        
        this.logger.info('🎯 Predicting release landing', { 
            release: releaseVersion, 
            targetDate 
        });
        
        try {
            const releaseContext = await this.contextManager.buildReleaseContext({
                releaseVersion,
                targetDate,
                ...context
            });
            
            // Multi-agent analysis
            const [
                predictionAnalysis,
                velocityAnalysis,
                ndbContextAnalysis
            ] = await Promise.all([
                this.releasePredictionAgent.predictLanding(releaseContext),
                this.teamVelocityAgent.analyzeVelocity(releaseContext),
                this.ndbIntelligence.analyzeReleaseContext(releaseContext)
            ]);
            
            // Synthesize results
            const synthesis = await this.intelligenceCoordinator.synthesizePrediction({
                prediction: predictionAnalysis,
                velocity: velocityAnalysis,
                ndbContext: ndbContextAnalysis,
                releaseContext
            });
            
            // Learn from this prediction for future improvements
            if (this.learningAgent) {
                await this.learningAgent.recordPrediction(releaseVersion, synthesis);
            }
            
            return synthesis;
            
        } catch (error) {
            this.logger.error('❌ Error predicting release landing:', error);
            throw error;
        }
    }
    
    /**
     * Analyze team velocity with NDB context
     */
    async analyzeTeamVelocity(teamContext = {}) {
        if (!this.initialized) {
            throw new Error('CrystalBallI not initialized');
        }
        
        const context = await this.contextManager.buildTeamContext({
            team: this.config.team,
            ...teamContext
        });
        
        return await this.teamVelocityAgent.analyzeVelocity(context);
    }
    
    /**
     * Get system status and health metrics
     */
    async getStatus() {
        const status = {
            initialized: this.initialized,
            enabled: this.config.enabled,
            team: this.config.team,
            learningEnabled: this.config.learningEnabled,
            activeConversations: this.conversationHistory.size,
            components: {}
        };
        
        if (this.initialized) {
            status.components = {
                contextManager: await this.contextManager.getHealth(),
                intelligenceCoordinator: await this.intelligenceCoordinator.getHealth(),
                ndbIntelligence: await this.ndbIntelligence.getHealth(),
                agents: {
                    conversational: await this.conversationalAgent.getHealth(),
                    prediction: await this.releasePredictionAgent.getHealth(),
                    velocity: await this.teamVelocityAgent.getHealth()
                }
            };
            
            if (this.learningAgent) {
                status.components.agents.learning = await this.learningAgent.getHealth();
            }
        }
        
        return status;
    }
    
    /**
     * Enable/disable learning capabilities
     */
    async toggleLearning(enabled = true) {
        this.config.learningEnabled = enabled;
        
        if (enabled && !this.learningAgent) {
            this.learningAgent = new LearningAgent(this.config);
            await this.learningAgent.initialize();
            await this.intelligenceCoordinator.registerAgent('learning', this.learningAgent);
        }
        
        this.logger.info('🧠 Learning toggled', { enabled });
        return { learningEnabled: enabled };
    }
    
    /**
     * Update NDB intelligence with new information
     */
    async updateIntelligence(domain, intelligence) {
        if (!this.initialized) {
            throw new Error('CrystalBallI not initialized');
        }
        
        await this.ndbIntelligence.updateIntelligence(domain, intelligence);
        
        this.logger.info('🧠 Intelligence updated', { domain });
        
        return { success: true, domain, timestamp: new Date() };
    }
    
    // Private helper methods
    
    generateConversationId() {
        return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    async buildSessionContext(inputContext, conversationId) {
        const baseContext = await this.contextManager.buildSessionContext({
            team: this.config.team,
            conversationId,
            ...inputContext
        });
        
        // Add conversation history
        const conversationHistory = this.conversationHistory.get(conversationId) || [];
        baseContext.conversationHistory = conversationHistory;
        
        return baseContext;
    }
    
    async storeConversationTurn(conversationId, question, response) {
        if (!this.conversationHistory.has(conversationId)) {
            this.conversationHistory.set(conversationId, []);
        }
        
        const conversation = this.conversationHistory.get(conversationId);
        conversation.push({
            timestamp: new Date(),
            question,
            response: {
                answer: response.answer,
                confidence: response.confidence,
                intent: response.intent
            }
        });
        
        // Keep conversation history manageable (last 10 exchanges)
        if (conversation.length > 10) {
            conversation.splice(0, conversation.length - 10);
        }
        
        this.conversationHistory.set(conversationId, conversation);
    }
    
    /**
     * Cleanup resources
     */
    async cleanup() {
        this.logger.info('🧹 Cleaning up CrystalBallI...');
        
        if (this.learningAgent) {
            await this.learningAgent.cleanup();
        }
        
        if (this.ndbIntelligence) {
            await this.ndbIntelligence.cleanup();
        }
        
        this.conversationHistory.clear();
        this.activeContexts.clear();
        this.initialized = false;
        
        this.logger.info('✅ CrystalBallI cleanup complete');
    }
}

module.exports = CrystalBallI;