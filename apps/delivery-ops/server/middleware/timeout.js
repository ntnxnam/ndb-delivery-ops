/**
 * Request timeout middleware to prevent hanging requests
 * Ensures all requests complete within a reasonable time limit.
 * On timeout: 408 + abort signal for upstream JIRA calls.
 */

const createTimeoutMiddleware = (timeoutMs = 30000) => {
  return (req, res, next) => {
    // Attach an abort controller so downstream handlers can wire
    // axios/JIRA calls to req.signal and get cancelled on timeout or client close.
    if (!req.signal) {
      const controller = new AbortController();
      req.signal = controller.signal;
      req.abortController = controller;
      // If client disconnects early (browser closed / navigation), abort upstream too.
      req.on('close', () => {
        if (!res.writableEnded && !controller.signal.aborted) {
          controller.abort();
        }
      });
    }

    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        console.error(`[TIMEOUT] Request to ${req.path} timed out after ${timeoutMs}ms`);
        // Abort any in-flight JIRA calls tied to this request.
        if (req.abortController && !req.abortController.signal.aborted) {
          req.abortController.abort();
        }
        res.status(408).json({
          success: false,
          error: 'Request Timeout',
          message: `Request timed out after ${timeoutMs / 1000} seconds — this can happen on VPN or for very large releases. Try again, or check your JIRA connection.`,
          path: req.path,
          timestamp: new Date().toISOString(),
        });
      }
    }, timeoutMs);

    // Clear timeout when response is sent
    const originalSend = res.send;
    const originalJson = res.json;

    res.send = function (...args) {
      clearTimeout(timeout);
      return originalSend.apply(this, args);
    };

    res.json = function (...args) {
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
  aiTimeout: createTimeoutMiddleware(300000), // 300 seconds for AI / weekly-skim / heavy changelog
  sprintTimeout: createTimeoutMiddleware(150000), // 150 seconds for sprint reports
  generalTimeout: createTimeoutMiddleware(30000), // 30 seconds for general endpoints
};
