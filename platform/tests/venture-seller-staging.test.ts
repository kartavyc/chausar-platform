// Original Chausar seller operations regressions, MIT/Apache commerce ideas.
import test from 'node:test';
import assert from 'node:assert/strict';
import {stageSellerChange,checkSellerApply} from '../runtime/venture/playbooks/online-seller/staging.ts';
const product={sku:'A',channel:'shopify',priceMinor:'10000',breakEvenMinor:'6000',stock:'8',title:'Cotton bag',currency:'INR'};
const caps={priceChangeBps:'2500',promotionBps:'2000'};
test('staging is a dry preview, refuses unwritable fields and below break even, checks caps again and stock CAS',()=>{
 const staged=stageSellerChange(product,{field:'price',value:'9000'},caps,'2026-10-28');assert.equal(staged.dryRun,true);assert.equal(staged.descriptionComplete,true);
 assert.throws(()=>stageSellerChange(product,{field:'rating',value:'5'},caps,'2026-10-28'),{code:'SELLER_FIELD_UNWRITABLE'});
 assert.throws(()=>stageSellerChange(product,{field:'price',value:'5000'},caps,'2026-10-28'),{code:'SELLER_BELOW_BREAK_EVEN'});
 assert.equal(stageSellerChange(product,{field:'price',value:'5900',clearance:true},{...caps,priceChangeBps:'5000'},'2026-10-28').clearance,true);
 assert.throws(()=>checkSellerApply(staged,product,{...caps,priceChangeBps:'500'},'2026-10-28'),{code:'SELLER_CAP_EXCEEDED'});
 const stock=stageSellerChange(product,{field:'stock',value:'9'},caps,'2026-10-28');assert.throws(()=>checkSellerApply(stock,{...product,stock:'7'},caps,'2026-10-28'),{code:'SELLER_STOCK_CHANGED'});
});
test('incomplete previews cannot apply, promotions require scoped depth and end date, destructive confirmation uses exact name',()=>{
 const stage=stageSellerChange({...product,breakEvenMinor:null},{field:'price',value:'9000'},caps,'2026-10-28');assert.equal(stage.descriptionComplete,false);assert.throws(()=>checkSellerApply(stage,product,caps,'2026-10-28'),{code:'SELLER_PREVIEW_INCOMPLETE'});
 assert.throws(()=>stageSellerChange(product,{field:'promotion',value:'sale'},caps,'2026-10-28'),{code:'SELLER_INPUT_INVALID'});
 const archive=stageSellerChange(product,{field:'archive',value:'yes'},caps,'2026-10-28');assert.equal(archive.confirmName,'Archive A');
});

test('promotions compare the effective price with break-even and keep clearance explicit',()=>{const promotion={field:'promotion',value:'Sale',scope:'A only',depthBps:'1000',endsOn:'2026-11-01'};assert.throws(()=>stageSellerChange({...product,breakEvenMinor:'9500'},promotion,caps,'2026-10-28'),{code:'SELLER_BELOW_BREAK_EVEN'});assert.equal(stageSellerChange({...product,breakEvenMinor:'9500'},{...promotion,clearance:true},caps,'2026-10-28').clearance,true);assert.equal(stageSellerChange({...product,breakEvenMinor:null},promotion,caps,'2026-10-28').descriptionComplete,false);});
