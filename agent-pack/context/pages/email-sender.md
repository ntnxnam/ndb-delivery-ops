---
name: email-sender
route: /
audience: tpm, rm
---

# Email Sender

**Route**: `/`  
**Audience**: `tpm, rm`

## Job

Compose and send release status emails with charts, AI draft cells, gate dates.

## Prompts

- `feature-exec-summary`

## Engineering docs

`apps/delivery-ops/docs/pages/` → EmailSender-requirements.md, EmailSender-data-layer.md

## Agent notes

SMTP path is sacred. AI draft must cite tickets. No localhost in hrefs.
