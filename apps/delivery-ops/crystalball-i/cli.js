#!/usr/bin/env node

/**
 * CrystalBallI CLI
 * 
 * Command-line interface for CrystalBallI operations:
 * - Initialize and configure
 * - Interactive chat mode
 * - Status and health checks
 * - Predictions and analysis
 */

const { createCrystalBallI } = require('./index');
const Logger = require('./utils/Logger');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

class CrystalBallICLI {
    constructor() {
        this.logger = new Logger('info');
        this.crystalBallI = null;
        this.configPath = path.join(__dirname, '.crystalball-i.json');
        
        // Load configuration
        this.config = this.loadConfig();
    }
    
    /**
     * Main CLI entry point
     */
    async run(args) {
        const command = args[0];
        const subArgs = args.slice(1);
        
        try {
            switch (command) {
                case 'init':
                    await this.initCommand();
                    break;
                    
                case 'chat':
                    await this.chatCommand(subArgs);
                    break;
                    
                case 'predict':
                    await this.predictCommand(subArgs);
                    break;
                    
                case 'status':
                    await this.statusCommand();
                    break;
                    
                case 'config':
                    await this.configCommand(subArgs);
                    break;
                    
                case 'test':
                    await this.testCommand(subArgs);
                    break;
                    
                case 'help':
                case '--help':
                case '-h':
                default:
                    this.showHelp();
                    break;
            }
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    }
    
    /**
     * Initialize CrystalBallI configuration
     */
    async initCommand() {
        console.log('🔮 Initializing CrystalBallI...\n');
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const question = (prompt) => new Promise((resolve) => {
            rl.question(prompt, resolve);
        });
        
        try {
            // Gather configuration
            const team = await question('Team name [NDB]: ') || 'NDB';
            const enableLearning = (await question('Enable learning? [Y/n]: ')).toLowerCase() !== 'n';
            const logLevel = await question('Log level (debug/info/warn/error) [info]: ') || 'info';
            
            const config = {
                team,
                enabled: true,
                learningEnabled: enableLearning,
                logLevel,
                initializedAt: new Date().toISOString(),
                version: require('./package.json').version
            };
            
            // Save configuration
            this.saveConfig(config);
            
            // Test initialization
            console.log('\n🧪 Testing initialization...');
            const crystalBallI = createCrystalBallI(config);
            await crystalBallI.initialize();
            
            const status = await crystalBallI.getStatus();
            
            console.log('✅ CrystalBallI initialized successfully!');
            console.log(`   Team: ${config.team}`);
            console.log(`   Learning: ${config.learningEnabled ? 'Enabled' : 'Disabled'}`);
            console.log(`   Status: ${status.initialized ? 'Ready' : 'Not Ready'}\n`);
            
            await crystalBallI.cleanup();
            
        } finally {
            rl.close();
        }
    }
    
    /**
     * Interactive chat mode
     */
    async chatCommand(args) {
        console.log('🔮 CrystalBallI Chat Mode');
        console.log('Ask me questions about releases, risks, team velocity, etc.');
        console.log('Type "exit" to quit, "help" for examples.\n');
        
        // Initialize CrystalBallI
        this.crystalBallI = createCrystalBallI(this.config);
        await this.crystalBallI.initialize();
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: '🔮 > '
        });
        
        const context = {
            releaseVersion: args[0] || 'NDB-2.11',
            conversationId: this.generateConversationId()
        };
        
        console.log(`Context: Release ${context.releaseVersion}`);
        console.log(`Conversation ID: ${context.conversationId}\n`);
        
        rl.prompt();
        
        rl.on('line', async (input) => {
            const question = input.trim();
            
            if (question.toLowerCase() === 'exit') {
                console.log('👋 Goodbye!');
                rl.close();
                await this.crystalBallI.cleanup();
                return;
            }
            
            if (question.toLowerCase() === 'help') {
                this.showChatHelp();
                rl.prompt();
                return;
            }
            
            if (question === '') {
                rl.prompt();
                return;
            }
            
            try {
                console.log('🤔 Thinking...\n');
                
                const response = await this.crystalBallI.ask(question, context);
                
                console.log(`💬 ${response.answer}`);
                
                if (response.confidence !== undefined) {
                    console.log(`\n📊 Confidence: ${Math.round(response.confidence * 100)}%`);
                }
                
                if (response.reasoning) {
                    console.log(`🧠 Reasoning: ${response.reasoning}`);
                }
                
                if (response.followUpQuestions && response.followUpQuestions.length > 0) {
                    console.log('\n💡 You might also ask:');
                    response.followUpQuestions.forEach((q, i) => {
                        console.log(`   ${i + 1}. ${q}`);
                    });
                }
                
                console.log('');
                
            } catch (error) {
                console.log(`❌ Error: ${error.message}\n`);
            }
            
            rl.prompt();
        });
        
