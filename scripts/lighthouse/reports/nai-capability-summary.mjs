import fs from 'fs';
const { completeChat } = await import('../../../shared/src/connectors/aiConnector.ts');
const releases = {
  'NDB-2.10': fs.readFileSync('/tmp/NDB-2.10_features.txt','utf8'),
  'NDB-2.11': fs.readFileSync('/tmp/NDB-2.11_features.txt','utf8'),
  'NDB-2.12': fs.readFileSync('/tmp/NDB-2.12_features.txt','utf8'),
};
const all = Object.entries(releases).map(([ver, list])=> `## ${ver} (${list.split('\n').filter(l=>l.startsWith('-')).length} items):\n${list}`).join('\n\n');
const prompt = `You are summarizing NDB (Nutanix Database Service) release capabilities for a senior executive audience.

We have 3 past releases: NDB-2.10, NDB-2.11, NDB-2.12 (last year). For each release, we completed these Features/Initiatives (titles only):

${all}

Task: Summarize what capability we offered. Group appropriately — by capability area (Upgrade, Provisioning, Operations, Security, Platform) and/or DB Engine (PostgreSQL, MySQL, SQL Server, MongoDB, Oracle) and Platform (On-Prem, NC2, GCP, Azure, Hybrid). Find best grouping (hybrid: primary by capability area, secondary by DB engine).

Output JSON with:
{
  "overall": "2-3 sentence overall narrative for last year",
  "groups": [{"name": "GroupName", "count": 5, "capabilities": ["one-liner"]}],
  "perRelease": {
    "NDB-2.10": {"summary": "1-2 sentence", "groups": [{"name": "...", "items": ["..."]}]},
    "NDB-2.11": {...},
    "NDB-2.12": {...}
  }
}
Rules: Use only provided titles, keep one-liner ≤15 words, group names executive-friendly, start overall with "In the last year, NDB delivered ..." and per-release with "In NDB-2.10, we ..." precise no fluff. Return ONLY JSON.`;
console.log("Calling NAI...");
try {
  const res = await completeChat([
    { role: 'system', content: 'You are concise technical writer for NDB summaries. Return only valid JSON.' },
    { role: 'user', content: prompt }
  ], { temperature: 0.2, maxTokens: 4000 });
  console.log(res.content);
  fs.writeFileSync('/tmp/nai-capability-summary.json', res.content);
} catch(e){
  console.error("NAI failed:", e.message, e.naiDebug);
  process.exit(1);
}
