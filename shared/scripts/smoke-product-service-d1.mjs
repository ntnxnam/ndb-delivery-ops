/**
 * Smoke test: prove productService supplies every D1 input the new
 * services demand, and that those services accept them without throwing
 * their "X is required (D1)" guards.
 *
 * Run with: node shared/scripts/smoke-product-service-d1.mjs
 */
import { resolve } from 'node:path';
import {
  ProductService,
  buildEngineeringPayloadJql,
  buildReleasePayloadJql,
  buildAllTicketsJql,
  getWishlistQuery,
  classifyRelease,
  enumerateSprints,
} from '../dist/index.js';

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error('  FAIL:', msg);
  } else {
    console.log('  ok:', msg);
  }
}

const configPath = resolve(
  process.cwd(),
  'apps/delivery-ops/server/config/teamBoardConfig.json'
);
const products = new ProductService(configPath);

console.log('1. productService resolves NDB knobs:');
const projectKey = products.getJiraProjects('ndb')[0];
const labelPrefix = products.getLabelPrefix('ndb');
const releasePrefix = products.getReleasePrefix('ndb');
const sprintCal = products.getSprintCalendar('ndb');
assert(projectKey === 'ERA', `projectKey = ERA (got ${projectKey})`);
assert(labelPrefix === 'ndb', `labelPrefix = ndb (got ${labelPrefix})`);
assert(releasePrefix === 'NDB-', `releasePrefix = NDB- (got ${releasePrefix})`);
assert(
  sprintCal.s1StartIso === '2024-10-23' && sprintCal.sprintDays === 21,
  `sprintCalendar = {2024-10-23, 21} (got ${JSON.stringify(sprintCal)})`
);

console.log('\n2. defaults work for an under-specified product:');
assert(
  products.getLabelPrefix('datalens') === 'datalens',
  'datalens labelPrefix defaults to id'
);
assert(
  products.getReleasePrefix('datalens') === 'DataLens-',
  'datalens releasePrefix defaults to `${name}-`'
);
try {
  products.getSprintCalendar('datalens');
  assert(false, 'datalens sprintCalendar should throw (no default)');
} catch (e) {
  assert(
    /no sprintCalendar configured/.test(e.message),
    `datalens sprintCalendar throws with helpful message`
  );
}

console.log('\n3. ported services accept productService output verbatim:');
const engJql = buildEngineeringPayloadJql('NDB-2.11', { projectKey });
assert(
  engJql.startsWith(`project = ${projectKey} AND`),
  `buildEngineeringPayloadJql scopes by projectKey (D36): ${engJql.slice(0, 80)}...`
);

const relJql = buildReleasePayloadJql('NDB-2.11');
assert(
  !relJql.includes('project = '),
  `buildReleasePayloadJql does NOT scope by project (D36): ${relJql.slice(0, 80)}...`
);
assert(
  relJql.includes('fixVersion = NDB-2.11'),
  `buildReleasePayloadJql still anchors by fixVersion (D36)`
);

const wishlist = getWishlistQuery('NDB-2.11', { labelPrefix });
assert(
  wishlist.includes(`${labelPrefix}-2.11-wishlist`),
  `getWishlistQuery injects labelPrefix into label clause: ${wishlist}`
);

const tixJql = buildAllTicketsJql(['FEAT-1001'], { projectKey });
assert(
  tixJql.startsWith(`project = ${projectKey} AND (`),
  `buildAllTicketsJql with projectKey scopes correctly`
);

const cls = classifyRelease('NDB-2.11', { productPrefix: releasePrefix });
assert(cls === 'Major/Minor', `classifyRelease NDB-2.11 = Major/Minor (got ${cls})`);

const sprints = enumerateSprints(3, sprintCal);
assert(
  sprints.length === 3 && sprints[0] === 1 && sprints[2] === 3,
  `enumerateSprints(3) returns [1,2,3] (got ${JSON.stringify(sprints)})`
);

console.log(
  `\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} (${failures === 0 ? 'D1 wiring is live for NDB' : 'investigate above'})`
);
process.exit(failures === 0 ? 0 : 1);
