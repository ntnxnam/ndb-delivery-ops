import { renderHook, act } from '@testing-library/react';
import { useCrystalBall } from '../../hooks/useCrystalBall';
import * as api from '../../utils/api';

// Mock the API functions
jest.mock('../../utils/api');
jest.mock('../../utils/errorMessages');

describe('useCrystalBall Hook', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn((key) => {
          if (key === 'jiraToken') return 'test-token';
          if (key === 'username') return 'testuser';
          return null;
        }),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
      writable: true,
    });
  });

  describe('checkStatus', () => {
    it('should fetch Crystal Ball status successfully', async () => {
      const mockStatus = {
        success: true,
        enabled: true,
        status: { initialized: true },
        version: '1.0.0'
      };

      api.authenticatedGet.mockResolvedValue({ data: mockStatus });

      const { result } = renderHook(() => useCrystalBall());

      await act(async () => {
        const status = await result.current.checkStatus();
        expect(status).toEqual(mockStatus);
      });

      expect(result.current.status).toEqual(mockStatus);
      expect(api.authenticatedGet).toHaveBeenCalledWith('/api/crystalball/status', {
        jiraToken: 'test-token',
        username: 'testuser'
      });
    });

    it('should handle status check error', async () => {
      const error = new Error('Network error');
      api.authenticatedGet.mockRejectedValue(error);

      const { result } = renderHook(() => useCrystalBall());

      await act(async () => {
        const status = await result.current.checkStatus();
        expect(status).toBeNull();
      });

      expect(result.current.status).toEqual({
        success: false,
        enabled: false,
        error: 'Network error'
      });
    });
  });

  describe('predictRelease', () => {
    it('should generate release predictions successfully', async () => {
      const mockPredictions = {
        success: true,
        predictions: {
          features: [
            {
              key: 'TEST-123',
              confidence: 0.8,
              riskLevel: 'low',
              estimatedCompletion: { probability: 0.9 }
            }
          ],
          overallHealth: {
            score: 85,
            level: 'good',
            confidence: 0.82
          }
        }
      };

      api.authenticatedPost.mockResolvedValue({ data: mockPredictions });

      const { result } = renderHook(() => useCrystalBall());

      const mockFeatures = [
        {
          key: 'TEST-123',
          summary: 'Test feature',
          fields: {
            status: { name: 'In Progress' },
            priority: { name: 'High' }
          }
        }
      ];

      let predictions;
      await act(async () => {
        predictions = await result.current.predictRelease('NDB-2.11', 'ndb', mockFeatures);
      });

      expect(predictions).toEqual(mockPredictions.predictions);
      expect(result.current.predictions).toEqual(mockPredictions.predictions);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('');

      expect(api.authenticatedPost).toHaveBeenCalledWith(
        '/api/crystalball/predict-release',
        {
          releaseVersion: 'NDB-2.11',
          teamId: 'ndb',
          features: mockFeatures
        },
        {
          jiraToken: 'test-token',
          username: 'testuser'
        }
      );
    });

    it('should handle prediction errors', async () => {
      const error = {
        response: {
          data: {
            error: 'Prediction failed',
            message: 'Crystal Ball is disabled'
          }
        }
      };

      api.authenticatedPost.mockRejectedValue(error);

      const { result } = renderHook(() => useCrystalBall());

      const mockFeatures = [{ key: 'TEST-123' }];

      await act(async () => {
        const predictions = await result.current.predictRelease('NDB-2.11', 'ndb', mockFeatures);
        expect(predictions).toBeNull();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeTruthy();
    });

    it('should validate required parameters', async () => {
      const { result } = renderHook(() => useCrystalBall());

      await act(async () => {
        const predictions = await result.current.predictRelease('', 'ndb', []);
        expect(predictions).toBeNull();
      });

      expect(result.current.error).toBe('Release version, team ID, and features are required');
    });
  });

  describe('getTrendAnalysis', () => {
    it('should fetch trend analysis successfully', async () => {
      const mockTrendAnalysis = {
        success: true,
        analysis: {
          releaseVersion: 'NDB-2.11',
          teamId: 'ndb',
          trends: {
            velocity: {
              current: 15,
              average: 12,
              trend: 'improving'
            }
          }
        }
      };

      api.authenticatedGet.mockResolvedValue({ data: mockTrendAnalysis });

      const { result } = renderHook(() => useCrystalBall());

      await act(async () => {
        const analysis = await result.current.getTrendAnalysis('NDB-2.11', 'ndb', 30);
        expect(analysis).toEqual(mockTrendAnalysis.analysis);
      });

      expect(result.current.trendAnalysis).toEqual(mockTrendAnalysis.analysis);
    });
  });

  describe('getRiskForecast', () => {
    it('should fetch risk forecast successfully', async () => {
      const mockRiskForecast = {
        success: true,
        forecast: {
          releaseVersion: 'NDB-2.11',
          milestones: [
            {
              name: 'Code Complete',
              riskLevel: 'low',
              probability: 0.85
            }
          ]
        }
      };

      api.authenticatedGet.mockResolvedValue({ data: mockRiskForecast });

      const { result } = renderHook(() => useCrystalBall());

      await act(async () => {
        const forecast = await result.current.getRiskForecast('NDB-2.11', 'ndb');
        expect(forecast).toEqual(mockRiskForecast.forecast);
      });

      expect(result.current.riskForecast).toEqual(mockRiskForecast.forecast);
    });
  });

  describe('utility functions', () => {
    it('should clear all data', () => {
      const { result } = renderHook(() => useCrystalBall());

      // Set some initial data
      act(() => {
        result.current.clearData();
      });

      expect(result.current.predictions).toBeNull();
      expect(result.current.trendAnalysis).toBeNull();
      expect(result.current.riskForecast).toBeNull();
      expect(result.current.error).toBe('');
    });

    it('should check if Crystal Ball is enabled', () => {
      const { result } = renderHook(() => useCrystalBall());

      // Initially not enabled (no status)
      expect(result.current.isEnabled()).toBe(false);

      // Mock enabled status
      act(() => {
        result.current.checkStatus();
      });

      // Mock the status response
      const enabledStatus = { success: true, enabled: true };
      api.authenticatedGet.mockResolvedValue({ data: enabledStatus });

      act(() => {
        result.current.checkStatus();
      });
    });
  });

  describe('error handling', () => {
    it('should handle network timeouts gracefully', async () => {
      const timeoutError = new Error('ECONNABORTED');
      timeoutError.code = 'ECONNABORTED';
      
      api.authenticatedPost.mockRejectedValue(timeoutError);

      const { result } = renderHook(() => useCrystalBall());

      await act(async () => {
        const predictions = await result.current.predictRelease('NDB-2.11', 'ndb', [{ key: 'TEST' }]);
        expect(predictions).toBeNull();
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.loading).toBe(false);
    });

    it('should handle rate limiting', async () => {
      const rateLimitError = {
        response: {
          status: 429,
          data: {
            error: 'Rate limit exceeded'
          }
        }
      };

      api.authenticatedGet.mockRejectedValue(rateLimitError);

      const { result } = renderHook(() => useCrystalBall());

      await act(async () => {
        const analysis = await result.current.getTrendAnalysis('NDB-2.11', 'ndb');
        expect(analysis).toBeNull();
      });

      expect(result.current.error).toBeTruthy();
    });
  });
});