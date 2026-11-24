#!/usr/bin/env node
/**
 * check-weave-smoke.js — TAP smoke gate for new routes/services/pages.
 * Enforces: server route/service has test, client page has test,
 * App.js route in sidebarNavConfig or opt-out, require() health, JSON validity.
 * Usage: node scripts/loom/checks/check-weave-smoke.js
 *        SMOKE_BASE=origin/main node scripts/loom/checks/check-weave-smoke.js
 *        PR_BODY="smoke-tested: manual QA on ..." node scripts/loom/checks/check-weave-smoke.js
 * No deps beyond fs/path (+ core child_process). Exit 1 on any FAIL.
 */
const fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'../../..');
const out=[];let fails=0;
function tap(ok,msg){out.push({ok,msg});if(!ok)fails++;}
function sh(cmd){try{return cp.execSync(cmd,{cwd:ROOT,encoding:'utf8'}).trim();}catch{return '';}}
function baseRef(){
  if(process.env.SMOKE_BASE) return process.env.SMOKE_BASE;
  for(const r of ['origin/main','origin/master','main','master']){
    if(sh(`git rev-parse --verify ${r} 2>/dev/null`)) return r;
  }
  return 'HEAD~1';
}
function newFiles(){
  const base=baseRef();
  const mb=sh(`git merge-base HEAD ${base} 2>/dev/null`)||base;
  let o=sh(`git diff --name-only --diff-filter=A ${mb}...HEAD 2>/dev/null`);
  if(!o) o=sh(`git diff --name-only --diff-filter=A HEAD~1 HEAD 2>/dev/null`);
  if(!o) o=sh('git diff --name-only --diff-filter=A HEAD 2>/dev/null');
  return o.split('\n').filter(Boolean).map(f=>f.trim());
}
function allTests(dir){
  const acc=[];(function walk(d){if(!fs.existsSync(d))return;
    for(const e of fs.readdirSync(d)){const p=path.join(d,e);
      const s=fs.statSync(p);if(s.isDirectory())walk(p);else if(s.isFile())acc.push(p);}})(dir);return acc;
}
function fileContainsAny(files,needle){
  const lo=needle.toLowerCase();
  for(const f of files){try{if(fs.readFileSync(f,'utf8').toLowerCase().includes(lo))return f;}catch{}}
  return null;
}
function smokeOptOut(){
  const body=process.env.PR_BODY||sh('git log --format=%B -n 1 HEAD 2>/dev/null')||'';
  if(/smoke-tested/i.test(body)) return true;
  for(const cand of [path.join(ROOT,'.git/PULLREQ_EDITMSG'),path.join(ROOT,'PR_DESCRIPTION.md')]){
    try{if(/smoke-tested/i.test(fs.readFileSync(cand,'utf8')))return true;}catch{}
  }
  return false;
}
// --- helpers: new files are A (added) vs merge-base; fallback HEAD~1 for detached ---
// PR opt-out: PR_BODY env or last commit msg contains "smoke-tested" -> skip test-coverage FAIL
// Client test: basename substring match in client/src/__tests__/** (e.g. ConfigManager in ConfigManager.test.js)
// Server health: node --check syntax (silent PASS) + node -e require() (explicit TAP)
// Config: JSON.parse validity for any new server/config/*.json
// --- collect new files ---
const added=newFiles();
const newRoutes=added.filter(f=>/^apps\/delivery-ops\/server\/routes\/.+\.js$/.test(f));
const newSvcs=added.filter(f=>/^apps\/delivery-ops\/server\/services\/.+\.js$/.test(f));
const newPages=added.filter(f=>/^apps\/delivery-ops\/client\/src\/components\/.+\.js$/.test(f));
const newConfigs=added.filter(f=>/^apps\/delivery-ops\/server\/config\/.+\.json$/.test(f));
const serverTests=allTests(path.join(ROOT,'apps/delivery-ops/server/__tests__'));
const clientTests=allTests(path.join(ROOT,'apps/delivery-ops/client/src/__tests__'));
const optOut=smokeOptOut();
// 1) route/service -> server test
const srvTargets=[...newRoutes,...newSvcs];
if(!srvTargets.length) tap(true,'no new server routes/services — skip');
for(const f of srvTargets){
  const baseName=path.basename(f,'.js');
  const hit=fileContainsAny(serverTests,baseName);
  tap(!!hit||optOut,`${f} has server test referencing "${baseName}"${hit?` (${path.relative(ROOT,hit)})`:optOut?' (PR smoke-tested)':''}`);
}
// 2) new page -> client test
if(!newPages.length) tap(true,'no new client pages — skip');
for(const f of newPages){
  const baseName=path.basename(f,'.js');
  const hit=fileContainsAny(clientTests,baseName);
  tap(!!hit,`${f} has client test referencing "${baseName}"${hit?` (${path.relative(ROOT,hit)})`:''}`);
}
// 3) App.js new routes -> sidebar wiring
try{
  const base=baseRef(),mb=sh(`git merge-base HEAD ${base} 2>/dev/null`)||base;
  const oldApp=sh(`git show ${mb}:apps/delivery-ops/client/src/App.js 2>/dev/null`);
  const curApp=fs.existsSync(path.join(ROOT,'apps/delivery-ops/client/src/App.js'))?fs.readFileSync(path.join(ROOT,'apps/delivery-ops/client/src/App.js'),'utf8'):'';
  const rx=/path="(\/[^"]+)"/g;const oldSet=new Set([...oldApp.matchAll(rx)].map(m=>m[1]));
  const curMatches=[...curApp.matchAll(rx)];
  const navSrc=fs.existsSync(path.join(ROOT,'apps/delivery-ops/client/src/layout/utils/sidebarNavConfig.js'))?fs.readFileSync(path.join(ROOT,'apps/delivery-ops/client/src/layout/utils/sidebarNavConfig.js'),'utf8'):'';
  const addedRoutes=curMatches.map(m=>m[1]).filter(p=>!oldSet.has(p));
  if(!addedRoutes.length) tap(true,'no new App.js routes — skip');
  for(const r of addedRoutes){
    const inNav=navSrc.includes(r);
    const snippet=curApp.slice(Math.max(0,curApp.indexOf(`path="${r}"`)-120),curApp.indexOf(`path="${r}"`)+200)||'';
    const optOutNav=/smoke:ignore-nav|opt-out|no-nav/i.test(snippet);
    tap(inNav||optOutNav,`App.js route "${r}" in sidebarNavConfig.js${optOutNav?' (opt-out)':''}`);
  }
}catch(e){tap(false,`App.js route check threw: ${e.message}`);}
// 4) syntax + require for new services/routes (syntax silent on PASS)
for(const f of [...newRoutes,...newSvcs]){
  try{cp.execSync(`node --check ${path.join(ROOT,f)}`,{stdio:'pipe'});}catch(e){
    tap(false,`${f} syntax error: ${(e.stderr||e.message||'').toString().slice(0,160)}`);}
}
if(!newSvcs.length) tap(true,'no new services to require — skip');
for(const f of newSvcs){
  try{cp.execSync(`node -e "require('./${f}')"`,{cwd:ROOT,stdio:'pipe'});tap(true,`require('${f}') does not throw`);}catch(e){tap(false,`require('${f}') threw: ${(e.stderr||e.message||'').toString().slice(0,180)}`);}
}
// 5) config JSON validity
if(!newConfigs.length) tap(true,'no new server/config JSON — skip');
for(const f of newConfigs){
  try{JSON.parse(fs.readFileSync(path.join(ROOT,f),'utf8'));tap(true,`${f} is valid JSON`);}catch(e){tap(false,`${f} invalid JSON: ${e.message}`);}
}
// TAP output
console.log(`TAP version 13\n1..${out.length}`);
out.forEach((t,i)=>console.log(`${t.ok?'ok':'not ok'} ${i+1} - ${t.msg}`));
if(fails) console.log(`# FAIL ${fails}/${out.length}`); else console.log(`# PASS ${out.length}/${out.length}`);
process.exit(fails?1:0);
