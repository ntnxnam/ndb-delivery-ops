const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Shared rule: don't count CORS preflight OPTIONS requests against any limiter.
// They're protocol overhead the browser fires automatically; counting them
// punishes normal users for protocol mechanics.
const skipOptions = (req) => req.method === 'OPTIONS';

// Security headers middleware
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
});

// General API rate limiter
//   prod: 100 req / 15 min  (lots of headroom for real users; tight enough to stop scrapers)
//   dev:  5000 req / 15 min (covers normal browsing — see below)
//
// Why 5000 in dev:
//   Every authenticated POST in the browser becomes 2 wire requests (CORS preflight + actual call).
//   React 18 strict mode double-mounts effects, so each useEffect-driven call doubles again.
//   A normal page visit can therefore generate 8-10 limiter hits even though the user did one thing.
//   At 500/15min that limit was hit after only ~25 page interactions in dev — visible to the user
//   as "Request failed with status code 429" on a perfectly normal click.
//
// Skip rules:
//   - /api/health        : load balancer / monitoring polling shouldn't burn user quota
//   - OPTIONS preflights : protocol overhead the browser fires automatically; not a user action
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 5000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health' || skipOptions(req),
});

// Strict rate limiter for authentication endpoints
// More lenient in development to allow testing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 50, // More lenient in development
  message: 'Too many authentication attempts from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful auth attempts
  skipFailedRequests: true, // Also skip failed requests to avoid blocking during testing
});

// Email sending rate limiter - 10 emails per hour per IP
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many email sending attempts from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// JIRA/Confluence API rate limiter
//   prod: 50 / 5min  dev: 1000 / 5min  (dev was 200 — too tight once CORS preflights
//                                       and React 18 strict-mode double-mount are factored in)
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 50 : 1000,
  message: 'Too many API requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipOptions,
});

// Checkpoint history (batch operations)
//   prod/dev: 100 -> 500 dev. Production unchanged.
const checkpointHistoryLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 500,
  message: 'Too many checkpoint history requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skip: skipOptions,
});

// Release-version family (sprint reports, release items, exec summary, etc.)
// Many UI surfaces hit this family on mount (sometimes 3-4 in parallel), so the
// dev budget needs real headroom. Production stays strict — those endpoints make
// expensive JIRA calls.
//   prod: 10 / 5min   dev: 800 / 5min
const releaseVersionsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 800,
  message: 'Too many release version requests from this IP. Please wait 60-90 seconds before trying again. Each request makes multiple JIRA API calls, so rate limits are reached quickly.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skip: skipOptions,
});

module.exports = {
  securityHeaders,
  generalLimiter,
  authLimiter,
  emailLimiter,
  apiLimiter,
  checkpointHistoryLimiter,
  releaseVersionsLimiter
};

