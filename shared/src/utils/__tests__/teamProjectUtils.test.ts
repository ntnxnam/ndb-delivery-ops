import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TeamConfig } from '../../types/teamConfig.js';
import * as U from '../../../dist/utils/teamProjectUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
const configPath = resolve(repoRoot, 'apps/delivery-ops/server/config/teamBoardConfig.json');

function loadFixtures(): TeamConfig[] {
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as { teams: TeamConfig[] };
  return raw.teams;
}

const fixtures = loadFixtures();

test('fixtures: 4 teams loaded from config v2', () => {
  assert.equal(fixtures.length, 4);
  for (const t of fixtures) {
    assert.ok(t.id);
    assert.ok(Array.isArray(t.releasePrefixes));
    assert.ok(typeof t.labelPrefix === 'string');
    assert.ok(Array.isArray(t.homeProjects));
    assert.ok(t.notificationEmails);
    assert.ok(t.tcms);
    assert.ok(t.qaEnv);
    assert.ok(t.branding);
    assert.ok(typeof t.defaultRelease === 'string');
    assert.ok(typeof t.storyPointsField === 'string');
  }
});

test('isHomeProject', () => {
  for (const cfg of fixtures) {
    for (const p of cfg.homeProjects) {
      assert.equal(U.isHomeProject(p, cfg), true, `${cfg.id}:${p}`);
    }
    assert.equal(U.isHomeProject('__NOPE__', cfg), false);
  }
  // edge: missing homeProjects
  assert.equal(U.isHomeProject('X', { homeProjects: undefined } as unknown as TeamConfig), false);
});

test('getHomeProjects', () => {
  for (const cfg of fixtures) {
    const hp = U.getHomeProjects(cfg);
    assert.deepEqual(hp, cfg.homeProjects);
  }
  assert.deepEqual(U.getHomeProjects({ homeProjects: undefined } as unknown as TeamConfig), []);
});

test('getBaseFilter / getReportBaseFilter', () => {
  for (const cfg of fixtures) {
    assert.equal(U.getBaseFilter(cfg), cfg.baseFilter);
  }
  // report base filter strips trailing statusCategory!=Done
  const cfg = { baseFilter: 'project = ERA AND statusCategory != Done' } as unknown as TeamConfig;
  assert.equal(U.getReportBaseFilter(cfg), 'project = ERA');
  const cfg2 = { baseFilter: 'filter=X and statusCategory!=Done' } as unknown as TeamConfig;
  assert.equal(U.getReportBaseFilter(cfg2), 'filter=X');
  const cfg3 = { baseFilter: 'no done clause here' } as unknown as TeamConfig;
  assert.equal(U.getReportBaseFilter(cfg3), 'no done clause here');
});

test('getReleasePrefixes / getReleaseRegexes / isTeamRelease', () => {
  for (const cfg of fixtures) {
    const ps = U.getReleasePrefixes(cfg);
    assert.deepEqual(ps, cfg.releasePrefixes);
    const rx = U.getReleaseRegexes(cfg);
    assert.equal(rx.length, ps.length);
    for (let i = 0; i < ps.length; i++) {
      assert.ok(rx[i] instanceof RegExp);
      // regex should match prefix followed by digit
      assert.equal(rx[i].test(ps[i] + '1'), true);
    }
    for (const p of ps) {
      assert.equal(U.isTeamRelease(p + '9.9', cfg), true);
    }
    assert.equal(U.isTeamRelease('ZZZ-1', cfg), false);
  }
  // edge: missing prefixes
  const empty = { releasePrefixes: undefined } as unknown as TeamConfig;
  assert.deepEqual(U.getReleasePrefixes(empty), []);
  assert.deepEqual(U.getReleaseRegexes(empty), []);
  assert.equal(U.isTeamRelease('anything', empty), false);
});

test('getLabelPrefix / getLabel', () => {
  for (const cfg of fixtures) {
    assert.equal(U.getLabelPrefix(cfg), cfg.labelPrefix);
  }
  const cfg = {
    labelPrefix: 'foo-',
    labels: { notPor: 'foo-not-por', ew: 'foo-ew' },
  } as unknown as TeamConfig;
  assert.equal(U.getLabel(cfg, 'notPor'), 'foo-not-por');
  assert.equal(U.getLabel(cfg, 'ew'), 'foo-ew');
  // default path
  assert.equal(U.getLabel(cfg, 'train'), 'foo--train'); // default: prefix + '-' + key
  // more explicit default check
  const cfg2 = { labelPrefix: 'bar', labels: {} } as unknown as TeamConfig;
  assert.equal(U.getLabel(cfg2, 'x'), 'bar-x');
  // missing labels object
  const cfg3 = { labelPrefix: 'baz' } as unknown as TeamConfig;
  assert.equal(U.getLabel(cfg3, 'y'), 'baz-y');
});

