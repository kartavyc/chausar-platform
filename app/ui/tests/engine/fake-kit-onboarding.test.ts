import {priceAndAcceptPlan} from '../helpers/accepted-plan';
// Chausar fake kit onboarding, 5M integration. Original behavior test at the fake engine API.
import { expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { fakeKitForIdea } from '../../src/engine/fake-kit-plans';
import type { BlueprintViewLite, OrderLite, ResultOf } from '../../src/engine/types';
async function start(idea: string) {
 const engine = new FakeEngine({ fresh: true });
 await engine.request('workspace.create', { name: 'New shop', pack: 'services' });
 await engine.request('venture.create', { idea, countryCode: 'IN' });
 await engine.request('venture.interview.answer', { questionId: 'q_1', answer: { skipped: true } });
 await engine.request('venture.interview.answer', { questionId: 'q_pricing_model', answer: { choiceId: 'monthly' } });
 await engine.request('venture.interview.answer', { questionId: 'q_price', answer: { skipped: true } });
 await engine.request('venture.interview.answer', { questionId: 'q_tax', answer: { yes: false } });
 return {engine, view: await engine.request('venture.blueprint.draft', { useTemplate: true }) as BlueprintViewLite};
}
it('chooses the tender desk with owner prices and the exact source/privacy intake',async()=>{
 const {view}=await start('I want a tender response business');expect(view.playbook).toEqual({id:'tender-desk',label:'Tender and proposal desk'});
 expect(view.blueprint.offers.map(offer=>offer.playbookOffer)).toEqual(['bid-response']);const offer=view.blueprint.offers[0]!;
 expect(offer.pricing.unitPriceMinor).toBeNull();expect(view.intake?.[offer.id]?.kit?.map(field=>field.id)).toEqual(['rfpText','rfp','issuerWorkbook','deadline','portal','documents','private']);
});
it('chooses the landed support playbook and keeps its own offers and intake in the fake plan', async () => {
 const { engine, view } = await start('I want a support desk for small shops');
 expect(view.playbook).toEqual({ id: 'support-desk', label: 'Support desk for small shops' });
 expect(view.blueprint.offers.map(offer => offer.playbookOffer)).toContain('monthly-support');
 const offer = view.blueprint.offers.find(offer => offer.playbookOffer === 'monthly-support')!;
 expect(view.intake?.[offer.id]?.kit?.map(field => field.id)).toContain('shopHours');
 expect(view.blueprint.offers.every(offer => offer.pricing.unitPriceMinor === null)).toBe(true);
 expect((await engine.request('venture.get', {}) as ResultOf<'venture.get'>)?.playbook?.id).toBe('support-desk');
});

it('matches the real longest phrase selection and registry tie order', async () => {
 for (const [idea, expected] of [['local seo and lead generation', 'lead-generation'], ['cfo on demand and online seller', 'online-seller'], ['collections desk and helpdesk service', 'support-desk']] as const) {
  expect((await start(idea)).view.playbook?.id).toBe(expected);
 }
});
it('keeps the real seller plan offer selection and order', async () => {
 const { view } = await start('online seller');
 expect(view.blueprint.offers.map(offer => offer.playbookOffer)).toEqual(['catalogue-upload','product-research','multi-store-report','product-photos','case-tracker','listing-health-audit','own-shop-back-office','reimbursement-audit','unit-economics-monthly','ads-health-check','amazon-ungating','amazon-brand-registry','amazon-returns','amazon-storefront','amazon-deals','amazon-compliance']);
});
it('omits the own-shop intake ask when the real offer asks no questions or rights', async () => {
 const { view } = await start('online seller');
 const offer = view.blueprint.offers.find(item => item.playbookOffer === 'own-shop-back-office')!;
 expect(Object.hasOwn(view.intake ?? {}, offer.id)).toBe(false);
});

it('keeps kit validation for an offer with no visible intake questions', async () => {
 const { engine, view } = await start('online seller');
 const offer = view.blueprint.offers.find(item => item.playbookOffer === 'own-shop-back-office')!;
 await priceAndAcceptPlan(engine,view,'100');
 await expect(engine.request('venture.order.create', { offerId: offer.id, request: 'Check my own shop', intake: { fields: { invented: 'value' } } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
 const order = await engine.request('venture.order.create', { offerId: offer.id, request: 'Check my own shop', intake: {} }) as OrderLite;
 expect(order.intake).toEqual({ rights: null, fields: {}, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null });
});

it('does not replace a more specific flagship selection with a kit', () => {
 expect(fakeKitForIdea('long video into shorts and lead generation')).toBeNull();
 expect(fakeKitForIdea('youtube editing lead generation')?.registration.id).toBe('lead-generation');
});
