import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {serialize,deserialize} from 'node:v8';
import { FakeEngine } from '../../src/engine/fake';
import { FakeWorkDesk } from '../../src/engine/fake-work';
import metadata from '../../src/engine/fixtures-social-plan.json';
const socialIntakeFields = (key: string) => structuredClone(metadata.offers.find(offer => offer.id === key)?.intake);
import type { BlueprintViewLite, OrderLite, RunDetail } from '../../src/engine/types';
async function onboard() {
 const engine = new FakeEngine({ fresh: true });
 await engine.request('workspace.create', { name: 'Social studio', pack: 'services' });
 await engine.request('venture.create', { idea: 'social media agency', countryCode: 'IN' });
 for (const [questionId, answer] of [['q_1', { skipped: true }], ['q_pricing_model', { choiceId: 'monthly' }], ['q_price', { skipped: true }], ['q_tax', { yes: false }]] as const) await engine.request('venture.interview.answer', { questionId, answer });
 return await engine.request('venture.blueprint.draft', { useTemplate: true }) as BlueprintViewLite;
}
const keys = ['content-calendar', 'community-replies', 'ugc-ads', 'monthly-report', 'repurpose-pack', 'linkedin-ghostwriting','reel-from-clips','hook-variations','local-instagram','reply-inbox','post-diagnosis','video-ads','cross-posting','influencer-campaign'];
function desk(key: string, legacy = false) {
 const runs: RunDetail[] = [];
 const view = { playbook: { id: 'social-agency', label: 'Social media agency' }, blueprint: {  backOffice: {currency:'INR',taxRegistered:{value:false}}, offers: [{ id: 'offer_social', playbookOffer: key, name: { value: 'Social service' }, pricing: { unitPriceMinor: '10000', defaultQuantity: '1' } }] }, offerReceipts: {}, intake: { offer_social: { rights: [], fields: ['clientRules'], kit: socialIntakeFields(key)?.map(field => legacy ? { ...field, required: false } : field) } } } as unknown as BlueprintViewLite;
 const work = new FakeWorkDesk({ current: () => 'business', now: () => '2026-10-27T10:00:00.000Z', clients: () => [{ id: 'client', name: 'Shop' }] as never, country:()=>({code:'IN',currency:'INR'}), plan: () => view, runs: () => runs, agentName: () => 'Writer', emit: () => {} }, { fresh: true });
 const create = (intake: unknown = {}, intakeFiles?: unknown) => work.request('venture.order.create', { clientId: 'client', offerId: 'offer_social', request: 'Draft my social work', intake, ...(intakeFiles ? { intakeFiles } : {}) }) as OrderLite;
 return { work, runs, create, start: (order: OrderLite) => work.request('venture.delivery.run', { orderId: order.id }) };
}
const source = (words: string[]) => ({ sourceFile: { name: 'source.srt', contentBase64: btoa(words.map((word, i) => `${i + 1}\n00:00:0${i},000 --> 00:00:0${i+1},000\n${word}\n`).join('\n')) } });
it('onboards all fourteen social offers with merged legacy and generic intake in stable plan order', async () => {
 const view = await onboard();
 expect(view.playbook?.id).toBe('social-agency');
 expect(view.blueprint.offers.map(offer => offer.playbookOffer)).toEqual(keys);
 for (const offer of view.blueprint.offers) {
  expect(offer.pricing.unitPriceMinor).toBeNull();
  expect(view.intake?.[offer.id]?.kit).toEqual(socialIntakeFields(offer.playbookOffer!));
  expect(view.intake?.[offer.id]?.fields).toContain('clientRules');
 }
 const calendar = view.blueprint.offers[0]!;
 expect(view.intake?.[calendar.id]?.fields).toContain('calendar');
});
it('normalizes calendar, exact client lists and new fields together', () => {
 const { create } = desk('content-calendar');
 const calendar = { month: '2026-11', channels: ['x'], postsPerChannel: 2, weekdays: [1] };
 const order = create({ calendar, clientRules: { bannedWords: ['  loud   words ', 'loud words'] }, aiVoice: true, fields: { sellingCap: '25' } });
 expect(order.intake).toEqual({ rights: null, format: 'long', aiVoice: true, aiPresenter: false, paidPromotion: false, cutFile: null, calendar, clientRules: { bannedWords: ['loud words'], bannedTopics: [], competitors: [], protectedPhrases: [] }, fields: { sellingCap: '25' } });
 expect(() => create({ calendar: { ...calendar, unknown: 1 } })).toThrowError(expect.objectContaining({ code: 'INVALID_VENTURE_REQUEST' }));
 expect(() => create({ aiVoice: 'yes' })).toThrowError(expect.objectContaining({ code: 'INVALID_VENTURE_REQUEST' }));
 expect(() => create({ fields: { unknown: 'x' } })).toThrowError(expect.objectContaining({ code: 'INVALID_VENTURE_REQUEST' }));
});
it('blocks missing rules and no-go community drafts before creating any run', () => {
 expect(() => desk('community-replies').create()).toThrowError(expect.objectContaining({ code: 'INTAKE_FIELD_REQUIRED' }));
 const { create, start, runs } = desk('community-replies', true);
 expect(() => start(create())).toThrowError(expect.objectContaining({ code: 'COMMUNITY_RULES_REQUIRED' }));
 expect(() => start(create({ fields: { communityRules: 'No self-promotion.', communityPromotion: true, communityLinks: false } }))).toThrowError(expect.objectContaining({ code: 'COMMUNITY_NO_GO' }));
 expect(runs).toHaveLength(0);
 expect(() => start(create({ fields: { communityRules: 'Be kind.', communityPromotion: false, communityLinks: false } }))).not.toThrow();
 expect(runs).toHaveLength(1);
});
it('counts actual bound transcript content, excluding timestamps, before repurposing', () => {
 const { create, start, runs } = desk('repurpose-pack');
 const fields = { channels: ['x', 'linkedin', 'facebook'] };
 expect(() => start(create({ fields }, source(['One claim'])))).toThrowError(expect.objectContaining({ code: 'SOURCE_THIN' }));
 expect(runs).toHaveLength(0);
 const good = create({ fields }, source(['Claim one', 'Fact two', 'Story three', 'Lesson four']));
 expect(() => start(good)).not.toThrow();
 expect(runs).toHaveLength(1);
 expect(() => create({ fields: { ...fields, sourceFile: good.intake!.fields!.sourceFile } })).toThrowError(expect.objectContaining({ code: 'UPLOAD_NOT_FOUND' }));
});
it('rejects unsupported source content and invalid channel routing with engine codes', () => {
 const { create, start, runs } = desk('repurpose-pack');
 expect(() => start(create({ fields: { channels: ['x', 'linkedin', 'facebook'] } }, { sourceFile: { name: 'source.csv', contentBase64: btoa('number\n1\n2\n3\n4') } }))).toThrowError(expect.objectContaining({ code: 'SOCIAL_SOURCE_INVALID' }));
 expect(() => start(create({ fields: { channels: ['x'] } }, source(['One', 'Two', 'Three', 'Four'])))).toThrowError(expect.objectContaining({ code: 'SOCIAL_INPUT_INVALID' }));
 expect(runs).toHaveLength(0);
});
it('keeps ghostwriting price in paise and refuses a selling cap outside the range before a run', () => {
 const { create, start, runs } = desk('linkedin-ghostwriting');
 const order = create({ fields: { postCount: '8', sellingCap: '101' }, moneyRupees: { extraRoundPrice: '125.50' }, clientRules: {} });
 expect(order.intake?.fields?.extraRoundPrice).toBe('12550');
 expect(() => start(order)).toThrowError(expect.objectContaining({ code: 'SOCIAL_INPUT_INVALID' }));
 expect(runs).toHaveLength(0);
});

