/**
 * CJS stub for node-fetch v3 (pure ESM).
 * Used by Jest so server/services/voodooService.js can be loaded in test env.
 * Tests that exercise actual HTTP responses should mock the voodooService layer directly.
 */
const fetchStub = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    headers: { get: () => null },
  })
);

fetchStub.default = fetchStub;
module.exports = fetchStub;
module.exports.default = fetchStub;
