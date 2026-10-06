/**
 * useTeamDetect
 *
 * Detects team settings from a base filter (POST /api/admin/inspect-base-filter)
 * and re-reads the sprint calendar when a different board is picked
 * (POST /api/admin/board-calendar). Detection only runs on explicit calls.
 */
import { useState, useCallback, useRef } from 'react';
import { authenticatedPost } from '../utils/api';
import { adminAuth, adminErrorMessage } from './useTeamAdmin';

export function useTeamDetect() {
  const [detected, setDetected] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');
  const [calendarLoading, setCalendarLoading] = useState(false);
  const projectReq = useRef(0);

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

  const loadProject = useCallback(async (projectKey, teamName) => {
    const req = projectReq.current + 1;
    projectReq.current = req;
    setCalendarLoading(true);
    try {
      const response = await authenticatedPost(
        '/api/admin/project-scope',
        { projectKey, name: teamName },
        adminAuth()
      );
      if (req !== projectReq.current) return null;
      const data = response.data;
      setDetected((prev) => (prev ? {
        ...prev,
        projectKey: data.projectKey,
        versions: data.versions,
        board: data.board,
      } : prev));
      return data;
    } catch (err) {
      if (req !== projectReq.current) return null;
      const failed = {
        projectKey,
        versions: { total: 0, unreleasedCount: 0, unreleased: [], error: adminErrorMessage(err, 'Could not load versions') },
        board: {
          boards: [],
          otherBoards: [],
          matchedOn: 'project',
          boardId: null,
          sprintCalendar: null,
          calendarError: adminErrorMessage(err, 'Could not load boards'),
        },
      };
      setDetected((prev) => (prev ? { ...prev, projectKey, versions: failed.versions, board: failed.board } : prev));
      return failed;
    } finally {
      if (req === projectReq.current) setCalendarLoading(false);
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

  return { detected, detecting, detectError, calendarLoading, detect, loadProject, loadBoardCalendar, resetDetect };
}
