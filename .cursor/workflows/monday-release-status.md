# Workflow: Monday release status

The Monday-morning weekly status email pipeline.

## Trigger

User says: "run monday release status", "send monday status email", or every
Monday by schedule (set up via Cursor hooks separately).

## Inputs

| Input | Required | Notes |
|---|---|---|
| `version` | yes | JIRA fixVersion string (e.g. `NDB-2.11`). |
| `audience` | yes | One of `vp`, `em`. Default `vp`. |
| `recipients` | yes | Comma-separated email addresses. |
| `compareTo` | no | An earlier ISO date or version to delta against. Default: 7 days ago. |

## Owner agent

`rm-assistant` (escalates to VP audience by default).

## Steps

1. **Fetch the snapshot**
   - Call MCP tool `get_release_status` with `{ version, audience }`.
   - Capture `structuredContent.riskCounts` and `structuredContent.topReds`.

2. **Compare to last week**
   - If `compareTo` not provided, read the prior snapshot from
     `reports/VP-Executive-NDB-<version>-<compareTo>.md` if it exists.
     - If no prior snapshot exists, skip this step and emit "no prior snapshot
       found" in the email footer.
   - Compute deltas: red Δ, yellow Δ, green Δ, item-count Δ, newly-red items.

3. **Pull predictability** (vp audience only)
   - Call `say_vs_do` with `{ version }` to attach the SP_said / SP_did line.

4. **Compose the email**
   - Use the `~/.cursor/skills/vp-release-report/` skill for the markdown
     structure (frontmatter, Executive Summary, Release Health, Risk
     Assessment).
   - Cap at one screen for VP. Two screens max for EM.
   - File name: `reports/VP-Executive-NDB-<version>-<YYYY-MM-DD>.md`.
   - HTML version (inline-styled, 800px wide):
     `reports/VP-Executive-NDB-<version>-<YYYY-MM-DD>-Email.html`.

5. **Send**
   - Use the `apps/delivery-ops/server/services/emailerService` (the
     existing SMTP-fixed sender) to deliver the HTML.
   - Plain-text fallback is required by the documentation-consistency rule.

6. **Archive**
   - Commit the two report files with `docs:` prefix:
     `docs: monday status NDB-<version> <YYYY-MM-DD>`.

## Outputs

- `reports/VP-Executive-NDB-<version>-<YYYY-MM-DD>.md`
- `reports/VP-Executive-NDB-<version>-<YYYY-MM-DD>-Email.html`
- Email delivered to recipients.

## Failure handling

| Failure | Recover |
|---|---|
| JIRA timeout in step 1 | Retry once. If still failing, abort and notify the user with the JIRA error. Do NOT send a partial email. |
| `say_vs_do` returns 0 items | Continue without the predictability section, add note in footer. |
| SMTP failure in step 5 | Save the HTML anyway. Tell the user the file is ready and ask to retry send. |
| No prior snapshot in step 2 | Continue without deltas; footer says "no prior snapshot found". |

## Validation checklist

Before the user accepts the artefact:
- [ ] Audience tone matches the chosen audience.
- [ ] No JQL strings in a VP-tier email.
- [ ] RAG counts authoritative (every count traces to a tool call).
- [ ] File names match the documentation-consistency rule.
- [ ] HTML is self-contained (no external CSS, no localhost links).
