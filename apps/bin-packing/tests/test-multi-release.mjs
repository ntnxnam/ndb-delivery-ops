/**
 * test-multi-release — E2E proof that two releases coexist with isolated data.
 * Run: node apps/bin-packing/tests/test-multi-release.mjs
 */
import assert from 'node:assert/strict';
const store=new Map();
globalThis.localStorage={ getItem(k){return store.has(k)?store.get(k):null}, setItem(k,v){store.set(k,String(v))}, removeItem(k){store.delete(k)}, clear(){store.clear()}, get length(){return store.size}, key(i){return [...store.keys()][i]??null} };
globalThis.window={ dispatchEvent(){}, addEventListener(){}, location:{search:''}, CustomEvent:class{constructor(t,d){this.type=t;this.detail=d?.detail}} };
globalThis.document={ getElementById:()=>null,querySelector:()=>null,readyState:'complete',addEventListener(){} };
const { ensureReleasesInitialized, createRelease, listReleases, getActiveReleaseId, setActiveReleaseId, getActiveRelease, scopedKey, deleteRelease, exportRelease, importRelease } = await import('../js/releases.js');
const state=await import('../js/state.js');
function log(...a){ console.log(...a); }
log('=== Test 1: migration creates default ==='); store.clear(); let regs=ensureReleasesInitialized(); assert.equal(regs.length,1); assert.equal(regs[0].name,'Release 1'); const defaultId=regs[0].id; assert.equal(getActiveReleaseId(),defaultId); log('✓ default',defaultId);
log('=== Test 2: write to A ==='); state.setProjects([{id:'row-1',rowNumber:1,feat:'FEAT-A1',summary:'A1',totalResources:3}]); state.setScheduleData([{id:'row-1',rowNumber:1,feat:'FEAT-A1'}]); state.setFteOverride(1,5); let a=state.getProjects(); assert.equal(a[0].feat,'FEAT-A1'); log('✓ A',a.map(p=>p.feat));
log('=== Test 3: create B empty ==='); const relB=createRelease('NDB 4.0'); assert.equal(getActiveReleaseId(),relB.id); assert.equal(listReleases().length,2); log('✓ B',relB.id);
log('=== Test 4: B starts empty ==='); assert.equal(state.getProjects().length,0); assert.equal(Object.keys(state.getFteOverrides()).length,0); log('✓ B isolated');
log('=== Test 5: write to B ==='); state.setProjects([{id:'row-2',rowNumber:2,feat:'FEAT-B1',totalResources:2},{id:'row-3',rowNumber:3,feat:'FEAT-B2',totalResources:4}]); state.setFteOverride(2,9); assert.equal(state.getProjects().length,2); log('✓ B',state.getProjects().map(p=>p.feat));
log('=== Test 6: switch to A intact ==='); setActiveReleaseId(defaultId); assert.equal(state.getProjects()[0].feat,'FEAT-A1'); assert.equal(state.getFteOverrides()['1'],5); log('✓ A intact');
log('=== Test 7: switch to B intact ==='); setActiveReleaseId(relB.id); assert.equal(state.getProjects().length,2); assert.equal(state.getFteOverrides()['2'],9); log('✓ B intact');
log('=== Test 8: namespaced keys ==='); const ns=[...store.keys()].filter(k=>k.includes(':')); assert.ok(ns.some(k=>k.startsWith('ndb-projects-upload:'))); log('✓ keys',ns.slice(0,4));
log('=== Test 9: export/import ==='); const exp=exportRelease(relB.id); assert.equal(exp.version,1); assert.ok(exp.release.name); const imp=importRelease(exp,'NDB 4.0 (imported)'); assert.equal(listReleases().length,3); log('✓ export/import',imp.name);
log('=== Test 10: scopedKey ==='); setActiveReleaseId(defaultId); assert.equal(scopedKey('ndb-projects-upload'),`ndb-projects-upload:${defaultId}`); log('✓ scopedKey');
log('=== Test 11: rename ==='); const { renameRelease } = await import('../js/releases.js'); let threw=false; try{ renameRelease(relB.id,'')}catch(_){threw=true} assert.equal(threw,true); const renamed=renameRelease(relB.id,'NDB 4.0 Renamed'); assert.equal(renamed.name,'NDB 4.0 Renamed'); assert.equal(listReleases().find(r=>r.id===relB.id).name,'NDB 4.0 Renamed'); log('✓ rename empty guard + success');
log('=== Test 12: duplicate ==='); const { duplicateRelease }=await import('../js/releases.js'); const dup=duplicateRelease(defaultId); assert.ok(dup.name.includes('(copy)')); assert.equal(dup.id!==defaultId,true); setActiveReleaseId(dup.id); assert.equal(state.getProjects()[0].feat,'FEAT-A1'); log('✓ duplicate copies data',dup.name);
log('=== Test 13: delete ==='); let before=listReleases().length; setActiveReleaseId(relB.id); deleteRelease(dup.id); assert.equal(listReleases().length,before-1); assert.equal(listReleases().some(r=>r.id===dup.id),false); log('✓ delete non-last ok');
log('=== Test 14: delete last blocked ==='); const only=[...listReleases()]; for(const r of [...only].slice(1)){ try{ deleteRelease(r.id);}catch(_){} } assert.equal(listReleases().length,1); let blocked=false; try{ deleteRelease(listReleases()[0].id)}catch(e){ blocked=e.message.includes('last release')} assert.equal(blocked,true); log('✓ delete last blocked');
log('=== ALL PASS ===');
