import React, { useState } from 'react';
import { authenticatedPost } from '../../utils/api';

const STEPS = [
  { id: 'basic', name: 'Basic Info', description: 'Team name and project details' },
  { id: 'versions', name: 'Version Config', description: 'Configure version patterns' },
  { id: 'users', name: 'User Management', description: 'Set up team permissions' },
  { id: 'filters', name: 'JIRA Filters', description: 'Configure base filters' },
  { id: 'test', name: 'Test & Validate', description: 'Verify configuration' }
];

function TeamOnboardingWizard({ onComplete, onCancel, editMode = false, initialData = null }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState(() => {
    if (editMode && initialData) {
      return {
        // Basic Info
        id: initialData.id || '',
        name: initialData.name || '',
        projectKey: initialData.projectKey || '',
        projectType: initialData.projectType || 'dedicated',
        boardId: initialData.boardId || null,
        
        // Version Config
        versionPatterns: (initialData.versionPatterns && initialData.versionPatterns.length > 0)
          ? initialData.versionPatterns
          : [''],
        
        // User Management
        admins: (initialData.userConfig?.admins && initialData.userConfig.admins.length > 0) 
          ? initialData.userConfig.admins 
          : [''],
        allowedUsers: (initialData.userConfig?.allowedUsers && initialData.userConfig.allowedUsers.length > 0)
          ? initialData.userConfig.allowedUsers 
          : [''],
        emailSenders: (initialData.userConfig?.emailSenders && initialData.userConfig.emailSenders.length > 0)
          ? initialData.userConfig.emailSenders 
          : [''],
        features: initialData.userConfig?.features || {
          releaseVersions: true,
          sprintReports: true,
          kpiTab: true
        },
        
        // Filters
        baseFilter: initialData.baseFilter || '',
        sprintBaseFilter: initialData.sprintBaseFilter || ''
      };
    }
    
    return {
      // Basic Info
      id: '',
      name: '',
      projectKey: '',
      projectType: 'dedicated',
      boardId: null,
      
      // Version Config
      versionPatterns: [''],
      
      // User Management
      admins: [''],
      allowedUsers: [''],
      emailSenders: [''],
      features: {
        releaseVersions: true,
        sprintReports: true,
        kpiTab: true
      },
      
      // Filters
      baseFilter: '',
      sprintBaseFilter: ''
    };
  });
  
  const [validation, setValidation] = useState({});
  const [loading, setLoading] = useState(false);
  const [testResults, setTestResults] = useState(null);

  const updateFormData = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear validation error for this field
    if (validation[field]) {
      setValidation(prev => ({ ...prev, [field]: null }));
    }
  };

  const validateStep = (stepIndex) => {
    const errors = {};
    
    switch (stepIndex) {
      case 0: // Basic Info
        if (!formData.id.trim()) errors.id = 'Team ID is required';
        if (!formData.name.trim()) errors.name = 'Team name is required';
        if (!formData.projectKey.trim()) errors.projectKey = 'Project key is required';
        if (!/^[a-z0-9-]+$/.test(formData.id)) {
          errors.id = 'Team ID must contain only lowercase letters, numbers, and hyphens';
        }
        break;
        
      case 1: // Version Config
        if (formData.projectType === 'parent') {
          const patterns = formData.versionPatterns.filter(p => p.trim());
          if (patterns.length === 0) {
            errors.versionPatterns = 'At least one version pattern is required for parent projects';
          }
        }
        break;
        
      case 2: // User Management
        const admins = formData.admins.filter(u => u.trim());
        if (admins.length === 0) {
          errors.admins = 'At least one admin is required';
        }
        break;
        
      case 3: // Filters
        // Filters are optional but should be valid if provided
        break;
        
      default:
        // No validation needed for other steps
        break;
    }
    
    setValidation(errors);
    return Object.keys(errors).length === 0;
  };

  const nextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
    }
  };

  const prevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  };

  const validateJiraProject = async () => {
    if (!formData.projectKey) return;
    
    setLoading(true);
    try {
      const jiraToken = localStorage.getItem('jiraToken');
      const response = await authenticatedPost('/api/admin/validate-jira-project', 
        { projectKey: formData.projectKey, jiraToken },
        { jiraToken, username: localStorage.getItem('username') || '' }
      );
      
      if (response.data.success) {
        setValidation(prev => ({ 
          ...prev, 
          projectValidation: { 
            valid: true, 
            project: response.data.project,
            versions: response.data.versions
          } 
        }));
      }
    } catch (error) {
      setValidation(prev => ({ 
        ...prev, 
        projectValidation: { 
          valid: false, 
          error: error.response?.data?.message || 'Project validation failed' 
        } 
      }));
    }
    setLoading(false);
  };

  const testConfiguration = async () => {
    setLoading(true);
    setTestResults(null);
    
    try {
      const jiraToken = localStorage.getItem('jiraToken');
      
      // Create a temporary team config for testing
      const _testTeam = {
        id: formData.id,
        name: formData.name,
        projectKey: formData.projectKey,
        projectType: formData.projectType,
        versionPatterns: formData.projectType === 'parent' 
          ? formData.versionPatterns.filter(p => p.trim())
          : undefined,
        baseFilter: formData.baseFilter || undefined,
        sprintBaseFilter: formData.sprintBaseFilter || undefined
      };

      // First validate JIRA access
      await validateJiraProject();

      // Test filters if provided
      const filters = [];
      if (formData.baseFilter) {
        filters.push({ name: 'baseFilter', filterQuery: formData.baseFilter });
      }
      if (formData.sprintBaseFilter) {
        filters.push({ name: 'sprintBaseFilter', filterQuery: formData.sprintBaseFilter });
      }

      let filterResults = null;
      if (filters.length > 0) {
        const filterResponse = await authenticatedPost('/api/admin/validate-filters',
          { filters, jiraToken },
          { jiraToken, username: localStorage.getItem('username') || '' }
        );
        filterResults = filterResponse.data;
      }

      setTestResults({
        projectValidation: validation.projectValidation,
        filterValidation: filterResults,
        overallValid: validation.projectValidation?.valid && 
                     (filterResults?.success !== false)
      });

    } catch (error) {
      setTestResults({
        error: error.response?.data?.message || 'Configuration test failed',
        overallValid: false
      });
    }
    
    setLoading(false);
  };

  const saveTeam = async () => {
    if (!validateStep(4)) return;
    
    setLoading(true);
    try {
      const teamData = {
        id: formData.id,
        name: formData.name,
        projectKey: formData.projectKey,
        projectType: formData.projectType,
        ...(formData.projectType === 'parent' && {
          versionPatterns: formData.versionPatterns.filter(p => p.trim())
        }),
        ...(formData.boardId && { boardId: parseInt(formData.boardId) }),
        ...(formData.baseFilter && { baseFilter: formData.baseFilter }),
        ...(formData.sprintBaseFilter && { sprintBaseFilter: formData.sprintBaseFilter }),
        userConfig: {
          admins: formData.admins.filter(u => u.trim()),
          allowedUsers: formData.allowedUsers.filter(u => u.trim()),
          emailSenders: formData.emailSenders.filter(u => u.trim()),
          features: formData.features
        }
      };

      const url = editMode ? `/api/admin/teams/${formData.id}` : '/api/admin/teams';
      const method = editMode ? 'PUT' : 'POST';
      
      const response = await fetch(`${window.location.origin}${url}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jiraToken')}`,
          'X-Username': localStorage.getItem('username') || ''
        },
        body: JSON.stringify(teamData)
      });

      const data = await response.json();
      
      if (data.success) {
        onComplete(data.team);
      } else {
        throw new Error(data.message || `Failed to ${editMode ? 'update' : 'create'} team`);
      }
    } catch (error) {
      setValidation(prev => ({
        ...prev,
        createError: error.message || `Failed to ${editMode ? 'update' : 'create'} team`
      }));
    }
    setLoading(false);
  };

  const addArrayField = (field) => {
    updateFormData(field, [...formData[field], '']);
  };

  const removeArrayField = (field, index) => {
    const newArray = formData[field].filter((_, i) => i !== index);
    updateFormData(field, newArray);
  };

  const updateArrayField = (field, index, value) => {
    const newArray = [...formData[field]];
    newArray[index] = value;
    updateFormData(field, newArray);
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: // Basic Info
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ 
                display: 'block', 
                fontSize: '14px', 
                fontWeight: '500', 
                marginBottom: '4px' 
              }}>
                Team ID *
              </label>
              <input
                type="text"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: `1px solid ${validation.id ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '4px',
                  backgroundColor: editMode ? '#f3f4f6' : 'white',
                  fontSize: '14px'
                }}
                value={formData.id}
                onChange={(e) => updateFormData('id', e.target.value.toLowerCase())}
                placeholder="e.g., datalens, analytics-team"
                disabled={editMode}
              />
              {validation.id && (
                <p style={{ color: '#ef4444', fontSize: '14px', marginTop: '4px' }}>
                  {validation.id}
                </p>
              )}
              {editMode && (
                <p style={{ color: '#6b7280', fontSize: '14px', marginTop: '4px' }}>
                  Team ID cannot be changed
                </p>
              )}
            </div>

            <div>
              <label style={{ 
                display: 'block', 
                fontSize: '14px', 
                fontWeight: '500', 
                marginBottom: '4px' 
              }}>
                Team Name *
              </label>
              <input
                type="text"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: `1px solid ${validation.name ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
                value={formData.name}
                onChange={(e) => updateFormData('name', e.target.value)}
                placeholder="e.g., DataLens, Analytics Team"
              />
              {validation.name && (
                <p style={{ color: '#ef4444', fontSize: '14px', marginTop: '4px' }}>
                  {validation.name}
                </p>
              )}
            </div>

            <div>
              <label style={{ 
                display: 'block', 
                fontSize: '14px', 
                fontWeight: '500', 
                marginBottom: '4px' 
              }}>
                Project Type *
              </label>
              <select
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
                value={formData.projectType}
                onChange={(e) => updateFormData('projectType', e.target.value)}
              >
                <option value="dedicated">Dedicated Project (e.g., NDB → ERA)</option>
                <option value="parent">Parent Project (e.g., DataLens → ENG)</option>
              </select>
            </div>

            <div>
              <label style={{ 
                display: 'block', 
                fontSize: '14px', 
                fontWeight: '500', 
                marginBottom: '4px' 
              }}>
                JIRA Project Key *
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  style={{
                    flex: 1,
                    padding: '8px',
                    border: `1px solid ${validation.projectKey ? '#ef4444' : '#d1d5db'}`,
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                  value={formData.projectKey}
                  onChange={(e) => updateFormData('projectKey', e.target.value.toUpperCase())}
                  placeholder="e.g., ERA, ENG"
                />
                <button
                  type="button"
                  onClick={validateJiraProject}
                  disabled={!formData.projectKey || loading}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: (!formData.projectKey || loading) ? '#9ca3af' : '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: (!formData.projectKey || loading) ? 'not-allowed' : 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Validate
                </button>
              </div>
              {validation.projectKey && (
                <p style={{ color: '#ef4444', fontSize: '14px', marginTop: '4px' }}>
                  {validation.projectKey}
                </p>
              )}
              {validation.projectValidation && (
                <div className={`mt-2 p-2 rounded ${validation.projectValidation.valid ? 'bg-green-100' : 'bg-red-100'}`}>
                  {validation.projectValidation.valid ? (
                    <div>
                      <p className="text-green-800 font-medium">✓ Project validated successfully</p>
                      <p className="text-sm text-green-700">
                        {validation.projectValidation.project.name} - 
                        {validation.projectValidation.versions.open} open versions
                      </p>
                    </div>
                  ) : (
                    <p className="text-red-800">✗ {validation.projectValidation.error}</p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Board ID (optional)</label>
              <input
                type="number"
                className="w-full p-2 border border-gray-300 rounded"
                value={formData.boardId || ''}
                onChange={(e) => updateFormData('boardId', e.target.value)}
                placeholder="JIRA board ID for sprint reports"
              />
            </div>
          </div>
        );

      case 1: // Version Config
        return (
          <div className="space-y-4">
            <div className="bg-blue-50 p-3 rounded">
              <p className="text-blue-800 text-sm">
                {formData.projectType === 'dedicated' ? (
                  'Dedicated projects use all versions directly from the JIRA project. No additional configuration needed.'
                ) : (
                  'Parent projects share versions with multiple products. Configure patterns to filter versions for this team.'
                )}
              </p>
            </div>

            {formData.projectType === 'parent' && (
              <div>
                <label className="block text-sm font-medium mb-1">Version Patterns *</label>
                <p className="text-sm text-gray-600 mb-2">
                  Version name filters. Globs (msp*) and regular expressions (^DataLens.*) both work.
                </p>
                {formData.versionPatterns.map((pattern, index) => (
                  <div key={index} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      className="flex-1 p-2 border border-gray-300 rounded"
                      value={pattern}
                      onChange={(e) => updateArrayField('versionPatterns', index, e.target.value)}
                      placeholder="msp* or ^DataLens.*"
                    />
                    {formData.versionPatterns.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeArrayField('versionPatterns', index)}
                        className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addArrayField('versionPatterns')}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Add Pattern
                </button>
                {validation.versionPatterns && (
                  <p className="text-red-500 text-sm mt-1">{validation.versionPatterns}</p>
                )}
              </div>
            )}

            {formData.projectType === 'parent' && validation.projectValidation?.valid && (
              <div className="bg-gray-50 p-3 rounded">
                <p className="font-medium mb-2">Version Preview:</p>
                <p className="text-sm text-gray-600">
                  Sample versions from {formData.projectKey}: {' '}
                  {validation.projectValidation.versions.openVersionNames.slice(0, 3).join(', ')}
                  {validation.projectValidation.versions.openVersionNames.length > 3 && '...'}
                </p>
              </div>
            )}
          </div>
        );

      case 2: // User Management
        return (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-1">Team Admins *</label>
              <p className="text-sm text-gray-600 mb-2">
                Users who can manage KPIs and team settings
              </p>
              {formData.admins.map((admin, index) => (
                <div key={index} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    className="flex-1 p-2 border border-gray-300 rounded"
                    value={admin}
                    onChange={(e) => updateArrayField('admins', index, e.target.value)}
                    placeholder="username"
                  />
                  {formData.admins.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeArrayField('admins', index)}
                      className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => addArrayField('admins')}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              >
                Add Admin
              </button>
              {validation.admins && <p className="text-red-500 text-sm mt-1">{validation.admins}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Allowed Users</label>
              <p className="text-sm text-gray-600 mb-2">
                Users who can access team features
              </p>
              {formData.allowedUsers.map((user, index) => (
                <div key={index} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    className="flex-1 p-2 border border-gray-300 rounded"
                    value={user}
                    onChange={(e) => updateArrayField('allowedUsers', index, e.target.value)}
                    placeholder="username"
                  />
                  <button
                    type="button"
                    onClick={() => removeArrayField('allowedUsers', index)}
                    className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addArrayField('allowedUsers')}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              >
                Add User
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Email Senders</label>
              <p className="text-sm text-gray-600 mb-2">
                Users who can send release version emails
              </p>
              {formData.emailSenders.map((sender, index) => (
                <div key={index} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    className="flex-1 p-2 border border-gray-300 rounded"
                    value={sender}
                    onChange={(e) => updateArrayField('emailSenders', index, e.target.value)}
                    placeholder="username"
                  />
                  <button
                    type="button"
                    onClick={() => removeArrayField('emailSenders', index)}
                    className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addArrayField('emailSenders')}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              >
                Add Sender
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Feature Access</label>
              <div className="space-y-2">
                {Object.entries(formData.features).map(([feature, enabled]) => (
                  <label key={feature} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => updateFormData('features', {
                        ...formData.features,
                        [feature]: e.target.checked
                      })}
                      className="mr-2"
                    />
                    <span className="capitalize">{feature.replace(/([A-Z])/g, ' $1')}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );

      case 3: // Filters
        return (
          <div className="space-y-4">
            <div className="bg-yellow-50 p-3 rounded">
              <p className="text-yellow-800 text-sm">
                JIRA filters are optional but recommended. They define the base set of issues for this team.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Base Filter</label>
              <input
                type="text"
                className="w-full p-2 border border-gray-300 rounded"
                value={formData.baseFilter}
                onChange={(e) => updateFormData('baseFilter', e.target.value)}
                placeholder="filter=DataLens-All-Base-Filter and statusCategory!=Done"
              />
              <p className="text-sm text-gray-500 mt-1">
                Used for general issue queries and KPI calculations
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Sprint Base Filter</label>
              <input
                type="text"
                className="w-full p-2 border border-gray-300 rounded"
                value={formData.sprintBaseFilter}
                onChange={(e) => updateFormData('sprintBaseFilter', e.target.value)}
                placeholder="filter=DataLens-All-Base-Filter"
              />
              <p className="text-sm text-gray-500 mt-1">
                Used for sprint reports and velocity calculations
              </p>
            </div>
          </div>
        );

      case 4: // Test & Validate
        return (
          <div className="space-y-4">
            <div className="bg-blue-50 p-3 rounded">
              <p className="text-blue-800 text-sm">
                Test the complete team configuration before creating the team.
              </p>
            </div>

            <button
              type="button"
              onClick={testConfiguration}
              disabled={loading}
              className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
            >
              {loading ? 'Testing Configuration...' : 'Test Configuration'}
            </button>

            {testResults && (
              <div className="space-y-3">
                <div className={`p-3 rounded ${testResults.overallValid ? 'bg-green-50' : 'bg-red-50'}`}>
                  <h4 className={`font-medium ${testResults.overallValid ? 'text-green-800' : 'text-red-800'}`}>
                    {testResults.overallValid ? '✓ Configuration Valid' : '✗ Configuration Issues'}
                  </h4>
                </div>

                {testResults.projectValidation && (
                  <div className="border rounded p-3">
                    <h5 className="font-medium mb-2">Project Access</h5>
                    {testResults.projectValidation.valid ? (
                      <p className="text-green-700 text-sm">
                        ✓ Project {formData.projectKey} is accessible
                      </p>
                    ) : (
                      <p className="text-red-700 text-sm">
                        ✗ {testResults.projectValidation.error}
                      </p>
                    )}
                  </div>
                )}

                {testResults.filterValidation && (
                  <div className="border rounded p-3">
                    <h5 className="font-medium mb-2">Filter Validation</h5>
                    {testResults.filterValidation.results?.map((result, index) => (
                      <p key={index} className={`text-sm ${result.valid ? 'text-green-700' : 'text-red-700'}`}>
                        {result.valid ? '✓' : '✗'} {result.name}: {' '}
                        {result.valid ? `${result.issueCount} issues` : result.error}
                      </p>
                    ))}
                  </div>
                )}

                {testResults.error && (
                  <div className="border border-red-300 rounded p-3 bg-red-50">
                    <p className="text-red-700 text-sm">{testResults.error}</p>
                  </div>
                )}
              </div>
            )}

            {validation.createError && (
              <div className="bg-red-50 border border-red-300 rounded p-3">
                <p className="text-red-700 text-sm">{validation.createError}</p>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="team-onboarding-wizard"
      style={{ 
        maxWidth: '1024px', 
        margin: '0 auto', 
        padding: '24px' 
      }}>
      <h2 style={{ 
        fontSize: '24px', 
        fontWeight: 'bold', 
        marginBottom: '24px' 
      }}>
        {editMode ? `Edit Team: ${initialData?.name || formData.name}` : 'Team Onboarding Wizard'}
      </h2>
      
      {/* Progress Steps */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        marginBottom: '32px' 
      }}>
        {STEPS.map((step, index) => (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: '500',
              backgroundColor: index <= currentStep ? '#3b82f6' : '#e5e7eb',
              color: index <= currentStep ? 'white' : '#6b7280'
            }}>
              {index + 1}
            </div>
            <div style={{ marginLeft: '8px' }}>
              <p style={{
                fontSize: '14px',
                fontWeight: '500',
                color: index <= currentStep ? '#2563eb' : '#6b7280',
                margin: 0
              }}>
                {step.name}
              </p>
              <p style={{
                fontSize: '12px',
                color: '#9ca3af',
                margin: 0
              }}>
                {step.description}
              </p>
            </div>
            {index < STEPS.length - 1 && (
              <div style={{
                width: '48px',
                height: '2px',
                marginLeft: '16px',
                backgroundColor: index < currentStep ? '#3b82f6' : '#e5e7eb'
              }} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="step-content" style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        padding: '24px',
        marginBottom: '24px'
      }}>
        <h3 style={{
          fontSize: '18px',
          fontWeight: '500',
          marginBottom: '16px'
        }}>
          {STEPS[currentStep].name}
        </h3>
        {renderStepContent()}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button
          type="button"
          onClick={currentStep === 0 ? onCancel : prevStep}
          style={{
            padding: '8px 24px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            backgroundColor: 'white',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          {currentStep === 0 ? 'Cancel' : 'Previous'}
        </button>
        
        {currentStep === STEPS.length - 1 ? (
          <button
            type="button"
            onClick={saveTeam}
            disabled={loading || !testResults?.overallValid}
            style={{
              padding: '8px 24px',
              backgroundColor: (loading || !testResults?.overallValid) ? '#9ca3af' : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: (loading || !testResults?.overallValid) ? 'not-allowed' : 'pointer',
              fontSize: '14px'
            }}
          >
            {loading ? `${editMode ? 'Updating' : 'Creating'} Team...` : `${editMode ? 'Update' : 'Create'} Team`}
          </button>
        ) : (
          <button
            type="button"
            onClick={nextStep}
            style={{
              padding: '8px 24px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}

export default TeamOnboardingWizard;