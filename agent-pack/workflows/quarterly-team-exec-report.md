# Workflow: Quarterly Team Executive report

Long-form Team Executive-tier release report with predictive analytics, published to
Confluence and emailed.

## Trigger

User says: "run quarterly vp report", "generate vp report for Qn", "publish vp
quarterly".

## Inputs

| Input | Required | Notes |
|---|---|---|
| `version` | yes | Lead release for the quarter (e.g. `NDB-2.11`). |
| `quarter` | yes | `Q1` / `Q2` / `Q3` / `Q4`. |
| `confluenceSpace` | yes | Target space key (e.g. `NDB`). |
| `confluenceParentId` | yes | Parent page ID under which to publish. |
| `recipients` | yes | Team Executive distribution list. |

## Owner agent

`rm-assistant`.

## Steps

1. **Snapshot the release**
   - Call `get_release_status` (`audience: team-exec`).
   - Call `say_vs_do` for the predictability headline.
   - Call `gantt_release_timeline` to capture slip data.

2. **Run predictive analytics**
   - Apply the `~/.cursor/skills/predictive-team-exec-analytics/` skill to the
     combined data set. Output: forecast completion date, confidence
     interval, top three risk drivers with probability estimates.

3. **Build the long-form report**
   - Drive the `~/.cursor/skills/team-exec-release-report/` skill.
   - Required sections (per documentation-consistency rule):
     1. Executive Summary
     2. Release Health
     3. Project Status
     4. Risk Assessment
     5. Trending
     6. Action Items
     7. Appendix (predictive-analytics raw output)
   - File:
     `reports/TeamExec-NDB-<version>-<quarter>-<YYYY-MM-DD>.md`.
   - HTML companion:
     `reports/TeamExec-NDB-<version>-<quarter>-<YYYY-MM-DD>-Email.html`.

4. **Publish to Confluence**
   - Use `apps/tpm-confluence-tools/` to render the markdown to Confluence
     storage XML.
   - Clean width constraints via the
     `~/.cursor/skills/confluence-width-cleanup/` skill.
   - Create the page under `confluenceParentId` in `confluenceSpace`.
   - Title format: `NDB <version> — <quarter> Team Executive Status — <YYYY-MM-DD>`.

5. **Email**
   - Send the HTML version to `recipients` via the
     `apps/delivery-ops/server/services/emailerService`.

6. **Archive + commit**
   - `docs: quarterly vp report NDB-<version> <quarter> <YYYY-MM-DD>`.

## Outputs

- Markdown report under `reports/`.
- Inline-HTML email artefact under `reports/`.
- Published Confluence page (URL captured in the email footer).
- Email delivered.

## Failure handling

| Failure | Recover |
|---|---|
| Predictive analytics has too little history | Skip Trending section; note in Appendix. |
| Confluence write fails | Save Markdown + HTML; surface Confluence error; do NOT send email until resolved (Team Executive gets one canonical link). |
| SMTP fails | Save artefacts; ask user to retry. |

## Validation checklist

- [ ] All 7 required sections present (or "intentionally omitted: <why>" note).
- [ ] One-page Executive Summary fits in one screen at 1080p.
- [ ] Predictive-analytics output cites its training window.
- [ ] Confluence page URL appears in the email body.
- [ ] No JIRA links inline in the Team Executive body (per `audience.md`).
