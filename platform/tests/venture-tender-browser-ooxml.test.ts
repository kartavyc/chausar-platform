// Original cross-runtime Office format regressions for the tender rehearsal desk.
import test from 'node:test';
import assert from 'node:assert/strict';
import {zip,unzip} from '../runtime/venture/playbooks/kit/ooxml/zip.ts';
import {writeXlsx} from '../runtime/venture/playbooks/kit/ooxml/xlsx.ts';
import {readXlsx} from '../runtime/venture/playbooks/kit/ooxml/read.ts';
import {unzipBrowser,storedZipBytes} from '../runtime/venture/playbooks/kit/ooxml/browser.ts';
import {readIssuerTenderParts,fillIssuerTenderParts,tenderExportParts} from '../runtime/venture/playbooks/tender-desk/export-core.ts';
const utf8=(s:string)=>new TextEncoder().encode(s);
const map={sheet:'Issuer',questionColumn:'A',answerColumn:'B',firstRow:2,lastRow:2};
test('browser reads stored and deflated entries identically, including binary untargeted parts',async()=>{
 const entries=[{name:'a.xml',bytes:utf8('नमस्ते')},{name:'media/a.bin',bytes:new Uint8Array([0,255,128])}];
 for(const bytes of [zip(entries),storedZipBytes(entries)])assert.deepEqual(await unzipBrowser(bytes),entries);
});
test('browser rejects CRC damage, entry and byte budgets just like native reader',async()=>{
 const bytes=storedZipBytes([{name:'a',bytes:utf8('payload')}]),broken=bytes.slice();broken[31]^=1;
 for(const [data,limits] of [[broken,{}],[bytes,{maxEntries:0}],[bytes,{maxBytes:3}]] as const){assert.throws(()=>unzip(data,limits),{code:'OOXML_UNREADABLE'});await assert.rejects(unzipBrowser(data,limits),{code:'OOXML_UNREADABLE'});}
});
test('browser rejects unsupported compression and unsafe archive paths',async()=>{
 const bytes=storedZipBytes([{name:'aaa',bytes:utf8('x')}]);
 for(const kind of ['method','path']){const bad=bytes.slice(),v=new DataView(bad.buffer),central=34;if(kind==='method')v.setUint16(central+10,99,true);else bad.set(utf8('/aa'),central+46);assert.throws(()=>unzip(bad),{code:'OOXML_UNREADABLE'});await assert.rejects(unzipBrowser(bad),{code:'OOXML_UNREADABLE'});}
});
test('browser issuer filling preserves every unrelated entry and formula and writes equals as text',async()=>{
 const bytes=writeXlsx({sheets:[{name:'Issuer',rows:[['Question','Answer'],['Describe delivery','']]},{name:'Other',rows:[['Keep']]}]});
 const entries=unzip(bytes);entries.push({name:'binary.bin',bytes:new Uint8Array([255,0,99])});
 const parts=await unzipBrowser(zip(entries));assert.equal(readIssuerTenderParts(parts,parts.length,map)[0]?.question,'Describe delivery');
 const filled=fillIssuerTenderParts(parts,parts.length,map,[{row:2,answer:'=SUM(A1:A2)'}]);
 for(const part of parts)if(part.name!=='xl/worksheets/sheet1.xml')assert.deepEqual(filled.find(p=>p.name===part.name),part);
 assert.equal(readXlsx(storedZipBytes(filled)).sheets[0]?.rows[1]?.[1],'=SUM(A1:A2)');
});
test('pure tender export parts produce genuine bounded Office documents',()=>{
 const pack=tenderExportParts({title:'Tender',coverLines:['Review'],rows:[{id:'one',kind:'technical',question:'Describe delivery',answer:'Delivery uses a local team.'}]});
 assert.equal(readXlsx(storedZipBytes(pack.xlsx)).sheets[0]?.rows[1]?.[3],'Delivery uses a local team.');
 assert.ok(unzip(storedZipBytes(pack.docx)).some(p=>p.name==='word/document.xml'));
});
