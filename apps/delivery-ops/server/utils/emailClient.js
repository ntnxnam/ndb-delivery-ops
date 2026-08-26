/**
 * CJS adapter onto shared EmailConnector (D3).
 */

const { getShared } = require('./jiraClient');

async function createEmailConnector(transportOptions) {
  const shared = await getShared();
  return new shared.EmailConnector(transportOptions);
}

module.exports = { createEmailConnector };
