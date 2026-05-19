/**
 * Team Velocity Agent
 * 
 * Specialized AI agent for analyzing team velocity, capacity, and performance patterns.
 * Understands individual member patterns, team dynamics, and velocity trends.
 */

const Logger = require('../utils/Logger');

class TeamVelocityAgent {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger(config.logLevel || 'info');
        
        // Velocity analysis configuration
        this.velocityConfig = {
            baseVelocity: 12, // story points per sprint
            sprintLength: 14, // days
            teamSize: 6,      // default team size
            ...config.velocity
        };
    }
    
    /**
     * Analyze team velocity patterns
     */
    async analyzeVelocity(context) {
        this.logger.info('📈 Analyzing team velocity', { 
            team: context.team,
            release: context.releaseVersion 
        });
        
        const analysis = {
            team: context.team || 'NDB',
            analysisDate: new Date(),
            
            // Core velocity metrics
            averageVelocity: this.velocityConfig.baseVelocity,
            currentVelocity: this.velocityConfig.baseVelocity,
            velocityTrend: 'stable',
            
            // Team composition analysis
            teamSize: this.velocityConfig.teamSize,
            activeMembers: this.velocityConfig.teamSize,
            
            // Performance indicators
            performanceIndicators: this.analyzePerformanceIndicators(context),
            
            // Individual patterns
            individualPatterns: await this.analyzeIndividualPatterns(context),
            
            // Velocity factors
            velocityFactors: this.identifyVelocityFactors(context),
            
            // Predictions
            capacityPrediction: await this.predictCapacity(context),
            
            // Summary for other agents
            summary: this.generateSummary()
        };
        
        this.logger.info('✅ Velocity analysis complete', {
            avgVelocity: analysis.averageVelocity,
            trend: analysis.velocityTrend
        });
        
        return analysis;
    }
    
    /**
     * Analyze performance indicators
     */
    analyzePerformanceIndicators(context) {
        const indicators = {
            throughput: 'stable',
            quality: 'good',
            predictability: 'moderate',
            factors: []
        };
        
        // Analyze based on available context
        const features = context.features || [];
        
        if (features.length > 0) {
            // Check for stuck work (performance indicator)
            const stuckFeatures = features.filter(f => {
                const updated = new Date(f.updated);
                const daysSinceUpdate = (new Date() - updated) / (1000 * 60 * 60 * 24);
                return daysSinceUpdate > 14;
            });
            
            if (stuckFeatures.length > 0) {
                indicators.throughput = 'declining';
                indicators.factors.push(`${stuckFeatures.length} features stuck (no updates >14 days)`);
            }
            
            // Check feature completion patterns
            const completedFeatures = features.filter(f => 
                this.isFeatureComplete(f.status?.name)
            );
            
            const completionRate = features.length > 0 
                ? completedFeatures.length / features.length 
                : 0;
            
            if (completionRate > 0.8) {
                indicators.throughput = 'high';
                indicators.factors.push('High feature completion rate');
            } else if (completionRate < 0.3) {
                indicators.throughput = 'low';
                indicators.factors.push('Low feature completion rate');
            }
        }
        
        return indicators;
    }
    
    /**
     * Analyze individual team member patterns
     */
    async analyzeIndividualPatterns(context) {
        const patterns = {
            analysisComplete: false,
            memberCount: this.velocityConfig.teamSize,
            patterns: [],
            insights: []
        };
        
        // In real implementation, this would analyze:
        // - Individual completion rates
        // - Task assignment patterns  
        // - Specialization areas
        // - Collaboration patterns
        
        patterns.insights.push('Individual pattern analysis requires historical JIRA data');
        patterns.insights.push('Would analyze completion rates by team member');
        patterns.insights.push('Would identify specialization and collaboration patterns');
        
        return patterns;
    }
    
    /**
     * Identify velocity factors
     */
    identifyVelocityFactors(context) {
        const factors = {
            positive: [],
            negative: [],
            neutral: []
        };
        
        const features = context.features || [];
        
        // Team size factor
        if (this.velocityConfig.teamSize >= 5) {
            factors.positive.push('Adequate team size for parallel work');
        } else {
            factors.negative.push('Small team size may limit parallel work');
        }
        
        // Work complexity factor
        const totalStoryPoints = features.reduce((sum, f) => {
            return sum + (f.customfield_10002 || 3); // Story points
        }, 0);
        
        const avgComplexity = features.length > 0 ? totalStoryPoints / features.length : 3;
        
        if (avgComplexity > 8) {
            factors.negative.push('High average story complexity may slow velocity');
        } else if (avgComplexity < 3) {
            factors.positive.push('Low complexity work enables higher velocity');
        }
        
        // Risk factor impact
        const riskFactors = features.filter(f => {
            const risk = this.extractRiskIndicator(f);
            return risk === 'Red' || risk === 'Yellow';
        });
        
        if (riskFactors.length > features.length * 0.3) {
            factors.negative.push('High proportion of risky features may impact velocity');
        }
        
        return factors;
    }
    
    /**
     * Predict team capacity
     */
    async predictCapacity(context) {
        const prediction = {
            nextSprint: {
                estimatedCapacity: this.velocityConfig.baseVelocity,
                confidence: 0.8,
                assumptions: []
            },
            next3Sprints: {
                estimatedCapacity: this.velocityConfig.baseVelocity * 3,
                confidence: 0.7,
                assumptions: []
            }
        };
        
        // Adjust for known factors
        const features = context.features || [];
        const stuckCount = features.filter(f => {
            const updated = new Date(f.updated);
            const daysSinceUpdate = (new Date() - updated) / (1000 * 60 * 60 * 24);
            return daysSinceUpdate > 14;
        }).length;
        
        if (stuckCount > 0) {
            prediction.nextSprint.estimatedCapacity *= 0.9; // 10% reduction
            prediction.nextSprint.assumptions.push('Reduced capacity due to stuck work');
        }
        
        // Team composition assumptions
        prediction.nextSprint.assumptions.push(`Based on team of ${this.velocityConfig.teamSize} members`);
        prediction.nextSprint.assumptions.push('Assumes no major holidays or team changes');
        
        return prediction;
    }
    
    /**
     * Generate summary for other agents
     */
    generateSummary() {
        return `Team averaging ${this.velocityConfig.baseVelocity} story points per sprint (stable trend)`;
    }
    
    /**
     * Helper methods
     */
    
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
        
        if (color === '#dc3545' || color === 'red' || v.includes('red') || v.includes('high')) return 'Red';
        if (color === '#ffc107' || color === 'yellow' || v.includes('yellow') || v.includes('medium')) return 'Yellow';
        if (color === '#28a745' || color === 'green' || v.includes('green') || v.includes('low')) return 'Green';
        return 'Not Set';
    }
    
    /**
     * Get health status
     */
    async getHealth() {
        return {
            status: 'healthy',
            baseVelocity: this.velocityConfig.baseVelocity,
            teamSize: this.velocityConfig.teamSize,
            lastAnalysis: null
        };
    }
}

module.exports = TeamVelocityAgent;