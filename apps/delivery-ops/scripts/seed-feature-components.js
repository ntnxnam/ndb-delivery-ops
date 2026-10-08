#!/usr/bin/env node
/**
 * Run base-filter Detect for configured teams and seed `featureComponents`
 * (plus boardId / sprintCalendar when a team has none) in teamBoardConfig.json.
 *
 * Usage (from apps/delivery-ops):
 *   node scripts/seed-feature-components.js [teamId[=CompA,CompB] ...]           # dry run
 *   node scripts/seed-feature-components.js [teamId[=CompA,CompB] ...] --write   # save
 * Without an explicit list, the suggested components (≥3 tickets or ≥5%) are used.
 *
 * Token: JIRA_PAT (or RELEASE_DATASET_SYNC_PAT) from the environment or from
 * ENV_FILE (default server/.env). The token is never printed.
 */
const path = require('path');

const serverDir = path.join(__dirname, '..', 'server');
require(require.resolve('dotenv', { paths: [serverDir] })).config({
  path: process.env.ENV_FILE || path.join(serverDir, '.env'),
});

const { getJira } = require(path.join(serverDir, 'utils/jiraClient'));
const { loadTeamBoardConfig, saveTeamBoardConfig } = require(path.join(serverDir, 'utils/teamConfig'));
const { inspectBaseFilter } = require(path.join(serverDir, 'services/teamInspectService'));
const { normalizeFeatureComponents } = require(path.join(serverDir, 'services/teamAdminService'));

function summarize(team, detected) {
  const { feature, board, versions } = detected;
  console.log(`\n== ${team.id} (${team.name})`);
  console.log(`  project: ${detected.projectKey} (${detected.projectShare}% of ${detected.sampledCount} sampled)` +
    (detected.projectKey !== team.projectKey ? `  ⚠ configured ${team.projectKey}` : ''));
  console.log(`  versions: ${versions.error || `${versions.unreleasedCount} unreleased / ${versions.total}`}`);
  console.log(`  board: ${board.boardId ?? '-'} ${board.boardName || ''} ${board.calendarError || board.error || JSON.stringify(board.sprintCalendar)}`);
  if (feature.error) return console.log(`  feature: ${feature.error}`);
  console.log(`  feature: ${feature.issueCount} tickets via ${feature.jql}`);
  for (const c of feature.components) {
    console.log(`    ${c.name} (${c.count}): ${c.primaryComponents.join(', ') || '-'}`);
  }
}

function chooseComponents(feature, picked) {
  const names = picked || feature.components.filter((c) => c.suggested).map((c) => c.name);
  const missing = names.filter((n) => !(n in feature.featureComponents));
  if (missing.length) throw new Error(`Components not found in FEAT results: ${missing.join(', ')}`);
  return Object.fromEntries(names.map((n) => [n, feature.featureComponents[n]]));
}

function applyDetected(team, detected, picked) {
  const next = { ...team };
  if (!detected.feature.error) {
    next.featureComponents = normalizeFeatureComponents(chooseComponents(detected.feature, picked));
    console.log(`  → featureComponents: ${Object.keys(next.featureComponents).join(', ') || '(none)'}`);
  }
  const { board } = detected;
  if (!team.boardId && board.boardId && board.sprintCalendar) {
    next.boardId = board.boardId;
    next.sprintCalendar = board.sprintCalendar;
    console.log(`  → board: ${board.boardId} ${JSON.stringify(board.sprintCalendar)}`);
  }
  return next;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const picks = new Map(args.filter((a) => !a.startsWith('--')).map((a) => {
    const [id, list] = a.split('=');
    return [id, list ? list.split(',').map((s) => s.trim()).filter(Boolean) : null];
  }));
  const wanted = [...picks.keys()];
  const token = process.env.JIRA_PAT || process.env.RELEASE_DATASET_SYNC_PAT;
  if (!token) throw new Error('Set JIRA_PAT in the environment or in ENV_FILE (default server/.env)');

  const jira = await getJira(token);
  const config = loadTeamBoardConfig();
  const teams = (config.teams || []).filter((t) => !wanted.length || wanted.includes(t.id));
  if (!teams.length) throw new Error(`No matching teams (${wanted.join(', ')})`);

  const updated = new Map();
  for (const team of teams) {
    try {
      const detected = await inspectBaseFilter(jira, { baseFilter: team.baseFilter, teamName: team.name, boardId: team.boardId });
      summarize(team, detected);
      updated.set(team.id, applyDetected(team, detected, picks.get(team.id)));
    } catch (err) {
      console.log(`\n== ${team.id}: FAILED — ${err.message}`);
    }
  }

  if (!write) return console.log('\nDry run — re-run with --write to save.');
  saveTeamBoardConfig({ ...config, teams: config.teams.map((t) => updated.get(t.id) || t) });
  console.log(`\nSaved ${updated.size} team(s) to teamBoardConfig.json`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
