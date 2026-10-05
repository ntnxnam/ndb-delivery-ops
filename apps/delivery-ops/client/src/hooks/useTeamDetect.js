/**
 * useTeamDetect
 *
 * Detects team settings from a base filter (POST /api/admin/inspect-base-filter)
 * and re-reads the sprint calendar when a different board is picked
 * (POST /api/admin/board-calendar). Detection only runs on explicit calls.
 */
import { useState, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';
import { adminAuth, adminErrorMessage } from './useTeamAdmin';

export function useTeamDetect() {
  const [detected, setDetected] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');
  const [calendarLoading, setCalendarLoading] = useState(false);

  const detect = useCallback(async ({ baseFilter, name, boardId, featureProjectKey }) => {
    setDetecting(true);
    setDetectError('');
    try {
      const response = await authenticatedPost(
        '/api/admin/inspect-base-filter',
        { baseFilter, name, boardId, featureProjectKey },
        adminAuth()
      );
      setDetected(response.data);
      return response.data;
    } catch (err) {
      setDetected(null);
      setDetectError(adminErrorMessage(err, 'Detect failed'));
      return null;
    } finally {
      setDetecting(false);
    }
  }, []);

  const loadBoardCalendar = useCallback(async (boardId) => {
    setCalendarLoading(true);
    try {
      const response = await authenticatedPost('/api/admin/board-calendar', { boardId }, adminAuth());
      return response.data;
    } catch (err) {
      return { boardId: Number(boardId), sprintCalendar: null, calendarError: adminErrorMessage(err, 'Board lookup failed') };
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  const resetDetect = useCallback(() => {
    setDetected(null);
    setDetectError('');
  }, []);

  return { detected, detecting, detectError, calendarLoading, detect, loadBoardCalendar, resetDetect };
}
