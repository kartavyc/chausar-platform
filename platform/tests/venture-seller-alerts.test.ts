// Original Chausar seller operations regressions, MIT/Apache commerce ideas.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sellerAlerts,sellerBriefing} from '../runtime/venture/playbooks/online-seller/alerts.ts';
const rows=[{sku:'A',category:'bags',stock:'20',sold30:'1',returns:'2',orders:'5',unitCostMinor:'2000',currency:'INR',source:'export.csv'}];
const thresholds={defaults:{lowStock:'5',slowSold30:'2',slowStock:'12',returnBps:'2000',returnMinOrders:'4'},categories:{bags:{lowStock:'25'}},skus:{A:{lowStock:'30'}}};
test('alerts use SKU then category thresholds, quote them, omit missing metrics and give every slow-mover option',()=>{
 const alerts=sellerAlerts(rows,thresholds);assert.equal(alerts.find((x:any)=>x.kind==='low-stock')!.threshold,'30');assert.deepEqual(alerts.find((x:any)=>x.kind==='slow-mover')!.options,['leave','mark down','pull']);
 assert.equal(sellerAlerts([{...rows[0],orders:null,returns:null}],thresholds).some((x:any)=>x.kind==='return-spike'),false);
 assert.deepEqual(rows[0].stock,'20');
});
test('briefing is three to six source-backed rows ranked by money, and unavailable metrics say cannot read',()=>{
 const brief=sellerBriefing([{...rows[0],unitCostMinor:null}],thresholds);assert.ok(brief.length>=3&&brief.length<=6);assert.ok(brief.some((row:any)=>row.moneyMinor===null&&row.metric==='cannot read'));assert.ok(brief.every((row:any)=>row.source));
});
