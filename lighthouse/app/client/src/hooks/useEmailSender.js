/**
 * Canonical hook location for EmailSender (Phase 3 vertical slice).
 * Implementation lives in components/EmailSender/useEmailSender.js (co-located
 * with its helpers); this module is the canonical import path per
 * minimal-architecture.mdc: components render, hooks fetch.
 * @see apps/delivery-ops/client/src/components/EmailSender/useEmailSender.js
 */
export { useEmailSender } from '../components/EmailSender/useEmailSender';
export { useEmailSender as default } from '../components/EmailSender/useEmailSender';
