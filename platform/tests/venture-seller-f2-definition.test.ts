// Chausar seller F2 public package contract.
import test from 'node:test';import assert from 'node:assert/strict';
import {ONLINE_SELLER_DEFINITION as seller} from '../runtime/venture/playbooks/online-seller/definition.ts';
import {SELLER_METADATA} from '../runtime/venture/playbooks/online-seller/metadata.ts';
import {readFileSync} from 'node:fs';
test('seller F2 offers are selectable and each starts its own writing artifact',()=>{
 const expected={'catalogue-upload':'catalogue-draft','product-research':'research-draft','multi-store-report':'multi-store-draft','product-photos':'photo-draft','case-tracker':'case-draft'};
 for(const [id,step] of Object.entries(expected)){const offer=seller.offers.find(o=>o.id===id);assert.ok(offer,id);assert.deepEqual(offer.stages,[step]);assert.equal(seller.draftStep(id),step);assert.equal(seller.steps.find(s=>s.id===step)?.kind,'write');assert.deepEqual(SELLER_METADATA.offers.find(o=>o.id===id),offer);}
 for(const id of ['move-has-cap','photo-is-the-product'])assert.ok(seller.judgeRules.some(rule=>rule.id===id));
});
test('F2 keeps its deterministic baseline cases and dated house rules',()=>{
 const baseline=JSON.parse(readFileSync(new URL('../runtime/venture/playbooks/online-seller/baselines/online-seller.json',import.meta.url),'utf8'));
 for(const id of ['price-below-break-even','slow-mover-options','research-no-go-trademark']){const sample=baseline.cases.find((c:any)=>c.id===id);assert.ok(sample,id);assert.equal(seller.baseline.score(sample,sample.draft,{}).pass,true);assert.equal(seller.baseline.score(sample,'Everything looks fine.',{}).pass,false);assert.equal(seller.baseline.score(sample,sample.draft,{input:'{}'}).pass,false,'corrupt source must not pass '+id);}
 for(const id of ['seller-change-caps','seller-stock-movements','seller-research-review','seller-photo-reference'])assert.ok(seller.rules.some(rule=>rule.id===id&&rule.needs===null));
});
test('Amazon extras remain owner-priced handoff checklists at the end of the offer menu',()=>{
 for(const id of ['ungating','brand-registry','returns','storefront','deals','compliance']){const offer=seller.offers.find(o=>o.id==='amazon-'+id);assert.ok(offer,id);assert.equal(offer.price,'owner-sets');assert.match(offer.description,/submit it yourself/);assert.equal(seller.draftStep(offer.id),'amazon-checklist-draft');}
 assert.equal(seller.planPicks.offers.at(-1),'amazon-compliance');const fake=JSON.parse(readFileSync(new URL('../../app/ui/src/engine/fixtures-kit-plan-picks.json',import.meta.url),'utf8')).find((p:any)=>p.id==='online-seller');assert.deepEqual(fake.offers,seller.planPicks.offers);assert.deepEqual(SELLER_METADATA.offers.map(o=>o.id),seller.offers.map(o=>o.id));
});

test('F2 intake fields have registered bilingual owner words',()=>{const en=JSON.parse(readFileSync(new URL('../../app/ui/src/text/en/kit-intake-words.json',import.meta.url),'utf8'));const words=new Set(Object.values(en));for(const offer of seller.offers.filter(o=>['catalogue-upload','product-research','multi-store-report','product-photos'].includes(o.id)))for(const id of offer.intake){const field=seller.intakeFields.find(f=>f.id===id)!;for(const text of [field.label,field.help,...(field.options??[])])assert.ok(words.has(text),text);}});
