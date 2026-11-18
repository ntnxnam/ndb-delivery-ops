import React from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';

/**
 * ReleaseVersionNotes Component
 * 
 * Rich text editors for Highlights, Lowlights, and Call to Action notes.
 * 
 * @param {Object} props
 * @param {string} props.highlights - Highlights content
 * @param {string} props.lowlights - Lowlights content
 * @param {string} props.callToAction - Call to Action content
 * @param {Function} props.setHighlights - Handler for highlights change
 * @param {Function} props.setLowlights - Handler for lowlights change
 * @param {Function} props.setCallToAction - Handler for call to action change
 * @param {Object} props.highlightsQuillRef - React ref for highlights editor
 * @param {Object} props.lowlightsQuillRef - React ref for lowlights editor
 * @param {Object} props.callToActionQuillRef - React ref for call to action editor
 * @param {Object} props.quillModules - ReactQuill modules configuration
 */
function ReleaseVersionNotes({
  highlights,
  lowlights,
  callToAction,
  setHighlights,
  setLowlights,
  setCallToAction,
  highlightsQuillRef,
  lowlightsQuillRef,
  callToActionQuillRef,
  quillModules
}) {
  return (
    <div className="grid-container" style={{ marginBottom: '1rem' }}>
      <div className="grid-4" style={{ backgroundColor: '#f8f9fa', padding: '0.75rem' }}>
        <label id="highlights-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
          1. Highlights
        </label>
        <div id="highlights" role="textbox" aria-labelledby="highlights-label" aria-multiline="true">
          <ReactQuill
            ref={highlightsQuillRef}
            value={highlights}
            onChange={setHighlights}
            modules={quillModules}
            placeholder="Enter key highlights..."
            className="rich-text-editor"
          />
        </div>
      </div>
      
      <div className="grid-4" style={{ backgroundColor: '#f0f0f0', padding: '0.75rem' }}>
        <label id="lowlights-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
          2. Lowlights
        </label>
        <div id="lowlights" role="textbox" aria-labelledby="lowlights-label" aria-multiline="true">
          <ReactQuill
            ref={lowlightsQuillRef}
            value={lowlights}
            onChange={setLowlights}
            modules={quillModules}
            placeholder="Enter concerns..."
            className="rich-text-editor"
          />
        </div>
      </div>
      
      <div className="grid-4" style={{ backgroundColor: '#e9ecef', padding: '0.75rem' }}>
        <label id="call-to-action-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
          3. Call to Action
        </label>
        <div id="call-to-action" role="textbox" aria-labelledby="call-to-action-label" aria-multiline="true">
          <ReactQuill
            ref={callToActionQuillRef}
            value={callToAction}
            onChange={setCallToAction}
            modules={quillModules}
            placeholder="Enter action items..."
            className="rich-text-editor"
          />
        </div>
      </div>
    </div>
  );
}

export default ReleaseVersionNotes;

