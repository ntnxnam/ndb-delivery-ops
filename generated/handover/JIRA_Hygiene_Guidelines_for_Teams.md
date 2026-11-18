# JIRA Hygiene Guidelines for Teams
*From a TPM Perspective - Basic Processes to Maintain*

## Core Hygiene Principles
- **Keep tickets updated**: Status updates must occur at least every 14 days to avoid stale ticket flags
- **Use proper issue types**: 
  - Features: `FEAT` type for PM requests, `X-FEAT` for cross-feature initiatives
  - Engineering work: Initiatives for strategic engineering projects
  - Stories/Bugs/Tasks for implementation work
- **Maintain hierarchy integrity**: All work should roll up appropriately through the portfolio hierarchy

## Essential Fields to Maintain
**For all open FEAT/X-FEAT/Initiative tickets:**
- ✅ **Commit Gate date** - Must be set when ticket enters "Ready to Commit" state
- ✅ **Promotion Gate date** - Must be set when ticket enters "Ready to Commit" state
- ✅ **Fix Version** - Updated at Engineering Complete (EC) to indicate target release; must reflect the actual release target
- ✅ **Commit Status** - Updated at EC to reflect readiness for commitment (e.g., "Ready for Commit Gate")

**Collateral Links (Required for completion):**
- ✅ **Design Doc Link** - Link to approved design documentation
- ✅ **Requirements Link** - Link to PRD or requirements document
- ✅ **Test Plan Link** - Link to comprehensive test plan
- ⚠️ **Risk Assessment** - Required when Risk Indicator is Yellow/Red
- ⚠️ **Path to Green** - Required when Risk Indicator is Yellow/Red

## Parent-Child Relationship Hygiene
- ✅ **Correct Hierarchy**: Ensure child tickets (Stories, Tasks, Bugs) are linked under the correct parent (Feature/Epic/Initiative) via Epic Link or Parent field
- ✅ **No Orphaned Children**: Every Story/Task/Bug should have a clear parent in the hierarchy
- ✅ **Consistent Fix Version**: Child tickets should inherit or match the Fix Version of their parent Feature where applicable
- ✅ **Avoid Deep Nesting**: Limit hierarchy depth to reasonable levels (Feature → Epic → Story is typical)

## Status Management Best Practices
- **Never leave tickets in Resolved state**: Resolved means "dev done, QA not verified" - always move to Closed when QA signs off
- **Use proper resolutions**: 
  - Fixed/Approved = Positive completion (shipped)
  - Won't Do/Won't Fix = Negative scope removal
  - Duplicate/Invalid/Cannot Reproduce = Negative technical closures
- **Terminal statuses** (considered done): Closed (with positive resolution), Cancelled, Promotion Gate Met (for Features)

## Risk Management
- **Set Risk Indicator early**: Red/Yellow/Green status should be established during planning
- **Update risk indicators proactively**: Change as soon as risk profile changes, not just during reviews
- **Address Risk Indicator NotSet**: This is a SoS (System of Systems) callout item that requires immediate attention

## Standard Filters to Maintain
- ✅ **Team Board Filter**: Ensure board filter correctly captures all relevant issue types for your team (typically project = X AND (issueType in (Story, Task, Bug, Sub-task) OR "Epic Link" in epicKeys))
- ✅ **Release Filter**: Use Fix Version = upcoming release to track release scope
- ✅ **Sprint Filter**: Active sprints should only contain committed work; use sprint in openSprints() for planning
- ✅ **Blocked Items Filter**: Filter for tickets with status = Blocked or having blocker links to surface impediments
- ✅ **Stale Tickets Filter**: Updated < -14d and status not in (Closed, Cancelled, Promotion Gate Met) to identify neglected tickets
- ✅ **Missing Fields Filter**: Find tickets with empty required fields (Fix Version, Commit Gate date, etc.) for hygiene cleanup

## Dependency & Tracking Hygiene
- **Link dependencies explicitly**: Use "blocks"/"is blocked by" relationships rather than relying on comments
- **Update dependencies when scope changes**: Remove/add links as work is reprioritized
- **Track cross-team commitments**: Ensure dependent teams have corresponding tickets with matching timelines

## Weekly Maintenance Routine (TPM Expectations)
- **Every Monday**: Review status update age - flag any tickets not updated in 14+ days
- **Pre-Sync**: Ensure all in-sprint tickets have accurate status, estimates, and assignees
- **Post-Planning**: Verify new tickets have all required fields populated before sprint start
- **Pre-Retrospective**: Confirm all completed tickets have collateral links and proper resolutions

## Common Pitfalls to Avoid
- ❌ Leaving tickets in "Resolved" indefinitely (creates false velocity)
- ❌ Using "In Progress" as a catch-all status without actual work occurring
- ❌ Setting dates far in the future without breaking down intermediate milestones
- ❌ Missing collateral links on completed tickets (hinders auditability and knowledge transfer)
- ❌ Not updating Fix Version at EC (breaks release tracking and reporting)

## TPM-Focused Expectations
As your TPM, I will monitor and report on:
- **Release-level health**: RAG status based on gate dates and risk indicators
- **Team-level delivery**: What shipped vs. what's at risk per team
- **FEAT-level callouts**: Status changes, gate achievements, date slips
- **Cross-team dependencies**: Blocking relationships that impact timelines
- **Stale tickets**: Items requiring attention due to lack of updates

**Remember**: Good JIRA hygiene isn't about bureaucracy—it's about creating transparency, enabling predictability, and allowing teams to focus on building rather than status-chasing.

*Maintain these basics, and we'll spend less time in meetings fixing tracking issues and more time delivering value.*