        rl.on('close', async () => {
            if (this.crystalBallI) {
                await this.crystalBallI.cleanup();
            }
            process.exit(0);
        });
    }
    
    /**
     * Prediction command
     */
    async predictCommand(args) {
        const releaseVersion = args[0];
        const targetDate = args[1];
        
        if (!releaseVersion) {
            console.error('❌ Release version required');
            console.log('Usage: crystalball-i predict <release-version> [target-date]');
            console.log('Example: crystalball-i predict NDB-2.11 2026-06-15');
            return;
        }
        
        console.log(`🎯 Predicting release landing for ${releaseVersion}...`);
        
        // Initialize CrystalBallI
        this.crystalBallI = createCrystalBallI(this.config);
        await this.crystalBallI.initialize();
        
        try {
            const prediction = await this.crystalBallI.predictReleaseLanding(
                releaseVersion,
                targetDate || this.inferTargetDate(releaseVersion),
                { team: this.config.team }
            );
            
            console.log('\n📊 Prediction Results:');
            console.log(`   Release: ${prediction.releaseVersion}`);
            console.log(`   Target Date: ${prediction.targetDate}`);
            console.log(`   Predicted Landing: ${prediction.predictedDate}`);
            console.log(`   Confidence: ${Math.round(prediction.confidence * 100)}%`);
            
            if (prediction.keyFactors && prediction.keyFactors.length > 0) {
                console.log('\n🔍 Key Factors:');
                prediction.keyFactors.forEach(factor => {
                    console.log(`   • ${factor}`);
                });
            }
            
            if (prediction.riskAnalysis) {
                const risks = prediction.riskAnalysis;
                console.log('\n⚠️ Risk Analysis:');
                console.log(`   High Risk Features: ${risks.highRiskFeatures?.length || 0}`);
                console.log(`   Stuck Features: ${risks.stuckFeatures?.length || 0}`);
                console.log(`   Descoping Candidates: ${risks.descopingCandidates?.length || 0}`);
            }
            
            if (prediction.recommendations && prediction.recommendations.length > 0) {
                console.log('\n📋 Recommendations:');
                prediction.recommendations.forEach(rec => {
                    console.log(`   • ${rec}`);
                });
            }
            
        } catch (error) {
            console.error(`❌ Prediction failed: ${error.message}`);
        } finally {
            await this.crystalBallI.cleanup();
        }
    }
    
    /**
     * Status command
     */
    async statusCommand() {
        console.log('🔍 CrystalBallI Status...\n');
        
        try {
            // Initialize CrystalBallI
            this.crystalBallI = createCrystalBallI(this.config);
            await this.crystalBallI.initialize();
            
            const status = await this.crystalBallI.getStatus();
            
            console.log('📊 System Status:');
            console.log(`   Initialized: ${status.initialized ? '✅' : '❌'}`);
            console.log(`   Enabled: ${status.enabled ? '✅' : '❌'}`);
            console.log(`   Team: ${status.team}`);
            console.log(`   Learning: ${status.learningEnabled ? '✅' : '❌'}`);
            console.log(`   Active Conversations: ${status.activeConversations}`);
            
            if (status.components) {
                console.log('\n🔧 Components:');
                for (const [component, health] of Object.entries(status.components)) {
                    const healthStatus = health.status === 'healthy' ? '✅' : '❌';
                    console.log(`   ${component}: ${healthStatus}`);
                }
            }
            
            await this.crystalBallI.cleanup();
            
        } catch (error) {
            console.error(`❌ Status check failed: ${error.message}`);
        }
    }
    
    /**
     * Configuration command
     */
    async configCommand(args) {
        const subCommand = args[0];
        
        switch (subCommand) {
            case 'show':
                console.log('⚙️ Current Configuration:');
                console.log(JSON.stringify(this.config, null, 2));
                break;
                
            case 'set':
                const key = args[1];
                const value = args[2];
                
                if (!key || value === undefined) {
                    console.error('❌ Usage: crystalball-i config set <key> <value>');
                    return;
                }
                
                this.setConfigValue(key, value);
                this.saveConfig(this.config);
                console.log(`✅ Set ${key} = ${value}`);
                break;
                
            case 'reset':
                this.config = this.getDefaultConfig();
                this.saveConfig(this.config);
                console.log('✅ Configuration reset to defaults');
                break;
                
            default:
                console.log('⚙️ Configuration commands:');
                console.log('  show    - Display current configuration');
                console.log('  set     - Set configuration value');
                console.log('  reset   - Reset to default configuration');
        }
    }
    
    /**
     * Test command
     */
    async testCommand(args) {
        const testType = args[0] || 'basic';
        
        console.log(`🧪 Running ${testType} tests...\n`);
        
        switch (testType) {
            case 'basic':
                await this.runBasicTests();
                break;
                
            case 'chat':
                await this.runChatTests();
                break;
                
            case 'prediction':
                await this.runPredictionTests();
                break;
                
            default:
                console.log('Available tests: basic, chat, prediction');
        }
    }
    
    /**
     * Run basic functionality tests
     */
    async runBasicTests() {
        const tests = [
            { name: 'Configuration Load', test: () => this.config !== null },
            { name: 'CrystalBallI Creation', test: async () => {
                const instance = createCrystalBallI(this.config);
                return instance !== null;
            }},
            { name: 'Initialization', test: async () => {
                const instance = createCrystalBallI(this.config);
                await instance.initialize();
                const result = instance.initialized;
                await instance.cleanup();
                return result;
            }},
            { name: 'Status Check', test: async () => {
                const instance = createCrystalBallI(this.config);
                await instance.initialize();
                const status = await instance.getStatus();
                await instance.cleanup();
                return status.initialized;
            }}
        ];
        
        for (const test of tests) {
            try {
                const result = await test.test();
                const status = result ? '✅' : '❌';
                console.log(`${status} ${test.name}`);
            } catch (error) {
                console.log(`❌ ${test.name}: ${error.message}`);
            }
        }
    }
    
    /**
     * Show help information
     */
    showHelp() {
        console.log('🔮 CrystalBallI CLI\n');
        console.log('Usage: crystalball-i <command> [options]\n');
        console.log('Commands:');
        console.log('  init              Initialize CrystalBallI configuration');
        console.log('  chat [release]    Interactive chat mode');
        console.log('  predict <release> Predict release landing date');
        console.log('  status            Show system status');
        console.log('  config <action>   Manage configuration');
        console.log('  test [type]       Run tests');
        console.log('  help              Show this help\n');
        
        console.log('Examples:');
        console.log('  crystalball-i init');
        console.log('  crystalball-i chat NDB-2.11');
        console.log('  crystalball-i predict NDB-2.11 2026-06-15');
        console.log('  crystalball-i status');
        console.log('  crystalball-i config show');
    }
    
    /**
     * Show chat help
     */
    showChatHelp() {
        console.log('💬 Chat Mode Help\n');
        console.log('Example questions:');
        console.log('  • When will this release land?');
        console.log('  • What are the biggest risks?');
        console.log('  • How is team velocity?');
        console.log('  • Compare to NDB-2.10');
        console.log('  • What features are stuck?');
        console.log('  • What should we descope?\n');
    }
    
    // Configuration management
    
    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            this.logger.warn('Failed to load config, using defaults');
        }
        
        return this.getDefaultConfig();
    }
    
    saveConfig(config) {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
        } catch (error) {
            console.error('❌ Failed to save configuration:', error.message);
        }
    }
    
    getDefaultConfig() {
        return {
            team: 'NDB',
            enabled: true,
            learningEnabled: true,
            logLevel: 'info'
        };
    }
    
    setConfigValue(key, value) {
        // Handle nested keys like "prediction.confidence"
        const keys = key.split('.');
        let obj = this.config;
        
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) obj[keys[i]] = {};
            obj = obj[keys[i]];
        }
        
        // Convert string values to appropriate types
        let convertedValue = value;
        if (value === 'true') convertedValue = true;
        else if (value === 'false') convertedValue = false;
        else if (!isNaN(value) && !isNaN(parseFloat(value))) convertedValue = parseFloat(value);
        
        obj[keys[keys.length - 1]] = convertedValue;
    }
    
    // Utility methods
    
    generateConversationId() {
        return `cli_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }
    
    inferTargetDate(releaseVersion) {
        // Simple heuristic for target date
        const date = new Date();
        date.setMonth(date.getMonth() + 3);
        return date.toISOString().split('T')[0];
    }
}

// Main execution
if (require.main === module) {
    const cli = new CrystalBallICLI();
    const args = process.argv.slice(2);
    
    cli.run(args).catch(error => {
        console.error('❌ CLI Error:', error);
        process.exit(1);
    });
}