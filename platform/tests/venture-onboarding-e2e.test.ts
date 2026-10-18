// P-e2e-docs (onboarding v2): connect an AI first, one open box, a plan made from checked blocks, then the journey
// as before, through the real Engine with demo mode, experimental file storage and a temp folder. Every model answer
// comes from a hand-written recording in fixtures/venture/onboarding/ (labelled synthetic recording); no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { numberGuard } from '../runtime/calculator.ts';
import { formatMinor } from '../runtime/currency.ts';
import { assertNoNumbers, assertNoSpelledNumbers, copiedTokens } from '../runtime/venture/records.ts';
import type {
  BlueprintView, BriefRecord, ClientRecord, GitHubTransport, InvoiceView, ModelCallRecord, ModelPreset, ModelReplayFixture,
  ModelStatusView, OrderRecord, PlaybookRecord, PriceReceiptRecord, SimulationRunRecord, VentureView,
} from '../runtime/venture/contracts.ts';
import {
  AI_OPTION_IDS, AI_OPTION_WORDS, APPROVAL_BLOCK_IDS, COMPOSE_REFUSED_WORDS, NOT_A_SERVICE_WORDS, NOTE_BLOCK_IDS, OFFER_BLOCK_IDS,
  PAGE_BLOCK_IDS, STEP_BLOCK_IDS, TOOL_BLOCK_IDS, VIEW_IDS,
} from '../runtime/venture/onboarding-contracts.ts';
import type { AiOptionsView, AiStatusView, ComposeDecision, ComposedPlan, OpenBoxKind } from '../runtime/venture/onboarding-contracts.ts';
import { createReplayTransport } from '../runtime/venture/models/index.ts';
import { AVAILABILITY_REASONS } from '../runtime/venture/models/presets.ts';
import { NOTE_BLOCKS } from '../runtime/venture/core/blocks.ts';
import { CONNECTOR_CATALOGUE } from '../runtime/venture/build/catalogue.ts';
import { RLS_LINE, SIGN_IN_LINE } from '../runtime/venture/build/brief-lint.ts';
import { kindByRules } from './fixtures/venture/onboarding/kind-rules.ts';

const PASSPHRASE = 'long-enough-passphrase';
const KEY = 'sk-ant-test-onboarding-e2e-not-a-real-key-5d21';
const noGitHub: GitHubTransport = { kind: 'fixture', read: async () => ({ status: 404, etag: null, body: '{"message":"Not Found"}', rateRemaining: null }) };

type Recording = ModelReplayFixture & { text: string; countryCode: string };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };

async function recording(name: string): Promise<Recording> {
  const fixture = JSON.parse(await readFile(new URL(`./fixtures/venture/onboarding/${name}`, import.meta.url), 'utf8')) as Recording;
  assert.equal(fixture.label, 'synthetic recording', name);
  return fixture;
}

async function newEngine(t: any, fixture: ModelReplayFixture, options: { claudeCodeTerms?: 'accepted' | 'pending'; directory?: string } = {}) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'chausar-onboarding-e2e-'));
  const engine = new Engine({
    directory, demo: true, storage: 'experimental-file',
    venture: {
      host: 'test', modelTransport: createReplayTransport(fixture), githubTransport: noGitHub,
      // Docker is absent here, so no container command runs.
      sandbox: { process: async () => { throw new Error('docker not found'); } },
      ...(options.claudeCodeTerms ? { claudeCodeTerms: options.claudeCodeTerms } : {}),
    },
  });
  t.after(async () => { await engine.close().catch(() => {}); if (!options.directory) await rm(directory, { recursive: true, force: true }); });
  const ask = (method: string, payload: Record<string, unknown> = {}): Promise<any> => engine.request(method, payload);
  return { engine, ask, directory };
}

function presetOf(options: AiOptionsView, id: ModelPreset['id']): ModelPreset {
  const found = options.presets.find(preset => preset.id === id);
  assert.ok(found, id);
  return found;
}

