// Load environment variables from .env file (if it exists)
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression');
const axios = require('axios');
const https = require('https');
const path = require('path');
const emailConfig = require('./config/emailConfig.json');
const { JIRA_API_V2, normalizeJiraBaseUrl } = require('./config/api');
const logger = require('./utils/logger');
const { securityHeaders, generalLimiter, authLimiter, emailLimiter, apiLimiter, checkpointHistoryLimiter, releaseVersionsLimiter } = require('./middleware/security');
const { sanitizeInput } = require('./middleware/validation');
const { sanitizeObject } = require('./utils/sanitize');
const { validateJiraTokenMiddleware } = require('./middleware/auth/jira');
const { extractApiError, getJiraErrorMessage, formatErrorResponse } = require('./utils/errorMessages');
const { formatDateWithHistoryHTML, formatAllCheckpointDatesHTML } = require('./utils/dateFormatter');
const { formatContentForEmail, formatJiraWikiMarkupForEmail } = require('./utils/emailFormatter');

// (removed) CrystalBallI Integration — package killed per ARCHITECTURE_TARGET.md v2 (2026-05-20).
// Future conversational/AI surface will live behind /api/team-exec, talking to shared/services
// directly rather than a separate npm sub-package.

const app = express();
const PORT = process.env.PORT || 7001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security and Performance Middleware
// Apply security headers
app.use(securityHeaders);

// Compression for better performance
app.use(compression());

// CORS configuration - restrict to specific origins in production
const corsOptions = {
  origin: (origin, callback) => {
    try {
      // In development, allow all origins
      if (NODE_ENV !== 'production') {
        return callback(null, true);
      }
      
      // In production, check against ALLOWED_ORIGINS
      const allowedOrigins = process.env.ALLOWED_ORIGINS 
        ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(o => o.length > 0)
        : [];
      
      // If no origin header (e.g., same-origin requests, Postman), allow it
      if (!origin) {
        return callback(null, true);
      }
      
      // Check if origin is in allowed list
      if (allowedOrigins.length === 0) {
        console.warn('⚠️  CORS: ALLOWED_ORIGINS not configured in production. Allowing all origins (not recommended).');
        return callback(null, true);
      }
      
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      console.warn(`🚫 CORS: Blocked request from origin: ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`);
      // Return false to reject the origin (CORS library will handle the error response)
      return callback(null, false);
    } catch (error) {
      // If there's an error in CORS processing, log it and allow the request to prevent 500 errors
      console.error('❌ CORS configuration error:', error);
      return callback(null, true); // Allow on error to prevent breaking the app
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Username', 'X-User-Email'],
  maxAge: 86400 // 24 hours
};
app.use(cors(corsOptions));

// Body parser with size limits to prevent DoS
app.use(bodyParser.json({ 
  limit: '1mb', // Limit JSON payload size
  verify: (req, res, buf) => {
    // Sanitize JSON input
    try {
      const data = JSON.parse(buf.toString());
      req.body = sanitizeObject(data);
    } catch (e) {
      // If parsing fails, body-parser will handle it
    }
  }
}));
app.use(bodyParser.urlencoded({ 
  extended: true, 
  limit: '1mb',
  parameterLimit: 50 // Limit number of parameters
}));

// Apply general rate limiting to all routes
app.use(generalLimiter);

// Trust proxy (if behind reverse proxy)
app.set('trust proxy', 1);

// Route modules
const configRoutes = require('./routes/config');
const authRoutes = require('./routes/auth');
const jiraRoutes = require('./routes/jira');
const emailRoutes = require('./routes/email');
const statusSnapshotsRoutes = require('./routes/statusSnapshots');
const adminRoutes = require('./routes/admin');
const dateMoverRoutes = require('./routes/dateMover');
const releaseDatasetRoutes = require('./routes/releaseDataset');
const releaseSyncRoutes = require('./routes/releaseSync');
const aiRoutes = require('./routes/ai');
const featureRoutes = require('./routes/feature');

// CORS preflight: ensure OPTIONS for all /api paths always succeeds.
// Use RegExp to avoid path-to-regexp wildcard parsing issues.
app.options(/^\/api\/.*$/, (req, res) => {
  res.status(204).end();
});

// Mount route modules
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/config', configRoutes); // Config routes at /api/config/*
app.use('/api/auth', authRoutes); // Auth routes at /api/auth/*
app.use('/api/jira', jiraRoutes); // JIRA routes at /api/jira/*
const jiraProxyRoutes = require('./routes/jira/proxy');
app.use('/api/jira/proxy', jiraProxyRoutes); // Apps Script / server-side Jira proxy
app.use('/api/email', emailRoutes); // Email routes at /api/email/*
app.use('/api/status-snapshots', statusSnapshotsRoutes); // Snapshots & trends
app.use('/api/admin', adminRoutes); // Admin team management routes
app.use('/api/date-mover', dateMoverRoutes); // D30: gate-date moves w/ Confluence audit
app.use('/api/release-dataset', releaseDatasetRoutes); // Phase 3: shared releaseDataset surface
app.use('/api/release-dataset', releaseSyncRoutes);   // Sync lifecycle: /sync-status, /sync, /bundle
app.use('/api/ai', aiRoutes); // AI routes: exec summary generation + JIRA push
app.use('/api/feature', featureRoutes); // Feature-level dashboard endpoints
const componentRoutes = require('./routes/component');
app.use('/api/component', componentRoutes); // Component report endpoints

// Bin-packing app (legacy NDB-projects-bin-packing). Static-mounted under
// /bin-packing per CONSOLIDATION.md #14 + D37: same-origin, single runtime,
// ESM modules + data/projects.json fetch work out of the box. Future React
// port tracked separately.
const binPackingRoot = path.join(__dirname, '..', '..', 'bin-packing');
app.use(
  '/bin-packing',
  express.static(binPackingRoot, {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      // Ensure browser ESM <script type="module"> loads correctly.
      if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      }
    },
  })
);

