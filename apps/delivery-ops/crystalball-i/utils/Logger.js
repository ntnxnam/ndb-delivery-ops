/**
 * Logger utility for CrystalBallI
 * 
 * Provides structured logging with different levels and formatting
 */

class Logger {
    constructor(level = 'info') {
        this.level = level;
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
        
        this.currentLevel = this.levels[level] || this.levels.info;
    }
    
    error(message, meta = {}) {
        if (this.currentLevel >= this.levels.error) {
            this.log('ERROR', message, meta);
        }
    }
    
    warn(message, meta = {}) {
        if (this.currentLevel >= this.levels.warn) {
            this.log('WARN', message, meta);
        }
    }
    
    info(message, meta = {}) {
        if (this.currentLevel >= this.levels.info) {
            this.log('INFO', message, meta);
        }
    }
    
    debug(message, meta = {}) {
        if (this.currentLevel >= this.levels.debug) {
            this.log('DEBUG', message, meta);
        }
    }
    
    log(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            component: 'CrystalBallI',
            ...meta
        };
        
        // In development, pretty print
        if (process.env.NODE_ENV !== 'production') {
            const color = this.getColor(level);
            const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
            console.log(`${color}[${timestamp}] ${level}: ${message}${metaStr}\x1b[0m`);
        } else {
            // In production, JSON format for structured logging
            console.log(JSON.stringify(logEntry));
        }
    }
    
    getColor(level) {
        const colors = {
            ERROR: '\x1b[31m',   // Red
            WARN: '\x1b[33m',    // Yellow
            INFO: '\x1b[36m',    // Cyan
            DEBUG: '\x1b[35m'    // Magenta
        };
        
        return colors[level] || '\x1b[37m'; // White default
    }
}

module.exports = Logger;