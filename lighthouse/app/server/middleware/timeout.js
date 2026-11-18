/**
 * Request timeout middleware to prevent hanging requests
 * Ensures all requests complete within a reasonable time limit
 */

const createTimeoutMiddleware = (timeoutMs = 30000) => {
  return (req, res, next) => {
    // Set a timeout for the request
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        console.error(`[TIMEOUT] Request to ${req.path} timed out after ${timeoutMs}ms`);
        res.status(408).json({
          success: false,
          error: 'Request Timeout',
          message: `Request timed out after ${timeoutMs / 1000} seconds`,
          path: req.path,
          timestamp: new Date().toISOString()
        });
      }
    }, timeoutMs);

    // Clear timeout when response is sent
    const originalSend = res.send;
    const originalJson = res.json;

    res.send = function(...args) {
      clearTimeout(timeout);
      return originalSend.apply(this, args);
    };

    res.json = function(...args) {
      clearTimeout(timeout);
      return originalJson.apply(this, args);
    };

    // Also clear timeout on response finish
    res.on('finish', () => {
      clearTimeout(timeout);
    });

    next();
  };
};

module.exports = {
  createTimeoutMiddleware,
  jiraTimeout: createTimeoutMiddleware(90000), // 90 seconds for JIRA endpoints
  generalTimeout: createTimeoutMiddleware(30000) // 30 seconds for general endpoints
};