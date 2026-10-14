import React, { useEffect, useMemo, useState } from 'react';

/**
 * Top-of-page wishlist Q7 settings. Pre-populated from server config;
 * Save writes dependencyViewConfig.json until the next change.
 */
export default function WishlistSettingsBar({
  wishlistMeta,
  onSave,
  saving,
  saveError,
  disabled,
}) {
  const presets = useMemo(() => {
    const list = Array.isArray(wishlistMeta?.linkTypePresets)
      ? wishlistMeta.linkTypePresets
      : ['', 'is blocked by', 'blocks', 'relates to'];
    return list;
  }, [wishlistMeta?.linkTypePresets]);

  const savedLink = wishlistMeta?.linkTypeFilter ?? '';
  const savedPartners = (wishlistMeta?.partnerLabelSuffixes || ['dependency']).join(', ');
  const savedSuffix = wishlistMeta?.labelSuffix || 'wishlist';

  const [linkTypeFilter, setLinkTypeFilter] = useState(savedLink);
  const [partnerSuffixes, setPartnerSuffixes] = useState(savedPartners);
  const [labelSuffix, setLabelSuffix] = useState(savedSuffix);
  const [customLink, setCustomLink] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setLinkTypeFilter(savedLink);
    setPartnerSuffixes(savedPartners);
    setLabelSuffix(savedSuffix);
    const inPresets = presets.some((p) => (p || '') === (savedLink || ''));
    setCustomLink(inPresets ? '' : savedLink || '');
    setStatus('');
  }, [savedLink, savedPartners, savedSuffix, presets]);

  const dirty =
    (linkTypeFilter || '') !== (savedLink || '') ||
    partnerSuffixes.trim() !== savedPartners.trim() ||
    (labelSuffix || '').trim() !== (savedSuffix || '').trim();

  const selectValue = useMemo(() => {
    if (presets.some((p) => (p || '') === (linkTypeFilter || ''))) {
      return linkTypeFilter || '';
    }
    return '__custom__';
  }, [presets, linkTypeFilter]);

  const handleSelect = (value) => {
    if (value === '__custom__') {
      setLinkTypeFilter(customLink || '');
      return;
    }
    setLinkTypeFilter(value);
    setCustomLink('');
  };

  const handleSave = async () => {
    setStatus('');
    const effectiveLink =
      selectValue === '__custom__' ? (customLink || '').trim() : (linkTypeFilter || '').trim();
    try {
      await onSave({
        linkTypeFilter: effectiveLink === '' ? null : effectiveLink,
        labelSuffix: (labelSuffix || 'wishlist').trim() || 'wishlist',
        partnerLabelSuffixes: partnerSuffixes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setStatus('Saved to dependencyViewConfig.json');
    } catch {
      // error surfaced via saveError
    }
  };

  return (
    <div className="dv-wishlist-settings">
      <div className="dv-wishlist-settings-title">
        Wishlist / pre-commit settings
        <span className="dv-meta">
          {wishlistMeta?.wishlistLabel
            ? ` · ${wishlistMeta.wishlistLabel}`
            : ' · loads with release'}
          {(wishlistMeta?.partnerLabels || []).length
            ? ` ↔ ${wishlistMeta.partnerLabels.join(', ')}`
            : ''}
        </span>
      </div>
      <div className="dv-wishlist-settings-row">
        <label>
          Link type (Q7b)
          <select
            value={selectValue}
            onChange={(e) => handleSelect(e.target.value)}
            disabled={disabled || saving}
            aria-label="Wishlist link type filter"
          >
            {presets.map((p) => (
              <option key={p === '' ? '__all__' : p} value={p}>
                {p === '' ? 'All link types' : p}
              </option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
        </label>
        {selectValue === '__custom__' && (
          <label>
            Custom link name
            <input
              type="text"
              value={customLink}
              onChange={(e) => {
                setCustomLink(e.target.value);
                setLinkTypeFilter(e.target.value);
              }}
              placeholder="e.g. has to be done after"
              disabled={disabled || saving}
            />
          </label>
        )}
        <label>
          Partner label suffixes
          <input
            type="text"
            value={partnerSuffixes}
            onChange={(e) => setPartnerSuffixes(e.target.value)}
            placeholder="dependency"
            title="Comma-separated, e.g. dependency, asks"
            disabled={disabled || saving}
          />
        </label>
        <label>
          Wishlist suffix
          <input
            type="text"
            value={labelSuffix}
            onChange={(e) => setLabelSuffix(e.target.value)}
            placeholder="wishlist"
            disabled={disabled || saving}
          />
        </label>
        <button
          type="button"
          className="dv-save-cfg"
          onClick={handleSave}
          disabled={disabled || saving || !dirty}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {(status || saveError) && (
        <div className={saveError ? 'dv-error' : 'dv-meta'} role="status">
          {saveError || status}
        </div>
      )}
    </div>
  );
}
