// Chausar browser plan snapshot parity. Original behavior and data comparison, no copied source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAYBOOK_REGISTRY } from '../runtime/venture/playbooks/registry.ts';
import { PLAYBOOK_REGISTRATIONS } from '../runtime/venture/playbooks/registrations.ts';
import { flagshipPlanById, flagshipPlan } from '../runtime/venture/playbooks/plan.ts';
import { kitIntakeAsk } from '../runtime/venture/playbooks/kit/intake.ts';
test('browser kit selections match real registry order and real plan offer order', () => {
 const snapshot = JSON.parse(readFileSync(new URL('../../app/ui/src/engine/fixtures-kit-plan-picks.json', import.meta.url), 'utf8')) as {id:string;offers:string[]}[];
 const ids = new Set(['it-triage', 'monitored-data', 'dev-agency', 'app-testing', 'data-entry-desk', 'seo-visibility', 'online-seller', 'support-desk', 'bookkeeping-cfo', 'lead-generation', 'recruiting-desk', 'job-search-desk', 'translation-studio', 'podcast-to-article', 'newsletter-studio', 'tender-desk', 'website-studio', 'narration-studio', 'virtual-assistant']);
 assert.deepEqual(snapshot, PLAYBOOK_REGISTRATIONS.filter(item => ids.has(item.id)).map(item => ({id:item.id, offers:flagshipPlanById(item.id)!.offers.map(offer=>offer.key)})));
 for (const [idea, id] of [['local seo and lead generation', 'lead-generation'], ['cfo on demand and online seller', 'online-seller'], ['collections desk and helpdesk service', 'support-desk']]) assert.equal(flagshipPlan(idea)!.id,id);
 const own = flagshipPlanById('online-seller')!.offers.find(offer=>offer.key==='own-shop-back-office')!;
 assert.equal(kitIntakeAsk({rights:own.rights,intake:own.intake!}),null);
});

test('browser pick metadata covers the whole registry, including flagship winners', () => {
 const snapshot = JSON.parse(readFileSync(new URL('../../app/ui/src/engine/fixtures-playbook-picks.json', import.meta.url), 'utf8'));
 assert.deepEqual(snapshot, PLAYBOOK_REGISTRY.map(({id,picks})=>({id,picks})));
 assert.equal(flagshipPlan('long video into shorts and lead generation')!.id, 'youtube');
 assert.equal(flagshipPlan('youtube editing lead generation')!.id, 'lead-generation');
});