test('getNotificationEmails', () => {
  for (const cfg of fixtures) {
    assert.deepEqual(U.getNotificationEmails(cfg), cfg.notificationEmails);
  }
  const fallback = U.getNotificationEmails({ notificationEmails: undefined } as unknown as TeamConfig);
  assert.deepEqual(fallback, { exec: '', techLeads: '', managers: '' });
});

test('getTcmsConfig', () => {
  for (const cfg of fixtures) {
    assert.deepEqual(U.getTcmsConfig(cfg), cfg.tcms);
  }
  const cfg = { projectKey: 'PROJ', tcms: undefined } as unknown as TeamConfig;
  assert.deepEqual(U.getTcmsConfig(cfg), { projectSegment: 'PROJ', baseUrl: '' });
});

test('getQaEnvUrl', () => {
  for (const cfg of fixtures) {
    assert.equal(U.getQaEnvUrl(cfg, 'dev'), cfg.qaEnv.devUrl);
    if (cfg.qaEnv.qaUrl) assert.equal(U.getQaEnvUrl(cfg, 'qa'), cfg.qaEnv.qaUrl);
    if (cfg.qaEnv.prodUrl) assert.equal(U.getQaEnvUrl(cfg, 'prod'), cfg.qaEnv.prodUrl);
  }
  const cfg = { qaEnv: { devUrl: 'd', qaUrl: 'q' } } as unknown as TeamConfig;
  assert.equal(U.getQaEnvUrl(cfg, 'dev'), 'd');
  assert.equal(U.getQaEnvUrl(cfg, 'qa'), 'q');
  assert.equal(U.getQaEnvUrl(cfg, 'prod'), '');
  const empty = { qaEnv: undefined } as unknown as TeamConfig;
  assert.equal(U.getQaEnvUrl(empty, 'dev'), '');
  assert.equal(U.getQaEnvUrl(empty, 'qa'), '');
  assert.equal(U.getQaEnvUrl(empty, 'prod'), '');
  assert.equal(U.getQaEnvUrl(empty, 'bogus' as any), '');
});

test('getReleasePrefix / stripReleasePrefix', () => {
  for (const cfg of fixtures) {
    const ps = U.getReleasePrefixes(cfg);
    assert.equal(U.getReleasePrefix(cfg), ps[0] || '');
    for (const p of ps) {
      assert.equal(U.stripReleasePrefix(p + '2.5', cfg), '2.5');
    }
    assert.equal(U.stripReleasePrefix('NOMATCH', cfg), 'NOMATCH');
  }
  const empty = { releasePrefixes: [] } as unknown as TeamConfig;
  assert.equal(U.getReleasePrefix(empty), '');
  assert.equal(U.stripReleasePrefix('X', empty), 'X');
});

test('getBrandingDisplayName', () => {
  for (const cfg of fixtures) {
    assert.equal(U.getBrandingDisplayName(cfg), cfg.branding.displayName);
  }
  const cfg = { branding: undefined, displayName: 'DN', name: 'N' } as unknown as TeamConfig;
  assert.equal(U.getBrandingDisplayName(cfg), 'DN');
  const cfg2 = { branding: undefined, displayName: undefined, name: 'N' } as unknown as TeamConfig;
  assert.equal(U.getBrandingDisplayName(cfg2), 'N');
  const cfg3 = { branding: { displayName: 'B' } } as unknown as TeamConfig;
  assert.equal(U.getBrandingDisplayName(cfg3), 'B');
});
test('additional fallback branches', () => {
  const cfg = { baseFilter: undefined, labelPrefix: undefined, branding: {}, displayName: undefined, name: 'N' } as unknown as TeamConfig;
  assert.equal(U.getBaseFilter(cfg), '');
  assert.equal(U.getLabelPrefix(cfg), '');
  assert.equal(U.getBrandingDisplayName(cfg), 'N');
  const cfg2 = { baseFilter: 'X AND statusCategory != Done', branding: { displayName: '' }, displayName: 'D', name: 'N' } as unknown as TeamConfig;
  assert.equal(U.getReportBaseFilter(cfg2), 'X');
  assert.equal(U.getBrandingDisplayName(cfg2), 'D');
});


test('getStoryPointsField / getDefaultRelease / getHomeProjectsString', () => {
  for (const cfg of fixtures) {
    assert.equal(U.getStoryPointsField(cfg), cfg.storyPointsField);
    assert.equal(U.getDefaultRelease(cfg), cfg.defaultRelease);
    assert.equal(U.getHomeProjectsString(cfg), cfg.homeProjects.join(', '));
  }
  const sp = U.getStoryPointsField({ storyPointsField: undefined } as unknown as TeamConfig);
  assert.equal(sp, 'customfield_10016');
  const dr = U.getDefaultRelease({ defaultRelease: undefined } as unknown as TeamConfig);
  assert.equal(dr, '');
  const hs = U.getHomeProjectsString({ homeProjects: undefined } as unknown as TeamConfig);
  assert.equal(hs, '');
});
