import { useState, useRef } from 'react';

/**
 * Custom hook for managing email form state
 * @returns {object} - Email form state and handlers
 */
export function useEmailForm() {
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [lowlights, setLowlights] = useState('');
  const [highlights, setHighlights] = useState('');
  const [callToAction, setCallToAction] = useState('');
  const [emailRecipients, setEmailRecipients] = useState('');
  const [emailRecipientsError, setEmailRecipientsError] = useState('');
  
  const lowlightsQuillRef = useRef(null);
  const highlightsQuillRef = useRef(null);
  const callToActionQuillRef = useRef(null);

  // Quill modules configuration
  const quillModules = {
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      ['link'],
      ['clean']
    ]
  };

  return {
    sendingEmail,
    setSendingEmail,
    emailSuccess,
    setEmailSuccess,
    lowlights,
    setLowlights,
    highlights,
    setHighlights,
    callToAction,
    setCallToAction,
    emailRecipients,
    setEmailRecipients,
    emailRecipientsError,
    setEmailRecipientsError,
    lowlightsQuillRef,
    highlightsQuillRef,
    callToActionQuillRef,
    quillModules
  };
}

