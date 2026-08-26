import { useCallback, useMemo, useState } from 'react';
import { authenticatedPost } from '../utils/api';
import { useSelectedRelease } from '../contexts/SelectedReleaseContext';
import { useTeam } from '../contexts/TeamContext';

function readOrCreateSessionId() {
  try {
    const key = 'agentChatSessionId';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `s_${Date.now()}`;
  }
}

function writeSessionId(id) {
  try {
    sessionStorage.setItem('agentChatSessionId', id);
  } catch {
    /* ignore */
  }
}

export function useChat() {
  const { selectedRelease, versions, productId } = useSelectedRelease();
  const { selectedTeam } = useTeam();

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState(null);
  const [sessionId, setSessionId] = useState(readOrCreateSessionId);

  const knownTeams = useMemo(() => {
    const names = [selectedTeam?.name].filter(Boolean);
    return [...new Set(names)];
  }, [selectedTeam]);

  const availableReleases = useMemo(() => {
    return (versions || []).map((v) => (typeof v === 'string' ? v : v?.name)).filter(Boolean);
  }, [versions]);

  const sendMessage = useCallback(
    async (content) => {
      const text = String(content || '').trim();
      if (!text || loading) return null;

      const userMessage = { role: 'user', content: text };
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      setLoading(true);
      setError('');

      try {
        const response = await authenticatedPost('/api/ai/chat', {
          message: text,
          history: nextMessages.slice(0, -1),
          release: selectedRelease || null,
          productId: productId || 'ndb',
          availableReleases,
          knownTeams,
          sessionId,
        });

        const data = response?.data || {};
        if (data.sessionId && data.sessionId !== sessionId) {
          writeSessionId(data.sessionId);
          setSessionId(data.sessionId);
        }
        const assistantMessage = {
          role: 'assistant',
          content: String(data.reply || 'No reply received.'),
          trace: Array.isArray(data.trace) ? data.trace : [],
          runtime: data.runtime || 'agent',
          provenanceId: data.provenanceId || null,
          pendingApprovals: Array.isArray(data.pendingApprovals) ? data.pendingApprovals : [],
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setScope(data.scope || null);
        return assistantMessage;
      } catch (err) {
        setError(err?.response?.data?.error || err?.message || 'Failed to send message');
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: 'I could not generate a response right now. Please retry.',
          },
        ]);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [availableReleases, knownTeams, loading, messages, productId, selectedRelease, sessionId]
  );

  const decideApproval = useCallback(
    async (id, decision) => {
      try {
        const response = await authenticatedPost(`/api/ai/approvals/${id}`, { decision });
        const approval = response?.data?.approval;
        setMessages((prev) =>
          prev.map((m) => {
            if (!Array.isArray(m.pendingApprovals) || m.pendingApprovals.length === 0) return m;
            return {
              ...m,
              pendingApprovals: m.pendingApprovals.map((row) =>
                row.id === id ? { ...row, status: approval?.status || decision } : row
              ),
            };
          })
        );
        return approval;
      } catch (err) {
        setError(err?.response?.data?.error || err?.message || 'Failed to update approval');
        return null;
      }
    },
    []
  );

  const clearChat = useCallback(() => {
    const next = `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    writeSessionId(next);
    setSessionId(next);
    setMessages([]);
    setError('');
    setScope(null);
  }, []);

  return {
    messages,
    loading,
    error,
    scope,
    sessionId,
    sendMessage,
    clearChat,
    decideApproval,
    selectedRelease,
  };
}