// Routes are now in separate modules:
// - routes/config.js: Config endpoints
// - routes/auth.js: Authentication endpoints  
// - routes/jira.js: JIRA API endpoints (all 11 endpoints extracted)
// - routes/email.js: Email endpoints (send-release-versions)
// All mounted above

// Helper function to format dates to dd/mmm/yyyy
function formatDate(dateValue) {
  if (!dateValue) return null;
  
  // Handle ISO date strings (2025-12-30T17:56:20.477+0000 or 2025-12-30)
  let date;
  if (typeof dateValue === 'string') {
    // Check for ISO format with time
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateValue)) {
      date = new Date(dateValue);
    }
    // Check for date-only format (YYYY-MM-DD)
    else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      date = new Date(dateValue + 'T00:00:00');
    }
    else {
      date = new Date(dateValue);
    }
  } else if (dateValue instanceof Date) {
    date = dateValue;
  } else {
    return null;
  }
  
  if (isNaN(date.getTime())) {
    return null;
  }
  
  const day = String(date.getDate()).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Endpoint to fetch JIRA ticket data
// Fetch and fetch-epics endpoints moved to routes/jira.js

// Endpoint to fetch issue breakdown by type and status
// Issue breakdown endpoint moved to routes/jira.js

// Endpoint to fetch all release versions from ERA project
// Release versions endpoint moved to routes/jira.js

// Endpoint to fetch items by fixVersion and labels
// Release items endpoint moved to routes/jira.js

// Endpoint to fetch Section 1 (Commit) items
// Release items commit endpoint moved to routes/jira.js

// Endpoint to fetch Section 2 (Long-term-funded) items
// Release items long-term endpoint moved to routes/jira.js

// Endpoint to fetch checkpoint history for all items in a release version
// Release items history endpoint moved to routes/jira.js

// Email endpoint moved to routes/email.js

// Error handling middleware - must be last
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  logger.error('Unhandled error', err, {
    path: req.path,
    method: req.method,
    ip: req.ip,
    status
  });
  const message = NODE_ENV === 'production'
    ? 'An internal server error occurred'
    : (err.message || 'An unexpected error occurred');
  res.status(status).json({
    error: message,
    ...(NODE_ENV !== 'production' && err.message && { message: err.message }),
    ...(NODE_ENV !== 'production' && err.stack && { stack: err.stack })
  });
});

// 404 handler - but skip favicon requests (handled by frontend)
app.use((req, res) => {
  // Don't log 404s for favicon requests
  if (req.path === '/favicon.ico' || req.path === '/favicon.svg') {
    return res.status(204).send(); // No Content
  }
  // Log API 404s to help debug production (e.g. /api/jira/sprints not found)
  if (req.path.startsWith('/api')) {
    logger.info('404 API request', { method: req.method, path: req.path });
  }
  res.status(404).json({
    error: 'Not Found',
    message: `The requested resource ${req.path} was not found`
  });
});

const emailScheduler = require('./services/emailScheduler');
const syncScheduler = require('./jobs/syncScheduler');

// Export app for supertest/integration tests (avoid starting server when required as module)
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT} in ${NODE_ENV} mode`);
    console.log(`Server accessible at http://0.0.0.0:${PORT}`);
    logger.info('Server started', { port: PORT, env: NODE_ENV });
    if (NODE_ENV === 'production') {
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn('⚠️  PRODUCTION: Set SMTP_USER and SMTP_PASS in .env or email sending will fail (relay requires auth).');
      }
      const origins = process.env.ALLOWED_ORIGINS || '';
      if (!origins.trim() || origins.includes('your-server-ip') || origins.includes('your-domain.com')) {
        console.warn('⚠️  PRODUCTION: Set ALLOWED_ORIGINS in .env to your app URL(s), e.g. https://your-app.example.com');
      }
    }
    emailScheduler.start();
    syncScheduler.start();
  });
}

module.exports = app;
