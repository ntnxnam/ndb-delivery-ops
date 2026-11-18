const { createProxyMiddleware } = require('http-proxy-middleware');

// DEV-ONLY: create-react-app devServer proxy. Not part of the production
// build or the deployed Express server. Safe to target the local backend
// during development; no-localhost rule explicitly exempts this file.
module.exports = function (app) {
  app.use(
    '/docs',
    createProxyMiddleware({
      target: 'http://localhost:8001',
      changeOrigin: true,
    })
  );
  app.use(
    '/Documentation',
    createProxyMiddleware({
      target: 'http://localhost:8001',
      changeOrigin: true,
    })
  );
};
