import { renderHook, act } from '@testing-library/react';
import * as apiService from '../../shared/services/apiService';

jest.mock('../../shared/services/apiService', () => ({
  authenticatedPost: jest.fn(),
  getApiBase: jest.fn(() => ''),
}));

function localStorageMock() {
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: jest.fn((key) => {
        if (key === 'jiraToken') return 'tok';
        if (key === 'username') return 'tester';
        return null;
      }),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    },
    writable: true,
    configurable: true,
  });
}

describe('useOncallReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock();
    apiService.authenticatedPost.mockResolvedValue({ data: { success: true, data: { html: '<b>ok</b>', subject: 'Report' } } });
  });

  describe('dashboard churn — asOf stability', () => {
    test('same asOf → stable refs (preview identity unchanged)', async () => {
      const dashA = { asOf: '2026-02-10T00:00:00Z', hero: { open: { count: 1 } } };
      const { result, rerender } = renderHook(
        ({ dashboard }) => require('../../hooks/useOncallReport').useOncallReport({ teamId: 'ndb', timeframe: '7d', dashboard, aiConcern: null }),
        { initialProps: { dashboard: dashA } }
      );
      const firstPreview = result.current.preview;
      const firstSend = result.current.send;

      // rerender with new object but same asOf — refs should be stable
      const dashA2 = { asOf: '2026-02-10T00:00:00Z', hero: { open: { count: 99 } } };
      rerender({ dashboard: dashA2 });

      expect(result.current.preview).toBe(firstPreview);
      expect(result.current.send).toBe(firstSend);
    });

    test('different asOf → new ref', async () => {
      const dashA = { asOf: '2026-02-10T00:00:00Z' };
      const { result, rerender } = renderHook(
        ({ dashboard }) => require('../../hooks/useOncallReport').useOncallReport({ teamId: 'ndb', timeframe: '7d', dashboard, aiConcern: null }),
        { initialProps: { dashboard: dashA } }
      );
      const firstPreview = result.current.preview;

      rerender({ dashboard: { asOf: '2026-02-11T00:00:00Z' } });

      expect(result.current.preview).not.toBe(firstPreview);
    });

    test('timeframe change → new ref', async () => {
      const dash = { asOf: '2026-02-10T00:00:00Z' };
      const { result, rerender } = renderHook(
        ({ timeframe }) => require('../../hooks/useOncallReport').useOncallReport({ teamId: 'ndb', timeframe, dashboard: dash, aiConcern: null }),
        { initialProps: { timeframe: '7d' } }
      );
      const first = result.current.preview;
      rerender({ timeframe: 'Overall' });
      expect(result.current.preview).not.toBe(first);
    });
  });

  describe('cc not sent', () => {
    test('request body has no cc field', async () => {
      const dash = { asOf: '2026-02-10T00:00:00Z' };
      const { result } = renderHook(() => require('../../hooks/useOncallReport').useOncallReport({ teamId: 'ndb', timeframe: '7d', dashboard: dash, aiConcern: null }));

      await act(async () => {
        await result.current.preview({ to: ['a@nutanix.com'] });
      });

      const body = apiService.authenticatedPost.mock.calls[0][1];
      expect(body).not.toHaveProperty('cc');
      expect(body).not.toHaveProperty('CC');
    });

    test('send also has no cc', async () => {
      const dash = { asOf: '2026-02-10T00:00:00Z' };
      const { result } = renderHook(() => require('../../hooks/useOncallReport').useOncallReport({ teamId: 'ndb', timeframe: '7d', dashboard: dash, aiConcern: null }));

      await act(async () => {
        await result.current.send({ to: ['b@nutanix.com'] });
      });

      const body = apiService.authenticatedPost.mock.calls[0][1];
      expect(body).not.toHaveProperty('cc');
    });
  });

  describe('timeout 180000', () => {
    test('authenticatedPost called with timeout 180000', async () => {
      const dash = { asOf: '2026-02-10T00:00:00Z' };
      const { result } = renderHook(() => require('../../hooks/useOncallReport').useOncallReport({ teamId: 'ndb', timeframe: '7d', dashboard: dash, aiConcern: null }));

      await act(async () => {
        await result.current.preview({ to: [] });
      });

      const axiosConfig = apiService.authenticatedPost.mock.calls[0][3];
      expect(axiosConfig).toEqual(expect.objectContaining({ timeout: 180000 }));
    });

    test('source file contains timeout 180000 literal', () => {
      const src = require('fs').readFileSync(require('path').join(__dirname, '../../hooks/useOncallReport.js'), 'utf8');
      expect(src).toMatch(/timeout:\s*180000/);
    });
  });

  describe('previewOnly flag', () => {
    test('preview sends previewOnly true', async () => {
      const { result } = renderHook(() => require('../../hooks/useOncallReport').useOncallReport({ teamId: 'ndb', timeframe: '7d', dashboard: { asOf: 'x' }, aiConcern: null }));
      await act(async () => { await result.current.preview({ to: [] }); });
      expect(apiService.authenticatedPost.mock.calls[0][1].previewOnly).toBe(true);
    });

    test('send sends previewOnly false', async () => {
      const { result } = renderHook(() => require('../../hooks/useOncallReport').useOncallReport({ teamId: 'ndb', timeframe: '7d', dashboard: { asOf: 'x' }, aiConcern: null }));
      await act(async () => { await result.current.send({ to: ['a@b.com'] }); });
      expect(apiService.authenticatedPost.mock.calls[0][1].previewOnly).toBe(false);
    });
  });
});
