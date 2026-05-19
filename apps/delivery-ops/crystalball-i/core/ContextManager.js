/**
 * Context Manager
 * 
 * Manages conversation context, session state, and contextual information
 * for CrystalBallI interactions. Builds rich context for AI analysis.
 */

const Logger = require('../utils/Logger');

class ContextManager {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger(config.logLevel || 'info');
        
        this.sessionContexts = new Map();
        this.releaseContexts = new Map();
        this.teamContexts = new Map();
    }
    
    /**
     * Build session context for a conversation
     */
    async buildSessionContext(inputContext) {
        const sessionContext = {
            sessionId: inputContext.conversationId || this.generateSessionId(),
            team: inputContext.team || this.config.team || 'NDB',
            timestamp: new Date(),
            source: inputContext.source || 'unknown',
            ...inputContext
        };
        
        // Add user context if available
        if (inputContext.user) {
            sessionContext.userContext = await this.buildUserContext(inputContext.user);
        }
        
        // Add team context
        sessionContext.teamContext = await this.buildTeamContext(sessionContext.team);
        
        // Store session context
        this.sessionContexts.set(sessionContext.sessionId, {
            ...sessionContext,
            createdAt: new Date(),
            lastActivity: new Date()
        });
        
        return sessionContext;
    }
    
    /**
     * Build release-specific context
     */
    async buildReleaseContext(inputContext) {
        const releaseVersion = inputContext.releaseVersion;
        
        if (this.releaseContexts.has(releaseVersion)) {
            const cached = this.releaseContexts.get(releaseVersion);
            // Return cached if less than 15 minutes old
            if (Date.now() - cached.cachedAt < 15 * 60 * 1000) {
                this.logger.debug('Using cached release context', { releaseVersion });
                return { ...cached, ...inputContext };
            }
        }
        
        const releaseContext = {
            releaseVersion,
            targetDate: inputContext.targetDate || this.inferTargetDate(releaseVersion),
            features: inputContext.features || [],
            team: inputContext.team || this.config.team,
            
            // Metadata
            contextType: 'release',
            builtAt: new Date(),
            cachedAt: Date.now(),
            
            // Additional context
            ...inputContext
        };
        
        // Enhance with team-specific context
        releaseContext.teamContext = await this.buildTeamContext(releaseContext.team);
        
        // Cache the context
        this.releaseContexts.set(releaseVersion, releaseContext);
        
        this.logger.info('Built release context', { 
            releaseVersion, 
            featureCount: releaseContext.features.length 
        });
        
        return releaseContext;
    }
    
    /**
     * Build team-specific context
     */
    async buildTeamContext(teamName = 'NDB') {
        if (this.teamContexts.has(teamName)) {
            const cached = this.teamContexts.get(teamName);
            // Return cached if less than 1 hour old
            if (Date.now() - cached.cachedAt < 60 * 60 * 1000) {
                return cached;
            }
        }
        
        const teamContext = {
            team: teamName,
            
            // Team composition (would be enhanced with real data)
            members: this.getTeamMembers(teamName),
            tpms: this.getTeamTPMs(teamName),
            
            // Team intelligence patterns
            workflowPatterns: await this.getTeamWorkflowPatterns(teamName),
            velocityPatterns: await this.getTeamVelocityPatterns(teamName),
            
            // Context metadata
            contextType: 'team',
            builtAt: new Date(),
            cachedAt: Date.now()
        };
        
        this.teamContexts.set(teamName, teamContext);
        
        return teamContext;
    }
    
    /**
     * Build user-specific context
     */
    async buildUserContext(user) {
        const userContext = {
            username: user.username,
            role: this.determineUserRole(user.username),
            permissions: this.getUserPermissions(user.username),
            
            // User preferences (could be enhanced)
            preferences: {
                verbosity: 'medium',
                includeRecommendations: true,
                includeReasoning: true
            }
        };
        
        return userContext;
    }
    
    /**
     * Get team members for a team
     */
    getTeamMembers(teamName) {
        // In real implementation, this would query actual team data
        const teamMembers = {
            'NDB': [
                'john.doe', 'jane.smith', 'bob.johnson', 'alice.wilson',
                'namratha.singh', 'sneha.xyz' // TPMs
            ]
        };
        
        return teamMembers[teamName] || [];
    }
    
    /**
     * Get TPMs for a team
     */
    getTeamTPMs(teamName) {
        const tpms = {
            'NDB': ['namratha.singh', 'sneha.xyz']
        };
        
        return tpms[teamName] || [];
    }
    
    /**
     * Get team workflow patterns
     */
    async getTeamWorkflowPatterns(teamName) {
        // Return team-specific workflow intelligence
        return {
            releaseGates: ['Concept Commit', 'Execute Commit', 'Code Complete', 'Promotion Gate'],
            fieldUsagePatterns: {
                'fixVersion': 'commitment_indicator',
                'labels': 'wishlist_tracking'
            },
            descopingPatterns: {
                targetFixVersions: ['Future', 'Era Future']
            }
        };
    }
    
    /**
     * Get team velocity patterns
     */
    async getTeamVelocityPatterns(teamName) {
        // Return historical velocity intelligence
        return {
            averageSprintVelocity: 12,
            sprintLength: 14,
            velocityTrend: 'stable',
            seasonalFactors: []
        };
    }
    
    /**
     * Determine user role based on username
     */
    determineUserRole(username) {
        const roleMapping = {
            'namratha.singh': 'TPM',
            'sneha.xyz': 'TPM'
        };
        
        return roleMapping[username] || 'Developer';
    }
    
    /**
     * Get user permissions
     */
    getUserPermissions(username) {
        const role = this.determineUserRole(username);
        
        const permissions = {
            TPM: ['release_planning', 'scope_management', 'team_coordination'],
            Developer: ['feature_development', 'status_updates'],
            QA: ['test_execution', 'quality_validation']
        };
        
        return permissions[role] || permissions.Developer;
    }
    
    /**
     * Infer target date from release version
     */
    inferTargetDate(releaseVersion) {
        // Simple heuristic - would be enhanced with real release planning data
        const match = releaseVersion.match(/(\d+)\.(\d+)/);
        if (match) {
            const major = parseInt(match[1]);
            const minor = parseInt(match[2]);
            
            // Assume quarterly releases
            const baseDate = new Date('2026-01-01');
            const quarterMonths = minor * 3;
            baseDate.setMonth(baseDate.getMonth() + quarterMonths);
            
            return baseDate.toISOString().split('T')[0];
        }
        
        // Default to 3 months from now
        const date = new Date();
        date.setMonth(date.getMonth() + 3);
        return date.toISOString().split('T')[0];
    }
    
    /**
     * Update session activity
     */
    updateSessionActivity(sessionId) {
        if (this.sessionContexts.has(sessionId)) {
            const session = this.sessionContexts.get(sessionId);
            session.lastActivity = new Date();
            this.sessionContexts.set(sessionId, session);
        }
    }
    
    /**
     * Get session context
     */
    getSessionContext(sessionId) {
        return this.sessionContexts.get(sessionId);
    }
    
    /**
     * Cleanup old contexts
     */
    cleanupOldContexts() {
        const now = Date.now();
        const sessionTimeout = 2 * 60 * 60 * 1000; // 2 hours
        const releaseTimeout = 60 * 60 * 1000;     // 1 hour
        const teamTimeout = 4 * 60 * 60 * 1000;    // 4 hours
        
        // Cleanup sessions
        for (const [sessionId, session] of this.sessionContexts) {
            if (now - session.lastActivity > sessionTimeout) {
                this.sessionContexts.delete(sessionId);
            }
        }
        
        // Cleanup release contexts
        for (const [releaseVersion, context] of this.releaseContexts) {
            if (now - context.cachedAt > releaseTimeout) {
                this.releaseContexts.delete(releaseVersion);
            }
        }
        
        // Cleanup team contexts
        for (const [teamName, context] of this.teamContexts) {
            if (now - context.cachedAt > teamTimeout) {
                this.teamContexts.delete(teamName);
            }
        }
    }
    
    /**
     * Generate session ID
     */
    generateSessionId() {
        return `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Get health status
     */
    async getHealth() {
        return {
            activeSessions: this.sessionContexts.size,
            cachedReleases: this.releaseContexts.size,
            cachedTeams: this.teamContexts.size,
            status: 'healthy'
        };
    }
}

module.exports = ContextManager;