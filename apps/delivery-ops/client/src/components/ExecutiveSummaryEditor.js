import React, { useState, useEffect } from 'react';
import { generateExecutiveSummary } from '../utils/generateExecutiveSummary';
import { authenticatedPut } from '../utils/api';
import { SHOW_EXECUTIVE_SUMMARY_ACTIONS, HIGHLIGHTS_LOWLIGHTS_TEMPLATE } from '../config/emailSenderFeatures';

/**
 * ExecutiveSummaryEditor Component
 * 
 * Provides a textarea; optionally shows buttons (Generate, Push to JIRA, Clear) when
 * SHOW_EXECUTIVE_SUMMARY_ACTIONS is true in config.
 * When useHighlightsLowlightsTemplate is true and initialValue is empty, prepopulates with template.
 *
 * @param {Object} props
 * @param {Object} props.item - JIRA item object
 * @param {string} props.releaseVersion - Selected release version
 * @param {Object} props.ganttConfig - Gantt configuration
 * @param {string} props.initialValue - Initial value from JIRA (customfield_38460)
 * @param {Function} props.onUpdate - Callback when value is updated (optional)
 * @param {boolean} props.useHighlightsLowlightsTemplate - If true, prepopulate with template when empty
 */
function ExecutiveSummaryEditor({
  item,
  releaseVersion,
  ganttConfig,
  initialValue = '',
  onUpdate = null,
  useHighlightsLowlightsTemplate = false
}) {
  const defaultWhenEmpty = useHighlightsLowlightsTemplate ? HIGHLIGHTS_LOWLIGHTS_TEMPLATE : '';
  const [value, setValue] = useState(initialValue || defaultWhenEmpty);
  const [isGenerating, setIsGenerating] = useState(false);
  const [, setIsPushing] = useState(false);
  const [message, setMessage] = useState(null);

  // Update local value when initialValue changes; notify parent when we use template so form validation sees content
  useEffect(() => {
    const next = initialValue || (useHighlightsLowlightsTemplate ? HIGHLIGHTS_LOWLIGHTS_TEMPLATE : '');
    setValue(next);
    if (useHighlightsLowlightsTemplate && !initialValue && onUpdate) {
      onUpdate(next);
    }
  }, [initialValue, useHighlightsLowlightsTemplate, onUpdate]);

  /**
   * Generate executive summary - ONLY updates local state, does NOT push to JIRA
   * Summary is only pushed to JIRA when user explicitly clicks "Push to JIRA" button
   */
  const handleGenerate = async () => {
    if (!item) return;
    
    setIsGenerating(true);
    setMessage(null);
    
    try {
      const summary = generateExecutiveSummary({
        item,
        releaseVersion,
        ganttConfig
      });
      
      // Only update local state - do NOT push to JIRA automatically
      setValue(summary);
      if (onUpdate) {
        onUpdate(summary);
      }
      setMessage({ type: 'success', text: 'Summary generated successfully' });
    } catch (error) {
      console.error('Error generating summary:', error);
      setMessage({ type: 'error', text: 'Failed to generate summary' });
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Push summary to JIRA - ONLY called when user explicitly clicks "Push to JIRA" button
   * This is the ONLY place where summary is pushed to JIRA
   */
  const handlePushToJira = async () => {
    if (!item || !item.key) {
      setMessage({ type: 'error', text: 'JIRA key is required' });
      return;
    }

    setIsPushing(true);
    setMessage(null);

    try {
      // Only push to JIRA when user explicitly clicks the button
      const response = await authenticatedPut('/api/jira/update-executive-summary', {
        jiraKey: item.key,
        executiveSummary: value || null
      });

      if (response.success) {
        setMessage({ type: 'success', text: 'Summary pushed to JIRA successfully' });
        if (onUpdate) {
          onUpdate(value);
        }
      } else {
        throw new Error(response.error || 'Failed to update JIRA');
      }
    } catch (error) {
      console.error('Error pushing to JIRA:', error);
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || error.message || 'Failed to push to JIRA' 
      });
    } finally {
      setIsPushing(false);
    }
  };

  const handleClear = () => {
    const cleared = useHighlightsLowlightsTemplate ? HIGHLIGHTS_LOWLIGHTS_TEMPLATE : '';
    setValue(cleared);
    setMessage(null);
    if (onUpdate) {
      onUpdate(cleared);
    }
  };

  const handleChange = (e) => {
    setValue(e.target.value);
    setMessage(null);
  };

  return (
    <div style={{ width: '100%' }}>
      {SHOW_EXECUTIVE_SUMMARY_ACTIONS && (
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '0.5rem',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !item}
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.85rem',
              backgroundColor: '#0052cc',
              color: 'white',
              border: 'none',
              borderRadius: '0',
              cursor: isGenerating || !item ? 'not-allowed' : 'pointer',
              opacity: isGenerating || !item ? 0.6 : 1
            }}
            title="Generate executive summary based on current item data"
          >
            {isGenerating ? 'Generating...' : 'Generate'}
          </button>
          <button
            onClick={handlePushToJira}
            disabled={true}
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.85rem',
              backgroundColor: '#00875a',
              color: 'white',
              border: 'none',
              borderRadius: '0',
              cursor: 'not-allowed',
              opacity: 0.6
            }}
            title="Push to JIRA is currently disabled"
          >
            Push to JIRA
          </button>
          <button
            onClick={handleClear}
            style={{
              padding: '0.4rem 0.8rem',
              fontSize: '0.85rem',
              backgroundColor: '#de350b',
              color: 'white',
              border: 'none',
              borderRadius: '0',
              cursor: 'pointer'
            }}
            title="Clear the executive summary"
          >
            Clear
          </button>
        </div>
      )}

      <textarea
        value={value}
        onChange={handleChange}
        placeholder={useHighlightsLowlightsTemplate ? 'Highlights and lowlights, reason for risk, path to green, support needed...' : 'Executive summary will appear here...'}
        className="text-input"
        style={{
          width: '100%',
          minHeight: '80px',
          padding: '0.5rem',
          fontSize: '0.875rem',
          lineHeight: '1.4',
          border: '1px solid #ddd',
          borderRadius: '0',
          fontFamily: 'inherit',
          resize: 'vertical',
          boxSizing: 'border-box'
        }}
        rows={3}
      />

      {message && (
        <div style={{
          marginTop: '0.5rem',
          padding: '0.4rem',
          fontSize: '0.75rem',
          borderRadius: '0',
          backgroundColor: message.type === 'success' ? '#f5f5f5' : '#f5f5f5',
          color: message.type === 'success' ? '#3c3' : '#c33',
          borderLeft: `3px solid ${message.type === 'success' ? '#3c3' : '#c33'}`
        }}>
          {message.text}
        </div>
      )}
    </div>
  );
}

export default ExecutiveSummaryEditor;

