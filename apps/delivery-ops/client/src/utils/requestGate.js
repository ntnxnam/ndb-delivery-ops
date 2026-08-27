/**
 * Hard stop against identical-request storms (failed Network tab floods).
 *
 * A buggy useEffect must not be able to fire thousands of XHRs. This gate:
 *   1. Coalesces in-flight calls with the same key (one HTTP, many waiters)
 *   2. Replays the last error for FAILURE_COOLDOWN_MS (no new HTTP)
 *   3. Opens a circuit after STORM_MAX_ATTEMPTS identical HTTP starts
 *      inside STORM_WINDOW_MS — blocked for CIRCUIT_OPEN_MS
 *
 * Explicit user refresh may pass ignoreFailureCooldown; it cannot bypass
 * an open storm circuit.
 */

export const STORM_WINDOW_MS = 10 * 1000;
export const STORM_MAX_ATTEMPTS = 5;
export const FAILURE_COOLDOWN_MS = 4 * 1000;
export const CIRCUIT_OPEN_MS = 30 * 1000;

const AUTH_KEYS = new Set(['username', 'userEmail', 'jiraToken']);

const inFlight = new Map();
const lastFailure = new Map();
const attempts = new Map();
const circuitOpenedAt = new Map();
const stormLogged = new Set();

export class RequestStormError extends Error {
  constructor(message, { key, reason } = {}) {
    super(message);
    this.name = 'RequestStormError';
    this.code = 'ERR_REQUEST_STORM';
    this.key = key;
    this.reason = reason;
  }
}

function stableStringify(value) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${k}:${stableStringify(value[k])}`).join(',')}}`;
}

function stripAuthFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = {};
  Object.keys(value).forEach((k) => {
    if (!AUTH_KEYS.has(k)) next[k] = value[k];
  });
  return next;
}

function normalizeBody(data) {
  if (data == null) return {};
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return { _raw: data };
    }
  }
  return data;
}

export function requestKey(method, url, body, params) {
  const verb = String(method || 'GET').toUpperCase();
  const path = String(url || '');
  return `${verb}:${path}:${stableStringify(stripAuthFields(normalizeBody(body)))}:${stableStringify(params || {})}`;
}

export function axiosRequestKey(config = {}) {
  return requestKey(config.method, config.url, config.data, config.params);
}

function pruneAttempts(key, now) {
  const recent = (attempts.get(key) || []).filter((t) => now - t < STORM_WINDOW_MS);
  if (recent.length) attempts.set(key, recent);
  else attempts.delete(key);
  return recent;
}

function isCircuitOpen(key, now = Date.now()) {
  const openedAt = circuitOpenedAt.get(key);
  if (!openedAt) return false;
  if (now - openedAt >= CIRCUIT_OPEN_MS) {
    circuitOpenedAt.delete(key);
    attempts.delete(key);
    stormLogged.delete(key);
    return false;
  }
  return true;
}

function openCircuit(key, now = Date.now()) {
  if (!circuitOpenedAt.has(key)) {
    circuitOpenedAt.set(key, now);
    if (!stormLogged.has(key)) {
      stormLogged.add(key);
      console.error(
        `[requestGate] Circuit open ${CIRCUIT_OPEN_MS}ms — blocked repeated ${key}`
      );
    }
  }
}

export function assertCanStart(key, { ignoreFailureCooldown = false } = {}) {
  const now = Date.now();
  if (isCircuitOpen(key, now)) {
    throw new RequestStormError(
      'Blocked repeated identical request (circuit open). Wait and retry once.',
      { key, reason: 'circuit_open' }
    );
  }

  if (!ignoreFailureCooldown) {
    const failed = lastFailure.get(key);
    if (failed && now - failed.at < FAILURE_COOLDOWN_MS) {
      throw failed.error;
    }
  }
}

export function startAttempt(key) {
  const now = Date.now();
  if (isCircuitOpen(key, now)) {
    throw new RequestStormError(
      'Blocked repeated identical request (circuit open). Wait and retry once.',
      { key, reason: 'circuit_open' }
    );
  }
  const recent = pruneAttempts(key, now);
  recent.push(now);
  attempts.set(key, recent);
  if (recent.length >= STORM_MAX_ATTEMPTS) {
    openCircuit(key, now);
    throw new RequestStormError(
      'Blocked repeated identical request (storm detected). Wait and retry once.',
      { key, reason: 'storm' }
    );
  }
}

export function finishAttempt(key, error) {
  inFlight.delete(key);
  if (!error || error.code === 'ERR_REQUEST_STORM' || error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
    if (!error) lastFailure.delete(key);
    return;
  }
  lastFailure.set(key, { at: Date.now(), error });
}

export async function withRequestGate(key, run, { ignoreFailureCooldown = false } = {}) {
  assertCanStart(key, { ignoreFailureCooldown });
  const existing = inFlight.get(key);
  if (existing) return existing;

  startAttempt(key);
  const promise = Promise.resolve()
    .then(run)
    .then((result) => {
      finishAttempt(key, null);
      return result;
    })
    .catch((error) => {
      finishAttempt(key, error);
      throw error;
    });

  inFlight.set(key, promise);
  return promise;
}

export function applyAxiosInterceptors(axiosInstance) {
  if (!axiosInstance || axiosInstance.__requestGateInstalled) return axiosInstance;
  axiosInstance.__requestGateInstalled = true;

  axiosInstance.interceptors.request.use((config) => {
    if (config.requestGate?.managed) return config;
    const key = axiosRequestKey(config);
    const ignoreFailureCooldown = Boolean(config.requestGate?.ignoreFailureCooldown);
    assertCanStart(key, { ignoreFailureCooldown });
    startAttempt(key);
    config.requestGate = { ...(config.requestGate || {}), key };
    return config;
  });

  axiosInstance.interceptors.response.use(
    (response) => {
      const key = response.config?.requestGate?.key || axiosRequestKey(response.config);
      if (!response.config?.requestGate?.managed) {
        finishAttempt(key, null);
      }
      return response;
    },
    (error) => {
      if (error?.code !== 'ERR_REQUEST_STORM' && error?.config && !error.config.requestGate?.managed) {
        const key = error.config.requestGate?.key || axiosRequestKey(error.config);
        finishAttempt(key, error);
      }
      return Promise.reject(error);
    }
  );

  return axiosInstance;
}

export function resetRequestGate() {
  inFlight.clear();
  lastFailure.clear();
  attempts.clear();
  circuitOpenedAt.clear();
  stormLogged.clear();
}

/** Clear cooldown/circuit for one key so an explicit user click can hit the network. */
export function resetGateForKey(key) {
  if (!key) return;
  lastFailure.delete(key);
  attempts.delete(key);
  circuitOpenedAt.delete(key);
  stormLogged.delete(key);
}
