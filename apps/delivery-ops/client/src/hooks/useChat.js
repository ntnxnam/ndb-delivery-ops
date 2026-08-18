import { useCallback, useMemo, useState } from 'react';
import { authenticatedPost } from '../utils/api';
import { useSelectedRelease } from '../contexts/SelectedReleaseContext';
import { useTeam } from '../contexts/TeamContext';

export function useChat() {
  const { selectedRelease, versions, productId } = useSelectedRelease();
  const { selectedTeam } = useTeam();

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState(null);

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
        });

        const data = response?.data || {};
        const assistantMessage = {
          role: 'assistant',
          content: String(data.reply || 'No reply received.'),
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
    [availableReleases, knownTeams, loading, messages, productId, selectedRelease]
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setError('');
    setScope(null);
  }, []);

  return {
    messages,
    loading,
    error,
    scope,
    sendMessage,
    clearChat,
    selectedRelease,
  };
}

