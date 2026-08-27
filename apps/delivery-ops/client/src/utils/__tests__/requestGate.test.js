import {
  FAILURE_COOLDOWN_MS,
  STORM_MAX_ATTEMPTS,
  requestKey,
  resetGateForKey,
  resetRequestGate,
  withRequestGate,
  RequestStormError,
} from '../requestGate';

describe('requestGate', () => {
  beforeEach(() => {
    resetRequestGate();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetRequestGate();
  });

  test('requestKey ignores injected auth fields', () => {
    const a = requestKey('POST', '/api/jira/release-versions', { teamId: 'ndb', username: 'a' });
    const b = requestKey('POST', '/api/jira/release-versions', { teamId: 'ndb', username: 'b' });
    expect(a).toBe(b);
  });

  test('coalesces in-flight calls into one run', async () => {
    let starts = 0;
    const run = () => {
      starts += 1;
      return new Promise((resolve) => setTimeout(() => resolve('ok'), 20));
    };
    const key = requestKey('POST', '/api/jira/release-versions', { teamId: 'ndb' });
    const [a, b, c] = await Promise.all([
      withRequestGate(key, run),
      withRequestGate(key, run),
      withRequestGate(key, run),
    ]);
    expect(starts).toBe(1);
    expect([a, b, c]).toEqual(['ok', 'ok', 'ok']);
  });

  test('replay last error during cooldown — no second run', async () => {
    const key = requestKey('POST', '/api/jira/release-versions', { teamId: 'ndb' });
    const boom = new Error('network down');
    const run = jest.fn().mockRejectedValue(boom);

    await expect(withRequestGate(key, run)).rejects.toThrow('network down');
    await expect(withRequestGate(key, run)).rejects.toThrow('network down');
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('ignoreFailureCooldown allows one retry after failure', async () => {
    const key = requestKey('POST', '/api/jira/release-versions', { teamId: 'ndb' });
    const run = jest.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce('recovered');

    await expect(withRequestGate(key, run)).rejects.toThrow('network down');
    await expect(withRequestGate(key, run, { ignoreFailureCooldown: true })).resolves.toBe('recovered');
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('opens circuit before a tight loop can flood', async () => {
    const key = requestKey('POST', '/api/jira/release-versions', { teamId: 'ndb' });
    let starts = 0;
    const run = () => {
      starts += 1;
      return Promise.reject(new Error('fail'));
    };

    for (let i = 0; i < 40; i += 1) {
      try {
        await withRequestGate(key, run, { ignoreFailureCooldown: true });
      } catch {
        // expected — failure or circuit
      }
    }

    expect(starts).toBeLessThan(STORM_MAX_ATTEMPTS);
    await expect(withRequestGate(key, run, { ignoreFailureCooldown: true })).rejects.toBeInstanceOf(RequestStormError);
  });

  test('resetGateForKey lets an explicit click run after the circuit opened', async () => {
    const key = requestKey('POST', '/api/jira/release-items', { teamId: 'prism-infra' });
    const run = jest.fn().mockRejectedValue(new Error('fail'));
    for (let i = 0; i < 10; i += 1) {
      try {
        await withRequestGate(key, run, { ignoreFailureCooldown: true });
      } catch {
        // failure or circuit
      }
    }
    expect(run.mock.calls.length).toBeLessThan(10);
    resetGateForKey(key);
    run.mockResolvedValueOnce('ok');
    await expect(withRequestGate(key, run)).resolves.toBe('ok');
  });

  test('cooldown expires so a later call can run', async () => {
    jest.useFakeTimers();
    const key = requestKey('GET', '/api/config/teams');
    const run = jest.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce('up');

    await expect(withRequestGate(key, run)).rejects.toThrow('down');
    jest.advanceTimersByTime(FAILURE_COOLDOWN_MS + 1);
    await expect(withRequestGate(key, run)).resolves.toBe('up');
    expect(run).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
