/**
 * Learning Agent
 * 
 * Handles continuous learning and improvement of CrystalBallI intelligence.
 * Tracks prediction accuracy, learns from outcomes, and evolves intelligence base.
 */

const Logger = require('../utils/Logger');

class LearningAgent {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger(config.logLevel || 'info');
        
        // Learning configuration
        this.learningConfig = {
            enabled: config.learningEnabled !== false,
            accuracyThreshold: 0.75,
            learningRate: 0.1,
            retentionPeriod: 365, // days
            ...config.learning
        };
        
        // Learning storage
        this.predictionHistory = new Map();
        this.conversationLearnings = new Map();
        this.accuracyMetrics = new Map();
        this.intelligenceUpdates = new Map();
        
        this.initialized = false;
    }
    
    async initialize() {
        if (!this.learningConfig.enabled) {
            this.logger.info('🧠 Learning disabled by configuration');
            return;
        }
        
        this.logger.info('🧠 Initializing Learning Agent...');
        
        try {
            // Initialize learning storage
            await this.loadLearningData();
            
            // Setup learning timers
            this.setupLearningTimers();
            
            this.initialized = true;
            this.logger.info('✅ Learning Agent initialized');
            
        } catch (error) {
            this.logger.error('❌ Learning Agent initialization failed:', error);
            throw error;
        }
    }
    
    /**
     * Learn from conversation interactions
     */
    async learnFromConversation(question, response, context) {
        if (!this.learningConfig.enabled) return;
        
        this.logger.debug('📚 Learning from conversation', { 
            question: question.substring(0, 50) + '...',
            confidence: response.confidence 
        });
        
        const learning = {
            timestamp: new Date(),
            question,
            intent: response.intent,
            confidence: response.confidence,
            context: {
                team: context.team,
                releaseVersion: context.releaseVersion
            },
            userSatisfaction: null, // Would be collected from user feedback
            
            // Learning opportunities
            learningOpportunities: this.identifyLearningOpportunities(question, response, context)
        };
        
        // Store conversation learning
        const conversationId = context.conversationId || this.generateId();
        this.conversationLearnings.set(conversationId, learning);
        
        // Trigger learning analysis
        await this.analyzeLearningOpportunities(learning);
    }
    
    /**
     * Record prediction for future validation
     */
    async recordPrediction(releaseVersion, prediction) {
        if (!this.learningConfig.enabled) return;
        
        this.logger.info('📊 Recording prediction for learning', { 
            release: releaseVersion,
            predictedDate: prediction.predictedDate,
            confidence: prediction.confidence
        });
        
        const predictionRecord = {
            releaseVersion,
            predictedDate: prediction.predictedDate,
            targetDate: prediction.targetDate,
            confidence: prediction.confidence,
            methodology: prediction.methodology,
            keyFactors: prediction.keyFactors,
            recordedAt: new Date(),
            
            // For future validation
            actualLandingDate: null,
            accuracyScore: null,
            validatedAt: null,
            
            // Learning metadata
            contextSnapshot: {
                featuresCount: prediction.releaseContext?.features?.length || 0,
                teamSize: prediction.releaseContext?.teamMembers?.length || 0
            }
        };
        
        this.predictionHistory.set(releaseVersion, predictionRecord);
        
        // Schedule validation reminder
        this.schedulePredictionValidation(releaseVersion, prediction.targetDate);
    }
    
    /**
     * Validate prediction accuracy when actual outcome is known
     */
    async validatePrediction(releaseVersion, actualOutcome) {
        if (!this.learningConfig.enabled) return;
        
        const prediction = this.predictionHistory.get(releaseVersion);
        if (!prediction) {
            this.logger.warn('No prediction found for validation', { releaseVersion });
            return;
        }
        
        this.logger.info('🎯 Validating prediction accuracy', {
            release: releaseVersion,
            predicted: prediction.predictedDate,
            actual: actualOutcome.actualDate
        });
        
        // Calculate accuracy
        const accuracy = this.calculatePredictionAccuracy(prediction, actualOutcome);
        
        // Update prediction record
        prediction.actualLandingDate = actualOutcome.actualDate;
        prediction.accuracyScore = accuracy.score;
        prediction.validatedAt = new Date();
        prediction.actualOutcome = actualOutcome;
        
        // Store accuracy metrics
        this.accuracyMetrics.set(releaseVersion, {
            releaseVersion,
            accuracy: accuracy.score,
            confidenceCalibration: this.calculateConfidenceCalibration(prediction, accuracy),
            lessons: accuracy.lessons,
            validatedAt: new Date()
        });
        
        // Learn from the outcome
        await this.learnFromPredictionOutcome(prediction, actualOutcome, accuracy);
        
        this.logger.info('✅ Prediction validated', {
            release: releaseVersion,
            accuracy: Math.round(accuracy.score * 100) + '%'
        });
        
        return accuracy;
    }
    
    /**
     * Update intelligence based on new information
     */
    async updateIntelligence(domain, newIntelligence, source = 'human') {
        if (!this.learningConfig.enabled) return;
        
        this.logger.info('🧠 Updating intelligence', { domain, source });
        
        const update = {
            domain,
            intelligence: newIntelligence,
            source,
            updatedAt: new Date(),
            confidence: source === 'human' ? 0.9 : 0.7,
            
            // Validation tracking
            validated: false,
            validationCount: 0,
            
            // Usage tracking
            usageCount: 0,
            lastUsed: null
        };
        
        // Store intelligence update
        const updateId = `${domain}_${Date.now()}`;
        this.intelligenceUpdates.set(updateId, update);
        
        // Schedule validation
        this.scheduleIntelligenceValidation(updateId);
        
        return updateId;
    }
    
    /**
     * Get model performance metrics
     */
    async getModelPerformance() {
        const performance = {
            predictionAccuracy: this.calculateOverallAccuracy(),
            confidenceCalibration: this.calculateOverallCalibration(),
            learningProgress: this.calculateLearningProgress(),
            totalPredictions: this.predictionHistory.size,
            validatedPredictions: this.getValidatedPredictions().length,
            intelligenceUpdates: this.intelligenceUpdates.size,
            generatedAt: new Date()
        };
        
        return performance;
    }
    
    // Private methods
    
    async loadLearningData() {
        // In production, this would load from persistent storage
        // For now, initialize empty collections
        this.predictionHistory = new Map();
        this.conversationLearnings = new Map();
        this.accuracyMetrics = new Map();
        this.intelligenceUpdates = new Map();
        
        this.logger.debug('Learning data initialized');
    }
    
    setupLearningTimers() {
        // Daily learning analysis
        setInterval(() => {
            this.performDailyLearningAnalysis();
        }, 24 * 60 * 60 * 1000); // 24 hours
        
        // Weekly intelligence validation
        setInterval(() => {
            this.performIntelligenceValidation();
        }, 7 * 24 * 60 * 60 * 1000); // 7 days
    }
    
    identifyLearningOpportunities(question, response, context) {
        const opportunities = [];
        
        // Low confidence responses indicate learning opportunities
        if (response.confidence < 0.6) {
            opportunities.push({
                type: 'low_confidence',
                description: 'Response had low confidence, may need more training data',
                priority: 'medium'
            });
        }
        
        // Unknown intents indicate missing capabilities
        if (response.intent === 'UNKNOWN' || response.intent === 'GENERAL_INFO') {
            opportunities.push({
                type: 'unknown_intent',
                description: 'Question intent not clearly classified',
                priority: 'high'
            });
        }
        
        // Context gaps
        if (!context.releaseVersion && question.includes('release')) {
            opportunities.push({
                type: 'context_gap',
                description: 'Release context missing from question about releases',
                priority: 'low'
            });
        }
        
        return opportunities;
    }
    
    async analyzeLearningOpportunities(learning) {
        for (const opportunity of learning.learningOpportunities) {
            switch (opportunity.type) {
                case 'low_confidence':
                    await this.addressLowConfidence(learning, opportunity);
                    break;
                    
                case 'unknown_intent':
                    await this.addressUnknownIntent(learning, opportunity);
                    break;
                    
                case 'context_gap':
                    await this.addressContextGap(learning, opportunity);
                    break;
            }
        }
    }
    
    async addressLowConfidence(learning, opportunity) {
        // In production, this might trigger:
        // - Collection of more training data
        // - Model retraining
        // - Confidence threshold adjustments
        
        this.logger.debug('Addressing low confidence response', {
            question: learning.question.substring(0, 30) + '...',
            confidence: learning.confidence
        });
    }
    
    async addressUnknownIntent(learning, opportunity) {
        // In production, this might:
        // - Add new intent patterns
        // - Update intent classification model
        // - Suggest new capabilities
        
        this.logger.debug('Addressing unknown intent', {
            question: learning.question.substring(0, 30) + '...'
        });
    }
    
    async addressContextGap(learning, opportunity) {
        // In production, this might:
        // - Improve context extraction
        // - Update entity recognition
        // - Enhance context building
        
        this.logger.debug('Addressing context gap', {
            description: opportunity.description
        });
    }
    
    calculatePredictionAccuracy(prediction, actualOutcome) {
        const predictedDate = new Date(prediction.predictedDate);
        const actualDate = new Date(actualOutcome.actualDate);
        const targetDate = new Date(prediction.targetDate);
        
        // Calculate date accuracy (days difference)
        const daysDifference = Math.abs(predictedDate - actualDate) / (1000 * 60 * 60 * 24);
        
        // Score based on accuracy (higher is better)
        let dateScore = Math.max(0, 1 - (daysDifference / 30)); // 30 days = 0 score
        
        // Bonus for beating target date if both predicted and actual beat it
        const predictedBeatsTarget = predictedDate <= targetDate;
        const actualBeatsTarget = actualDate <= targetDate;
        
        if (predictedBeatsTarget === actualBeatsTarget) {
            dateScore += 0.1; // Bonus for correctly predicting on-time/late
        }
        
        const accuracy = {
            score: Math.min(dateScore, 1.0),
            daysDifference: Math.round(daysDifference),
            predictedCorrectly: {
                onTime: predictedBeatsTarget === actualBeatsTarget,
                dateRange: daysDifference <= 7 // Within a week
            },
            lessons: this.extractLessons(prediction, actualOutcome, daysDifference)
        };
        
        return accuracy;
    }
    
    extractLessons(prediction, actualOutcome, daysDifference) {
        const lessons = [];
        
        if (daysDifference > 14) {
            lessons.push('Large date variance suggests need for better risk assessment');
        }
        
        if (prediction.confidence > 0.8 && daysDifference > 7) {
            lessons.push('High confidence prediction was inaccurate - review confidence calculation');
        }
        
        if (actualOutcome.majorIssues && actualOutcome.majorIssues.length > 0) {
            lessons.push('Major issues occurred that were not predicted - improve risk detection');
        }
        
        return lessons;
    }
    
    calculateConfidenceCalibration(prediction, accuracy) {
        // How well does confidence match actual accuracy?
        const confidenceDifference = Math.abs(prediction.confidence - accuracy.score);
        
        return {
            calibrationScore: 1 - confidenceDifference, // Higher is better
            overconfident: prediction.confidence > accuracy.score,
            confidenceDifference: Math.round(confidenceDifference * 100)
        };
    }
    
    async learnFromPredictionOutcome(prediction, actualOutcome, accuracy) {
        // In production, this would:
        // - Update prediction models
        // - Adjust confidence calculations  
        // - Refine risk assessment algorithms
        // - Update intelligence patterns
        
        this.logger.info('Learning from prediction outcome', {
            release: prediction.releaseVersion,
            accuracy: Math.round(accuracy.score * 100) + '%',
            lessons: accuracy.lessons.length
        });
        
        // Store lessons for model updates
        for (const lesson of accuracy.lessons) {
            await this.recordLesson(prediction.releaseVersion, lesson, accuracy);
        }
    }
    
    async recordLesson(releaseVersion, lesson, accuracy) {
        // Store lesson for future model improvements
        const lessonRecord = {
            releaseVersion,
            lesson,
            accuracy: accuracy.score,
            recordedAt: new Date(),
            applied: false
        };
        
        // In production, would store in persistent storage
        this.logger.debug('Lesson recorded', { lesson, accuracy: accuracy.score });
    }
    
    schedulePredictionValidation(releaseVersion, targetDate) {
        // In production, would schedule reminder to validate prediction
        // after target date passes
        
        this.logger.debug('Prediction validation scheduled', {
            release: releaseVersion,
            targetDate
        });
    }
    
    scheduleIntelligenceValidation(updateId) {
        // In production, would schedule validation of intelligence updates
        
        this.logger.debug('Intelligence validation scheduled', { updateId });
    }
    
    async performDailyLearningAnalysis() {
        if (!this.learningConfig.enabled) return;
        
        // Analyze recent conversations and predictions
        this.logger.info('🔍 Performing daily learning analysis...');
        
        // In production, would:
        // - Analyze conversation patterns
        // - Update model weights
        // - Generate learning insights
        // - Cleanup old data
    }
    
    async performIntelligenceValidation() {
        if (!this.learningConfig.enabled) return;
        
        // Validate intelligence updates based on usage and feedback
        this.logger.info('🔍 Performing intelligence validation...');
        
        // In production, would:
        // - Validate intelligence updates
        // - Remove outdated patterns
        // - Promote validated intelligence
    }
    
    calculateOverallAccuracy() {
        const validatedPredictions = this.getValidatedPredictions();
        
        if (validatedPredictions.length === 0) return null;
        
        const totalAccuracy = validatedPredictions.reduce((sum, pred) => {
            const metrics = this.accuracyMetrics.get(pred.releaseVersion);
            return sum + (metrics ? metrics.accuracy : 0);
        }, 0);
        
        return totalAccuracy / validatedPredictions.length;
    }
    
    calculateOverallCalibration() {
        const validatedPredictions = this.getValidatedPredictions();
        
        if (validatedPredictions.length === 0) return null;
        
        let totalCalibration = 0;
        let count = 0;
        
        for (const pred of validatedPredictions) {
            const metrics = this.accuracyMetrics.get(pred.releaseVersion);
            if (metrics && metrics.confidenceCalibration) {
                totalCalibration += metrics.confidenceCalibration.calibrationScore;
                count++;
            }
        }
        
        return count > 0 ? totalCalibration / count : null;
    }
    
    calculateLearningProgress() {
        // Simple learning progress metric
        return {
            conversationsLearned: this.conversationLearnings.size,
            predictionsRecorded: this.predictionHistory.size,
            intelligenceUpdates: this.intelligenceUpdates.size,
            validatedPredictions: this.getValidatedPredictions().length
        };
    }
    
    getValidatedPredictions() {
        return Array.from(this.predictionHistory.values())
            .filter(pred => pred.validatedAt !== null);
    }
    
    generateId() {
        return `learn_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }
    
    /**
     * Get health status
     */
    async getHealth() {
        return {
            enabled: this.learningConfig.enabled,
            initialized: this.initialized,
            status: this.initialized ? 'healthy' : 'not_initialized',
            
            metrics: {
                predictions: this.predictionHistory.size,
                conversations: this.conversationLearnings.size,
                accuracyMetrics: this.accuracyMetrics.size,
                intelligenceUpdates: this.intelligenceUpdates.size
            }
        };
    }
    
    async cleanup() {
        // Cleanup learning data and timers
        this.predictionHistory.clear();
        this.conversationLearnings.clear();
        this.accuracyMetrics.clear();
        this.intelligenceUpdates.clear();
        
        this.initialized = false;
        this.logger.info('🧹 Learning Agent cleanup complete');
    }
}

module.exports = LearningAgent;