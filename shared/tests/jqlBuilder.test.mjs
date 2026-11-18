import { jqlBuilder } from '../dist/services/jqlBuilder.js';

function assert(cond, msg){ if(!cond) throw new Error('FAIL: '+msg); console.log('PASS: '+msg); }

const c1 = jqlBuilder.buildClosedJql({baseFilter:'filter=NDB-All-Base-Filter', startDate:'2025-04-01', endDate:'2025-06-30', includeSubtasks:false});
assert(c1.jql.includes('statusCategory = Done') && c1.jql.includes('resolved >= "2025-04-01"') && c1.jql.includes('resolved <= "2025-06-30"') && c1.jql.includes('issuetype not in (Sub-task)'), 'closed JQL');

const t1 = jqlBuilder.buildTouchedJql({baseFilter:'filter=prism-infra-all-base-filter', startDate:'2025-01-01', endDate:'2025-03-31', includeSubtasks:true});
assert(t1.jql.includes('updated >= "2025-01-01"') && t1.jql.includes('updated <= "2025-03-31"') && t1.jql.includes('statusCategory = Done AND resolved >= "2025-01-01"'), 'touched JQL');

const w1 = jqlBuilder.buildWorkloggedJql({baseFilter:'filter=NCN-All-Base-Filter', startDate:'2025-07-01', endDate:'2025-09-30', includeSubtasks:false});
assert(w1.jql.includes('worklogDate >= "2025-07-01"') && w1.jql.includes('worklogDate <= "2025-09-30"'), 'worklogged JQL');

const stripped = jqlBuilder.stripDoneFromBaseFilter('filter=NDB-All-Base-Filter and statusCategory!=Done');
assert(stripped === 'filter=NDB-All-Base-Filter', 'stripDoneFromBaseFilter (end)');
const stripped2 = jqlBuilder.stripDoneFromBaseFilter('filter=X and statusCategory!=Done AND project=ERA');
assert(stripped2 === 'filter=X AND project=ERA', 'stripDoneFromBaseFilter (middle, spacing preserved)');
const stripped3 = jqlBuilder.stripDoneFromBaseFilter('filter=Y and statusCategory not in (Done)');
assert(stripped3 === 'filter=Y', 'stripDoneFromBaseFilter (not in Done)');

const f1 = jqlBuilder.buildReleaseFeatureJql('NDB-2.10');
assert(f1.jql === 'fixVersion = "NDB-2.10" AND issuetype = Feature', 'release feature JQL');

const i1 = jqlBuilder.buildReleaseInitiativeJql('NDB-2.11');
assert(i1.jql === 'fixVersion = "NDB-2.11" AND issuetype = Initiative', 'release initiative JQL');

const cset = jqlBuilder.buildReleaseCommitJql('NDB-2.12', 'ndb');
assert(cset.jql === 'fixVersion = "NDB-2.12" AND issuetype in (Feature, Initiative) AND status != Cancelled AND labels not in ("ndb-not-por")', 'commit set POR');

const ctotal = jqlBuilder.buildReleaseCommitTotalJql('NDB-2.12');
assert(ctotal.jql === 'fixVersion = "NDB-2.12" AND issuetype in (Feature, Initiative) AND status != Cancelled', 'commit set total');

const kpi = jqlBuilder.buildKpiClosedJql('NDB-2.10', 'project=ERA and priority = "Critical - P1" and type=Bug');
assert(kpi.jql === 'filter="NDB-2.10-All" AND (project=ERA and priority = "Critical - P1" and issuetype=Bug) AND status = Closed AND ("Integrated Version" = "NDB-2.10" OR fixVersion = "NDB-2.10")', 'KPI closed JQL with Integrated Version OR fixVersion, type normalized');
assert(kpi.warnings.length === 1 && kpi.warnings[0].includes('Normalized type='), 'KPI warning for type= normalization');

const fs1 = jqlBuilder.buildFeatureSummaryJql('NDB-2.11');
assert(fs1.jql === 'filter="NDB-2.11-All" AND issuetype in (Feature, Initiative) AND ("Integrated Version" = "NDB-2.11" OR fixVersion = "NDB-2.11")', 'feature summary JQL');

const to = jqlBuilder.buildTeamOverallJqls({baseFilter:'filter=NDB-All-Base-Filter and statusCategory!=Done', startDate:'2025-04-01', endDate:'2025-06-30'}, 'closed');
assert(to.length === 1 && to[0].jql.includes('statusCategory = Done') && !to[0].jql.includes('statusCategory != Done'), 'team overall strips Done exclusion and adds resolved window');

const allJqls = [c1,t1,w1,f1,i1,cset,ctotal,kpi,fs1,...to].map(r=>r.jql).join(' ');
assert(!/(?<!issue)type=/.test(allJqls), 'no raw type= (only issuetype=) in any JQL');

console.log('All jqlBuilder tests PASSED');
console.log('Total assertions: 14');