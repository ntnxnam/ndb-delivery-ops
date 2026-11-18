const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'logs', 'assignee-debug.log');

if (fs.existsSync(logFile)) {
  const content = fs.readFileSync(logFile, 'utf8');
  console.log('=== Assignee Debug Log ===\n');
  console.log(content);
  
  // Show summary
  const lines = content.split('\n').filter(line => line.trim());
  console.log(`\n=== Summary ===`);
  console.log(`Total log entries: ${lines.length}`);
  
  const nullCount = (content.match(/Assignee field is null\/undefined/g) || []).length;
  const extractedCount = (content.match(/Extracted assignee:/g) || []).length;
  const failedCount = (content.match(/Failed to extract assignee/g) || []).length;
  
  console.log(`- Assignee field is null/undefined: ${nullCount}`);
  console.log(`- Successfully extracted: ${extractedCount}`);
  console.log(`- Failed to extract: ${failedCount}`);
} else {
  console.log('No log file found. Make sure you have fetched items at least once.');
  console.log(`Expected log file at: ${logFile}`);
}

