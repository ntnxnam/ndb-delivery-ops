import { useCallback, useMemo, useState } from 'react';
import { JQL_FIELDS, JQL_OPERATORS, JQL_LOGICAL, JQL_FUNCTIONS, SCRIPTRUNNER_FUNCTIONS, FIELD_VALUES, getLabelValues, getScriptRunnerFunctions, detectContext, filterPrefix } from '../utils/jqlAutocompleteLogic';

export function useJqlAutocomplete({ labelPrefix, release, baseFilter } = {}) {
  const [suggestions, setSuggestions] = useState([]);
  const [ghost, setGhost] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const compute = useCallback((text, caret) => {
    const ctx = detectContext(text, caret);
    if (ctx.kind === 'none') {
      setSuggestions([]);
      setGhost('');
      return;
    }
    if (ctx.kind === 'value') {
      // labels: derive from product context when available (D1), else placeholder fallback
      let fieldVals = FIELD_VALUES[ctx.field] || FIELD_VALUES[ctx.field.toLowerCase?.()] || [];
      if (ctx.field === 'labels' || ctx.field === 'label') {
        const dynamic = getLabelValues({ labelPrefix, release });
        if (dynamic.length) fieldVals = dynamic;
      }
      const vals = fieldVals;
      let items = [];
      if (vals.length) {
        const filtered = filterPrefix(vals, ctx.typedVal);
        items = filtered.map((v) => ({ label: v, insert: `"${v}"`, kind: 'value' }));
      } else if (ctx.field === 'filter' || ctx.field === 'filterid' || ctx.field === 'savedfilter') {
        const placeholder = filterPrefix(['NDB-All-Base-Filter', '175938', 'filter = "My Saved Filter"'], ctx.typedVal, 3).map((v) => ({ label: v, insert: v, kind: 'value' }));
        items = placeholder;
      }
      setSuggestions(items);
      setGhost(items[0] ? items[0].insert.slice(ctx.typedVal.length) : '');
      setActiveIndex(0);
      return;
    }
    if (ctx.kind === 'field') {
      const typed = ctx.typed || '';
      const fieldHits = filterPrefix(JQL_FIELDS, typed, 6).map((v) => ({ label: v, insert: v, kind: 'field' }));
      const logicHits = filterPrefix(JQL_LOGICAL, typed, 3).map((v) => ({ label: v, insert: v, kind: 'logical' }));
      const opHits = filterPrefix(JQL_OPERATORS, typed, 3).map((v) => ({ label: v, insert: v, kind: 'operator' }));
      const funcHits = filterPrefix(JQL_FUNCTIONS, typed, 2).map((v) => ({ label: v, insert: v, kind: 'function' }));
      const srSource = (baseFilter || release) ? getScriptRunnerFunctions({ baseFilter, release }) : SCRIPTRUNNER_FUNCTIONS;
      const srHits = filterPrefix(srSource, typed, 2).map((v) => ({ label: v, insert: v, kind: 'scriptrunner' }));
      let merged = [];
      if (typed.length === 0) merged = [...fieldHits, ...logicHits];
      else {
        merged = [...fieldHits, ...opHits, ...logicHits, ...funcHits, ...srHits];
        merged = merged.slice(0, 8);
      }
      setSuggestions(merged);
      const top = merged[0];
      if (top && typed) {
        const rem = top.insert.slice(typed.length);
        setGhost(rem);
      } else setGhost('');
      setActiveIndex(0);
      return;
    }
    setSuggestions([]);
    setGhost('');
  }, [labelPrefix, release, baseFilter]);

  const accept = useCallback((text, caret, idx = activeIndex) => {
    const item = suggestions[idx];
    if (!item) return null;
    const ctx = detectContext(text, caret);
    const typed = ctx.typed || ctx.typedVal || '';
    const before = text.slice(0, caret - typed.length);
    const after = text.slice(caret);
    const inserted = item.insert + ' ';
    const nextText = before + inserted + after;
    const nextCaret = before.length + inserted.length;
    return { nextText, nextCaret, item };
  }, [suggestions, activeIndex]);

  const api = useMemo(() => ({ suggestions, ghost, activeIndex, setActiveIndex, compute, accept }), [suggestions, ghost, activeIndex, compute, accept]);
  return api;
}
