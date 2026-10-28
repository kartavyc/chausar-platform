// Original Chausar seller operations regressions, MIT/Apache commerce ideas.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sellerPhotoBrief} from '../runtime/venture/playbooks/online-seller/photos.ts';
const brief={mainImage:'upload_main',brandText:'Acme Cotton',protectedPhrases:['Acme Cotton'],bannedWords:['guaranteed'],background:'white',palette:'brand green',font:'brand font',icons:'plain',variants:[{kind:'secondary',reference:'upload_main',background:'white',palette:'brand green',font:'brand font',icons:'plain',prompt:'Show the real product.',fakeUi:false,frames:false,watermarks:false}],quote:{provider:'Owner chosen image app',currency:'INR',unitMinor:'1000',source:'Owner quoted price',expiresAt:'2026-10-29T00:00:00Z'}};
test('photo calls retain the real main image, consistency and hard constraints, with a source-backed quote first',()=>{
 const plan=sellerPhotoBrief(brief,'2026-10-28T10:00:00Z');assert.equal(plan.mainImage,'upload_main');assert.equal(plan.quote.totalMinor,'1000');assert.equal(plan.capability,'handoff');assert.equal(plan.generated,false);assert.ok(plan.calls.every((c:any)=>c.references.includes('upload_main')));
 assert.throws(()=>sellerPhotoBrief({...brief,variants:[{...brief.variants[0],reference:'other'}]},'2026-10-28T10:00:00Z'),{code:'SELLER_PHOTO_REFERENCE_REQUIRED'});
 for(const field of ['fakeUi','frames','watermarks'])assert.throws(()=>sellerPhotoBrief({...brief,variants:[{...brief.variants[0],[field]:true}]},'2026-10-28T10:00:00Z'),{code:'SELLER_PHOTO_CONSTRAINT'});
 assert.throws(()=>sellerPhotoBrief({...brief,brandText:'Guaranteed results'},'2026-10-28T10:00:00Z'),{code:'SELLER_PHOTO_BANNED_WORD'});
 assert.throws(()=>sellerPhotoBrief({...brief,quote:null},'2026-10-28T10:00:00Z'),{code:'SELLER_QUOTE_REQUIRED'});
});
