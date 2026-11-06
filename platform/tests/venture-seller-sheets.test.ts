// Original Chausar seller operations regressions, MIT/Apache commerce ideas.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sellerCatalogueRows} from '../runtime/venture/playbooks/online-seller/catalogue-sheets.ts';
import {sellerMultiStore} from '../runtime/venture/playbooks/online-seller/multi-store.ts';
import {sellerCase} from '../runtime/venture/playbooks/online-seller/cases.ts';
test('dated owner-supplied maps build marketplace rows with formula-looking cells kept as text',()=>{
 const map={channel:'meesho',checkedOn:'2026-10-28',source:'Owner seller-panel template',columns:[{header:'Product name',field:'title'},{header:'SKU',field:'sku'}]};
 const sheet=sellerCatalogueRows([{sku:'A',title:'=DANGEROUS()'}],map,'2026-10-28');assert.deepEqual(sheet.rows,[['Product name','SKU'],['=DANGEROUS()','A']]);assert.equal(sheet.checkedOn,'2026-10-28');assert.throws(()=>sellerCatalogueRows([{sku:'A'}],{...map,checkedOn:'2025-01-01'},'2026-10-28'),{code:'SELLER_TEMPLATE_STALE'});
});
test('multi-store report preserves currency groups, gaps, duplicates, transfer opportunities and order ages',()=>{
 const row={sku:'A',store:'one',currency:'INR',priceMinor:'10000',stock:'2',source:'stock.csv'};const report=sellerMultiStore([row,{...row,store:'two',stock:'20',priceMinor:'9000'},{...row,sku:'B',currency:'USD'},{...row},{...row,sku:'C'},{...row,sku:'C',store:'two',stock:'20'}],['one','two'],[{id:'o1',store:'one',sku:'A',placedOn:'2026-10-25',fulfilled:false}],'2026-10-28');
 assert.ok(report.duplicates.length);assert.ok(report.gaps.some((g:any)=>g.sku==='B'));assert.ok(report.priceDifferences.length);assert.ok(report.transfers.some((t:any)=>t.sku==='C'));assert.ok(!report.transfers.some((t:any)=>t.sku==='A'));assert.equal(report.unfulfilled[0].ageDays,3);assert.deepEqual(report.currencies,['INR','USD']);
});
test('case deadlines need official or owner evidence and closed does not mean solved',()=>{
 const input={reference:'CASE A',status:'closed',deadline:{on:'2026-11-01',kind:'owner',source:'Owner confirmation'},attachments:['upload_a'],timeline:[{on:'2026-10-28',text:'Seller closed case',source:'Official email'}]};const c=sellerCase(input);assert.equal(c.solved,false);assert.match(c.line,/closed does not mean solved/i);assert.deepEqual(c.attachments,['upload_a']);assert.throws(()=>sellerCase({...input,deadline:{...input.deadline,kind:'model'}}),{code:'SELLER_DEADLINE_SOURCE_REQUIRED'});
});
