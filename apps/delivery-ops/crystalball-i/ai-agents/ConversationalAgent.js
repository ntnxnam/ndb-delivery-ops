/**
 * Conversational Agent
 * 
 * Handles natural language processing for questions like "When will this release land?"
 * Converts user questions into structured queries and generates human-readable responses.
 * The interface between human conversation and AI intelligence.
 */

const Logger = require('../utils/Logger');

class ConversationalAgent {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger(config.logLevel || 'info');
        
        // Intent patterns for query classification
        this.intentPatterns = {
            RELEASE_LANDING: {
                patterns: [
                    /when.*will.*release.*land/i,
                    /when.*will.*ship/i,
                    /release.*date/i,
                    /when.*complete/i,
                    /delivery.*date/i,
                    /when.*ready/i,
                    /when.*will.*land/i,
                    /when.*will.*NDB.*land/i,
                    /NDB.*land/i,
                    /release.*land/i
                ],
                confidence: 0.9,
                requiredContext: ['releaseVersion']
            },
            
            RISK_ASSESSMENT: {
                patterns: [
                    /what.*risk/i,
                    /risk.*factor/i,
                    /what.*blocking/i,
                    /concern/i,
                    /blocker/i,
                    /what.*wrong/i
                ],
                confidence: 0.8,
                requiredContext: []
            },
            
            TEAM_VELOCITY: {
                patterns: [
                    /team.*velocity/i,
                    /how.*team.*doing/i,
                    /team.*performance/i,
                    /team.*capacity/i,
                    /team.*progress/i
                ],
                confidence: 0.8,
                requiredContext: []
            },
            
            FEATURE_STATUS: {
                patterns: [
                    /status.*of/i,
                    /how.*going/i,
                    /progress.*on/i,
                    /update.*on/i
                ],
                confidence: 0.7,
                requiredContext: []
            },
            
            COMPARISON: {
                patterns: [
                    /compare.*to/i,
                    /similar.*to/i,
                    /how.*compared/i,
                    /vs\./i,
                    /versus/i
                ],
                confidence: 0.7,
                requiredContext: []
            },
            
            WHAT_IF: {
                patterns: [
                    /what.*if/i,
                    /scenario/i,
                    /assume/i,
                    /suppose/i
                ],
                confidence: 0.6,
                requiredContext: []
            },
            
            GENERAL_INFO: {
                patterns: [
                    /tell.*about/i,
                    /information.*about/i,
                    /details.*on/i,
                    /explain/i
                ],
                confidence: 0.5,
                requiredContext: []
            }
        };
        
