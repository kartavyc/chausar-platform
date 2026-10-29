// Original TD1 tests. Use the A5 OOXML format implementation, never Countersign source code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tenderExportPack,readIssuerTender,fillIssuerTender} from '../runtime/venture/playbooks/tender-desk/export.ts';
import {writeXlsx} from '../runtime/venture/playbooks/kit/ooxml/xlsx.ts';
import {readDocx,readXlsx} from '../runtime/venture/playbooks/kit/ooxml/read.ts';
import {unzip,zip} from '../runtime/venture/playbooks/kit/ooxml/zip.ts';
const utf=(text:string)=>new TextEncoder().encode(text);
const map={sheet:'Questions',questionColumn:'A',answerColumn:'B',firstRow:2,lastRow:3};
function issuer(){
 const parts=unzip(writeXlsx({sheets:[{name:'Questions',rows:[['Question','Response','Computed'],['Describe support',null,'placeholder'],['Confirm ISO 9001',null,'untouched']]},{name:'Pricing',rows:[['Owner only','=KEEP()']]}]}));
 const target=parts.find(p=>p.name==='xl/worksheets/sheet1.xml')!;target.bytes=utf(new TextDecoder().decode(target.bytes).replace('<c r="C2" t="inlineStr"><is><t xml:space="preserve">placeholder</t></is></c>','<c r="C2" s="7"><f>SUM(1,2)</f><v>3</v></c>'));
 parts.push({name:'customXml/source.xml',bytes:utf('<keep exact="yes">Issuer words</keep>')});return zip(parts);
}
test('tender pack has a DOCX cover, text-only XLSX and formula-safe flat CSV',()=>{
 const pack=tenderExportPack({title:'Client bid',coverLines:['Issuer: City office'],rows:[{id:'q1',kind:'technical',question:'Describe support',answer:'=HYPERLINK("https://example.test")'}]});
 assert.deepEqual(readDocx(pack.docx).paragraphs.slice(0,2),['Client bid','Issuer: City office']);assert.equal(readXlsx(pack.xlsx).sheets[0]!.rows[1]![3],'=HYPERLINK("https://example.test")');assert.match(pack.csv,/'=HYPERLINK/);assert.match(pack.csv,/Question,Type,Answer/);
});
test('issuer questions require an explicit exact column map and retain stable cell references',()=>{
 const rows=readIssuerTender(issuer(),map);assert.deepEqual(rows.map(r=>[r.row,r.questionCell,r.answerCell,r.question]),[[2,'A2','B2','Describe support'],[3,'A3','B3','Confirm ISO 9001']]);
 for(const bad of [null,{...map,answerColumn:'A'},{...map,lastRow:1000},{...map,extra:true},{...map,sheet:'Missing'}])assert.throws(()=>readIssuerTender(issuer(),bad),{code:'TENDER_COLUMN_MAP_REQUIRED'});
});
test('filling issuer answers preserves every untargeted entry, formula, sheet and cell as bytes',()=>{
 const original=issuer(),before=unzip(original),filled=fillIssuerTender(original,map,[{row:2,answer:'=1+1'},{row:3,answer:'Evidence pending'}]),after=unzip(filled);
 assert.deepEqual(after.map(e=>e.name),before.map(e=>e.name));
 for(const entry of before)if(entry.name!=='xl/worksheets/sheet1.xml')assert.deepEqual(after.find(e=>e.name===entry.name)!.bytes,entry.bytes,entry.name);
 const sheet=new TextDecoder().decode(after.find(e=>e.name==='xl/worksheets/sheet1.xml')!.bytes);assert.ok(sheet.includes('<c r="C2" s="7"><f>SUM(1,2)</f><v>3</v></c>'));assert.ok(sheet.includes('<c r="C3" t="inlineStr"><is><t xml:space="preserve">untouched</t></is></c>'));assert.match(sheet,/<c r="B2" t="inlineStr">/);assert.equal(readXlsx(filled).sheets[0]!.rows[1]![1],'=1+1');assert.deepEqual(issuer(),original);
});
test('issuer fill refuses formula targets, duplicate answers, unmapped rows and oversized cells',()=>{
 const bytes=issuer();assert.throws(()=>fillIssuerTender(bytes,{...map,answerColumn:'C'},[{row:2,answer:'overwrite'}]),{code:'TENDER_WORKBOOK_PROTECTED'});
 for(const answers of [[{row:2,answer:'a'},{row:2,answer:'b'}],[{row:4,answer:'a'}],[{row:2,answer:'a'.repeat(32768)}]])assert.throws(()=>fillIssuerTender(bytes,map,answers),{code:'TENDER_EXPORT_INVALID'});
});
test('issuer fill preserves target style and refuses a merged answer region or duplicate archive parts',()=>{
 const parts=unzip(issuer()),sheet=parts.find(p=>p.name==='xl/worksheets/sheet1.xml')!;sheet.bytes=utf(new TextDecoder().decode(sheet.bytes).replace('</row>','</row>').replace('<c r="C2"','<c r="B2" s="5"/><c r="C2"'));
 const styled=fillIssuerTender(zip(parts),map,[{row:2,answer:'Safe text'}]);assert.match(new TextDecoder().decode(unzip(styled).find(e=>e.name===sheet.name)!.bytes),/<c r="B2" s="5" t="inlineStr">/);
 sheet.bytes=utf(new TextDecoder().decode(sheet.bytes).replace('</worksheet>','<mergeCells count="1"><mergeCell ref="B2:C2"/></mergeCells></worksheet>'));
 assert.throws(()=>fillIssuerTender(zip(parts),map,[{row:2,answer:'No'}]),{code:'TENDER_WORKBOOK_PROTECTED'});
 assert.throws(()=>readIssuerTender(zip([...parts,parts[0]!]),map),{code:'TENDER_EXPORT_INVALID'});
});
test('array-formula spill ranges and protected sheets cannot become answer targets',()=>{
 const parts=unzip(issuer()),sheet=parts.find(p=>p.name==='xl/worksheets/sheet1.xml')!;
 sheet.bytes=utf(new TextDecoder().decode(sheet.bytes).replace('<f>SUM(1,2)</f>','<f t="array" ref="B2:C3">SUM(1,2)</f>'));
 assert.throws(()=>fillIssuerTender(zip(parts),map,[{row:3,answer:'No overwrite'}]),{code:'TENDER_WORKBOOK_PROTECTED'});
 sheet.bytes=utf(new TextDecoder().decode(sheet.bytes).replace('<f t="array" ref="B2:C3">SUM(1,2)</f>','<f>SUM(1,2)</f>').replace('</worksheet>','<sheetProtection sheet="1"/></worksheet>'));
 assert.throws(()=>fillIssuerTender(zip(parts),map,[{row:3,answer:'No overwrite'}]),{code:'TENDER_WORKBOOK_PROTECTED'});
});
test('malformed exported rows and answer collections are explicit domain refusals',()=>{
 assert.throws(()=>tenderExportPack({title:'Bid',coverLines:[],rows:[null as never]}),{code:'TENDER_EXPORT_INVALID'});
});
test('malformed answer collections are explicit domain refusals',()=>{
 assert.throws(()=>fillIssuerTender(issuer(),map,[null as never]),{code:'TENDER_EXPORT_INVALID'});
});
