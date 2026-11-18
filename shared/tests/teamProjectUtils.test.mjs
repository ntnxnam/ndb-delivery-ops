import { isHomeProject, getHomeProjects, getBaseFilter, getReportBaseFilter, getReleasePrefixes, getReleaseRegexes, isTeamRelease, getLabelPrefix, getLabel, getNotificationEmails, getTcmsConfig, getQaEnvUrl, getReleasePrefix, stripReleasePrefix, getBrandingDisplayName, getStoryPointsField, getDefaultRelease, getHomeProjectsString } from '../dist/utils/teamProjectUtils.js';

function assert(cond, msg){ if(!cond) throw new Error('FAIL: '+msg); console.log('PASS: '+msg); }

const ndb = { id:'ndb', name:'NDB', displayName:'NDB', projectKey:'NDB', homeProjects:['NDB','ERA','FEAT'], baseFilter:'filter=NDB-All-Base-Filter and statusCategory!=Done', releasePrefixes:['NDB-'], releaseRegexes:['NDB-\\d+'], labelPrefix:'ndb-', labels:{notPor:'ndb-not-por', ew:'ndb-ew'}, sprintCalendar:{s1StartIso:'2024-10-23',sprintDays:21}, boardId:2888, companionDisciplines:[{projectKey:'TECHPUBS',label:'TechPubs',hardGate:'GA'}], notificationEmails:{exec:'ndb-exec@nutanix.com',techLeads:'ndb-tl@nutanix.com',managers:'ndb-mgr@nutanix.com'}, tcms:{projectSegment:'NDB',baseUrl:'https://tcms'}, qaEnv:{devUrl:'https://qa-ndb.dev',qaUrl:'https://qa-ndb.qa',prodUrl:'https://ndb.prod'}, branding:{displayName:'NDB',shortName:'NDB'}, defaultRelease:'NDB-2.12', storyPointsField:'customfield_10002' };
const prism = { id:'prism-infra', name:'Prism Infra', displayName:'Prism Infra', projectKey:'ENG', homeProjects:['ENG','ERA','FEAT'], baseFilter:'filter=prisminfra-all-base-filter', releasePrefixes:['AOS '], releaseRegexes:['AOS \\d+\\.\\d+'], labelPrefix:'prisminfra-', labels:{notPor:'prisminfra-not-por'}, sprintCalendar:{s1StartIso:'2023-09-05',sprintDays:14}, boardId:3132, companionDisciplines:[], notificationEmails:{exec:'prism-exec@nutanix.com',techLeads:'prism-tl@nutanix.com',managers:'prism-mgr@nutanix.com'}, tcms:{projectSegment:'AOS',baseUrl:'https://tcms'}, qaEnv:{devUrl:'https://qa-prism.dev',qaUrl:'https://qa-prism.qa',prodUrl:'https://prism.prod'}, branding:{displayName:'Prism Infra',shortName:'Prism'}, defaultRelease:'AOS 5.11', storyPointsField:'customfield_10002' };
const ncn = { id:'ncn', name:'Nutanix Cloud Native', displayName:'Nutanix Cloud Native', projectKey:'NCN', homeProjects:['NCN'], baseFilter:'filter=NCN-All-Base-Filter', releasePrefixes:['NCN-Konvoy-','NCN-NDK-','CSI-'], releaseRegexes:['NCN-Konvoy-\\d+','NCN-NDK-\\d+','CSI-\\d+'], labelPrefix:'ncn-', labels:{notPor:'ncn-not-por'}, sprintCalendar:{s1StartIso:'2020-02-20',sprintDays:14}, boardId:4741, companionDisciplines:[], notificationEmails:{exec:'ncn-exec@nutanix.com',techLeads:'ncn-tl@nutanix.com',managers:'ncn-mgr@nutanix.com'}, tcms:{projectSegment:'NCN',baseUrl:'https://tcms'}, qaEnv:{devUrl:'https://qa-ncn.dev',qaUrl:'https://qa-ncn.qa',prodUrl:'https://ncn.prod'}, branding:{displayName:'Nutanix Cloud Native',shortName:'NCN'}, defaultRelease:'NCN-2025.1', storyPointsField:'customfield_10002' };
const cerebro = { id:'cerebro-dr', name:'Cerebro / DR', displayName:'Cerebro / DR', projectKey:'ENG', homeProjects:['ENG'], baseFilter:'filter=DR-All', releasePrefixes:['AOS '], releaseRegexes:['AOS \\d+\\.\\d+'], labelPrefix:'cerebro-', labels:{notPor:'cerebro-not-por'}, sprintCalendar:{s1StartIso:'2021-11-04',sprintDays:14}, boardId:2477, companionDisciplines:[], notificationEmails:{exec:'cerebro-exec@nutanix.com',techLeads:'cerebro-tl@nutanix.com',managers:'cerebro-mgr@nutanix.com'}, tcms:{projectSegment:'AOS',baseUrl:'https://tcms'}, qaEnv:{devUrl:'https://qa-cerebro.dev',qaUrl:'https://qa-cerebro.qa',prodUrl:'https://cerebro.prod'}, branding:{displayName:'Cerebro / DR',shortName:'Cerebro'}, defaultRelease:'AOS 5.11', storyPointsField:'customfield_10002' };

