/**
 * Populate Confluence content with JIRA query results
 * Replaces JIRA queries with actual counts and populates tables
 */

function populateContentWithJiraData(content, jiraData) {
  if (!content || !jiraData || !jiraData.organized) {
    console.log('Content population skipped:', {
      hasContent: !!content,
      hasJiraData: !!jiraData,
      hasOrganized: !!jiraData?.organized
    });
    return content;
  }

  console.log('Starting content population:', {
    contentLength: content.length,
    organizedSections: Object.keys(jiraData.organized),
    resultsCount: jiraData.results?.length || 0
  });

  let populatedContent = content;
  const organized = jiraData.organized;

  // First, replace individual JIRA queries with their counts
  if (jiraData.results && Array.isArray(jiraData.results)) {
    jiraData.results.forEach(result => {
      // Escape special regex characters in the query
      const escapedQuery = result.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Replace the query with its count (handle both Jira(...) format and HTML formatted versions)
      const queryRegex = new RegExp(`Jira\\(${escapedQuery}\\)`, 'gi');
      const htmlQueryRegex = new RegExp(`<br><em>JIRA Query:</em>\\s*${escapedQuery.substring(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*<br>`, 'gi');
      
      // Replace in both formats
      populatedContent = populatedContent.replace(queryRegex, result.count.toString());
      populatedContent = populatedContent.replace(htmlQueryRegex, result.count.toString());
    });
  }

  // Populate table rows with organized data
  Object.keys(organized).forEach(section => {
    const data = organized[section];
    const sectionName = section.trim();
    
    // Look for table rows for this section
    // Pattern: Section name followed by table header row, then empty row to populate
    const sectionRegex = new RegExp(
      `(${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n[^\\n]*Done\\s*\\|\\s*Planned in Current Sprint\\s*\\|\\s*Planned in Future Sprints\\s*\\|\\s*No Sprint or Passed Sprint[^\\n]*\\n[^\\n]*---\\s*\\|\\s*---\\s*\\|\\s*---[^\\n]*)`,
      'gi'
    );
    
    populatedContent = populatedContent.replace(sectionRegex, (match) => {
      // Add the populated row after the separator
      const doneCount = data.done || 0;
      const currentSprintCount = data.current_sprint || 0;
      const futureSprintCount = data.future_sprint || 0;
      const noSprintCount = data.no_sprint || 0;
      
      return match + `\n${doneCount} | ${currentSprintCount} | ${futureSprintCount} | ${noSprintCount}`;
    });
    
    // Also handle cases where there's just a header without separator
    const simpleTableRegex = new RegExp(
      `(${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n[^\\n]*Done\\s*\\|\\s*Planned in Current Sprint\\s*\\|\\s*Planned in Future Sprints\\s*\\|\\s*No Sprint or Passed Sprint)([^\\n]*)`,
      'gi'
    );
    
    populatedContent = populatedContent.replace(simpleTableRegex, (match, header, after) => {
      // If there's no data row after, add one
      if (!after || after.trim() === '' || after.includes('---')) {
        const doneCount = data.done || 0;
        const currentSprintCount = data.current_sprint || 0;
        const futureSprintCount = data.future_sprint || 0;
        const noSprintCount = data.no_sprint || 0;
        return header + (after.includes('---') ? after : '') + `\n${doneCount} | ${currentSprintCount} | ${futureSprintCount} | ${noSprintCount}`;
      }
      return match;
    });
  });

  return populatedContent;
}

/**
 * Populate status fields with values from JIRA data
 * Looks for patterns like "Requirements Done?" and adds the count
 */
function populateStatusFields(content, jiraData) {
  if (!content || !jiraData || !jiraData.organized) {
    return content;
  }

  let populated = content;
  const organized = jiraData.organized;

  // Map of status field names to JIRA data sections
  const statusFieldMap = {
    'Requirements Done?': 'Requirements',
    'UX Done?': 'UX',
    'Tech Design Done?': 'Tech Design',
    'API Review Done?': 'API Review',
    'Dev Tickets Created?': 'Dev Tickets',
    'UI Done?': 'UI',
    'Coding Done?': 'Coding',
    'UT Done?': 'UT',
    'Test Plan Review Done?': 'Test Plan',
    'Test Tickets Created?': 'Test Tickets',
    'Test Automation Completed?': 'Test Automation',
    'Test Framework Changes Complete?': 'Test Framework'
  };

  Object.keys(statusFieldMap).forEach(fieldName => {
    const sectionName = statusFieldMap[fieldName];
    const sectionData = organized[sectionName];
    
    if (sectionData) {
      // Find the field and add the count
      const fieldPattern = new RegExp(`(${fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*([^\\n]*)`, 'gi');
      populated = populated.replace(fieldPattern, (match, field, after) => {
        // Get the counts for this section
        const doneCount = sectionData.done || 0;
        const currentSprintCount = sectionData.current_sprint || 0;
        const futureSprintCount = sectionData.future_sprint || 0;
        const noSprintCount = sectionData.no_sprint || 0;
        
        // Clean up after text (remove HTML tags if present)
        const cleanAfter = after.replace(/<[^>]+>/g, '').trim();
        
        // Check if there's already a status indicator (GreenDONE, YellowIN PROGRESS, etc.)
        if (cleanAfter && (cleanAfter.includes('Green') || cleanAfter.includes('Yellow') || cleanAfter.includes('Grey') || cleanAfter.includes('DONE') || cleanAfter.includes('IN PROGRESS') || cleanAfter.includes('NOT STARTED'))) {
          // Keep existing status but add count
          return `${field} ${after.trim()} (${doneCount})`;
        }
        
        // Determine status based on counts
        let status = '';
        if (doneCount > 0) {
          status = `GreenDONE (${doneCount})`;
        } else if (currentSprintCount > 0 || futureSprintCount > 0) {
          status = `YellowIN PROGRESS (${currentSprintCount + futureSprintCount})`;
        } else {
          status = `GreyNOT STARTED (0)`;
        }
        
        return `${field} ${status}`;
      });
    }
  });

  return populated;
}

module.exports = {
  populateContentWithJiraData,
  populateStatusFields
};

