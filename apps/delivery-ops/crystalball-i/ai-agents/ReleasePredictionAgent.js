/**
 * Release Prediction Agent
 * 
 * Specialized AI agent for predicting release landing dates using Monte Carlo
 * simulations, historical analysis, and NDB-specific context intelligence.
 * This is the core prediction engine that answers "When will this release land?"
 */

const Logger = require('../utils/Logger');

class ReleasePredictionAgent {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger(config.logLevel || 'info');
        
        // Prediction configuration
        this.predictionConfig = {
            monteCarloSimulations: 10000,
            confidenceIntervals: [50, 70, 80, 90, 95],
            baseVelocity: 12, // story points per sprint
            sprintLength: 14, // days
            ...config.prediction
        };
        
        // Risk factors and their impact multipliers
        this.riskFactors = {
            stuckFeatures: {
                impact: 0.3,
                threshold: 15 // days
            },
            highRiskFeatures: {
                impact: 0.2,
                multiplier: 1.5
            },
            teamCapacityIssues: {
                impact: 0.25,
                indicators: ['declining_velocity', 'team_departures']
            },
            externalDependencies: {
                impact: 0.15,
                multiplier: 1.3
            }
        };
    }
    
    /**
     * Main prediction method - predicts release landing date
     */
    async predictLanding(releaseContext) {
        this.logger.info('🎯 Predicting release landing', { 
            release: releaseContext.releaseVersion 
        });
        
        try {
            // Multi-dimensional analysis
            const analysisComponents = await this.runComprehensiveAnalysis(releaseContext);
            
            // Monte Carlo simulation for date prediction
            const dateSimulation = await this.runMonteCarloSimulation(
                releaseContext, 
                analysisComponents
            );
            
            // Risk assessment and mitigation analysis
            const riskAssessment = await this.assessReleaseRisks(
                releaseContext, 
                analysisComponents
            );
            
            // Generate recommendations
            const recommendations = await this.generateRecommendations(
                analysisComponents,
                riskAssessment,
                dateSimulation
            );
            
            // Synthesize final prediction
            const prediction = {
                releaseVersion: releaseContext.releaseVersion,
                targetDate: releaseContext.targetDate,
                predictedDate: dateSimulation.medianDate,
                confidence: dateSimulation.confidence,
                
                probabilityDistribution: dateSimulation.distribution,
                confidenceIntervals: dateSimulation.intervals,
                
                keyFactors: analysisComponents.keyFactors,
                riskAnalysis: riskAssessment,
                recommendations: recommendations,
                
                analysisTimestamp: new Date(),
                methodology: 'Monte Carlo simulation with NDB context intelligence'
            };
            
            this.logger.info('✅ Prediction completed', {
                predicted: dateSimulation.medianDate,
                confidence: Math.round(dateSimulation.confidence * 100)
            });
            
            return prediction;
            
        } catch (error) {
            this.logger.error('❌ Error predicting release landing:', error);
            throw error;
        }
    }
    
    /**
     * Comprehensive multi-dimensional analysis
     */
    async runComprehensiveAnalysis(releaseContext) {
        const analysis = {
            keyFactors: [],
            velocityAnalysis: {},
            scopeAnalysis: {},
            riskFactors: [],
            historicalComparison: {}
        };
        
        // 1. Velocity Analysis
        analysis.velocityAnalysis = await this.analyzeVelocity(releaseContext);
        analysis.keyFactors.push(`Team velocity: ${analysis.velocityAnalysis.summary}`);
        
        // 2. Scope Analysis
        analysis.scopeAnalysis = await this.analyzeScope(releaseContext);
        analysis.keyFactors.push(`Scope: ${analysis.scopeAnalysis.summary}`);
        
        // 3. Progress Analysis
        const progressAnalysis = await this.analyzeProgress(releaseContext);
        analysis.keyFactors.push(`Progress: ${progressAnalysis.summary}`);
        
        // 4. Risk Factor Identification
        analysis.riskFactors = await this.identifyRiskFactors(releaseContext);
        if (analysis.riskFactors.length > 0) {
            analysis.keyFactors.push(`${analysis.riskFactors.length} risk factors identified`);
        }
        
        // 5. Historical Comparison
        analysis.historicalComparison = await this.compareToHistoricalReleases(releaseContext);
        if (analysis.historicalComparison.similarReleases?.length > 0) {
            analysis.keyFactors.push(`Historical pattern: ${analysis.historicalComparison.summary}`);
        }
        
        return analysis;
    }
    
    /**
     * Monte Carlo simulation for date prediction
     */
    async runMonteCarloSimulation(releaseContext, analysisComponents) {
        const simulations = this.predictionConfig.monteCarloSimulations;
        const outcomes = [];
        
        this.logger.info('🎲 Running Monte Carlo simulation', { simulations });
        
        // Base parameters
        const baseVelocity = analysisComponents.velocityAnalysis.averageVelocity || this.predictionConfig.baseVelocity;
        const remainingWork = analysisComponents.scopeAnalysis.remainingStoryPoints || 0;
        const riskMultiplier = this.calculateRiskMultiplier(analysisComponents.riskFactors);
        
        for (let i = 0; i < simulations; i++) {
            const outcome = this.simulateSingleScenario({
                baseVelocity,
                remainingWork,
                riskMultiplier,
                targetDate: new Date(releaseContext.targetDate),
                currentDate: new Date()
            });
            
            outcomes.push(outcome);
        }
        
        // Calculate statistics
        outcomes.sort((a, b) => a.completionDate - b.completionDate);
        
        const distribution = this.calculateDistribution(outcomes);
        const intervals = this.calculateConfidenceIntervals(outcomes);
        const medianDate = outcomes[Math.floor(outcomes.length * 0.5)].completionDate;
        const confidence = this.calculateConfidence(outcomes, new Date(releaseContext.targetDate));
        
        return {
            medianDate: this.formatDate(medianDate),
            confidence: confidence,
            distribution: distribution,
            intervals: intervals,
            totalScenarios: simulations,
            methodology: 'Monte Carlo simulation with risk adjustment'
        };
    }
    
    /**
     * Simulate single release scenario
     */
    simulateSingleScenario(params) {
        const { baseVelocity, remainingWork, riskMultiplier, currentDate } = params;
        
        // Add randomness to velocity (±20% variation)
        const velocityVariation = (Math.random() * 0.4 - 0.2) + 1; // 0.8 to 1.2
        const adjustedVelocity = baseVelocity * velocityVariation * riskMultiplier;
        
        // Calculate completion time
        const sprintsNeeded = Math.ceil(remainingWork / adjustedVelocity);
        const daysNeeded = sprintsNeeded * this.predictionConfig.sprintLength;
        
        // Add buffer for integration, testing, gate processes (5-15 days)
        const bufferDays = Math.random() * 10 + 5;
        const totalDays = daysNeeded + bufferDays;
        
        // Calculate completion date
        const completionDate = new Date(currentDate);
        completionDate.setDate(completionDate.getDate() + totalDays);
        
        return {
            completionDate,
            sprintsNeeded,
            adjustedVelocity,
            bufferDays: Math.round(bufferDays),
            totalDays: Math.round(totalDays)
        };
    }
    
    /**
     * Analyze team velocity patterns
     */
    async analyzeVelocity(releaseContext) {
        const analysis = {
            averageVelocity: this.predictionConfig.baseVelocity,
            trend: 'stable',
            summary: '',
            factors: []
        };
        
        // In real implementation, this would analyze actual sprint data
        // For now, using heuristics based on available data
        
        const features = releaseContext.features || [];
        const totalStoryPoints = features.reduce((sum, f) => {
            const points = f.customfield_10002 || 0; // Story points field
            return sum + points;
        }, 0);
        
        if (totalStoryPoints > 0) {
            analysis.factors.push(`${totalStoryPoints} total story points estimated`);
        }
        
        // Analyze team capacity indicators
        if (releaseContext.teamMembers) {
            const teamSize = releaseContext.teamMembers.length;
            analysis.factors.push(`${teamSize} team members`);
            
            // Adjust velocity based on team size
            if (teamSize < 5) {
                analysis.averageVelocity *= 0.8; // Small team penalty
                analysis.factors.push('Small team size may impact velocity');
            }
        }
        
        // Check for stuck features (velocity risk)
        const stuckFeatures = features.filter(f => {
            const updated = new Date(f.updated);
            const daysSinceUpdate = (new Date() - updated) / (1000 * 60 * 60 * 24);
            return daysSinceUpdate > 14;
        });
        
        if (stuckFeatures.length > 0) {
            analysis.trend = 'at_risk';
            analysis.factors.push(`${stuckFeatures.length} features appear stuck`);
            analysis.averageVelocity *= 0.85; // Velocity penalty for stuck work
        }
        
        // Generate summary
        analysis.summary = `${analysis.averageVelocity} points/sprint (${analysis.trend})`;
        
        return analysis;
    }
    
    /**
     * Analyze release scope and remaining work
     */
    async analyzeScope(releaseContext) {
        const features = releaseContext.features || [];
        
        const analysis = {
            totalFeatures: features.length,
            completedFeatures: 0,
            remainingFeatures: 0,
            remainingStoryPoints: 0,
            summary: '',
            scopeHealth: 'unknown'
        };
        
        // Analyze feature completion status
        for (const feature of features) {
            const status = feature.status?.name;
            const storyPoints = feature.customfield_10002 || 3; // Default 3 if missing
            
            if (this.isFeatureComplete(status)) {
                analysis.completedFeatures++;
            } else {
                analysis.remainingFeatures++;
                analysis.remainingStoryPoints += storyPoints;
            }
        }
        
        // Calculate completion percentage
        const completionPercentage = analysis.totalFeatures > 0 
            ? Math.round((analysis.completedFeatures / analysis.totalFeatures) * 100)
            : 0;
        
        // Assess scope health
        if (completionPercentage >= 80) {
            analysis.scopeHealth = 'excellent';
        } else if (completionPercentage >= 60) {
            analysis.scopeHealth = 'good';
        } else if (completionPercentage >= 40) {
            analysis.scopeHealth = 'moderate';
        } else {
            analysis.scopeHealth = 'concerning';
        }
        
        analysis.summary = `${completionPercentage}% complete, ${analysis.remainingStoryPoints} points remaining`;
        
        return analysis;
    }
    
    /**
     * Analyze current progress and momentum
     */
    async analyzeProgress(releaseContext) {
        const features = releaseContext.features || [];
        
        const analysis = {
            momentum: 'unknown',
            recentActivity: 0,
            summary: ''
        };
        
        // Count recent activity (last 7 days)
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        
        let recentUpdates = 0;
        for (const feature of features) {
            const updated = new Date(feature.updated);
            if (updated > oneWeekAgo) {
                recentUpdates++;
            }
        }
        
        analysis.recentActivity = recentUpdates;
        
        // Assess momentum
        const activityRatio = features.length > 0 ? recentUpdates / features.length : 0;
        
        if (activityRatio >= 0.5) {
            analysis.momentum = 'high';
        } else if (activityRatio >= 0.3) {
            analysis.momentum = 'moderate';
        } else {
            analysis.momentum = 'low';
        }
        
        analysis.summary = `${analysis.momentum} momentum (${recentUpdates} features updated recently)`;
        
        return analysis;
    }
    
    /**
     * Identify release risk factors
     */
    async identifyRiskFactors(releaseContext) {
        const risks = [];
        const features = releaseContext.features || [];
        
        // Stuck features risk
        const stuckFeatures = features.filter(f => {
            const updated = new Date(f.updated);
            const daysSinceUpdate = (new Date() - updated) / (1000 * 60 * 60 * 24);
            return daysSinceUpdate > this.riskFactors.stuckFeatures.threshold;
        });
        
        if (stuckFeatures.length > 0) {
            risks.push({
                type: 'stuck_features',
                severity: stuckFeatures.length > 3 ? 'high' : 'medium',
                description: `${stuckFeatures.length} features haven't been updated in ${this.riskFactors.stuckFeatures.threshold}+ days`,
                impact: this.riskFactors.stuckFeatures.impact,
                features: stuckFeatures.map(f => f.key)
            });
        }
        
        // High risk manual indicators
        const highRiskFeatures = features.filter(f => {
            const risk = this.extractRiskIndicator(f);
            return risk === 'Red';
        });
        
        if (highRiskFeatures.length > 0) {
            risks.push({
                type: 'high_risk_features',
                severity: 'high',
                description: `${highRiskFeatures.length} features marked as high risk`,
                impact: this.riskFactors.highRiskFeatures.impact,
                features: highRiskFeatures.map(f => f.key)
            });
        }
        
        // Scope creep risk (if no fixVersion set)
        const uncommittedFeatures = features.filter(f => !f.fixVersions || f.fixVersions.length === 0);
        if (uncommittedFeatures.length > 0) {
            risks.push({
                type: 'scope_uncertainty',
                severity: 'medium',
                description: `${uncommittedFeatures.length} features without clear commitment (no fixVersion)`,
                impact: 0.1,
                features: uncommittedFeatures.map(f => f.key)
            });
        }
        
        return risks;
    }
    
    /**
     * Compare to historical releases
     */
    async compareToHistoricalReleases(releaseContext) {
        // Placeholder for historical analysis
        // In real implementation, would query historical release data
        
        return {
            similarReleases: [],
            averageSlipDays: 7,
            summary: 'Similar releases typically slip by 1 week',
            confidence: 'low',
            dataAvailable: false
        };
    }
    
    /**
     * Assess overall release risks
     */
    async assessReleaseRisks(releaseContext, analysisComponents) {
        const assessment = {
            overallRiskLevel: 'medium',
            highRiskFeatures: [],
            stuckFeatures: [],
            descopingCandidates: [],
            riskDistribution: { Green: 0, Yellow: 0, Red: 0, 'Not Set': 0 },
            mitigationStrategies: []
        };
        
        const features = releaseContext.features || [];
        
        // Analyze individual feature risks
        for (const feature of features) {
            const risk = this.extractRiskIndicator(feature);
            assessment.riskDistribution[risk]++;
            
            if (risk === 'Red') {
                assessment.highRiskFeatures.push({
                    key: feature.key,
                    risk: risk,
                    reason: 'Manual red risk indicator'
                });
            }
            
            // Check for stuck features
            const updated = new Date(feature.updated);
            const daysSinceUpdate = (new Date() - updated) / (1000 * 60 * 60 * 24);
            
            if (daysSinceUpdate > 15) {
                assessment.stuckFeatures.push({
                    key: feature.key,
                    daysStuck: Math.round(daysSinceUpdate),
                    status: feature.status?.name,
                    reason: `No updates for ${Math.round(daysSinceUpdate)} days`
                });
                
                // Potential descoping candidates
                if (daysSinceUpdate > 21) {
                    const descopingProbability = this.calculateDescopingProbability(feature, daysSinceUpdate);
                    assessment.descopingCandidates.push({
                        key: feature.key,
                        daysStuck: Math.round(daysSinceUpdate),
                        descopingProbability: descopingProbability
                    });
                }
            }
        }
        
        // Determine overall risk level
        const totalFeatures = features.length;
        const riskyFeatures = assessment.highRiskFeatures.length + assessment.stuckFeatures.length;
        const riskRatio = totalFeatures > 0 ? riskyFeatures / totalFeatures : 0;
        
        if (riskRatio >= 0.3) {
            assessment.overallRiskLevel = 'high';
        } else if (riskRatio >= 0.15) {
            assessment.overallRiskLevel = 'medium';
        } else {
            assessment.overallRiskLevel = 'low';
        }
        
        return assessment;
    }
    
    /**
     * Generate actionable recommendations
     */
    async generateRecommendations(analysis, riskAssessment, dateSimulation) {
        const recommendations = [];
        
        // Velocity recommendations
        if (analysis.velocityAnalysis.trend === 'at_risk') {
            recommendations.push("Address stuck features to improve team velocity");
        }
        
        // Risk mitigation recommendations
        if (riskAssessment.stuckFeatures.length > 0) {
            recommendations.push(`Review ${riskAssessment.stuckFeatures.length} stuck features for possible reassignment or descoping`);
        }
        
        if (riskAssessment.highRiskFeatures.length > 0) {
            recommendations.push("Focus resources on high-risk features to prevent delays");
        }
        
        // Timeline recommendations based on confidence
        if (dateSimulation.confidence < 0.7) {
            recommendations.push("Consider scope adjustment to improve timeline confidence");
        }
        
        // Proactive TPM recommendations
        if (riskAssessment.descopingCandidates.length > 0) {
            recommendations.push("TPM review recommended for potential scope adjustments");
        }
        
        return recommendations;
    }
    
    // Helper methods
    
    calculateRiskMultiplier(riskFactors) {
        let multiplier = 1.0;
        
        for (const risk of riskFactors) {
            multiplier *= (1.0 + risk.impact);
        }
        
        // Cap the risk multiplier at 2.0 (100% increase)
        return Math.min(multiplier, 2.0);
    }
    
    calculateDistribution(outcomes) {
        const total = outcomes.length;
        const buckets = {};
        
        for (const outcome of outcomes) {
            const dateKey = this.formatDate(outcome.completionDate);
            buckets[dateKey] = (buckets[dateKey] || 0) + 1;
        }
        
        // Convert to percentages
        for (const key in buckets) {
            buckets[key] = Math.round((buckets[key] / total) * 100);
        }
        
        return buckets;
    }
    
    calculateConfidenceIntervals(outcomes) {
        const intervals = {};
        
        for (const percentile of this.predictionConfig.confidenceIntervals) {
            const index = Math.floor((percentile / 100) * outcomes.length);
            intervals[`p${percentile}`] = this.formatDate(outcomes[index].completionDate);
        }
        
        return intervals;
    }
    
    calculateConfidence(outcomes, targetDate) {
        const onTimeCount = outcomes.filter(outcome => outcome.completionDate <= targetDate).length;
        return onTimeCount / outcomes.length;
    }
    
    isFeatureComplete(status) {
        const completeStatuses = [
            'Done', 'Closed', 'Complete', 'Resolved',
            'Promotion Gate Met', 'Code Complete Met'
        ];
        
        return completeStatuses.includes(status);
    }
    
    extractRiskIndicator(feature) {
        const riskField = feature.customfield_23560;
        if (!riskField) return 'Not Set';
        
        const value = typeof riskField === 'object' ? (riskField.value || riskField.name || '') : String(riskField);
        const color = typeof riskField === 'object' ? (riskField.color || '').toLowerCase() : '';
        const v = value.toLowerCase();
        
        if (color === '#dc3545' || color === 'red' || v.includes('red') || v.includes('high') || v.includes('critical')) return 'Red';
        if (color === '#ffc107' || color === 'yellow' || v.includes('yellow') || v.includes('medium') || v.includes('at risk')) return 'Yellow';
        if (color === '#28a745' || color === 'green' || v.includes('green') || v.includes('on track') || v.includes('low')) return 'Green';
        return 'Not Set';
    }
    
    calculateDescopingProbability(feature, daysStuck) {
        let probability = 0.0;
        
        // Base probability from stuck duration
        if (daysStuck > 21) probability += 0.4;
        else if (daysStuck > 15) probability += 0.2;
        
        // Priority factor
        const priority = feature.priority?.name;
        const priorityMultipliers = { P0: 0.5, P1: 0.8, P2: 1.2, P3: 1.5 };
        probability *= (priorityMultipliers[priority] || 1.0);
        
        // Risk indicator factor
        const risk = this.extractRiskIndicator(feature);
        if (risk === 'Red') probability += 0.3;
        else if (risk === 'Yellow') probability += 0.1;
        
        return Math.min(probability, 1.0);
    }
    
    formatDate(date) {
        if (typeof date === 'string') return date;
        
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
    
    async getHealth() {
        return {
            status: 'healthy',
            simulationConfig: this.predictionConfig,
            riskFactors: Object.keys(this.riskFactors).length
        };
    }
}

module.exports = ReleasePredictionAgent;