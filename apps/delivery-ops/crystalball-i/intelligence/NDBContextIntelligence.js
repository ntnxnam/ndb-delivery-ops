/**
 * NDB Context Intelligence
 * 
 * Core intelligence system that understands NDB-specific JIRA usage patterns,
 * field semantics, TPM behaviors, and team dynamics. This is what makes
 * CrystalBallI smart about NDB workflows rather than being a generic tool.
 */

const Logger = require('../utils/Logger');

class NDBContextIntelligence {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger(config.logLevel || 'info');
        this.intelligenceBase = new Map();
        this.initialized = false;
        
        // Core NDB intelligence patterns
        this.ndbPatterns = {
            fieldSemantics: new Map(),
            roleActions: new Map(),
            labelPatterns: new Map(),
            gateTimings: new Map(),
            descopingPatterns: new Map()
        };
    }
    
    async initialize() {
        this.logger.info('🧠 Initializing NDB Context Intelligence...');
        
        try {
            await this.loadCoreIntelligence();
            await this.loadRolePatterns();
            await this.loadGateIntelligence();
            await this.loadDescopingPatterns();
            
            this.initialized = true;
            this.logger.info('✅ NDB Context Intelligence initialized');
            
        } catch (error) {
            this.logger.error('❌ Failed to initialize NDB intelligence:', error);
            throw error;
        }
    }
    
    /**
     * Load core NDB intelligence patterns
     */
    async loadCoreIntelligence() {
        // Field semantics - what JIRA fields mean in NDB context
        const fieldSemantics = {
            // Release planning indicators
            'fixVersion': {
                context: 'commitment_indicator',
                meaning: 'Team has made commitment to deliver in this release',
                confidence: 'high',
                businessImpact: 'Resource allocation and timeline commitment'
            },
            
            // Labels with specific meanings
            'labels': {
                patterns: {
                    'ndb-X.Y-wishlist': {
                        meaning: 'Request for inclusion, no commitment made',
                        confidence: 'medium',
                        workflow_stage: 'planning'
                    }
                }
            },
            
            // Risk indicators
            'customfield_23560': {
                context: 'risk_assessment',
                meaning: 'Manual risk indicator set by team',
                values: {
                    'Green': 'on_track',
                    'Yellow': 'at_risk',
                    'Red': 'high_risk',
                    'Not Set': 'unknown'
                }
            },
            
            // Quality indicators  
            'customfield_23073': {
                context: 'quality_metrics',
                meaning: 'QI percentage, test execution, bug counts',
                format: 'QI: X%, execution Y%, Z bugs'
            },
            
            // Date fields by issue hierarchy
            'customfield_11067': {
                context: 'code_complete_date',
                applicable_types: ['X-FEAT', 'Capability', 'Feature', 'Initiative']
            },
            'customfield_35863': {
                context: 'commit_gate_date',
                applicable_types: ['X-FEAT', 'Capability', 'Feature', 'Initiative']
            },
            'customfield_35864': {
                context: 'promotion_gate_date', 
                applicable_types: ['X-FEAT', 'Capability', 'Feature', 'Initiative']
            },
            'duedate': {
                context: 'due_date',
                applicable_types: ['Epic']
            }
        };
        
        this.ndbPatterns.fieldSemantics = new Map(Object.entries(fieldSemantics));
        this.logger.info('📋 Loaded field semantics', { count: fieldSemantics.length });
    }
    
    /**
     * Load role-based action patterns
     */
    async loadRolePatterns() {
        const rolePatterns = {
            TPM: {
                members: ['namratha.singh', 'sneha.xyz'], // TODO: Make configurable
                capabilities: [
                    'release_planning',
                    'scope_management', 
                    'resource_allocation',
                    'cross_team_coordination',
                    'milestone_management'
                ],
                typicalActions: {
                    'fixVersion_changes': {
                        meaning: 'Release scope management decision',
                        businessImpact: 'Commitment or descoping decision',
                        confidence: 'high'
                    },
                    'bulk_assignee_updates': {
                        meaning: 'Team capacity rebalancing',
                        triggers: ['team_member_departure', 'workload_imbalance', 'skill_matching'],
                        confidence: 'high'
                    },
                    'label_management': {
                        meaning: 'Release planning coordination',
                        patterns: ['wishlist_to_commit', 'priority_adjustments'],
                        confidence: 'medium'
                    }
                },
                interventionTiming: {
                    trigger: 'gate_proximity',
                    typical_actions: ['descoping', 'resource_rebalancing', 'timeline_adjustments'],
                    prediction_confidence: 'high'
                }
            },
            
            Developer: {
                capabilities: [
                    'status_progression',
                    'technical_execution',
                    'code_completion',
                    'blocker_reporting'
                ],
                typicalActions: {
                    'status_updates': {
                        meaning: 'Individual work progress',
                        confidence: 'high'
                    },
                    'story_point_updates': {
                        meaning: 'Effort estimation refinement',
                        confidence: 'medium'
                    }
                }
            },
            
            QA: {
                responsibilities: {
                    automation: {
                        field_indicator: 'assignee',
                        issue_type: 'Test',
                        meaning: 'QA owns test automation for this feature'
                    },
                    verification: {
                        field_indicator: 'customfield_XXXXX', // QA Contact field
                        issue_type: 'Bug',
                        meaning: 'QA owns verification of this defect'
                    }
                }
            }
        };
        
        this.ndbPatterns.roleActions = new Map(Object.entries(rolePatterns));
        this.logger.info('👥 Loaded role patterns', { roles: Object.keys(rolePatterns).length });
    }
    
    /**
     * Load gate timing intelligence
     */
    async loadGateIntelligence() {
        const gatePatterns = {
            release_gates: [
                'Concept Commit Gate',
                'Execute Commit Gate', 
                'Code Complete Gate',
                'Promotion Gate'
            ],
            
            intervention_patterns: {
                timing: 'around_gates',
                universal: true, // Applies to all teams
                typical_window: '1-2 weeks before gate',
                
                predicted_actions: [
                    {
                        action: 'descoping',
                        trigger: 'stuck_features_near_gate',
                        probability_factors: [
                            'days_stuck > 15',
                            'gate_proximity < 14_days',
                            'feature_complexity = high'
                        ]
                    },
                    {
                        action: 'resource_rebalancing',
                        trigger: 'capacity_constraints',
                        probability_factors: [
                            'team_velocity_declining',
                            'multiple_features_at_risk',
                            'gate_proximity < 21_days'
                        ]
                    }
                ]
            }
        };
        
        this.ndbPatterns.gateTimings = new Map(Object.entries(gatePatterns));
        this.logger.info('🚪 Loaded gate timing patterns');
    }
    
    /**
     * Load descoping pattern intelligence
     */
    async loadDescopingPatterns() {
        const descopingPatterns = {
            descoping_indicators: {
                fixVersion_changes: {
                    from: /^NDB-\d+\.\d+$/,
                    to: ['Future', 'Era Future'],
                    meaning: {
                        'Future': 'Indefinitely postponed',
                        'Era Future': 'Planned for next major version (Era)'
                    },
                    business_impact: 'scope_reduction',
                    confidence: 'high'
                }
            },
            
            descoping_predictors: {
                stuck_duration_threshold: 15, // days
                gate_proximity_threshold: 14, // days
                complexity_factors: ['story_points > 13', 'multiple_dependencies', 'external_blockers'],
                
                risk_multipliers: {
                    p0_priority: 0.7, // P0s less likely to be descoped
                    p1_priority: 1.0,
                    p2_priority: 1.3, // P2s more likely to be descoped
                    p3_priority: 1.5
                }
            }
        };
        
        this.ndbPatterns.descopingPatterns = new Map(Object.entries(descopingPatterns));
        this.logger.info('📉 Loaded descoping patterns');
    }
    
    /**
     * Analyze release context with NDB intelligence
     */
    async analyzeReleaseContext(releaseContext) {
        if (!this.initialized) {
            throw new Error('NDB Intelligence not initialized');
        }
        
        this.logger.info('🔍 Analyzing release context', { 
            release: releaseContext.releaseVersion 
        });
        
        const analysis = {
            release: releaseContext.releaseVersion,
            targetDate: releaseContext.targetDate,
            timestamp: new Date(),
            
            // Core analysis components
            fieldAnalysis: await this.analyzeFieldUsage(releaseContext.features || []),
            commitmentAnalysis: await this.analyzeCommitmentStrength(releaseContext.features || []),
            riskAnalysis: await this.analyzeRiskFactors(releaseContext.features || []),
            teamDynamics: await this.analyzeTeamDynamics(releaseContext),
            gateAnalysis: await this.analyzeGateProximity(releaseContext),
            descopingPrediction: await this.predictDescopingActions(releaseContext.features || [])
        };
        
        // Synthesize overall insights
        analysis.insights = await this.synthesizeInsights(analysis);
        
        return analysis;
    }
    
    /**
     * Analyze field usage patterns in features
     */
    async analyzeFieldUsage(features) {
        const analysis = {
            totalFeatures: features.length,
            fieldUsagePatterns: {},
            semanticInsights: []
        };
        
        for (const feature of features) {
            // Analyze commitment indicators
            if (feature.fixVersions && feature.fixVersions.length > 0) {
                const fixVersion = feature.fixVersions[0].name;
                if (fixVersion.match(/^NDB-\d+\.\d+$/)) {
                    analysis.semanticInsights.push({
                        feature: feature.key,
                        insight: 'team_commitment',
                        confidence: 'high',
                        meaning: `Team committed to deliver ${feature.key} in ${fixVersion}`
                    });
                }
            }
            
            // Analyze label patterns
            if (feature.labels) {
                for (const label of feature.labels) {
                    if (label.match(/ndb-\d+\.\d+-wishlist/)) {
                        analysis.semanticInsights.push({
                            feature: feature.key,
                            insight: 'wishlist_request',
                            confidence: 'medium', 
                            meaning: `${feature.key} requested for release but no commitment made`
                        });
                    }
                }
            }
        }
        
        return analysis;
    }
    
    /**
     * Analyze commitment strength based on field patterns
     */
    async analyzeCommitmentStrength(features) {
        const commitmentLevels = {
            high: [], // fixVersion set
            medium: [], // wishlist label
            low: [], // neither
            conflicted: [] // both wishlist and fixVersion
        };
        
        for (const feature of features) {
            const hasFixVersion = feature.fixVersions && feature.fixVersions.length > 0;
            const hasWishlistLabel = feature.labels && 
                feature.labels.some(label => label.match(/ndb-\d+\.\d+-wishlist/));
            
            if (hasFixVersion && hasWishlistLabel) {
                commitmentLevels.conflicted.push(feature.key);
            } else if (hasFixVersion) {
                commitmentLevels.high.push(feature.key);
            } else if (hasWishlistLabel) {
                commitmentLevels.medium.push(feature.key);
            } else {
                commitmentLevels.low.push(feature.key);
            }
        }
        
        return {
            commitmentDistribution: commitmentLevels,
            totalCommitted: commitmentLevels.high.length,
            totalWishlist: commitmentLevels.medium.length,
            conflictsRequiringAttention: commitmentLevels.conflicted
        };
    }
    
    /**
     * Analyze risk factors using NDB context
     */
    async analyzeRiskFactors(features) {
        const riskAnalysis = {
            highRiskFeatures: [],
            stuckFeatures: [],
            descopingCandidates: [],
            riskDistribution: { Green: 0, Yellow: 0, Red: 0, 'Not Set': 0 }
        };
        
        const now = new Date();
        
        for (const feature of features) {
            // Risk indicator analysis
            const riskIndicator = this.extractRiskIndicator(feature);
            riskAnalysis.riskDistribution[riskIndicator]++;
            
            if (riskIndicator === 'Red') {
                riskAnalysis.highRiskFeatures.push({
                    key: feature.key,
                    risk: riskIndicator,
                    reason: 'Manual red risk indicator'
                });
            }
            
            // Analyze stuck features (status + time analysis)
            const stuckAnalysis = await this.analyzeStuckFeature(feature, now);
            if (stuckAnalysis.isStuck) {
                riskAnalysis.stuckFeatures.push({
                    key: feature.key,
                    daysStuck: stuckAnalysis.daysStuck,
                    status: feature.status?.name,
                    reason: stuckAnalysis.reason
                });
                
                // Predict descoping candidates
                if (stuckAnalysis.daysStuck > 15) {
                    riskAnalysis.descopingCandidates.push({
                        key: feature.key,
                        daysStuck: stuckAnalysis.daysStuck,
                        descopingProbability: this.calculateDescopingProbability(feature, stuckAnalysis)
                    });
                }
            }
        }
        
        return riskAnalysis;
    }
    
    /**
     * Predict TPM descoping actions based on patterns
     */
    async predictDescopingActions(features) {
        const predictions = {
            likelyDescopingActions: [],
            timeline: 'within_1_week',
            confidence: 'medium',
            reasoning: []
        };
        
        const descopingPatterns = this.ndbPatterns.descopingPatterns.get('descoping_predictors');
        
        for (const feature of features) {
            const descopingProbability = this.calculateDescopingProbability(feature);
            
            if (descopingProbability > 0.6) {
                predictions.likelyDescopingActions.push({
                    feature: feature.key,
                    probability: descopingProbability,
                    predictedAction: 'descope_to_future',
                    reasoning: this.generateDescopingReasoning(feature)
                });
            }
        }
        
        return predictions;
    }
    
    /**
     * Synthesize overall insights from analysis
     */
    async synthesizeInsights(analysis) {
        const insights = [];
        
        // Commitment insights
        if (analysis.commitmentAnalysis.totalCommitted > 0) {
            insights.push({
                type: 'commitment',
                message: `${analysis.commitmentAnalysis.totalCommitted} features have team commitment (fixVersion set)`,
                confidence: 'high'
            });
        }
        
        // Risk insights  
        if (analysis.riskAnalysis.highRiskFeatures.length > 0) {
            insights.push({
                type: 'risk',
                message: `${analysis.riskAnalysis.highRiskFeatures.length} features marked as high risk`,
                confidence: 'high'
            });
        }
        
        // Descoping predictions
        if (analysis.descopingPrediction.likelyDescopingActions.length > 0) {
            insights.push({
                type: 'prediction',
                message: `Predict ${analysis.descopingPrediction.likelyDescopingActions.length} features likely to be descoped`,
                confidence: analysis.descopingPrediction.confidence
            });
        }
        
        return insights;
    }
    
    // Helper methods
    
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
    
    async analyzeStuckFeature(feature, currentDate) {
        // Simple heuristic - in real implementation, would analyze changelog
        const status = feature.status?.name;
        const updated = new Date(feature.updated);
        const daysSinceUpdate = Math.floor((currentDate - updated) / (1000 * 60 * 60 * 24));
        
        const stuckThresholds = {
            'In Progress': 14,
            'Code Review': 7,
            'Testing': 10,
            'Blocked': 3
        };
        
        const threshold = stuckThresholds[status] || 21;
        const isStuck = daysSinceUpdate > threshold;
        
        return {
            isStuck,
            daysStuck: daysSinceUpdate,
            threshold,
            reason: isStuck ? `No updates for ${daysSinceUpdate} days in ${status}` : null
        };
    }
    
    calculateDescopingProbability(feature, stuckAnalysis = null) {
        let probability = 0.0;
        
        // Base probability factors
        if (stuckAnalysis?.isStuck) {
            probability += 0.3;
            if (stuckAnalysis.daysStuck > 21) probability += 0.2;
        }
        
        // Priority factor
        const priority = feature.priority?.name;
        const priorityMultipliers = { P0: 0.7, P1: 1.0, P2: 1.3, P3: 1.5 };
        probability *= (priorityMultipliers[priority] || 1.0);
        
        // Risk indicator factor
        const risk = this.extractRiskIndicator(feature);
        if (risk === 'Red') probability += 0.2;
        if (risk === 'Yellow') probability += 0.1;
        
        return Math.min(probability, 1.0);
    }
    
    generateDescopingReasoning(feature) {
        const reasons = [];
        
        const risk = this.extractRiskIndicator(feature);
        if (risk === 'Red') reasons.push('Manual red risk indicator');
        
        const priority = feature.priority?.name;
        if (priority === 'P2' || priority === 'P3') {
            reasons.push(`${priority} priority makes descoping more likely`);
        }
        
        return reasons;
    }
    
    async analyzeTeamDynamics(releaseContext) {
        // Placeholder - would analyze team composition, velocity trends, etc.
        return {
            teamSize: releaseContext.teamMembers?.length || 'unknown',
            recentChanges: 'analysis_not_implemented',
            velocityTrend: 'analysis_not_implemented'
        };
    }
    
    async analyzeGateProximity(releaseContext) {
        // Placeholder - would calculate proximity to release gates
        return {
            nextGate: 'Code Complete Gate',
            daysUntilGate: 14,
            interventionProbability: 'high'
        };
    }
    
    /**
     * Update intelligence with new patterns
     */
    async updateIntelligence(domain, newIntelligence) {
        if (!this.ndbPatterns.has(domain)) {
            this.ndbPatterns.set(domain, new Map());
        }
        
        const domainIntelligence = this.ndbPatterns.get(domain);
        
        for (const [key, value] of Object.entries(newIntelligence)) {
            domainIntelligence.set(key, value);
        }
        
        this.logger.info('🧠 Intelligence updated', { domain, updates: Object.keys(newIntelligence).length });
    }
    
    /**
     * Get system health
     */
    async getHealth() {
        return {
            initialized: this.initialized,
            patternsLoaded: this.ndbPatterns ? Object.keys(this.ndbPatterns).length : 0,
            lastUpdate: new Date()
        };
    }
    
    async cleanup() {
        if (this.ndbPatterns) {
            this.ndbPatterns.fieldSemantics?.clear();
            this.ndbPatterns.roleActions?.clear();
            this.ndbPatterns.labelPatterns?.clear();
            this.ndbPatterns.gateTimings?.clear();
            this.ndbPatterns.descopingPatterns?.clear();
        }
        this.intelligenceBase?.clear();
        this.initialized = false;
    }
}

module.exports = NDBContextIntelligence;