// isHomeProject
assert(isHomeProject('NDB', ndb) === true, 'isHomeProject NDB true');
assert(isHomeProject('ERA', ndb) === true, 'isHomeProject ERA true (ndb home)');
assert(isHomeProject('PRISM-1', ndb) === false, 'isHomeProject PRISM false for ndb');
assert(isHomeProject('NCN', ncn) === true, 'isHomeProject NCN true');
assert(isHomeProject('NDB', ncn) === false, 'isHomeProject NDB false for ncn');

// getHomeProjects
assert(getHomeProjects(ndb).length === 3, 'getHomeProjects ndb length 3');
assert(getHomeProjects(cerebro).length === 1, 'getHomeProjects cerebro length 1');

// getBaseFilter
assert(getBaseFilter(ndb) === 'filter=NDB-All-Base-Filter and statusCategory!=Done', 'getBaseFilter ndb');

// getReportBaseFilter
assert(getReportBaseFilter(ndb) === 'filter=NDB-All-Base-Filter', 'getReportBaseFilter strips Done');

// getReleasePrefixes
assert(getReleasePrefixes(ndb).length === 1, 'getReleasePrefixes ndb length 1');
assert(getReleasePrefixes(ncn).length === 3, 'getReleasePrefixes ncn length 3 (multiple release types)');

// getReleaseRegexes
const ndbRegexes = getReleaseRegexes(ndb);
assert(ndbRegexes.length === 1, 'getReleaseRegexes ndb length 1');
assert(ndbRegexes[0].test('NDB-2.10'), 'getReleaseRegexes ndb matches NDB-2.10');
assert(!ndbRegexes[0].test('NCN-Konvoy-1.0'), 'getReleaseRegexes ndb does not match NCN');
const ncnRegexes = getReleaseRegexes(ncn);
assert(ncnRegexes.length === 3, 'getReleaseRegexes ncn length 3');
assert(ncnRegexes.some(r=>r.test('NCN-Konvoy-1.0')), 'getReleaseRegexes ncn matches NCN-Konvoy-1.0');
assert(ncnRegexes.some(r=>r.test('CSI-1.0')), 'getReleaseRegexes ncn matches CSI-1.0');

// isTeamRelease
assert(isTeamRelease('NDB-2.10', ndb) === true, 'isTeamRelease NDB-2.10 for ndb');
assert(isTeamRelease('NCN-Konvoy-1.0', ncn) === true, 'isTeamRelease NCN-Konvoy-1.0 for ncn');
assert(isTeamRelease('NDB-2.10', ncn) === false, 'isTeamRelease NDB-2.10 false for ncn');
assert(isTeamRelease('AOS 5.11', prism) === true, 'isTeamRelease AOS 5.11 true for prism (prefix "AOS ")');

// getLabelPrefix
assert(getLabelPrefix(ndb) === 'ndb-', 'getLabelPrefix ndb');

// getLabel
assert(getLabel(ndb, 'notPor') === 'ndb-not-por', 'getLabel ndb notPor');
assert(getLabel(ndb, 'ew') === 'ndb-ew', 'getLabel ndb ew');
assert(getLabel(ncn, 'train') === 'ncn-train', 'getLabel ncn train default');

// getNotificationEmails
assert(getNotificationEmails(ndb).exec === 'ndb-exec@nutanix.com', 'getNotificationEmails ndb exec');
assert(getNotificationEmails(prism).exec === 'prism-exec@nutanix.com', 'getNotificationEmails prism exec');

// getTcmsConfig
assert(getTcmsConfig(ndb).projectSegment === 'NDB', 'getTcmsConfig ndb projectSegment');
assert(getTcmsConfig(ncn).projectSegment === 'NCN', 'getTcmsConfig ncn projectSegment');

// getQaEnvUrl
assert(getQaEnvUrl(ndb, 'dev') === 'https://qa-ndb.dev', 'getQaEnvUrl ndb dev');
assert(getQaEnvUrl(ndb, 'prod') === 'https://ndb.prod', 'getQaEnvUrl ndb prod');
assert(getQaEnvUrl(ncn, 'qa') === 'https://qa-ncn.qa', 'getQaEnvUrl ncn qa');

// getReleasePrefix
assert(getReleasePrefix(ndb) === 'NDB-', 'getReleasePrefix ndb');
assert(getReleasePrefix(ncn) === 'NCN-Konvoy-', 'getReleasePrefix ncn (first)');

// stripReleasePrefix
assert(stripReleasePrefix('NDB-2.10', ndb) === '2.10', 'stripReleasePrefix ndb');
assert(stripReleasePrefix('NCN-Konvoy-1.0', ncn) === '1.0', 'stripReleasePrefix ncn');
assert(stripReleasePrefix('CSI-1.0', ncn) === '1.0', 'stripReleasePrefix ncn CSI');
assert(stripReleasePrefix('Unknown-1.0', ndb) === 'Unknown-1.0', 'stripReleasePrefix unknown unchanged');

// getBrandingDisplayName
assert(getBrandingDisplayName(ndb) === 'NDB', 'getBrandingDisplayName ndb');
assert(getBrandingDisplayName(prism) === 'Prism Infra', 'getBrandingDisplayName prism');

// getStoryPointsField
assert(getStoryPointsField(ndb) === 'customfield_10002', 'getStoryPointsField ndb');

// getDefaultRelease
assert(getDefaultRelease(ndb) === 'NDB-2.12', 'getDefaultRelease ndb');

// getHomeProjectsString
assert(getHomeProjectsString(ndb) === 'NDB, ERA, FEAT', 'getHomeProjectsString ndb');

console.log('All teamProjectUtils tests PASSED');
console.log('Total assertions: 45');