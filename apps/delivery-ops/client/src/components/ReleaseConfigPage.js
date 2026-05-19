import React, { useState, useEffect, useCallback } from 'react';
import { Toast } from '../shared/components/Toast';

const ReleaseConfigPage = () => {
  const [releases, setReleases] = useState({});
  const [selectedVersion, setSelectedVersion] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showNewReleaseForm, setShowNewReleaseForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Form state for release configuration
  const [releaseData, setReleaseData] = useState({
    version: '',
    ecDate: '',
    ccm1Gate: [{ label: 'Code Complete 1', date: '', color: '#de350b', style: 'dotted' }],
    ccm2Gate: [{ label: 'Code Complete 2', date: '', color: '#de350b', style: 'solid' }],
    codeFreeze: { label: 'Code Freeze (Soft Guidance)', date: '', color: '#607d8b', style: 'dashed' },
    commitGate1: { label: 'Commit Gate 1', date: '', color: '#ff9800', style: 'dotted' },
    commitGate2: { label: 'Commit Gate 2', date: '', color: '#ff9800', style: 'solid' },
    promotionGate1: { label: 'Promotion Gate 1', date: '', color: '#9c27b0', style: 'dotted' },
    promotionGate2: { label: 'Promotion Gate 2', date: '', color: '#9c27b0', style: 'solid' },
    ga1: { label: 'General Availability 1', date: '', color: '#28a745', style: 'dotted' },
    ga2: { label: 'General Availability 2', date: '', color: '#28a745', style: 'solid' }
  });

  const loadReleaseData = useCallback((version, releasesData = releases) => {
    const releaseConfig = releasesData[version];
    if (releaseConfig) {
      setReleaseData({
        version,
        ecDate: releaseConfig.ecDate || '',
        ccm1Gate: releaseConfig.ccm1Gate || [{ label: 'Concept Commit 1 (CC 1)', date: '', color: '#de350b', style: 'dotted' }],
        ccm2Gate: releaseConfig.ccm2Gate || [{ label: 'Concept Commit 2 (CC 2)', date: '', color: '#de350b', style: 'solid' }],
        codeFreeze: releaseConfig.codeFreeze || { label: 'Code Freeze (Soft Guidance)', date: '', color: '#607d8b', style: 'dashed' },
        commitGate1: releaseConfig.commitGate1 || null,
        commitGate2: releaseConfig.commitGate2 || null,
        promotionGate1: releaseConfig.promotionGate1 || null,
        promotionGate2: releaseConfig.promotionGate2 || null,
        ga1: releaseConfig.ga1 || null,
        ga2: releaseConfig.ga2 || null
      });
    }
  }, [releases]);

  const loadReleaseConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/config/release-dates');
      
      if (!response.ok) {
        throw new Error('Failed to load release configurations');
      }
      
      const data = await response.json();
      setReleases(data.releases || {});
      
      // Select first release if available and none selected
      const releaseVersions = Object.keys(data.releases || {});
      if (releaseVersions.length > 0 && !selectedVersion) {
        setSelectedVersion(releaseVersions[0]);
        loadReleaseData(releaseVersions[0], data.releases);
      }
    } catch (err) {
      setError('Failed to load release configurations: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedVersion, loadReleaseData]);

  // Load release configurations on component mount
  useEffect(() => {
    loadReleaseConfigs();
  }, [loadReleaseConfigs]);

  const handleVersionSelect = (version) => {
    setSelectedVersion(version);
    setIsEditing(false);
    setShowNewReleaseForm(false);
    loadReleaseData(version);
  };

  const handleNewRelease = () => {
    setReleaseData({
      version: '',
      ecDate: '',
      ccm1Gate: [{ label: 'Concept Commit 1 (CC 1)', date: '', color: '#de350b', style: 'dotted' }],
      ccm2Gate: [{ label: 'Concept Commit 2 (CC 2)', date: '', color: '#de350b', style: 'solid' }],
      codeFreeze: { label: 'Code Freeze (Soft Guidance)', date: '', color: '#607d8b', style: 'dashed' },
      commitGate1: null,
      commitGate2: null,
      promotionGate1: null,
      promotionGate2: null,
      ga1: null,
      ga2: null
    });
    setSelectedVersion('');
    setIsEditing(true);
    setShowNewReleaseForm(true);
  };

  const handleEdit = () => {
    setIsEditing(true);
    setShowNewReleaseForm(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setShowNewReleaseForm(false);
    if (selectedVersion) {
      loadReleaseData(selectedVersion);
    }
  };

  const updateGateDate = (gateKey, date) => {
    if (Array.isArray(releaseData[gateKey])) {
      // Handle array gates (ccm1Gate, ccm2Gate)
      const updatedGate = [...releaseData[gateKey]];
      updatedGate[0] = { ...updatedGate[0], date };
      setReleaseData({
        ...releaseData,
        [gateKey]: updatedGate
      });
    } else if (releaseData[gateKey]) {
      // Handle existing object gates
      setReleaseData({
        ...releaseData,
        [gateKey]: { ...releaseData[gateKey], date }
      });
    } else {
      // Create new gate if it doesn't exist
      const gateLabels = {
        commitGate1: 'Commit Gate',
        commitGate2: 'Commit Gate 2',
        promotionGate1: 'Promotion Gate',
        promotionGate2: 'Promotion Gate 2', 
        ga1: 'GA Target Date',
        ga2: 'General Availability 2'
      };
      const gateColors = {
        commitGate1: '#ff9800',
        commitGate2: '#ff9800',
        promotionGate1: '#9c27b0',
        promotionGate2: '#9c27b0',
        ga1: '#28a745',
        ga2: '#28a745'
      };
      setReleaseData({
        ...releaseData,
        [gateKey]: {
          label: gateLabels[gateKey] || 'Gate',
          date,
          color: gateColors[gateKey] || '#6c757d',
          style: 'solid'
        }
      });
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      
      // Validate required fields
      if (!releaseData.version.trim()) {
        setError('Release version is required');
        return;
      }

      const saveData = {
        version: releaseData.version.trim(),
        ecDate: releaseData.ecDate.trim(),
        ccm1Gate: releaseData.ccm1Gate.filter(cc => cc.date.trim()),
        ccm2Gate: releaseData.ccm2Gate.filter(cc => cc.date.trim()),
        codeFreeze: releaseData.codeFreeze.date.trim() ? releaseData.codeFreeze : null,
        commitGate1: releaseData.commitGate1 && releaseData.commitGate1.date.trim() ? releaseData.commitGate1 : null,
        commitGate2: releaseData.commitGate2 && releaseData.commitGate2.date.trim() ? releaseData.commitGate2 : null,
        promotionGate1: releaseData.promotionGate1 && releaseData.promotionGate1.date.trim() ? releaseData.promotionGate1 : null,
        promotionGate2: releaseData.promotionGate2 && releaseData.promotionGate2.date.trim() ? releaseData.promotionGate2 : null,
        ga1: releaseData.ga1 && releaseData.ga1.date.trim() ? releaseData.ga1 : null,
        ga2: releaseData.ga2 && releaseData.ga2.date.trim() ? releaseData.ga2 : null
      };

      const response = await fetch('/api/config/release-dates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Username': localStorage.getItem('username') || ''
        },
        body: JSON.stringify(saveData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save release configuration');
      }

      // Reload configurations
      await loadReleaseConfigs();
      setSelectedVersion(saveData.version);
      setIsEditing(false);
      setShowNewReleaseForm(false);
      setSuccess(`Release configuration for ${saveData.version} saved successfully`);
      
    } catch (err) {
      setError('Failed to save release configuration: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedVersion) return;
    
    if (!window.confirm(`Are you sure you want to delete the release configuration for ${selectedVersion}?`)) {
      return;
    }

    try {
      setSaving(true);
      setError('');

      const response = await fetch(`/api/config/release-dates/${selectedVersion}`, {
        method: 'DELETE',
        headers: {
          'X-Username': localStorage.getItem('username') || ''
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete release configuration');
      }

      // Reload configurations
      await loadReleaseConfigs();
      setSelectedVersion('');
      setIsEditing(false);
      setSuccess(`Release configuration for ${selectedVersion} deleted successfully`);
      
    } catch (err) {
      setError('Failed to delete release configuration: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="release-config-loading">
        <div className="loading-spinner">⏳</div>
        <p>Loading release configurations...</p>
      </div>
    );
  }

  const releaseVersions = Object.keys(releases);

  return (
    <div className="release-config-page">
      <div className="page-header">
        <div className="header-content">
          <h1>Release Configuration</h1>
          <p>Manage release dates and milestones for different versions</p>
        </div>
        <div className="header-actions">
          <button 
            onClick={handleNewRelease}
            className="btn-primary"
            disabled={saving}
          >
            📅 New Release
          </button>
        </div>
      </div>

      <div className="config-content">
        {/* Release Version Selector */}
        {releaseVersions.length > 0 && (
          <div className="version-selector">
            <label>Select Release Version:</label>
            <div className="version-tabs">
              {releaseVersions.map((version) => (
                <button
                  key={version}
                  onClick={() => handleVersionSelect(version)}
                  className={`version-tab ${selectedVersion === version ? 'active' : ''}`}
                >
                  {version}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Release Configuration Form */}
        {(selectedVersion || showNewReleaseForm) && (
          <div className="release-form">
            <div className="form-header">
              <h2>
                {showNewReleaseForm ? 'New Release Configuration' : `Release ${selectedVersion}`}
              </h2>
              <div className="form-actions">
                {!isEditing ? (
                  <>
                    <button onClick={handleEdit} className="btn-secondary">
                      ✏️ Edit
                    </button>
                    {selectedVersion && (
                      <button 
                        onClick={handleDelete} 
                        className="btn-danger"
                        disabled={saving}
                      >
                        🗑️ Delete
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button 
                      onClick={handleSave} 
                      className="btn-primary"
                      disabled={saving}
                    >
                      {saving ? '💾 Saving...' : '💾 Save'}
                    </button>
                    <button onClick={handleCancel} className="btn-secondary">
                      ❌ Cancel
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="form-content">
              {/* Release Version Input */}
              {(showNewReleaseForm || isEditing) && (
                <div className="form-group">
                  <label>Release Version:</label>
                  <input
                    type="text"
                    value={releaseData.version}
                    onChange={(e) => setReleaseData({...releaseData, version: e.target.value})}
                    placeholder="e.g., NDB-2.12"
                    disabled={!showNewReleaseForm && selectedVersion}
                  />
                </div>
              )}

              {/* Execute Commit Date */}
              <div className="form-group">
                <label>Execute Commit (EC):</label>
                <input
                  type="date"
                  value={releaseData.ecDate}
                  onChange={(e) => setReleaseData({...releaseData, ecDate: e.target.value})}
                  disabled={!isEditing}
                />
              </div>

              {/* Concept Commits */}
              <div className="gate-section">
                <h3>Concept Commits</h3>
                <div className="gate-group">
                  <div className="form-group">
                    <label>Concept Commit 1 (CC 1):</label>
                    <input
                      type="date"
                      value={releaseData.ccm1Gate[0]?.date || ''}
                      onChange={(e) => updateGateDate('ccm1Gate', e.target.value)}
                      disabled={!isEditing}
                    />
                  </div>
                  <div className="form-group">
                    <label>Concept Commit 2 (CC 2):</label>
                    <input
                      type="date"
                      value={releaseData.ccm2Gate[0]?.date || ''}
                      onChange={(e) => updateGateDate('ccm2Gate', e.target.value)}
                      disabled={!isEditing}
                    />
                  </div>
                </div>
              </div>

              {/* Code Freeze */}
              <div className="gate-section">
                <h3>Code Freeze</h3>
                <div className="form-group">
                  <label>Code Freeze (Soft Guidance):</label>
                  <input
                    type="date"
                    value={releaseData.codeFreeze.date}
                    onChange={(e) => updateGateDate('codeFreeze', e.target.value)}
                    disabled={!isEditing}
                  />
                </div>
              </div>

              {/* Commit Gates */}
              <div className="gate-section">
                <h3>Commit Gates</h3>
                <div className="gate-group">
                  {releaseData.commitGate1 && (
                    <div className="form-group">
                      <label>{releaseData.commitGate1.label}:</label>
                      <input
                        type="date"
                        value={releaseData.commitGate1.date}
                        onChange={(e) => updateGateDate('commitGate1', e.target.value)}
                        disabled={!isEditing}
                      />
                    </div>
                  )}
                  {releaseData.commitGate2 && (
                    <div className="form-group">
                      <label>{releaseData.commitGate2.label}:</label>
                      <input
                        type="date"
                        value={releaseData.commitGate2.date}
                        onChange={(e) => updateGateDate('commitGate2', e.target.value)}
                        disabled={!isEditing}
                      />
                    </div>
                  )}
                  {isEditing && !releaseData.commitGate1 && (
                    <button
                      onClick={() => updateGateDate('commitGate1', '')}
                      className="btn-add-gate"
                    >
                      ➕ Add Commit Gate
                    </button>
                  )}
                  {isEditing && releaseData.commitGate1 && !releaseData.commitGate2 && (
                    <button
                      onClick={() => updateGateDate('commitGate2', '')}
                      className="btn-add-gate"
                    >
                      ➕ Add Commit Gate 2
                    </button>
                  )}
                </div>
              </div>

              {/* Promotion Gates */}
              <div className="gate-section">
                <h3>Promotion Gates</h3>
                <div className="gate-group">
                  {releaseData.promotionGate1 && (
                    <div className="form-group">
                      <label>{releaseData.promotionGate1.label}:</label>
                      <input
                        type="date"
                        value={releaseData.promotionGate1.date}
                        onChange={(e) => updateGateDate('promotionGate1', e.target.value)}
                        disabled={!isEditing}
                      />
                    </div>
                  )}
                  {releaseData.promotionGate2 && (
                    <div className="form-group">
                      <label>{releaseData.promotionGate2.label}:</label>
                      <input
                        type="date"
                        value={releaseData.promotionGate2.date}
                        onChange={(e) => updateGateDate('promotionGate2', e.target.value)}
                        disabled={!isEditing}
                      />
                    </div>
                  )}
                  {isEditing && !releaseData.promotionGate1 && (
                    <button
                      onClick={() => updateGateDate('promotionGate1', '')}
                      className="btn-add-gate"
                    >
                      ➕ Add Promotion Gate
                    </button>
                  )}
                  {isEditing && releaseData.promotionGate1 && !releaseData.promotionGate2 && (
                    <button
                      onClick={() => updateGateDate('promotionGate2', '')}
                      className="btn-add-gate"
                    >
                      ➕ Add Promotion Gate 2
                    </button>
                  )}
                </div>
              </div>

              {/* General Availability */}
              <div className="gate-section">
                <h3>General Availability</h3>
                <div className="gate-group">
                  {releaseData.ga1 && (
                    <div className="form-group">
                      <label>{releaseData.ga1.label}:</label>
                      <input
                        type="date"
                        value={releaseData.ga1.date}
                        onChange={(e) => updateGateDate('ga1', e.target.value)}
                        disabled={!isEditing}
                      />
                    </div>
                  )}
                  {releaseData.ga2 && (
                    <div className="form-group">
                      <label>{releaseData.ga2.label}:</label>
                      <input
                        type="date"
                        value={releaseData.ga2.date}
                        onChange={(e) => updateGateDate('ga2', e.target.value)}
                        disabled={!isEditing}
                      />
                    </div>
                  )}
                  {isEditing && !releaseData.ga1 && (
                    <button
                      onClick={() => updateGateDate('ga1', '')}
                      className="btn-add-gate"
                    >
                      ➕ Add GA Target Date
                    </button>
                  )}
                  {isEditing && releaseData.ga1 && !releaseData.ga2 && (
                    <button
                      onClick={() => updateGateDate('ga2', '')}
                      className="btn-add-gate"
                    >
                      ➕ Add GA 2
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {releaseVersions.length === 0 && !showNewReleaseForm && (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            <h3>No Release Configurations</h3>
            <p>Create your first release configuration to get started</p>
            <button onClick={handleNewRelease} className="btn-primary">
              📅 Create New Release
            </button>
          </div>
        )}
      </div>

      {/* Toast Messages */}
      {error && (
        <Toast
          message={error}
          type="error"
          onClose={() => setError('')}
        />
      )}
      {success && (
        <Toast
          message={success}
          type="success"
          onClose={() => setSuccess('')}
        />
      )}

      <style>{`
        .release-config-page {
          padding: 24px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 32px;
          padding-bottom: 16px;
          border-bottom: 2px solid #e9ecef;
        }

        .header-content h1 {
          margin: 0 0 8px 0;
          color: #333;
          font-size: 32px;
          font-weight: 600;
        }

        .header-content p {
          margin: 0;
          color: #6c757d;
          font-size: 16px;
        }

        .header-actions {
          display: flex;
          gap: 12px;
        }

        .version-selector {
          margin-bottom: 24px;
        }

        .version-selector label {
          display: block;
          margin-bottom: 12px;
          font-weight: 600;
          color: #333;
        }

        .version-tabs {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }

        .version-tab {
          padding: 8px 16px;
          border: 2px solid #dee2e6;
          background: white;
          color: #6c757d;
          border-radius: 6px 6px 0 0;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s ease;
        }

        .version-tab:hover {
          border-color: #007bff;
          color: #007bff;
        }

        .version-tab.active {
          border-color: #007bff;
          background: #007bff;
          color: white;
        }

        .release-form {
          background: white;
          border: 2px solid #dee2e6;
          border-radius: 0 8px 8px 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .form-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px 24px;
          border-bottom: 1px solid #dee2e6;
          background: #f8f9fa;
        }

        .form-header h2 {
          margin: 0;
          color: #333;
          font-size: 20px;
          font-weight: 600;
        }

        .form-actions {
          display: flex;
          gap: 12px;
        }

        .form-content {
          padding: 24px;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          margin-bottom: 6px;
          font-weight: 600;
          color: #333;
        }

        .group-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }


        .gate-section {
          margin-bottom: 32px;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 8px;
          border-left: 4px solid #007bff;
        }

        .gate-section h3 {
          margin: 0 0 16px 0;
          color: #333;
          font-size: 18px;
          font-weight: 600;
        }

        .gate-group {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 16px;
        }

        .form-group input {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ced4da;
          border-radius: 4px;
          font-size: 14px;
          transition: border-color 0.2s ease;
        }

        .form-group input:focus {
          outline: none;
          border-color: #007bff;
          box-shadow: 0 0 0 2px rgba(0,123,255,0.25);
        }

        .form-group input:disabled {
          background: #f8f9fa;
          color: #6c757d;
        }

        .btn-primary, .btn-secondary, .btn-danger, .btn-add, .btn-remove, .btn-add-gate {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .btn-primary {
          background: #007bff;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: #0056b3;
        }

        .btn-secondary {
          background: #6c757d;
          color: white;
        }

        .btn-secondary:hover {
          background: #545b62;
        }

        .btn-danger {
          background: #dc3545;
          color: white;
        }

        .btn-danger:hover:not(:disabled) {
          background: #c82333;
        }

        .btn-add {
          background: #28a745;
          color: white;
          padding: 6px 12px;
          font-size: 12px;
        }

        .btn-add:hover {
          background: #218838;
        }

        .btn-remove {
          background: #dc3545;
          color: white;
          padding: 4px 8px;
          font-size: 12px;
          flex-shrink: 0;
        }

        .btn-remove:hover {
          background: #c82333;
        }

        .btn-add-gate {
          background: #17a2b8;
          color: white;
          padding: 8px 12px;
          font-size: 13px;
        }

        .btn-add-gate:hover {
          background: #138496;
        }

        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .empty-state {
          text-align: center;
          padding: 60px 24px;
          color: #6c757d;
        }

        .empty-icon {
          font-size: 48px;
          margin-bottom: 16px;
        }

        .empty-state h3 {
          margin: 0 0 12px 0;
          font-size: 24px;
          color: #333;
        }

        .empty-state p {
          margin: 0 0 24px 0;
          font-size: 16px;
        }

        .release-config-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 24px;
          color: #6c757d;
        }

        .loading-spinner {
          font-size: 32px;
          margin-bottom: 16px;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.1); }
        }

        @media (max-width: 768px) {
          .release-config-page {
            padding: 16px;
          }

          .page-header {
            flex-direction: column;
            gap: 16px;
            align-items: stretch;
          }

          .form-header {
            flex-direction: column;
            gap: 16px;
            align-items: stretch;
          }

          .form-actions {
            justify-content: stretch;
          }

          .form-actions button {
            flex: 1;
          }

          .gate-group {
            grid-template-columns: 1fr;
          }

          .version-tabs {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
};

export default ReleaseConfigPage;