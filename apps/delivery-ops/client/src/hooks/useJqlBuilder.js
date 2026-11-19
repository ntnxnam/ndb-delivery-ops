import { useState, useCallback, useRef } from 'react';

export function useJqlBuilder() {
  const [plaintext, setPlaintext] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const timer = useRef(null);

  const preview = useCallback(async (text, teamId, releaseVersion) => {
    setLoading(true);
    try {
      const res = await fetch('/api/jql-builder/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plaintext: text, teamId, releaseVersion }) });
      const data = await res.json();
      setResult(data);
    } finally { setLoading(false); }
  }, []);

  const onChange = useCallback((text, teamId, releaseVersion) => {
    setPlaintext(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => preview(text, teamId, releaseVersion), 500);
  }, [preview]);

  const test = useCallback(async (jql) => {
    const res = await fetch('/api/jql-builder/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jql }) });
    const data = await res.json();
    setTestResult(data);
    return data;
  }, []);

  return { plaintext, result, loading, testResult, onChange, test, preview };
}
