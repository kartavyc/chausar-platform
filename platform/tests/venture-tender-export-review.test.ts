// Independent export review: mapped order, literal spreadsheet text and untouched issuer payloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeXlsx} from '../runtime/venture/playbooks/kit/ooxml/xlsx.ts';
import {readXlsx} from '../runtime/venture/playbooks/kit/ooxml/read.ts';
import {unzip,zip} from '../runtime/venture/playbooks/kit/ooxml/zip.ts';
import {fillIssuerTender,readIssuerTender} from '../runtime/venture/playbooks/tender-desk/export.ts';
import {groundTenderAnswer} from '../runtime/venture/playbooks/tender-desk/ground.ts';
test('issuer row identity is independent of answer order and hostile-looking answers stay literal',()=>{
 const bytes=writeXlsx({sheets:[{name:'RFP',rows:[['Question','Answer'],['Describe support',null],['Describe uptime',null]]},{name:'Keep',rows:[['Issuer text','=literal']]}]}),parts=unzip(bytes);parts.push({name:'customXml/evidence.xml',bytes:new TextEncoder().encode('<issuer preserve="yes"/>')});
 const source=zip(parts),map={sheet:'RFP',questionColumn:'A',answerColumn:'B',firstRow:2,lastRow:3};
 const output=fillIssuerTender(source,map,[{row:3,answer:'=WEBSERVICE("https://example.test")'},{row:2,answer:'हिंदी & <source> "quoted"'}]);
 const read=readXlsx(output).sheets[0]!.rows;assert.equal(read[1]![1],'हिंदी & <source> "quoted"');assert.equal(read[2]![1],'=WEBSERVICE("https://example.test")');
 const after=unzip(output);for(const part of parts)if(part.name!=='xl/worksheets/sheet1.xml')assert.deepEqual(after.find(value=>value.name===part.name)!.bytes,part.bytes);
 assert.deepEqual(readIssuerTender(source,map).map(row=>row.answer),['','']);
});
test('a requirement in the question alone cannot justify a standard or a figure in an answer',()=>{
 const question='Do you hold ISO 9001 certification and serve 500 clients?';
 const result=groundTenderAnswer(question,'Yes, we hold ISO 9001 certification and serve 500 clients.',[{id:'doc',text:'We provide local support.'}]);
 assert.equal(result.passed,false);assert.equal(result.affirmativeGap,true);assert.ok(result.claims.some(claim=>claim.kind==='certification'&&!claim.matched));assert.ok(result.claims.some(claim=>claim.kind==='figure'&&!claim.matched));
});