        // Response templates for different intent types
        this.responseTemplates = {
            RELEASE_LANDING: {
                highConfidence: "Based on {factors}, I predict {release} will land on **{predictedDate}** with {confidence}% confidence.",
                mediumConfidence: "Current analysis suggests {release} will likely land around **{predictedDate}**, though there's some uncertainty due to {uncertaintyFactors}.",
                lowConfidence: "Based on limited data, {release} might land around **{predictedDate}**, but I recommend monitoring {keyRisks} closely."
            },
            
            RISK_ASSESSMENT: {
                highRisk: "I've identified {riskCount} significant risks: {topRisks}. Immediate attention needed on {criticalItems}.",
                mediumRisk: "There are {riskCount} moderate risks to watch: {topRisks}. Worth monitoring closely.",
                lowRisk: "Overall risk appears manageable with {riskCount} minor concerns: {topRisks}."
            },
            
            TEAM_VELOCITY: {
                positive: "Team velocity looks {trend} - averaging {avgVelocity} story points per sprint. {positiveIndicators}",
                concerning: "Team velocity shows some concerns - {concerns}. {recommendations}",
                declining: "Team velocity is declining - {declineFactors}. Recommend {interventions}."
            }
        };
    }
    
    /**
     * Parse user query and determine intent
     */
    async parseQuery(question, context = {}) {
        this.logger.info('🔍 Parsing query', { question });
        
        const queryIntent = {
            originalQuestion: question,
            type: 'UNKNOWN',
            confidence: 0.0,
            entities: {},
            context: context,
            timestamp: new Date()
        };
        
        // Extract entities (release versions, feature keys, etc.)
        queryIntent.entities = await this.extractEntities(question);
        
        // Classify intent using pattern matching
        const intentClassification = await this.classifyIntent(question);
        queryIntent.type = intentClassification.type;
        queryIntent.confidence = intentClassification.confidence;
        queryIntent.matchedPatterns = intentClassification.patterns;
        
        // Add context-based enhancements
        if (context.releaseVersion && !queryIntent.entities.releaseVersion) {
            queryIntent.entities.releaseVersion = context.releaseVersion;
        }
        
        this.logger.info('✅ Query parsed', {
            intent: queryIntent.type,
            confidence: queryIntent.confidence,
            entities: Object.keys(queryIntent.entities)
        });
        
        return queryIntent;
    }
    
    /**
     * Extract entities from the question (release versions, feature keys, dates, etc.)
     */
    async extractEntities(question) {
        const entities = {};
        
        // Extract release versions (NDB-X.Y format)
        const releaseMatch = question.match(/NDB[-_]?(\d+)\.(\d+)/i);
        if (releaseMatch) {
            entities.releaseVersion = `NDB-${releaseMatch[1]}.${releaseMatch[2]}`;
        }
        
        // Extract feature keys (FEAT-XXXX, NDB-XXXX, etc.)
        const featureMatches = question.match(/([A-Z]+-\d+)/g);
        if (featureMatches) {
            entities.features = featureMatches;
        }
        
        // Extract time references
        const timeMatches = question.match(/(next week|this month|Q\d|quarter|sprint|release)/gi);
        if (timeMatches) {
            entities.timeReferences = timeMatches;
        }
        
        // Extract comparison references
        const comparisonMatch = question.match(/compare.*to.*?(NDB[-_]?\d+\.\d+|previous|last)/i);
        if (comparisonMatch) {
            entities.comparisonTarget = comparisonMatch[1];
        }
        
        return entities;
    }
    
    /**
     * Classify user intent using pattern matching
     */
    async classifyIntent(question) {
        let bestMatch = {
            type: 'GENERAL_INFO',
            confidence: 0.1,
            patterns: []
        };
        
        for (const [intentType, intentData] of Object.entries(this.intentPatterns)) {
            const matchedPatterns = [];
            let totalConfidence = 0;
            
            for (const pattern of intentData.patterns) {
                if (pattern.test(question)) {
                    matchedPatterns.push(pattern.toString());
                    totalConfidence += intentData.confidence;
                }
            }
            
            if (matchedPatterns.length > 0) {
                // Use base confidence scaled by match ratio
                const matchRatio = matchedPatterns.length / intentData.patterns.length;
                const confidence = intentData.confidence * matchRatio;
                
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        type: intentType,
                        confidence: confidence,
                        patterns: matchedPatterns
                    };
                }
            }
        }
        
        return bestMatch;
    }
    
    /**
     * Generate human-readable response from AI analysis
     */
    async generateResponse(aiAnalysis, queryIntent, context = {}) {
        this.logger.info('📝 Generating conversational response', { 
            intent: queryIntent.type,
            analysisType: typeof aiAnalysis
        });
        
        const response = {
            answer: '',
            confidence: aiAnalysis.confidence || 0.5,
            reasoning: '',
            intent: queryIntent.type,
            followUpQuestions: [],
            actionableInsights: [],
            conversationId: context.conversationId,
            timestamp: new Date()
        };
        
        try {
            // Route to appropriate response generator based on intent
            switch (queryIntent.type) {
                case 'RELEASE_LANDING':
                    response.answer = await this.generateReleaseLandingResponse(aiAnalysis, queryIntent, context);
                    break;
                    
                case 'RISK_ASSESSMENT':
                    response.answer = await this.generateRiskAssessmentResponse(aiAnalysis, queryIntent, context);
                    break;
                    
                case 'TEAM_VELOCITY':
                    response.answer = await this.generateTeamVelocityResponse(aiAnalysis, queryIntent, context);
                    break;
                    
                case 'FEATURE_STATUS':
                    response.answer = await this.generateFeatureStatusResponse(aiAnalysis, queryIntent, context);
                    break;
                    
                case 'COMPARISON':
                    response.answer = await this.generateComparisonResponse(aiAnalysis, queryIntent, context);
                    break;
                    
                default:
                    response.answer = await this.generateGenericResponse(aiAnalysis, queryIntent, context);
            }
            
            // Add reasoning explanation
            response.reasoning = await this.generateReasoning(aiAnalysis, queryIntent);
            
            // Generate follow-up questions
            response.followUpQuestions = await this.generateFollowUpQuestions(queryIntent, aiAnalysis);
            
            // Extract actionable insights
            response.actionableInsights = await this.extractActionableInsights(aiAnalysis, queryIntent);
            
            this.logger.info('✅ Response generated', {
                answerLength: response.answer.length,
                confidence: response.confidence
            });
            
        } catch (error) {
            this.logger.error('❌ Error generating response:', error);
            response.answer = "I encountered an issue generating a detailed response. Let me provide what I can analyze...";
            response.confidence = 0.2;
        }
        
        return response;
    }
    
    /**
     * Generate release landing prediction response
     */
    async generateReleaseLandingResponse(analysis, queryIntent, context) {
        const releaseVersion = queryIntent.entities.releaseVersion || context.releaseVersion || 'this release';
        
        // Check if we have limited data access
        if (context.releaseContext?.limitedData || !context.releaseContext?.features?.length) {
            return `I'd love to predict when ${releaseVersion} will land, but I need access to JIRA data to provide accurate insights. 

**To get release predictions, I need:**
• JIRA authentication (token/credentials)
• Access to feature/ticket data for ${releaseVersion}
• Team velocity and historical information

**Quick setup:**
1. Ensure you're logged into JIRA in VooDoo
2. Load some release data on this page first
3. Ask me again - I'll have much better insights!

Right now I can see you're looking at ${releaseVersion}, but I don't have the detailed feature data to make meaningful predictions.`;
        }
        
        if (!analysis.predictedDate) {
            return `I need more information to predict when ${releaseVersion} will land. Please ensure I have access to current feature status and team velocity data.`;
        }
        
        const confidence = Math.round((analysis.confidence || 0.5) * 100);
        const predictedDate = this.formatDate(analysis.predictedDate);
        
        let response = `Based on my analysis of current team velocity, historical patterns, and feature progress, I predict **${releaseVersion} will land on ${predictedDate}** with ${confidence}% confidence.`;
        
        // Add key factors
        if (analysis.keyFactors && analysis.keyFactors.length > 0) {
            response += `\n\n**Key factors in this prediction:**`;
            for (const factor of analysis.keyFactors.slice(0, 3)) {
                response += `\n• ${factor}`;
            }
        }
        
        // Add risks or concerns
        if (analysis.risks && analysis.risks.length > 0) {
            response += `\n\n**Main risks to watch:**`;
            for (const risk of analysis.risks.slice(0, 2)) {
                response += `\n⚠️ ${risk}`;
            }
        }
        
        // Add recommendations
        if (analysis.recommendations && analysis.recommendations.length > 0) {
            response += `\n\n**Recommendations:**`;
            for (const rec of analysis.recommendations.slice(0, 2)) {
                response += `\n📋 ${rec}`;
            }
        }
        
        return response;
    }
    
    /**
     * Generate risk assessment response
     */
    async generateRiskAssessmentResponse(analysis, queryIntent, context) {
        if (!analysis.riskAnalysis) {
            return "I couldn't find detailed risk information. Please ensure I have access to current feature status and risk indicators.";
        }
        
        const risks = analysis.riskAnalysis;
        let response = '';
        
        // High-level risk summary
        const totalRisks = (risks.highRiskFeatures?.length || 0) + (risks.stuckFeatures?.length || 0);
        
        if (totalRisks === 0) {
            response = "**Good news!** I don't see any major risks at the moment. ";
        } else if (totalRisks <= 2) {
            response = `I've identified **${totalRisks} moderate risk factors** that need attention: `;
        } else {
            response = `**Alert:** I've found **${totalRisks} risk factors** requiring immediate focus: `;
        }
        
        // Detail the top risks
        const allRisks = [
            ...(risks.highRiskFeatures || []).map(f => `🔴 ${f.key}: ${f.reason}`),
            ...(risks.stuckFeatures || []).map(f => `⏰ ${f.key}: Stuck ${f.daysStuck} days in ${f.status}`)
        ];
        
        if (allRisks.length > 0) {
            response += '\n\n' + allRisks.slice(0, 3).join('\n');
        }
        
        // Add descoping predictions if available
        if (risks.descopingCandidates && risks.descopingCandidates.length > 0) {
            response += `\n\n**Predicted TPM Actions:**`;
            for (const candidate of risks.descopingCandidates.slice(0, 2)) {
                const probability = Math.round(candidate.descopingProbability * 100);
                response += `\n📉 ${candidate.key}: ${probability}% chance of descoping (stuck ${candidate.daysStuck} days)`;
            }
        }
        
        return response;
    }
    
    /**
     * Generate team velocity response
     */
    async generateTeamVelocityResponse(analysis, queryIntent, context) {
        if (!analysis.velocityAnalysis) {
            return "I need access to team velocity data to provide this analysis. Please ensure sprint data is available.";
        }
        
        const velocity = analysis.velocityAnalysis;
        let response = '';
        
        // Overall velocity assessment
        if (velocity.trend === 'improving') {
            response = `**Team velocity is looking good!** `;
        } else if (velocity.trend === 'declining') {
            response = `**Team velocity shows some concerns.** `;
        } else {
            response = `**Team velocity is stable.** `;
        }
        
        // Add specific metrics
        if (velocity.averageVelocity) {
            response += `The team is averaging **${velocity.averageVelocity} story points per sprint**.`;
        }
        
        // Add trend details
        if (velocity.trendDetails) {
            response += `\n\n${velocity.trendDetails}`;
        }
        
        // Add individual insights if available
        if (velocity.individualInsights && velocity.individualInsights.length > 0) {
            response += `\n\n**Team Member Insights:**`;
            for (const insight of velocity.individualInsights.slice(0, 2)) {
                response += `\n• ${insight}`;
            }
        }
        
        return response;
    }
    
    /**
     * Generate generic response for unclassified queries
     */
    async generateGenericResponse(analysis, queryIntent, context) {
        let response = "Based on my analysis of the current data:\n\n";
        
        // Add any available insights
        if (analysis.insights && analysis.insights.length > 0) {
            for (const insight of analysis.insights.slice(0, 3)) {
                response += `• ${insight.message}\n`;
            }
        } else {
            response += "I have information available but need a more specific question to provide targeted insights.";
        }
        
        return response;
    }
    
    /**
     * Generate reasoning explanation
     */
    async generateReasoning(analysis, queryIntent) {
        const reasoningParts = [];
        
        if (analysis.keyFactors) {
            reasoningParts.push(`Considered ${analysis.keyFactors.length} key factors`);
        }
        
        if (analysis.confidence) {
            const confidence = Math.round(analysis.confidence * 100);
            reasoningParts.push(`${confidence}% confidence based on data quality and historical patterns`);
        }
        
        if (analysis.dataSource) {
            reasoningParts.push(`Analysis based on ${analysis.dataSource}`);
        }
        
        return reasoningParts.join('; ');
    }
    
    /**
     * Generate follow-up questions
     */
    async generateFollowUpQuestions(queryIntent, analysis) {
        const questions = [];
        
        switch (queryIntent.type) {
            case 'RELEASE_LANDING':
                questions.push(
                    "What are the biggest risks to this timeline?",
                    "How does this compare to similar past releases?",
                    "What can the team do to improve the timeline?"
                );
                break;
                
            case 'RISK_ASSESSMENT':
                questions.push(
                    "Which features are most likely to be descoped?",
                    "How can we mitigate these risks?",
                    "What's the impact if these risks materialize?"
                );
                break;
                
            case 'TEAM_VELOCITY':
                questions.push(
                    "What's affecting team performance?",
                    "How does current velocity compare to past sprints?",
                    "Are there capacity issues I should know about?"
                );
                break;
        }
        
        return questions.slice(0, 3); // Return max 3 follow-up questions
    }
    
    /**
     * Extract actionable insights
     */
    async extractActionableInsights(analysis, queryIntent) {
        const insights = [];
        
        if (analysis.recommendations) {
            insights.push(...analysis.recommendations.slice(0, 3));
        }
        
        if (analysis.actionItems) {
            insights.push(...analysis.actionItems.slice(0, 2));
        }
        
        return insights;
    }
    
    // Utility methods
    
    formatDate(date) {
        if (typeof date === 'string') {
            date = new Date(date);
        }
        
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
    
    async getHealth() {
        return {
            intentPatterns: Object.keys(this.intentPatterns).length,
            responseTemplates: Object.keys(this.responseTemplates).length,
            status: 'healthy'
        };
    }
}

module.exports = ConversationalAgent;