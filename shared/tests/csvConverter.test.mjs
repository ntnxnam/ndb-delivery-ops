import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getColumnAliases, canonicalHeaderFor, buildHeaderIndex, normalizeHeaders, NDB_COLUMN_ALIASES, CANONICAL_HEADERS, MANDATORY_CANONICALS } from '../dist/services/productColumnAliases.js';
import { SIZING_MONTHS, sizingToMonths } from '../dist/constants/binPackingSizing.js';
import { CsvConverterService, parseCSV, parseDependencyNumbersAndBlockers } from '../dist/services/csvConverterService.js';

const SHEET1_HEADER = [...CANONICAL_HEADERS];
function dataRow(overrides={}){
  const row=SHEET1_HEADER.map(()=>'');
  const set=(col,v)=>{const idx=SHEET1_HEADER.indexOf(col); if(idx>=0) row[idx]=v;};
  set('Sl No','1'); set('FEAT NUMBER','FEAT-1'); set('SUMMARY','Hello');
  for(const [k,v] of Object.entries(overrides)) set(k,v);
  return row;
}

describe('productColumnAliases — alias mapping', ()=>{
  it('Sl. No maps to Sl No', ()=>{ assert.equal(canonicalHeaderFor('Sl. No','ndb'),'Sl No'); assert.equal(canonicalHeaderFor('Row Number','ndb'),'Sl No');});
  it('FEAT synonyms', ()=>{ assert.equal(canonicalHeaderFor('Issue Key','ndb'),'FEAT NUMBER'); assert.equal(canonicalHeaderFor('Key','ndb'),'FEAT NUMBER');});
  it('SUMMARY synonyms', ()=>{ assert.equal(canonicalHeaderFor('Title','ndb'),'SUMMARY');});
  it('unknown product fallback', ()=>{ assert.equal(canonicalHeaderFor('Issue Key','unknown-xyz'),'FEAT NUMBER');});
  it('normalizeHeaders', ()=>{ assert.deepEqual(normalizeHeaders(['Sl. No','Issue Key','Title'],'ndb'),['Sl No','FEAT NUMBER','SUMMARY']);});
  it('buildHeaderIndex', ()=>{ const m=buildHeaderIndex(['Sl. No','Issue Key','Title'],'ndb'); assert.equal(m.get('Sl No'),0); assert.equal(m.get('FEAT NUMBER'),1);});
});
describe('sizing', ()=>{
  it('ceiling map', ()=>{ assert.equal(SIZING_MONTHS['XS (1 month)'],1); assert.equal(SIZING_MONTHS['S (1-3 months)'],3); assert.equal(SIZING_MONTHS['M (3-5 months)'],5); assert.equal(SIZING_MONTHS['L (5-8 months)'],8); assert.equal(SIZING_MONTHS['XL (8-13 months)'],13); assert.equal(SIZING_MONTHS['XXL (13+ months)'],21); assert.equal(SIZING_MONTHS['3L (21+ months)'],34); assert.equal(SIZING_MONTHS['4L (34+ months)'],55); assert.equal(SIZING_MONTHS['None'],0);});
  it('sizingToMonths trim/unknown', ()=>{ assert.equal(sizingToMonths('  M (3-5 months)  '),5); assert.equal(sizingToMonths('unknown'),0); assert.equal(sizingToMonths(null),0);});
});
describe('dependency parsing', ()=>{
  it('split/dedup', ()=>{ assert.deepEqual(parseDependencyNumbersAndBlockers('33, 34; 33').rowNumbers,[33,34]);});
  it('blockers', ()=>{ const {rowNumbers,devBlockers,relBlockers}=parseDependencyNumbersAndBlockers('33 (dev-blocker), 5 (rel-blocker), 7'); assert.deepEqual(rowNumbers,[33,5,7]); assert.deepEqual(devBlockers,[33]); assert.deepEqual(relBlockers,[5]);});
  it('empty', ()=>{ assert.deepEqual(parseDependencyNumbersAndBlockers(''),{rowNumbers:[],devBlockers:[],relBlockers:[]}); });
});
describe('rowNumber fallback', ()=>{
  it('9000+', ()=>{ const svc=new CsvConverterService('ndb'); const header=[...SHEET1_HEADER]; const rowA=dataRow({'Sl No':''}); const rowB=dataRow({'Sl No':''}); rowB[SHEET1_HEADER.indexOf('FEAT NUMBER')]='FEAT-2'; const {projects}=svc.validateViaRowsToProjects([header,rowA,rowB]); assert.equal(projects[0].rowNumber,9000); assert.equal(projects[1].rowNumber,9001);});
});
describe('productId passthrough', ()=>{
  it('ctor', ()=>{ const svc=new CsvConverterService('ndb'); assert.equal(svc.productId,'ndb'); assert.equal(svc.normalizeHeaders(['Issue Key'])[0],'FEAT NUMBER');});
});
describe('mandatory', ()=>{
  it('missing mandatory errors', ()=>{ const svc=new CsvConverterService('ndb'); const {error}=svc.validateViaRowsToProjects([['Priority','Status'],['P0','Open']]); assert.ok(error && error.includes('FEAT NUMBER'));});
  it('skip empty', ()=>{ const svc=new CsvConverterService('ndb'); const header=[...SHEET1_HEADER]; const empty=header.map(()=>''); const {projects,skipped}=svc.validateViaRowsToProjects([header,empty]); assert.equal(projects.length,0); assert.equal(skipped.length,1);});
  it('only feat or only summary ok', ()=>{ const svc=new CsvConverterService('ndb'); const header=[...SHEET1_HEADER]; const a=dataRow({SUMMARY:''}); const b=dataRow({'FEAT NUMBER':''}); b[SHEET1_HEADER.indexOf('SUMMARY')]='Just summary'; assert.equal(svc.validateViaRowsToProjects([header,a,b]).projects.length,2);});
});
describe('duration priority', ()=>{
  it('Number of Months wins', ()=>{ const svc=new CsvConverterService('ndb'); const h=[...SHEET1_HEADER]; const r=dataRow({'Number of Months (Dev)':'9','Total Months Needed for 1 person by Dev (Everything from start to finish)':'20','Dev Resources required for max parallization':'2','sizing (refer sheet 2 for guidance)':'M (3-5 months)'}); assert.equal(svc.validateViaRowsToProjects([h,r]).projects[0].durationMonths,9);});
  it('ceil total/dev', ()=>{ const svc=new CsvConverterService('ndb'); const h=[...SHEET1_HEADER]; const r=dataRow({'Total Months Needed for 1 person by Dev (Everything from start to finish)':'10','Dev Resources required for max parallization':'3','sizing (refer sheet 2 for guidance)':'M (3-5 months)'}); assert.equal(svc.validateViaRowsToProjects([h,r]).projects[0].durationMonths,4);});
  it('sizing third', ()=>{ const svc=new CsvConverterService('ndb'); const h=[...SHEET1_HEADER]; assert.equal(svc.validateViaRowsToProjects([h,dataRow({'sizing (refer sheet 2 for guidance)':'L (5-8 months)'})]).projects[0].durationMonths,8);});
  it('0 when nothing', ()=>{ assert.equal(new CsvConverterService('ndb').validateViaRowsToProjects([[...SHEET1_HEADER],dataRow()]).projects[0].durationMonths,0);});
});
describe('detectFileType', ()=>{
  it('ext', ()=>{ const svc=new CsvConverterService(); assert.equal(svc.detectFileType('/tmp/a.csv'),'csv'); assert.equal(svc.detectFileType('/tmp/b.xlsx'),'xlsx'); assert.equal(svc.detectFileType('/tmp/d.json'),'unknown');});
});
describe('canonicalCsv', ()=>{
  it('header order + quoting', ()=>{ const svc=new CsvConverterService('ndb'); const {canonicalCsv,error}=svc.convertToCanonicalCsv([[...SHEET1_HEADER],dataRow({'FEAT NUMBER':'FEAT-99',SUMMARY:'hi, there'})]); assert.equal(error,null); const lines=canonicalCsv.split('\n'); assert.deepEqual(parseCSV(lines[0])[0], [...CANONICAL_HEADERS]); assert.ok(lines[1].includes('"hi, there"'));});
});
describe('report', ()=>{
  it('warnings', ()=>{ const svc=new CsvConverterService('ndb'); const rows=[['Priority'],['P0']]; const validated=svc.validateViaRowsToProjects(rows); const rep=svc.generateReport({fileType:'csv',rows,validated,durationMs:5}); assert.equal(rep.totalDataRows,1); assert.ok(rep.warnings.some(w=>w.includes('FEAT NUMBER'))); assert.equal(rep.canonicalHeaders,CANONICAL_HEADERS);});
});
describe('parseCSV RFC4180', ()=>{
  it('quoted', ()=>{ const rows=parseCSV('a,"b, c","d ""quoted"" e"\n1,2,3'); assert.deepEqual(rows[0],['a','b, c','d "quoted" e']); });
});