/** The recommended row: one Anthropic key, Haiku 5.5 for quick work, then Sonnet 5.5 for plans. Two calls. */
async function connectPair(ask: (method: string, payload?: Record<string, unknown>) => Promise<any>): Promise<AiStatusView> {
  const options = await ask('venture.ai.options') as AiOptionsView;
  const row = options.options.find(option => option.id === 'api-key')!;
  assert.deepEqual(row.recommended, { fast: 'anthropic-haiku-5-5', main: 'anthropic-sonnet-5-5' });
  await ask('venture.ai.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: presetOf(options, 'anthropic-haiku-5-5').consentDigest, apiKey: KEY });
  return await ask('venture.ai.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: presetOf(options, 'anthropic-sonnet-5-5').consentDigest, apiKey: KEY }) as AiStatusView;
}

/** Every string the model wrote into a composed plan (engine and fixed words left out). */
function modelStrings(plan: ComposedPlan): string[] {
  const words: string[] = [plan.reading.value, plan.name.value, plan.oneLiner.value, plan.customer.value];
  for (const offer of plan.offers) words.push(offer.name.value, offer.description.value);
  for (const step of plan.steps) words.push(step.title.value);
  for (const page of plan.pages) words.push(page.title.value, page.purpose.value);
  for (const tool of plan.tools) words.push(tool.reason.value);
  for (const question of plan.questions) words.push(question.text, ...question.choices.map(choice => choice.label));
  for (const view of plan.views) if (view.id === 'audience-first') words.push(view.who.value, view.pain.value);
  return words;
}

function assertNoModelNumbers(plan: ComposedPlan) {
  const allowed = copiedTokens(plan.text);
  for (const value of modelStrings(plan)) {
    assert.doesNotThrow(() => assertNoNumbers(value, 'plan words', allowed), value);
    assert.doesNotThrow(() => assertNoSpelledNumbers(value, 'plan words', allowed), value);
    assert.doesNotMatch(value, /\d/, value);
  }
}

test('the recordings: each sentence is classified as the deterministic rules say, and every model string is within the rules', async () => {
  const names = ['dog-walking-gb.json', 'excel-skill-in.json', 'cafe-bills-problem-in.json', 'landlord-not-a-service.json', 'dog-walking-claude-cli.json'];
  const expected: Record<string, OpenBoxKind> = {
    'dog-walking-gb.json': 'idea', 'excel-skill-in.json': 'skill', 'cafe-bills-problem-in.json': 'problem', 'landlord-not-a-service.json': 'not-a-service', 'dog-walking-claude-cli.json': 'idea',
  };
  for (const name of names) {
    const fixture = await recording(name);
    const decide = fixture.responses.find(response => response.purpose === 'decide');
    assert.ok(decide, name);
    const raw = decide.kind === 'claude-cli' ? (decide.body as any).structured_output : JSON.parse((decide.body as any).content[0].text);
    assert.equal(raw.kind, expected[name], name);
    assert.equal(kindByRules(fixture.text), raw.kind, `${name}: the test-only rules agree with the recording`);
    for (const response of fixture.responses) {
      assert.ok(response.mustInclude.some(fragment => /^chausar-(re)?(decide|compose)-v1$/.test(fragment)) || !['decide', 'compose'].includes(response.purpose), `${name}: ${response.purpose} names its marker`);
    }
  }
});

test('onboarding end to end: connect first, compose a fitted plan from blocks, keep it safe, then price, accept, build, rehearse and invoice', async t => {
  const dog = await recording('dog-walking-gb.json');
  const { engine, ask } = await newEngine(t, dog);

  // 1. Connect, before any vault: ChatGPT is not open, the API key row can connect but is unverified.
  assert.equal((await ask('workspace.status')).open, false);
  const options = await ask('venture.ai.options') as AiOptionsView;
  assert.deepEqual(options.options.map(option => option.id), [...AI_OPTION_IDS]);
  const chatgpt = options.options.find(option => option.id === 'chatgpt-sign-in')!;
  assert.deepEqual([chatgpt.status, chatgpt.canConnect, chatgpt.presetIds, chatgpt.why], ['not-open', false, [], AI_OPTION_WORDS['chatgpt-sign-in'].why]);
  const keyRow = options.options.find(option => option.id === 'api-key')!;
  assert.deepEqual([keyRow.status, keyRow.canConnect], ['unverified', true]);
  assert.equal(options.unchecked, true, 'nothing in this build is checked with a live account');
  for (const option of options.options) assert.doesNotMatch(`${option.label} ${option.line} ${option.why}`, /\b(works|working)\b/i, option.id);
  const connected = await connectPair(ask);
  assert.equal(connected.scope, 'before-vault');
  assert.deepEqual([connected.tiers.fast.presetId, connected.tiers.main.presetId], ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5']);
  assert.ok(connected.connections.every(connection => connection.keyLoaded));
  assert.equal(engine.vault, null, 'connecting an AI makes no vault');

  // 2. Compose: one open box. decide (fast tier) reads it and picks views; fill (main tier) picks blocks.
  const decision = await ask('venture.compose.decide', { text: dog.text, countryCode: 'GB' }) as ComposeDecision;
  assert.deepEqual([decision.kind, decision.family?.value, decision.views], ['idea', 'other', ['offers-first', 'pages', 'notes']]);
  assert.equal(decision.writtenBy.presetId, 'anthropic-haiku-5-5');
  assert.equal(decision.writtenBy.replay, true);
  let plan = await ask('venture.compose.fill', { composeId: decision.composeId }) as ComposedPlan;
  assert.equal(plan.writtenBy.presetId, 'anthropic-sonnet-5-5');
  assert.deepEqual([plan.kind, plan.text, plan.country.code, plan.saved], ['idea', dog.text, 'GB', false]);
  assert.deepEqual(plan.views.map(view => view.id), ['offers-first', 'pages', 'notes']);
  assert.ok(plan.views.every(view => (VIEW_IDS as readonly string[]).includes(view.id)));
  assert.deepEqual(plan.offers.map(offer => [offer.id, offer.block]), [['offer_1', 'subscription'], ['offer_2', 'package']]);
  assert.ok(plan.offers.every(offer => (OFFER_BLOCK_IDS as readonly string[]).includes(offer.block) && offer.priceDisplay === null && offer.pricing.unitPriceMinor === null));
  assert.deepEqual(plan.steps.map(step => step.id), ['step_1', 'step_2', 'step_3', 'step_4']);
  assert.deepEqual(plan.steps.map(step => step.block), ['book-time', 'in-person-work', 'draft-reply', 'get-paid']);
  assert.ok(plan.steps.every(step => (STEP_BLOCK_IDS as readonly string[]).includes(step.block)));
  assert.equal(plan.steps.filter(step => step.block === 'draft-reply').length, 1, 'exactly one drafting step');
  assert.deepEqual(plan.steps.map(step => step.doneBy), ['you', 'you', 'agent-then-you', 'you'], 'code, not the model, decides who does each step');
  assert.equal(plan.steps.find(step => step.block === 'in-person-work')?.capability, 'yours');
  assert.ok(plan.approvals.some(approval => approval.block === 'each-draft'));
  assert.ok(plan.approvals.every(approval => (APPROVAL_BLOCK_IDS as readonly string[]).includes(approval.block) && approval.by === 'engine'));
  const pageBlocks = plan.pages.map(page => page.block);
  assert.ok(pageBlocks.includes('home') && pageBlocks.includes('offers-prices'));
  assert.ok(pageBlocks.every(block => (PAGE_BLOCK_IDS as readonly string[]).includes(block)));
  assert.deepEqual(plan.tools.map(tool => tool.block), ['cal-com', 'whatsapp']);
  for (const tool of plan.tools) {
    assert.ok((TOOL_BLOCK_IDS as readonly string[]).includes(tool.block));
    const entry = CONNECTOR_CATALOGUE.find(item => item.id === tool.block);
    assert.ok(entry && entry.category !== 'payments', tool.block);
    assert.equal(tool.card.id, tool.block);
  }
  assert.deepEqual(plan.notes, plan.notes.map(note => ({ block: note.block, text: NOTE_BLOCKS[note.block].words })), 'notes are fixed words');
  assert.ok(plan.notes.every(note => (NOTE_BLOCK_IDS as readonly string[]).includes(note.block)));
  assertNoModelNumbers(plan);
  assert.equal(engine.vault, null, 'nothing is saved yet');

  // 3. The owner's prices, typed as text: GBP 18 per month and GBP 60.50 per project. Not VAT registered.
  plan = await ask('venture.compose.update', { composeId: plan.composeId, patch: { offers: [{ id: 'offer_1', unitPrice: '18' }, { id: 'offer_2', unitPrice: '60.50' }] } }) as ComposedPlan;
  plan = await ask('venture.compose.update', { composeId: plan.composeId, patch: { taxRegistered: false } }) as ComposedPlan;
  assert.deepEqual(plan.offers.map(offer => [offer.pricing.unitPriceMinor, offer.pricing.unitPriceLabel, offer.priceDisplay]),
    [['1800', 'told-by-you', formatMinor('1800', 'GBP')], ['6050', 'told-by-you', formatMinor('6050', 'GBP')]]);
  assert.equal(plan.backOffice.taxRegistered.value, false);
  await assert.rejects(ask('venture.compose.update', { composeId: plan.composeId, patch: { offers: [{ id: 'offer_1', pricingModel: 'hourly' }] } }), code('INVALID_VENTURE_REQUEST'), 'a subscription is priced per month');
  const draftCalls = await ask('venture.ai.calls') as ModelCallRecord[];
  assert.deepEqual(draftCalls.map(call => call.purpose), ['compose', 'decide']);

  // 4. Keep it safe: the vault opens, then venture.create adopts the plan and the AI by id and digest only.
  const created = await ask('workspace.create', { name: 'Night Shift Walkers', passphrase: PASSPHRASE, pack: 'services' });
  assert.equal(typeof created.recoveryCode, 'string');
  const view = await ask('venture.create', { idea: dog.text, countryCode: 'GB', workingName: 'Night Shift Walkers', composeId: plan.composeId, composedDigest: plan.digest }) as VentureView;
  assert.equal(view.venture.serviceType, 'other');
  assert.deepEqual([view.checklist[0].id, view.checklist[0].label, view.checklist[0].done], ['ai', 'Connect your AI', true]);
  await assert.rejects(ask('venture.ai.status'), code('VENTURE_EXISTS'));
  await assert.rejects(ask('venture.compose.get'), code('VENTURE_EXISTS'));
  const status = await ask('venture.models.status') as ModelStatusView;
  const live = status.connections.filter(connection => connection.status === 'connected');
  assert.deepEqual(live.map(connection => connection.presetId).sort(), ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5']);
  assert.ok(live.every(connection => connection.keyLoaded), 'the key moved to the vault host shelf, in memory');
  assert.equal((await ask('trust.get')).send, 'shape');
  const sent = await ask('venture.models.calls', { limit: 100 }) as ModelCallRecord[];
  assert.deepEqual(sent.map(call => call.id).sort(), draftCalls.map(call => call.id).sort(), 'What was sent lists the calls made before the vault');
  for (const call of sent) {
    assert.equal(call.payloadText.includes(KEY), false);
    assert.equal(call.containsClientData, false);
    assert.equal(call.replay, true);
  }

  // 5. The plan in the vault: version 1, written by the model, with its blocks. Prices become receipts, then accept.
  const v1 = (await ask('venture.blueprint.get') as BlueprintView).blueprint;
  assert.deepEqual([v1.version, v1.source, v1.status], [1, 'model', 'draft']);
  assert.deepEqual(v1.offers.map(offer => offer.block), ['subscription', 'package']);
  assert.deepEqual(v1.deliverySteps.map(step => step.block), ['book-time', 'in-person-work', 'draft-reply', 'get-paid']);
  assert.deepEqual(v1.pages?.map(page => page.block), ['home', 'offers-prices', 'booking', 'faq']);
  assert.deepEqual(v1.tools?.map(tool => tool.block), ['cal-com', 'whatsapp']);
  assert.deepEqual(v1.notes?.map(note => note.block), ['insurance', 'safety']);
  assert.equal(v1.composition?.composeId, plan.composeId);
  const receipts: Record<string, PriceReceiptRecord> = {};
  for (const offer of ['offer_1', 'offer_2']) {
    const quote = await ask('venture.price.quote', { offerId: offer }) as PriceReceiptRecord;
    assert.equal(quote.inputs.taxTreatment, 'none');
    assert.doesNotThrow(() => numberGuard(quote.explanation, quote));
    receipts[offer] = quote;
  }
  // Not registered, one unit each: the totals are exactly the typed prices, 1800 and 6050 pence.
  assert.equal(receipts.offer_1.totalMinor, '1800');
  assert.equal(receipts.offer_2.totalMinor, '6050');
  const accepted = (await ask('venture.blueprint.accept', { digest: v1.digest }) as BlueprintView).blueprint;
  assert.equal(accepted.status, 'accepted');

  // 6. Build and run. The brief uses the plan's own pages and leaves out the client-area lines (no client-area page).
  const brief = await ask('venture.build.brief') as BriefRecord;
  assert.equal(brief.lint.ok, true, JSON.stringify(brief.lint.findings));
  assert.equal(brief.wordsBy, 'model');
  const pageLines = brief.markdown.split('\n').filter(line => /^\d\. /.test(line));
  assert.deepEqual(pageLines.map(line => line.replace(/^\d\. /, '').split(':')[0]), v1.pages!.map(page => page.title.value));
  assert.equal(brief.markdown.includes(RLS_LINE), false);
  assert.equal(brief.markdown.includes(SIGN_IN_LINE), false);
  assert.equal(brief.markdown.includes('Keep client uploads private'), false);
  assert.equal(brief.markdown.includes('A signed-in client sees only their own requests and files'), false);
  assert.ok(brief.markdown.includes(formatMinor('1800', 'GBP')), 'the price is copied from the receipt');

  const playbook = await ask('venture.delivery.playbook') as PlaybookRecord;
  const draftStep = playbook.steps.find(step => step.id === 'draft')!;
  assert.equal(draftStep.title, v1.deliverySteps.find(step => step.block === 'draft-reply')!.title.value, 'the drafting step is found by its block');
  assert.equal(playbook.steps.some(step => step.doneBy === 'agent' && step.title === 'Walk the dogs'), false, 'no agent is credited with the walks');
  assert.equal(playbook.steps.find(step => step.id === 'work')?.title, 'Do the hands-on work with tools');

  const rehearsal = await ask('venture.simulation.run', { useTemplate: true }) as SimulationRunRecord;
  assert.equal(rehearsal.modelMode, 'template');
  assert.equal(rehearsal.passed, true, JSON.stringify(rehearsal.episodes.map(episode => episode.firstFailure)));

  const client = await ask('venture.client.add', { name: 'Leeds Demo Client', countryCode: 'GB' }) as ClientRecord;
  const order = await ask('venture.order.create', { clientId: client.id, offerId: 'offer_1', quantity: '1', request: 'Please walk my dog on my long shifts this month.' }) as OrderRecord;
  const orderReceipt = await ask('venture.receipt.get', { id: order.priceReceiptId }) as PriceReceiptRecord;
  assert.equal(orderReceipt.totalMinor, '1800');
  assert.doesNotThrow(() => numberGuard(orderReceipt.explanation, orderReceipt));
  const prepared = await ask('venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-19', dueInDays: 14 }) as InvoiceView;
  const issued = await ask('venture.invoice.issue', { invoiceId: prepared.invoice.id, digest: prepared.invoice.digest }) as InvoiceView;
  assert.equal(issued.invoice.totalMinor, orderReceipt.totalMinor, 'the invoice total is the receipt total');
  assert.deepEqual(issued.invoice.taxLines, []);
  // Every money amount on the invoice is a figure from its receipt, formatted by code.
  const amounts = issued.documentText.match(/GBP [\d,]+\.\d{2}/g) ?? [];
  assert.ok(amounts.length > 0);
  const receiptDisplays = new Set(orderReceipt.figures.map(figure => figure.display));
  for (const amount of amounts) assert.ok(receiptDisplays.has(amount), `${amount} comes from the receipt`);

  // Nothing anywhere holds the key.
  assert.equal(JSON.stringify(engine.vault!.read()).includes(KEY), false);
});

test('the number guard and the repair: a digit or a price in words is refused once and repaired, markup too', async t => {
  for (const [name, refusedText] of [['digit-then-repair.json', 'Walks for 2 dogs'], ['spelled-price-then-repair.json', 'Twenty pounds a walk'], ['markup-in-words.json', '<b>']] as const) {
    const fixture = await recording(name);
    const { ask } = await newEngine(t, fixture);
    await connectPair(ask);
    const decision = await ask('venture.compose.decide', { text: fixture.text, countryCode: 'GB' }) as ComposeDecision;
    const plan = await ask('venture.compose.fill', { composeId: decision.composeId }) as ComposedPlan;
    assertNoModelNumbers(plan);
    assert.equal(plan.offers[0].name.value, 'Weekly walks', name);
    assert.equal(plan.calls.compose.length, 2, `${name}: the first answer and the repair are both recorded`);
    const calls = await ask('venture.ai.calls') as ModelCallRecord[];
    const compose = calls.filter(call => call.purpose === 'compose');
    assert.deepEqual(compose.map(call => call.status), ['completed', 'failed'], `${name}: newest first, the repair completed after the first answer failed`);
    const repair = compose.find(call => call.payloadText.includes('chausar-recompose-v1'));
    assert.ok(repair, `${name}: the repair call carries its own marker`);
    assert.match(repair.payloadText, /Your last answer was refused/);
    assert.equal(repair.payloadText.includes(refusedText), false, `${name}: the rejected text is never sent back`);
  }
});

test('refused twice: an unknown block id in both answers gives COMPOSE_REFUSED, no plan, and both failed calls listed', async t => {
  const fixture = await recording('unknown-block-twice.json');
  const { ask } = await newEngine(t, fixture);
  await connectPair(ask);
  const decision = await ask('venture.compose.decide', { text: fixture.text, countryCode: 'GB' }) as ComposeDecision;
  await assert.rejects(ask('venture.compose.fill', { composeId: decision.composeId }), (error: any) => error.code === 'COMPOSE_REFUSED' && error.message === COMPOSE_REFUSED_WORDS);
  const state = await ask('venture.compose.get') as { decision: ComposeDecision; plan: ComposedPlan | null };
  assert.equal(state.decision.composeId, decision.composeId, 'the decision stays, so Try again can call fill again');
  assert.equal(state.plan, null, 'no plan is ever kept from a refused answer');
  const failed = (await ask('venture.ai.calls') as ModelCallRecord[]).filter(call => call.purpose === 'compose');
  assert.deepEqual(failed.map(call => call.status), ['failed', 'failed']);
});

test('a decide answer with two lead views is repaired once; a sentence that is not a service gets no views and no plan', async t => {
  const repaired = await recording('decide-repair.json');
  const first = await newEngine(t, repaired);
  await connectPair(first.ask);
  const decision = await first.ask('venture.compose.decide', { text: repaired.text, countryCode: 'GB' }) as ComposeDecision;
  assert.deepEqual(decision.views, ['offers-first', 'pages', 'notes']);
  assert.equal(decision.callIds.length, 2);
  const plan = await first.ask('venture.compose.fill', { composeId: decision.composeId }) as ComposedPlan;
  assert.equal(plan.calls.decide.length, 2);

  const landlord = await recording('landlord-not-a-service.json');
  const second = await newEngine(t, landlord);
  await connectPair(second.ask);
  const refused = await second.ask('venture.compose.decide', { text: landlord.text, countryCode: 'GB' }) as ComposeDecision;
  assert.deepEqual([refused.kind, refused.views, refused.family, refused.reading, refused.refusal], ['not-a-service', [], null, null, NOT_A_SERVICE_WORDS]);
  await assert.rejects(second.ask('venture.compose.fill', { composeId: refused.composeId }), code('COMPOSE_NOT_A_SERVICE'));
  assert.equal((await second.ask('venture.ai.calls') as ModelCallRecord[]).filter(call => call.purpose === 'compose').length, 0, 'fill sent nothing');
});

test('the skill and the problem get fitted plans with their own lead views', async t => {
  for (const [name, kind, lead] of [['excel-skill-in.json', 'skill', 'steps-first'], ['cafe-bills-problem-in.json', 'problem', 'audience-first']] as const) {
    const fixture = await recording(name);
    const { ask } = await newEngine(t, fixture);
    await connectPair(ask);
    const decision = await ask('venture.compose.decide', { text: fixture.text, countryCode: fixture.countryCode }) as ComposeDecision;
    assert.equal(decision.kind, kind);
    const plan = await ask('venture.compose.fill', { composeId: decision.composeId }) as ComposedPlan;
    assert.equal(plan.views[0].id, lead, name);
    assert.equal(plan.country.currency, 'INR');
    assertNoModelNumbers(plan);
    if (kind === 'skill') {
      assert.deepEqual(plan.questions.map(question => [question.id, question.block, question.by, question.required]), [['q_1', 'customer', 'model', false], ['q_2', 'area', 'model', false]]);
      const answered = await ask('venture.compose.update', { composeId: plan.composeId, patch: { answers: [{ questionId: 'q_1', answer: { choiceId: 'c_2' } }] } }) as ComposedPlan;
      assert.deepEqual(answered.questions[0].answer, { choiceId: 'c_2' });
      assert.equal(plan.steps.find(step => step.block === 'meet-client')?.capability, 'yours');
    } else {
      const audience = plan.views[0] as Extract<ComposedPlan['views'][number], { id: 'audience-first' }>;
      assert.equal(audience.who.by, 'model');
      assert.equal(audience.pain.label, 'assumption');
    }
  }
});

test('the Claude Code route answers with the terms accepted, and the same connect is refused while they are pending', async t => {
  const fixture = await recording('dog-walking-claude-cli.json');
  const pending = await newEngine(t, fixture, { claudeCodeTerms: 'pending' });
  const closed = await pending.ask('venture.ai.options') as AiOptionsView;
  assert.deepEqual([closed.options.find(option => option.id === 'claude-code')!.status, closed.options.find(option => option.id === 'claude-code')!.canConnect], ['needs-setup', false]);
  const preset = presetOf(closed, 'claude-code-cli');
  assert.equal(preset.availabilityReason, AVAILABILITY_REASONS.claudeTerms);
  await assert.rejects(pending.ask('venture.ai.connect', { presetId: 'claude-code-cli', consentDigest: preset.consentDigest }), (error: any) => error.code === 'PRESET_UNAVAILABLE' && error.message === AVAILABILITY_REASONS.claudeTerms);

  const open = await newEngine(t, fixture, { claudeCodeTerms: 'accepted' });
  const options = await open.ask('venture.ai.options') as AiOptionsView;
  const status = await open.ask('venture.ai.connect', { presetId: 'claude-code-cli', consentDigest: presetOf(options, 'claude-code-cli').consentDigest }) as AiStatusView;
  assert.deepEqual([status.tiers.fast.presetId, status.tiers.main.presetId], ['claude-code-cli', 'claude-code-cli']);
  assert.equal(status.tiers.fast.model, 'claude-sonnet-5-5', 'Claude Code runs Sonnet 5.5 for both tiers');
  const decision = await open.ask('venture.compose.decide', { text: fixture.text, countryCode: 'GB' }) as ComposeDecision;
  const plan = await open.ask('venture.compose.fill', { composeId: decision.composeId }) as ComposedPlan;
  assert.deepEqual([plan.writtenBy.presetId, plan.writtenBy.model, plan.writtenBy.replay], ['claude-code-cli', 'claude-sonnet-5-5', true]);
  assert.deepEqual(plan.offers.map(offer => offer.block), ['subscription', 'package']);
});

test('a new Engine on the same folder before Keep it safe starts empty: the draft lived in memory only', async t => {
  const dog = await recording('dog-walking-gb.json');
  const directory = await mkdtemp(join(tmpdir(), 'chausar-onboarding-e2e-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await newEngine(t, dog, { directory });
  await connectPair(first.ask);
  const decision = await first.ask('venture.compose.decide', { text: dog.text, countryCode: 'GB' }) as ComposeDecision;
  const plan = await first.ask('venture.compose.fill', { composeId: decision.composeId }) as ComposedPlan;
  await first.engine.close();
  const second = await newEngine(t, dog, { directory });
  assert.deepEqual((await second.ask('venture.ai.status') as AiStatusView).connections, []);
  assert.equal(await second.ask('venture.compose.get'), null);
  await assert.rejects(second.ask('venture.compose.update', { composeId: plan.composeId, patch: { taxRegistered: false } }), code('COMPOSE_NOT_FOUND'));
  await assert.rejects(second.ask('venture.compose.decide', { text: dog.text, countryCode: 'GB' }), code('NO_MODEL_CONNECTED'));
});

test('the offline demo replay answers the composer for the demo idea and the three open-box examples, and nothing else', async t => {
  const demo = JSON.parse(await readFile(new URL('./fixtures/venture/demo/model-replay.json', import.meta.url), 'utf8')) as ModelReplayFixture;
  const sentences: [string, string, OpenBoxKind, string][] = [
    ['Monthly bookkeeping for cafes and small shops in Pune.', 'IN', 'idea', 'offers-first'],
    ['Dog walking for busy nurses in Leeds.', 'GB', 'idea', 'offers-first'],
    ["I'm good at Excel and I want to teach it.", 'IN', 'skill', 'steps-first'],
    ['Small cafes lose track of their bills.', 'IN', 'problem', 'audience-first'],
  ];
  const { ask } = await newEngine(t, demo);
  await connectPair(ask);
  for (const [text, countryCode, kind, lead] of sentences) {
    const decision = await ask('venture.compose.decide', { text, countryCode }) as ComposeDecision;
    assert.equal(decision.kind, kind, text);
    assert.equal(kindByRules(text), kind, text);
    const plan = await ask('venture.compose.fill', { composeId: decision.composeId }) as ComposedPlan;
    assert.equal(plan.views[0].id, lead, text);
    assertNoModelNumbers(plan);
  }
  const landlord = await ask('venture.compose.decide', { text: "My landlord won't fix the heating.", countryCode: 'GB' }) as ComposeDecision;
  assert.equal(landlord.kind, 'not-a-service');
  await assert.rejects(ask('venture.compose.decide', { text: 'Kite repairs for beach clubs on the coast.', countryCode: 'GB' }), code('FIXTURE_MISSING'), 'a sentence with no recording says so; nothing is made up');
});
