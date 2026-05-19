/**
 * CrystalBallI - Main Entry Point
 * 
 * Intelligent Release Prediction Engine with Conversational Interface
 * Built for NDB team with self-learning capabilities and VooDoo integration
 */

const CrystalBallI = require('./core/CrystalBallI');
const VooDooIntegration = require('./integrations/VooDooIntegration');
const Logger = require('./utils/Logger');

// Default configuration
const DEFAULT_CONFIG = {
    team: 'NDB',
    enabled: true,
    learningEnabled: true,
    logLevel: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    
    // Server configuration for standalone mode
    server: {
        port: process.env.CRYSTALBALL_PORT || 3001,
        host: process.env.CRYSTALBALL_HOST || 'localhost'
    },
    
    // Integration configuration
    voodooIntegration: {
        enabled: true,
        apiPrefix: '/api/crystalball-i',
        websocketPath: '/crystalball-i/ws'
    }
};

/**
 * Create CrystalBallI instance
 */
function createCrystalBallI(config = {}) {
    const mergedConfig = {
        ...DEFAULT_CONFIG,
        ...config
    };
    
    return new CrystalBallI(mergedConfig);
}

/**
 * Create VooDoo integration
 */
function createVooDooIntegration(config = {}) {
    const mergedConfig = {
        ...DEFAULT_CONFIG,
        ...config
    };
    
    return new VooDooIntegration(mergedConfig);
}

/**
 * Start CrystalBallI as standalone server
 */
async function startStandaloneServer(config = {}) {
    const logger = new Logger(config.logLevel || DEFAULT_CONFIG.logLevel);
    
    try {
        logger.info('🚀 Starting CrystalBallI standalone server...');
        
        // Create integration instance
        const integration = createVooDooIntegration(config);
        await integration.initialize();
        
        // Create Express app
        const express = require('express');
        const cors = require('cors');
        const helmet = require('helmet');
        const compression = require('compression');
        const http = require('http');
        
        const app = express();
        const server = http.createServer(app);
        
        // Middleware
        app.use(helmet());
        app.use(compression());
        app.use(cors());
        app.use(express.json({ limit: '10mb' }));
        
        // Health check endpoint
        app.get('/health', (req, res) => {
            res.json({
                service: 'CrystalBallI',
                status: 'healthy',
                version: require('./package.json').version,
                timestamp: new Date()
            });
        });
        
        // CrystalBallI API routes
        const apiRouter = integration.createAPIRouter();
        app.use(config.voodooIntegration?.apiPrefix || '/api/crystalball-i', apiRouter);
        
        // WebSocket server
        const wss = integration.createWebSocketServer(server);
        
        // Start server
        const port = config.server?.port || DEFAULT_CONFIG.server.port;
        const host = config.server?.host || DEFAULT_CONFIG.server.host;
        
        server.listen(port, host, () => {
            logger.info('✅ CrystalBallI server started', { 
                host, 
                port,
                apiEndpoint: `http://${host}:${port}/api/crystalball-i`,
                websocketEndpoint: `ws://${host}:${port}/crystalball-i/ws`
            });
        });
        
        // Graceful shutdown
        process.on('SIGTERM', async () => {
            logger.info('🛑 Shutting down CrystalBallI server...');
            wss.close();
            await integration.cleanup();
            server.close(() => {
                logger.info('✅ Server shutdown complete');
                process.exit(0);
            });
        });
        
        return { app, server, wss, integration };
        
    } catch (error) {
        logger.error('❌ Failed to start CrystalBallI server:', error);
        throw error;
    }
}

/**
 * Integration with existing Express app (VooDoo)
 */
function integrateWithVooDoo(app, server, config = {}) {
    const logger = new Logger(config.logLevel || DEFAULT_CONFIG.logLevel);
    
    logger.info('🔗 Integrating CrystalBallI with VooDoo...');
    
    // Create integration instance
    const integration = createVooDooIntegration(config);
    
    // Add API routes immediately (before initialization)
    const apiRouter = integration.createAPIRouter();
    app.use('/api/crystalball-i', apiRouter);
    
    // Initialize in background
    integration.initialize().then(() => {
        logger.info('✅ CrystalBallI integration ready');
        
        // Add WebSocket support if server provided
        if (server) {
            const wss = integration.createWebSocketServer(server);
            logger.info('🌐 WebSocket server integrated');
        }
        
    }).catch(error => {
        logger.error('❌ CrystalBallI integration failed:', error);
    });
    
    return integration;
}

module.exports = {
    // Core exports
    CrystalBallI,
    VooDooIntegration,
    
    // Factory functions
    createCrystalBallI,
    createVooDooIntegration,
    
    // Server functions
    startStandaloneServer,
    integrateWithVooDoo,
    
    // Configuration
    DEFAULT_CONFIG
};

// If this file is run directly, start standalone server
if (require.main === module) {
    const config = {
        logLevel: 'info'
    };
    
    startStandaloneServer(config).catch(error => {
        console.error('Failed to start CrystalBallI:', error);
        process.exit(1);
    });
}