it('matches engine normalization and refusal codes and words across social legacy inputs', async () => {
 const { create } = desk('content-calendar');
 const samples: unknown[] = [undefined, {}, { format: 'short', aiPresenter: true }, { clientRules: { competitors: [' Shop ', 'Shop'] } }, { calendar: { month: '2026-11', channels: ['x'], postsPerChannel: 2, weekdays: [1] } }, { calendar: { month: '2026-10', channels: ['x'], postsPerChannel: 31, weekdays: [1,2,3,4,5,6,7] } }, { clientRules: { invented: [] } }, { rights: {} }, { cutFile: 'relative.mp4' }, { paidPromotion: null }, { format: null }, { fields: { sellingCap: '20' } }, { invented: 1 }, { calendar: { month: '2026-11', channels: ['x'], postsPerChannel: 10, weekdays: [1] } }];
 const capture = (run: () => unknown) => { try { return { value: run() }; } catch (error) { const problem = error as Error & {code: string}; return { code: problem.code, message: problem.message }; } };
 // Execute the real native boundary in Node. Bundling its entire runtime into jsdom is not the production path.
 const moduleUrl=pathToFileURL(resolve(process.cwd(),'platform/runtime/venture/playbooks/intake.ts')).href;
 const script=`import {readFileSync} from 'node:fs';import {serialize,deserialize} from 'node:v8';import {orderIntake} from ${JSON.stringify(moduleUrl)};const {samples,offer,options}=deserialize(readFileSync(0));const capture=run=>{try{return {value:run()};}catch(error){return {code:error.code,message:error.message};}};process.stdout.write(serialize(samples.map(sample=>capture(()=>orderIntake(sample,offer,options)))));`;
 const expected=deserialize(execFileSync(process.execPath,['--input-type=module','-e',script],{input:serialize({samples,offer:{key:'content-calendar',name:'Social service',rights:[],intake:socialIntakeFields('content-calendar')},options:{by:'owner',at:'2026-10-27T10:00:00.000Z',today:'2026-10-27',host:'desktop'}}),timeout:15000}));
 for (const [index,sample] of samples.entries()) expect(capture(() => create(sample).intake)).toEqual(expected[index]);
}, 20000);
