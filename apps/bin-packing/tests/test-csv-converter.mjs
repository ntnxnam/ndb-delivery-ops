/**
 * test-csv-converter — integration tests for bin-packing CSV converter.
 * Self-contained (no external deps): inlines minimal alias map + csv-parser logic.
 * Run: node --test apps/bin-packing/tests/test-csv-converter.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

function parseCSV(text) {
  const rows = [];
  let i = 0; const len = text.length;
  while (i < len) {
    const row = [];
    while (i < len) {
      if (text[i] === '"') {
        let cell = ''; i++;
        while (i < len) {
          if (text[i] === '"') { if (text[i+1]==='"') { cell+='"'; i+=2; } else { i++; break; } }
          else { cell+=text[i]; i++; }
        }
        row.push(cell);
        if (text[i]===',') i++;
        else if (text[i]==='\n'||text[i]==='\r') { if(text[i]==='\r'&&text[i+1]==='\n') i+=2; else i++; break; }
        else if (i>=len) break;
      } else {
        let cell=''; while(i<len&&text[i]!==','&&text[i]!=='\n'&&text[i]!=='\r') cell+=text[i++];
        row.push(cell.trim());
        if(text[i]===',') i++; else { if(text[i]==='\r'&&text[i+1]==='\n') i+=2; else i++; break; }
      }
    }
    if(row.some(c=>c!=='')) rows.push(row);
  }
  return rows;
}
function normalizeHeaderCell(h){ let s=(h!=null?String(h):'').trim(); if(s.charCodeAt(0)===0xFEFF) s=s.slice(1).trim(); if(s.length>=2&&s.startsWith('"')&&s.endsWith('"')) s=s.slice(1,-1).trim(); return s; }
const ALIAS_MAP={
  'Sl No':['Sl No','Sl. No','S.No','Row Number','#'],
  'FEAT NUMBER':['FEAT NUMBER','Issue Key','Key','FEAT','Feature Key','Ticket Key','Issue Name'],
  'SUMMARY':['SUMMARY','Summary','Title','Description','Name'],
  'Priority':['Priority','Prio','Points','Story Points'],
  'STATUS':['STATUS','Status','State'],
  'Total Months Needed for 1 person by Dev (Everything from start to finish)':['Total Months Needed for 1 person by Dev (Everything from start to finish)','Effort (person-months)','Total Person Months','Total Months'],
  'Dev Resources required for max parallization':['Dev Resources required for max parallization','Dev Resources','Dev Cost','Dev Team Size'],
  'Number of Months (Dev)':['Number of Months (Dev)','Duration (months)','Duration'],
  'sizing (refer sheet 2 for guidance)':['sizing (refer sheet 2 for guidance)','Sizing','Size'],
  'Dependency Numbers (Comma Separated List)':['Dependency Numbers (Comma Separated List)','Dependencies','Dependency','Depends','Depends On'],
};
function norm(s){ let t=(s??'').trim(); if(t.charCodeAt(0)===0xFEFF) t=t.slice(1).trim(); if(t.length>=2&&t.startsWith('"')&&t.endsWith('"')) t=t.slice(1,-1).trim(); return t.toLowerCase(); }
function canonicalHeaderFor(raw){ const needle=norm(raw); if(!needle) return null; for(const[c,syns] of Object.entries(ALIAS_MAP)) for(const syn of syns) if(norm(syn)===needle) return c; return null; }
const SIZING_MONTHS={'None':0,'XS (1 month)':1,'S (1-3 months)':3,'M (3-5 months)':5,'L (5-8 months)':8,'XL (8-13 months)':13,'XXL (13+ months)':21,'3L (21+ months)':34,'4L (34+ months)':55};
function sizingToMonths(label){ if(!label) return 0; const v=SIZING_MONTHS[String(label).trim()]; return v!==undefined?v:0; }
function parseDependencyNumbersAndBlockers(raw){
  if(!raw||typeof raw!=='string') return{rowNumbers:[],devBlockers:[],relBlockers:[]};
  const rn=[],db=[],rb=[];
  for(const part of raw.split(/[,;]/)){ const t=part.trim(); const m=t.match(/\d+/); if(m){ const n=parseInt(m[0],10); rn.push(n); if(/\d+\s*\(\s*dev-blocker\s*\)/i.test(t)) db.push(n); else if(/\d+\s*\(\s*rel-blocker\s*\)/i.test(t)) rb.push(n); } }
  return{rowNumbers:[...new Set(rn)],devBlockers:[...new Set(db)],relBlockers:[...new Set(rb)]};
}
function rowsToProjects(rows){
  const rawHeader=rows?.[0]??[]; const header=rawHeader.map(normalizeHeaderCell);
  const dataRows=rows?.length>1?rows.slice(1):[];
  if(!header.length||!dataRows.length) return{projects:[],error:'No header or data rows.'};
  const idx=(name)=>{ const n=(name||'').trim(); const i=header.findIndex(h=>(h||'').trim()===n); return i>=0?i:-1; };
  const idxContains=(sub)=>header.findIndex(h=>(h||'').trim().indexOf(sub)!==-1);
  const iSlNo=idx('Sl No')>=0?idx('Sl No'):idx('Sl. No')>=0?idx('Sl. No'):idxContains('Sl No');
  const iFirstCol=iSlNo>=0?iSlNo:0;
  const iFeat=idx('FEAT NUMBER')>=0?idx('FEAT NUMBER'):idxContains('FEAT NUMBER');
  const iSummary=idx('SUMMARY')>=0?idx('SUMMARY'):idxContains('SUMMARY');
  if(iFeat<0||iSummary<0) return{projects:[],error:'Sheet must include "FEAT NUMBER" and "SUMMARY" columns. Check the header row.'};
  const iDevResources=idx('Dev Resources required for max parallization');
  const iSizing=idx('sizing (refer sheet 2 for guidance)');
  const iDep=idx('Dependency Numbers (Comma Separated List)');
  const iNumMonths=idx('Number of Months (Dev)');
  const iTotalPM=idx('Total Months Needed for 1 person by Dev (Everything from start to finish)');
  const projects=[];
  for(let rowIdx=0;rowIdx<dataRows.length;rowIdx++){
    const row=dataRows[rowIdx];
    const feat=(row[iFeat]||'').trim(); const summary=(row[iSummary]||'').trim().replace(/\s+/g,' ')||feat||'';
    if(!feat&&!summary) continue;
    const sizingRaw=(row[iSizing]||'').trim(); const monthsFromSizing=sizingToMonths(sizingRaw);
    let devResources=parseFloat(String(row[iDevResources]||'').replace(/,/g,'')); if(Number.isNaN(devResources)||devResources<0) devResources=0;
    const rowNumRaw=(row[iFirstCol]||'').trim(); const pn=parseInt(rowNumRaw,10); const rowNumber=rowNumRaw&&!Number.isNaN(pn)?pn:null;
    const{rowNumbers:dependencyRowNumbers,devBlockers:dependencyDevBlockers,relBlockers:dependencyRelBlockers}=parseDependencyNumbersAndBlockers(row[iDep]);
    const assignedRowNumber=rowNumber!=null?rowNumber:9000+projects.length;
    const totalPMRaw=iTotalPM>=0?(row[iTotalPM]||'').trim():'';
    const numMonths=iNumMonths>=0&&row[iNumMonths]?parseFloat(String(row[iNumMonths]).replace(/,/g,'')):NaN;
    const totalPMNum=totalPMRaw?parseFloat(String(totalPMRaw).replace(/,/g,'')):NaN;
    let durationMonths;
    if(!Number.isNaN(numMonths)&&numMonths>0) durationMonths=numMonths;
    else if(!Number.isNaN(totalPMNum)&&totalPMNum>0&&devResources>0) durationMonths=Math.ceil(totalPMNum/devResources);
    else if(!Number.isNaN(totalPMNum)&&totalPMNum>0){ durationMonths=Math.ceil(totalPMNum); if(devResources===0) devResources=1; }
    else if(monthsFromSizing>0) durationMonths=monthsFromSizing; else durationMonths=0;
    projects.push({id:`row-${assignedRowNumber}`,rowNumber:assignedRowNumber,feat,summary,sizingLabel:sizingRaw,durationMonths,totalResources:Math.round(devResources*100)/100,dependencyRowNumbers,dependencyDevBlockers,dependencyRelBlockers,totalPersonMonths:totalPMRaw,totalPersonMonthsNum:Number.isNaN(totalPMNum)?null:totalPMNum});
  }
  return{projects,error:null};
}
function normalizeRows(rows){ const h=rows[0].map(c=>canonicalHeaderFor(c)??c); return[h,...rows.slice(1)]; }
function loadFixture(name){ return parseCSV(readFileSync(join(fixturesDir,name),'utf8')); }

test('jira-export: Issue Key → FEAT NUMBER, 3 rows, 9000 fallback',()=>{
  const rows=normalizeRows(loadFixture('jira-export.csv'));
  const{projects,error}=rowsToProjects(rows);
  assert.equal(error,null); assert.equal(projects.length,3);
  assert.equal(projects[0].feat,'FEAT-100'); assert.equal(projects[2].feat,'FEAT-102');
  assert.ok(projects.every(p=>p.rowNumber>=9000));
});
test('jira-export: duration from effort/dev-resources (priority 2)',()=>{
  const rows=normalizeRows(loadFixture('jira-export.csv'));
  const{projects}=rowsToProjects(rows);
  assert.equal(projects[0].durationMonths,3); // 9/3=3 beats M=5
  assert.equal(projects[1].durationMonths,2); // 4/2=2 beats S=3
});
test('jira-export: dev-blocker dep parse 33 (dev-blocker)',()=>{
  const rows=normalizeRows(loadFixture('jira-export.csv'));
  const{projects}=rowsToProjects(rows);
  assert.deepEqual(projects[2].dependencyRowNumbers.sort((a,b)=>a-b),[1,33]);
  assert.deepEqual(projects[2].dependencyDevBlockers,[33]);
  assert.deepEqual(projects[2].dependencyRelBlockers,[]);
});
test('messy-headers: S.No → Sl No, Issue Name → FEAT NUMBER',()=>{
  const rows=normalizeRows(loadFixture('messy-headers.csv'));
  assert.ok(rows[0].includes('Sl No')); assert.ok(rows[0].includes('FEAT NUMBER'));
  const{projects,error}=rowsToProjects(rows);
  assert.equal(error,null); assert.equal(projects.length,3);
  assert.equal(projects[0].rowNumber,1); assert.equal(projects[1].rowNumber,2); assert.equal(projects[2].rowNumber,3);
});
test('messy-headers: duration via sizing fallback',()=>{
  const rows=normalizeRows(loadFixture('messy-headers.csv'));
  const{projects}=rowsToProjects(rows);
  assert.equal(projects[0].durationMonths,5); assert.equal(projects[1].durationMonths,3); assert.equal(projects[2].durationMonths,1);
});
test('messy-headers: Depends alias + dev-blocker parse',()=>{
  const rows=normalizeRows(loadFixture('messy-headers.csv'));
  const{projects}=rowsToProjects(rows);
  assert.deepEqual(projects[1].dependencyRowNumbers,[1]);
  assert.deepEqual(projects[2].dependencyRowNumbers.sort((a,b)=>a-b),[1,2]);
  assert.deepEqual(projects[2].dependencyDevBlockers,[2]);
});
test('dev-blocker-deps: 5 rows canonical parse',()=>{
  const rows=loadFixture('dev-blocker-deps.csv');
  const{projects,error}=rowsToProjects(rows);
  assert.equal(error,null); assert.equal(projects.length,5);
  assert.equal(projects[0].rowNumber,1); assert.equal(projects[4].rowNumber,5);
});
test('dev-blocker-deps: duration priority Number of Months (Dev) wins',()=>{
  const rows=loadFixture('dev-blocker-deps.csv');
  const{projects}=rowsToProjects(rows);
  assert.equal(projects[0].durationMonths,5); // explicit 5 beats 15/3=5 beats XL=13
  assert.equal(projects[1].durationMonths,6); // 18/3=6 beats XL=13
  assert.equal(projects[2].durationMonths,8); // L=8
});
test('dev-blocker-deps: mixed dev-blocker and rel-blocker parse',()=>{
  const rows=loadFixture('dev-blocker-deps.csv');
  const{projects}=rowsToProjects(rows);
  assert.deepEqual(projects[1].dependencyRowNumbers,[1]);
  assert.deepEqual(projects[2].dependencyRowNumbers,[33]);
  assert.deepEqual(projects[2].dependencyDevBlockers,[33]);
  assert.deepEqual(projects[3].dependencyRowNumbers.sort((a,b)=>a-b),[1,2]);
  assert.deepEqual(projects[3].dependencyDevBlockers,[2]);
  assert.deepEqual(projects[4].dependencyRowNumbers,[3]);
  assert.deepEqual(projects[4].dependencyRelBlockers,[3]);
  assert.deepEqual(projects[4].dependencyDevBlockers,[]);
});
test('9000 fallback: blank Sl No → 9000 + index',()=>{
  const rows=parseCSV(`Sl No,FEAT NUMBER,SUMMARY,sizing (refer sheet 2 for guidance)\n1,FEAT-1,A,M (3-5 months)\n,FEAT-2,B,S (1-3 months)\n3,FEAT-3,C,L (5-8 months)\n`);
  const{projects}=rowsToProjects(rows);
  assert.equal(projects[0].rowNumber,1); assert.equal(projects[1].rowNumber,9001); assert.equal(projects[2].rowNumber,3);
});
