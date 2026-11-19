const express = require('express');
const router = express.Router();
const teamBoardConfig = require('../config/teamBoardConfig.json');
const releaseVersionsEmailConfig = require('../config/releaseVersionsEmailConfig.json');

router.get('/', (req, res) => {
  const teamId = req.query.teamId || teamBoardConfig.defaultTeamId || 'ndb';
  const team = (teamBoardConfig.teams || []).find((t) => t.id === teamId) || null;
  const allReleases = Object.keys(releaseVersionsEmailConfig.releaseGateDates || {});
  // Filter releases by team's releaseRegexes/releasePrefixes (product-agnostic D1); fallback to all if team has no filter
  let filtered = allReleases;
  if (team && Array.isArray(team.releaseRegexes) && team.releaseRegexes.length) {
    const regexes = team.releaseRegexes.map((pat) => { try { return new RegExp(pat); } catch { return null; } }).filter(Boolean);
    if (regexes.length) filtered = allReleases.filter((r) => regexes.some((re) => re.test(r)));
  } else if (team && Array.isArray(team.releasePrefixes) && team.releasePrefixes.length) {
    filtered = allReleases.filter((r) => team.releasePrefixes.some((p) => r.startsWith(p)));
  }
  const gates = releaseVersionsEmailConfig.releaseGateDates || {};
  // Only use demo fallback when config is empty (no gateDates at all), not for team mismatches
  let releases = filtered.slice(0, 8);
  if (!releases.length && !allReleases.length) {
    releases = ['NDB-2.12', 'NDB-3.0', 'NDB-2.11.1', 'NDB-2.11.1.1'].slice(0, 4);
  }
  const filteredGates = releases.length ? Object.fromEntries(Object.entries(gates).filter(([k]) => releases.includes(k))) : {};
  res.json({
    teamId,
    releases,
    team,
    gateDates: filteredGates,
  });
});

module.exports = router;
