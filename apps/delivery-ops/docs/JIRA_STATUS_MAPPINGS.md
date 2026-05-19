# JIRA Status Mappings Documentation

## Overview

**🚨 CRITICAL FOR VOODOO**: This document defines how JIRA issue statuses are categorized across the NDB Status Sender application. These mappings affect task breakdown displays, completion rate calculations, and executive summary generation.

**VooDoo Context-Aware Queries**: Different user contexts (executive vs team) require different JIRA query patterns - see `VOODOO_JIRA_QUERY_STRATEGY.md` for complete implementation details.

## Status Categories

### Done
**Statuses that represent truly completed work:**
- `Done`
- `Closed`

**Completion Rate**: Only these statuses count toward completion percentage.

### To Be Verified  
**Statuses that represent work completed but pending verification:**
- `Resolved`

**Note**: This is work that is complete from development perspective but requires QA/verification before being considered truly "Done".

### In Progress
**Statuses representing active development or review work:**
- `In Progress`
- `Development`
- `Code Review` 
- `In Review`
- `Testing`
- `QA`
- `UAT`
- `Pending Merge`

### To Do
**Statuses representing work not yet started:**
- `To Do`
- `Open`
- `Backlog` 
- `New`
- `Ready`
- `Ready for Development`
- `Selected for Development`

### Blocked
**Statuses representing work that is blocked or needs information:**
- `Blocked`
- `On Hold`
- `Need Info`
- `Needs Info`
- `Waiting`
- `Waiting for Information`
- `Pending`

### Other
**Any JIRA status that doesn't match the exact statuses above**

Examples of statuses that typically fall into "Other":
- Custom workflow statuses like "Approved", "Deployed", "Validated"
- Project-specific statuses like "Customer Review", "Legal Review"  
- Legacy or non-standard status names
- Workflow-specific statuses not covered above

**Note**: The categorization now uses exact string matching instead of keyword matching to ensure accurate status classification.

## API Implementation

### Issue Breakdown Endpoint
- **Endpoint**: `/api/jira/issue-breakdown`
- **File**: `server/routes/jira/index.js`
- **Function**: `categorizeStatus(status)`

### Affected Features
1. **Email Sender Page**: Issue breakdown display and completion statistics
2. **All-Status Page**: Task breakdown column (planned)
3. **Executive Summary**: Project completion analysis
4. **Email Reports**: Breakdown data included in sent emails

## Business Rules

### Completion Rate Calculation
- **Numerator**: Only "Done" category items (Done, Closed)
- **Denominator**: All items except excluded issue types (Feature, Epic, Initiative, X-FEAT, Capability)
- **"To Be Verified" items are NOT counted as completed**

### Risk Assessment Impact
- High percentage of "To Be Verified" items may indicate QA bottleneck
- Long-standing "Blocked" items should be highlighted in reports
- "In Progress" items need timeline monitoring

## Configuration Impact

### Status Color Coding
- **Done**: Green (`#28a745`)
- **To Be Verified**: Orange (`#fd7e14`) 
- **In Progress**: Blue (`#007bff`)
- **To Do**: Gray (`#6c757d`)
- **Blocked**: Red (`#dc3545`)
- **Other**: Light Gray (`#cccccc`)

### Breaking Changes
- **Before**: "Resolved" was counted as "Done" (inflated completion rates)
- **After**: "Resolved" becomes "To Be Verified" (more accurate completion tracking)

## Maintenance Notes

### When Adding New Status Types
1. Update `categorizeStatus()` function in `server/routes/jira/index.js`
2. Update this documentation
3. Test completion rate calculations
4. Verify UI color coding works correctly
5. Update relevant unit tests

### Related Code Locations
- Status categorization logic: `server/routes/jira/index.js#categorizeStatus`
- Email Sender UI: `client/src/components/EmailSender/EmailSender.js`
- Task breakdown service: `client/src/services/taskBreakdownService.js` (planned)
- Executive summary generation: `server/routes/jira/index.js#generateExecutiveSummary`

## Version History
- **v1.0** (Current): Initial documentation with "To Be Verified" category separation
- **v0.9** (Previous): "Resolved" incorrectly categorized as "Done"