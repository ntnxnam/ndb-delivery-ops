/**
 * Script to fetch field history for JIRA issues
 * 
 * Usage: node scripts/fetch-field-history.js <JIRA_KEY_1> [JIRA_KEY_2] ... [JIRA_KEY_N]
 * 
 * Or set JIRA_KEYS environment variable: JIRA_KEYS="FEAT-1,FEAT-2" node scripts/fetch-field-history.js
 */

const fs = require('fs');
const path = require('path');
const { fetchFieldHistory, fetchFieldHistoryForMultiple } = require('../server/utils/fieldHistoryUtils');

// Get JIRA token from environment variable
const JIRA_TOKEN = process.env.JIRA_TOKEN;

if (!JIRA_TOKEN) {
  console.error('Error: JIRA_TOKEN environment variable is required');
  console.error('Usage: JIRA_TOKEN=your_token node scripts/fetch-field-history.js <JIRA_KEY_1> [JIRA_KEY_2] ...');
  process.exit(1);
}

// Get options from environment
const saveRawResponse = process.env.SAVE_RAW_RESPONSE === 'true';

// Get JIRA keys from command line arguments or environment variable
// Split command line args on commas in case user passes "FEAT-1,FEAT-2" as single arg
const jiraKeysFromArgs = process.argv.slice(2)
  .flatMap(arg => arg.split(','))
  .map(k => k.trim())
  .filter(k => k.length > 0);
const jiraKeysFromEnv = process.env.JIRA_KEYS ? process.env.JIRA_KEYS.split(',').map(k => k.trim()).filter(k => k.length > 0) : [];

const jiraKeys = jiraKeysFromArgs.length > 0 ? jiraKeysFromArgs : jiraKeysFromEnv;

if (jiraKeys.length === 0) {
  console.error('Error: No JIRA keys provided');
  console.error('Usage: node scripts/fetch-field-history.js <JIRA_KEY_1> [JIRA_KEY_2] ...');
  console.error('Or: JIRA_KEYS="FEAT-1,FEAT-2" node scripts/fetch-field-history.js');
  process.exit(1);
}

async function main() {
  console.log(`Fetching field history for ${jiraKeys.length} JIRA issue(s)...`);
  console.log('JIRA Keys:', jiraKeys.join(', '));
  console.log('---\n');
  
  // Output file paths
  const outputPath = path.join(__dirname, '..', 'JIRA-fields-history-for-project-dates.json');
  const rawResponsePath = path.join(__dirname, '..', 'JIRA-raw-api-responses.json');
  
  // Clear existing output files to avoid reading stale data
  try {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
      console.log('✓ Cleared existing output file');
    }
    if (fs.existsSync(rawResponsePath)) {
      fs.unlinkSync(rawResponsePath);
      console.log('✓ Cleared existing raw response file');
    }
  } catch (error) {
    console.warn('Warning: Could not clear existing files:', error.message);
  }
  
  try {
    const results = await fetchFieldHistoryForMultiple(jiraKeys, JIRA_TOKEN, { saveRawResponse });
    
    // If raw response was saved, also save it separately
    if (saveRawResponse) {
      const rawResponses = results.map(r => r._rawResponse).filter(r => r !== null && r !== undefined);
      if (rawResponses.length > 0) {
        fs.writeFileSync(rawResponsePath, JSON.stringify(rawResponses, null, 2), 'utf8');
        console.log(`✓ Raw API responses saved to: ${rawResponsePath}`);
      }
    }
    
    // Write results to JSON file
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
    
    console.log(`\n✓ Successfully fetched history for ${results.length} issue(s)`);
    console.log(`✓ Results saved to: ${outputPath}`);
    
    // Print summary
    console.log('\n--- Summary ---');
    results.forEach(result => {
      if (result.error) {
        console.log(`✗ ${result.key}: Error - ${result.error}`);
      } else {
        console.log(`✓ ${result.key}:`);
        console.log(`  - Commit Gate dates: ${result.codeCompleteDate.length}`);
        console.log(`  - Commit Gate moved: ${result.numberofTimesCCMDateMoved} times`);
        console.log(`  - Promotion Gate dates: ${result.PGCompleteDate.length}`);
      }
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();

