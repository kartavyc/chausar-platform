// P6: the whole venture journey through the real Engine and every real venture package, with synthetic recordings
// for the model and GitHub (build spec section 11). No network: the model and GitHub answer from hand-written fixtures.
// Written in Phase B against the contracts; it passes once all packages have landed (Phase C).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { numberGuard } from '../runtime/calculator.ts';
import { EXTERNAL_ORIGINS, STEP_PLAN } from '../runtime/venture/contracts.ts';
import type {
  BlueprintView, BooksSummary, BriefRecord, BuildStatus, CapabilityStatus, ClientRecord, ConnectorCard, CountryProfile, DeliveryRunRecord,
  HandoffPlan, HandoffRecord, InterviewView, InvoiceView, LaunchStatus, ModelCallRecord, ModelPreset, ModelStatusView, OrderRecord, PlanPreview, PriceReceiptRecord,
  SimulationRunRecord, VentureEventRecord, VentureView,
} from '../runtime/venture/contracts.ts';
import { createReplayTransport } from '../runtime/venture/models/index.ts';
import { createFixtureGitHubTransport, decompressFromEncodedURIComponent } from '../runtime/venture/build/index.ts';

const PASSPHRASE = 'long-enough-passphrase';
const API_KEY = 'sk-ant-test-not-a-real-key-0000';
const GITHUB_TOKEN = 'github_pat_test_not_a_real_token_00';
const GSTIN = '27ZZZZZ9999Z1Z8'; // synthetic, with a valid checksum
const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune, done by AI helpers with me checking every report.';
const REQUEST = 'Please close my September books. The bank statement and bills are in the shared folder.';
const RLS_LINES = [
  'Turn on row level security for every table, with policies so a signed-in client reads and writes only their own rows.',
  'Nothing is readable without sign-in except the public pages.',
  'Only the public anon key may appear in front-end code, never a service role key.',
];
const CANNOT_SAY = [
  'Whether your app works.',
  'Your Lovable or Replit preview.',
  'How many builder credits you used.',
  'Your live address, unless a host records a deployment.',
  'Whether your client data is locked down.',
  'These answers come from a synthetic recording, not your real repo.',
];
const OUTLINE_LINE = "Template outline. No AI wrote this and it doesn't read the client's request.";

type CallRecord = ModelCallRecord;
type StatusView = ModelStatusView;

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };
const figure = (receipt: PriceReceiptRecord, key: string) => {
  const found = receipt.figures.find(f => f.key === key);
  assert.ok(found, `receipt ${receipt.id} has a ${key} figure`);
  return found;
};

async function newEngine(t: any, withRecordings: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-venture-e2e-'));
  let engine: Engine;
  if (withRecordings) {
    const modelFixture = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/model-replay.json', import.meta.url), 'utf8'));
    const githubFixture = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/github-sync.json', import.meta.url), 'utf8'));
    engine = new Engine({ directory, demo: true, storage: 'experimental-file', venture: {
      host: 'test',
      // Docker is absent here, so the container tier says it needs setup; no docker command runs in this test.
      sandbox: { process: async () => { throw new Error('docker not found'); } },
      modelTransport: createReplayTransport(modelFixture),
      githubTransport: store => createFixtureGitHubTransport(githubFixture, () => ({
        briefId: [...store.read().conversations].reverse().find((r: any) => r.kind === 'venture-brief')?.briefId ?? '' })),
    } });
  } else {
    engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  }
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  const ask = (method: string, payload: Record<string, unknown> = {}): Promise<any> => engine.request(method, payload);
  return { engine, ask };
}

test('the whole venture journey in India, with a model and GitHub answering from synthetic recordings', async t => {
  const { engine, ask } = await newEngine(t, true);
  const events = async () => ((await ask('venture.events', { limit: 100 })) as { events: VentureEventRecord[] }).events;
  const calls = async () => await ask('venture.models.calls', { limit: 100 }) as CallRecord[];

  // 1. Countries, before any vault.
  const countries = await ask('venture.countries') as CountryProfile[];
  assert.equal(countries.length, 15);
  const india = countries.find(c => c.code === 'IN');
  assert.ok(india);
  assert.equal(india.currency, 'INR');
  assert.equal(india.tax.mode, 'gst');
  assert.equal(india.tax.label, 'GST');
  assert.equal(india.tax.standardRateBps, '1800');
  assert.equal(india.tax.idLabel, 'GSTIN');

  // 2. The instant plan, before any vault; nothing is saved.
  const preview = await ask('venture.preview', { idea: IDEA, countryCode: 'IN' }) as PlanPreview;
  assert.equal(preview.serviceType.value, 'bookkeeping');
  assert.equal(preview.saved, false);
  assert.deepEqual(preview.deliverySteps.map(s => ({ id: s.id, doneBy: s.doneBy, capability: s.capability, note: s.note })),
    STEP_PLAN.map(s => ({ id: s.id, doneBy: s.doneBy, capability: s.capability, note: s.note })));
  assert.equal((await ask('workspace.status')).open, false);

  // 3. Keep it: the vault opens and still sends nothing.
  await ask('workspace.create', { name: 'Ledger Cafe Books', passphrase: PASSPHRASE, pack: 'services' });
  assert.equal((await ask('workspace.status')).open, true);
  assert.equal((await ask('trust.get')).send, 'nothing');

  // 4. The venture: one of twelve done, records kept for ten years.
  const created = await ask('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' }) as VentureView;
  assert.equal(created.done, 1);
  assert.equal(created.total, 12);
  // Onboarding v2: connecting an AI is the first item; the AI here is added after the vault, so it is not done yet.
  assert.deepEqual([created.checklist[0].id, created.checklist[0].label, created.checklist[0].done], ['ai', 'Connect your AI', false]);
  assert.equal(created.checklist.find(item => item.id === 'idea')?.label, 'Say what you want to do');
  assert.equal((await ask('trust.get')).retentionDays, 3650);
  const retention = (await events()).find(e => e.name === 'retention-changed');
  assert.ok(retention);
  assert.equal((retention.data as { to: number }).to, 3650);

  // 5. Add your AI: Haiku for fast work, Sonnet for main work. The send setting moves to question shapes once.
  const presets = await ask('venture.models.presets') as ModelPreset[];
  const haiku = presets.find(p => p.id === 'anthropic-haiku-5-5');
  const sonnet = presets.find(p => p.id === 'anthropic-sonnet-5-5');
  assert.ok(haiku && sonnet);
  await ask('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: haiku.consentDigest, apiKey: API_KEY, tiers: ['fast'] });
  const status = await ask('venture.models.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: sonnet.consentDigest, apiKey: API_KEY, tiers: ['main'] }) as StatusView;
  assert.equal(status.tiers.fast.presetId, 'anthropic-haiku-5-5');
  assert.equal(status.tiers.main.presetId, 'anthropic-sonnet-5-5');
  assert.equal(status.replay.active, true);
  assert.equal((await ask('trust.get')).send, 'shape');
  assert.equal((await events()).filter(e => e.name === 'send-policy-changed').length, 1);

  // 6. The interview's opening questions come from the model recording, and the call carried the idea.
  const interview = await ask('venture.interview.next') as InterviewView;
  const q1 = interview.interview.questions.find(q => q.id === 'q_1');
  assert.ok(q1);
  assert.equal(q1.by, 'model');
  assert.equal(q1.kind, 'choice');
  assert.equal(q1.field, 'customer');
  assert.equal(q1.text, 'Who will your first clients be?');
  assert.deepEqual(q1.choices.map(c => c.label), ['Cafes and small restaurants', 'Small shops', 'Freelancers']);
  assert.equal(q1.choices[0].id, 'c_1');
  const interviewCalls = (await calls()).filter(c => c.purpose === 'interview');
  assert.equal(interviewCalls.length, 1);
  assert.ok(interviewCalls[0].payloadText.includes(IDEA));

  // 7. Answers in screen order. 2,499 rupees is 249900 paise; 18 percent is 1800 basis points.
  const answers: [string, Record<string, unknown>][] = [
    ['q_1', { choiceId: 'c_1' }], ['q_2', { text: 'WhatsApp photos and a shared folder' }], ['q_pricing_model', { choiceId: 'monthly' }],
    ['q_price', { amount: '2,499' }], ['q_tax', { yes: true }], ['q_tax_rate', { rate: '18' }],
  ];
  let answered: InterviewView = interview;
  for (const [questionId, answer] of answers) answered = await ask('venture.interview.answer', { questionId, answer }) as InterviewView;
  assert.equal(answered.done, true);
  assert.equal(answered.interview.questions.find(q => q.id === 'q_price')?.answerMinor, '249900');
  assert.equal(answered.interview.questions.find(q => q.id === 'q_tax_rate')?.answerBps, '1800');

  // 8. The plan's words come from the model; its structure, prices and tax come from the owner and the code.
  const drafted = (await ask('venture.blueprint.draft') as BlueprintView).blueprint;
  assert.equal(drafted.source, 'model');
  assert.deepEqual(drafted.name, { value: 'Ledger Cafe Books', label: 'assumption', by: 'model' });
  const offer1 = drafted.offers.find(o => o.id === 'offer_1');
  const offer2 = drafted.offers.find(o => o.id === 'offer_2');
  assert.ok(offer1 && offer2);
  assert.equal(offer1.pricing.unitPriceMinor, '249900');
  assert.equal(offer1.pricing.unitPriceLabel, 'told-by-you');
  assert.equal(offer2.pricing.unitPriceLabel, 'not-set');
  assert.equal(drafted.backOffice.taxRegistered.value, true);
  assert.equal(drafted.backOffice.taxRateBps, '1800');
  assert.equal(drafted.backOffice.taxRateBy, 'country-table');
  for (const id of ['step_1', 'step_2', 'step_4']) {
    const step = drafted.deliverySteps.find(s => s.id === id);
    assert.equal(step?.doneBy, 'you', id);
    assert.equal(step?.capability, 'planned', id);
  }
  const step3 = drafted.deliverySteps.find(s => s.id === 'step_3');
  assert.equal(step3?.doneBy, 'agent-then-you');
  assert.equal(step3?.capability, 'drafts-now');

  // 9. The owner's GSTIN and SAC make it ready for a tax invoice, in a new draft version.
  const updated = (await ask('venture.blueprint.update', { patch: { taxId: GSTIN, sacCode: '998222' } }) as BlueprintView).blueprint;
  assert.equal(updated.status, 'draft');
  assert.ok(updated.version > drafted.version);
  assert.notEqual(updated.digest, drafted.digest);
  assert.equal(updated.backOffice.taxState, '27');
  assert.equal(updated.backOffice.taxInvoiceReady, true);

  // 10. A price receipt for the draft. INR 2,499.00 x 1 month = 249900 paise; GST at 18 percent:
  // (249900 x 1800 + 5000) / 10000 = 449,825,000 / 10000 = 44982; total 249900 + 44982 = 294882 (INR 2,948.82).
  const quote = await ask('venture.price.quote', { offerId: 'offer_1' }) as PriceReceiptRecord;
  assert.equal(figure(quote, 'subtotal').minor, '249900');
  assert.equal(figure(quote, 'tax').minor, '44982');
  assert.equal(figure(quote, 'total').minor, '294882');
  assert.equal(figure(quote, 'total').display, 'INR 2,948.82');
  assert.equal(quote.totalMinor, '294882');
  assert.equal(quote.inputs.blueprintDigest, updated.digest);
  assert.doesNotThrow(() => numberGuard(quote.explanation, quote));

  // 11. Accepting keeps the digest, creates the terms and keeps the draft's receipt current.
  const accepted = (await ask('venture.blueprint.accept', { digest: updated.digest }) as BlueprintView).blueprint;
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.digest, updated.digest);
  const afterAccept = await ask('venture.get') as VentureView;
  assert.ok(afterAccept.terms.length >= 6);
  assert.equal(afterAccept.terms.find(term => term.key === 'offer')?.lifecycle, 'active');
  assert.equal((await ask('venture.blueprint.get') as BlueprintView).offerReceipts.offer_1?.id, quote.id);

  // 12. The build brief: lint passes, prices copied from the receipt, data rules and the UI check included.
  const brief = await ask('venture.build.brief') as BriefRecord;
  assert.equal(brief.lint.ok, true, JSON.stringify(brief.lint.findings));
  assert.equal(brief.wordsBy, 'model');
  assert.ok(brief.markdown.includes('INR 2,948.82'));
  assert.ok(brief.markdown.split('\n')[0].includes(brief.briefId));
  for (const line of RLS_LINES) assert.ok(brief.markdown.includes(line), line);
  assert.ok(brief.markdown.includes('lintapple@0.1.20'));
  assert.equal(brief.markdown.includes('—'), false);

  // 13. Handoff links carry the brief exactly; only the Lovable one is marked opened.
  const lovable = await ask('venture.build.handoff', { builder: 'lovable' }) as HandoffPlan;
  const replit = await ask('venture.build.handoff', { builder: 'replit' }) as HandoffPlan;
  assert.equal(lovable.mode, 'link');
  assert.equal(replit.mode, 'link');
  assert.equal(new URLSearchParams(new URL(lovable.url).hash.slice(1)).get('prompt'), brief.markdown);
  const replitPrompt = new URL(replit.url).search.slice(1).split('&').find(part => part.startsWith('prompt='));
  assert.ok(replitPrompt);
  assert.equal(decompressFromEncodedURIComponent(decodeURIComponent(replitPrompt.slice('prompt='.length))), brief.markdown);
  for (const plan of [lovable, replit]) assert.doesNotMatch(plan.url, /autosubmit/i);
  assert.ok(replit.notes.includes('Replit receives this brief as soon as the page opens.'));
  await ask('venture.build.handoffOpened', { handoffId: lovable.handoffId });
  const handoffs = (await ask('venture.build.status')).handoffs as HandoffRecord[];
  assert.ok(handoffs.find(h => h.id === lovable.handoffId)?.openedAt);
  assert.equal(handoffs.find(h => h.id === replit.handoffId)?.openedAt, null);

  // 14. Follow the build on GitHub, read only, from the recording.
  await ask('venture.build.link', { repo: 'https://github.com/demo-owner/ledger-cafe-books', token: GITHUB_TOKEN });
  const sync = await ask('venture.build.sync') as BuildStatus;
  assert.equal(sync.lastCommit?.by, 'lovable');
  assert.equal(sync.briefMarker, 'found');
  assert.equal(sync.uiWorkflow, 'found');
  assert.equal(sync.checks, 'passed');
  assert.equal(sync.deployment, null);
  assert.equal(sync.syncConflictBranch, null);
  assert.deepEqual(sync.cannotSay, CANNOT_SAY);

  // 15. The connector catalogue claims only what the code does today.
  const cards = await ask('venture.connectors.list', {}) as ConnectorCard[];
  assert.equal(cards.length, 72); // W5 5A6 added six shared connectors
  assert.equal(new Set(cards.map(c => c.category)).size, 12);
  const availableFor = (mode: string) => cards.filter(c => c.modes.some(m => m.mode === mode && m.status === 'available')).map(c => c.id).sort();
  assert.deepEqual(availableFor('handoff'), ['bolt', 'lovable', 'mail-app', 'replit', 'v0']);
  // W5 5A6: the owner's own Make and n8n webhooks write, each send approved.
  assert.deepEqual(availableFor('write'), ['chausar-books', 'chausar-crm', 'make-webhook', 'n8n-webhook']);
  const stripe = cards.find(c => c.id === 'stripe');
  assert.ok(stripe?.chips.includes('planned: handoff') && stripe.chips.includes('planned: write'));
  assert.ok(cards.find(c => c.id === 'github')?.modes.some(m => m.mode === 'read' && m.status === 'available' && m.qualification === 'fixture-tested'));
  assert.ok(cards.find(c => c.id === 'zoho-books')?.modes.some(m => m.mode === 'read' && m.status === 'planned'));
  for (const card of cards) if (card.vendorUrl) assert.ok((EXTERNAL_ORIGINS as readonly string[]).includes(new URL(card.vendorUrl).origin), card.vendorUrl);

  // 16. Rehearse all three practice clients with the model, one per request, each judged. The clean and messy
  // clients send practice files, so their agents read them and reconcile the month with the calculator first.
  await ask('venture.delivery.playbook');
  for (const kind of ['clean', 'messy', 'pushback']) {
    const run = await ask('venture.simulation.run', { scenarioIds: [`bookkeeping-${kind}`] }) as SimulationRunRecord;
    assert.equal(run.passed, true, JSON.stringify(run.episodes.map(e => [e.firstFailure, e.checks.filter(c => !c.passed)])));
    assert.equal(run.modelMode, 'model');
    assert.match(run.costDisplay, /^USD /);
    for (const episode of run.episodes) {
      assert.equal(episode.judge.length, 4);
      assert.ok(episode.judge.every(answer => answer.answer === 'yes'), JSON.stringify(episode.judge));
    }
    const episode = run.episodes[0];
    if (kind === 'pushback') { assert.equal(episode.harness ?? null, null); continue; }
    assert.ok(episode.harness, kind);
    assert.equal(episode.harness.sections, 'report');
    assert.ok(episode.harness.proofs.some(proof => proof.kind === 'reconciled'));
    assert.ok(episode.harness.proofs.some(proof => proof.kind === 'balanced'), 'both practice months balance');
    assert.ok(episode.renderedText?.includes('## Reconciliation'), episode.renderedText ?? '');
    assert.ok(episode.renderedText?.includes(kind === 'clean' ? 'Closing balance on the statement: INR 77,730.00' : 'Closing balance on the statement: INR 61,480.00'));
    const receipt = await ask('venture.work.get', { id: episode.harness.workReceiptIds[0] }) as { operation: string; reconciliation: { matched: unknown[]; unmatchedBank: unknown[]; unmatchedBills: unknown[] } };
    assert.equal(receipt.operation, 'work.reconcile');
    assert.deepEqual([receipt.reconciliation.matched.length, receipt.reconciliation.unmatchedBank.length, receipt.reconciliation.unmatchedBills.length], kind === 'clean' ? [5, 0, 0] : [3, 2, 1]);
    if (kind === 'messy') {
      assert.equal(episode.harness.handoffs.length, 1);
      assert.equal(episode.harness.handoffs[0].answeredBy, 'practice-client');
      assert.ok(episode.turns.some(turn => turn.by === 'agent' && turn.text.startsWith('Question: ')));
    }
  }
  const rehearsed = await ask('venture.launch.status') as LaunchStatus;
  assert.deepEqual(rehearsed.rehearsal.map(r => [r.scenarioId, r.passed, r.judged]).sort(),
    [['bookkeeping-clean', true, true], ['bookkeeping-messy', true, true], ['bookkeeping-pushback', true, true]]);

  // 17. Shadow: practice drafts only.
  assert.equal((await ask('venture.launch.advance', { to: 'shadow' }) as LaunchStatus).stage, 'shadow');

  // 18. A client in Maharashtra and an order. CGST and SGST at 9 percent each:
  // (249900 x 1800 + 10000) / 20000 = 449,830,000 / 20000 = 22491; tax 2 x 22491 = 44982; total 294882.
  const client = await ask('venture.client.add', { name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', stateCode: '27' }) as ClientRecord;
  const order = await ask('venture.order.create', { clientId: client.id, offerId: 'offer_1', quantity: '1', request: REQUEST }) as OrderRecord;
  const orderReceipt = await ask('venture.receipt.get', { id: order.priceReceiptId }) as PriceReceiptRecord;
  assert.equal(orderReceipt.inputs.taxTreatment, 'cgst-sgst');
  assert.equal(figure(orderReceipt, 'cgst').minor, '22491');
  assert.equal(figure(orderReceipt, 'sgst').minor, '22491');
  assert.equal(figure(orderReceipt, 'total').minor, '294882');

  // 19. At shadow, an agent draft waits for the owner to see the exact text before anything is sent.
  const waiting = await ask('venture.delivery.run', { orderId: order.id }) as DeliveryRunRecord;
  assert.equal(waiting.status, 'waiting-for-you');
  assert.equal(waiting.practice, true);
  assert.ok(waiting.preview);
  assert.ok(waiting.preview.payloadText.includes(REQUEST));
  const previewCall = (await calls()).find(c => c.id === waiting.preview?.callId);
  assert.equal(previewCall?.status, 'preview');
  assert.equal(previewCall?.containsClientData, true);

  // 20. Approve the send; the practice draft is ready, every check passed, and it can't be accepted.
  const practice = await ask('venture.delivery.approve', { runId: waiting.id, digest: waiting.preview.digest }) as DeliveryRunRecord;
  assert.equal(practice.status, 'ready-for-review');
  assert.ok(practice.renderedText?.includes('Total: INR 2,948.82'), practice.renderedText ?? '');
  assert.ok(practice.checks.length > 0 && practice.checks.every(c => c.passed), JSON.stringify(practice.checks));
  assert.ok(practice.checks.some(c => c.check === 'no-done-claims'));
  await assert.rejects(ask('venture.delivery.review', { runId: waiting.id, verdict: 'accepted' }), code('PRACTICE_DRAFT'));

  // 21. Approve each: the business is live and a real draft can be accepted.
  assert.equal((await ask('venture.launch.advance', { to: 'approve-each' }) as LaunchStatus).stage, 'approve-each');
  assert.equal((await ask('venture.get') as VentureView).venture.status, 'live');
  const real = await ask('venture.delivery.run', { orderId: order.id }) as DeliveryRunRecord;
  assert.equal(real.practice, false);
  assert.equal(real.status, 'waiting-for-you');
  assert.ok(real.preview);
  await ask('venture.delivery.approve', { runId: real.id, digest: real.preview.digest });
  const reviewed = await ask('venture.delivery.review', { runId: real.id, verdict: 'accepted' }) as DeliveryRunRecord;
  assert.equal(reviewed.status, 'accepted');
  assert.equal((await calls()).find(c => c.id === real.preview?.callId)?.approvedBy, 'owner');

  // 22. Delivered: a sale fact goes into the books.
  const delivered = await ask('venture.order.deliver', { orderId: order.id, deliveredOn: '2026-10-04' }) as OrderRecord;
  assert.equal(typeof delivered.saleFactId, 'string');
  assert.ok(delivered.saleFactId);

  // 23. A tax invoice: CGST and SGST lines of INR 224.91, due 1 October plus 15 days = 16 October.
  const prepared = await ask('venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01', dueInDays: 15 }) as InvoiceView;
  const issued = await ask('venture.invoice.issue', { invoiceId: prepared.invoice.id, digest: prepared.invoice.digest }) as InvoiceView;
  const invoice = issued.invoice;
  assert.equal(invoice.number, 'INV-0001');
  assert.equal(invoice.documentTitle, 'TAX INVOICE');
  assert.deepEqual(invoice.taxLines.map(line => [line.label, line.minor]), [['CGST at 9%', '22491'], ['SGST at 9%', '22491']]);
  assert.equal(invoice.placeOfSupply, 'Maharashtra (27)');
  assert.equal(invoice.supplierTaxId, GSTIN);
  assert.equal(invoice.dueDate, '2026-10-16');
  assert.equal(invoice.totalMinor, '294882');
  assert.ok(issued.documentText.includes('Practice invoice from an experimental Chausar build.'));
  assert.ok(invoice.booksReceiptId, invoice.booksNote ?? 'no books receipt');
  const billedReceipt = await ask('receipts.get', { id: invoice.booksReceiptId });
  assert.equal(billedReceipt.operation, 'billed');
  assert.equal(billedReceipt.totalMinor, '249900');

  // 24. The client pays INR 2,948.82 in full.
  const paid = await ask('venture.payment.record', { invoiceId: invoice.id, amount: '2948.82', receivedOn: '2026-10-05', method: 'upi' }) as InvoiceView;
  assert.equal(paid.invoice.status, 'paid');
  assert.equal(paid.invoice.balanceMinor, '0');
  assert.equal(paid.payments.length, 1);
  assert.ok(paid.payments[0].booksReceiptId, paid.payments[0].booksNote ?? 'no books receipt');
  const receivedReceipt = await ask('receipts.get', { id: paid.payments[0].booksReceiptId });
  assert.equal(receivedReceipt.operation, 'received');
  assert.equal(receivedReceipt.totalMinor, '294882');

  // 25. The books for October: billed and earned leave out tax, received includes it.
  const books = await ask('venture.books.summary', { from: '2026-10-01', to: '2026-10-31' }) as BooksSummary;
  const byOperation = Object.fromEntries(books.figures.map(f => [f.operation, f]));
  assert.deepEqual([byOperation.billed?.minor, byOperation.received?.minor, byOperation.earned?.minor], ['249900', '294882', '249900']);
  assert.deepEqual([byOperation.billed?.label, byOperation.received?.label, byOperation.earned?.label],
    ['Billed (without tax)', 'Received (with tax)', 'Earned (without tax)']);
  for (const books_figure of books.figures) assert.equal((await ask('receipts.get', { id: books_figure.receiptId })).totalMinor, books_figure.minor);
  assert.equal(books.notes[0], 'Billed and earned leave out tax. Received is the cash that came in, tax included.');

  // 26. The old back office sees the new business's books.
  assert.equal((await ask('calculation.run', { operation: 'billed', period: { from: '2026-10-01', to: '2026-10-31' } })).totalMinor, '249900');

  // 27. Every launch step is done.
  const finished = await ask('venture.get') as VentureView;
  assert.equal(finished.done, 12, JSON.stringify(finished.checklist.filter(item => !item.done)));
  assert.equal(finished.total, 12);
  assert.equal(finished.next, null);

  // 28. The event log tells the story in order.
  const names: string[] = (await events()).map(e => e.name);
  let cursor = 0;
  for (const name of ['venture-created', 'retention-changed', 'model-connected', 'send-policy-changed', 'price-quoted', 'blueprint-accepted',
    'brief-ready', 'handoff-prepared', 'handoff-opened', 'repo-synced', 'simulation-finished', 'order-created', 'invoice-issued', 'payment-recorded']) {
    const at = names.indexOf(name, cursor);
    assert.ok(at >= 0, `${name} appears after position ${cursor} in ${names.join(', ')}`);
    cursor = at + 1;
  }

  // 29. What was sent: only recordings, no key or token, client data only in the two approved delivery calls. The judge's
  // call on the draft made at approve each was prepared (prices as placeholders) and waits for the owner: the write
  // turn was approved here, not on Today, so no standing consent was given and nothing went on its own.
  const sent = await calls();
  assert.ok(sent.length > 0);
  for (const call of sent) {
    assert.equal(call.replay, true, call.id);
    for (const secret of [API_KEY, GITHUB_TOKEN, 'Cafe Aroma Demo', 'owner@aroma.example']) assert.equal(call.payloadText.includes(secret), false, `${call.purpose} ${call.id}`);
  }
  const withRequest = sent.filter(call => call.payloadText.includes(REQUEST));
  assert.deepEqual(withRequest.map(call => call.purpose).sort(), ['delivery', 'delivery', 'judge']);
  for (const call of withRequest.filter(item => item.purpose === 'delivery')) assert.equal(call.consent, 'approved-preview');
  const judgeCall = withRequest.find(call => call.purpose === 'judge')!;
  assert.equal(judgeCall.status, 'preview', 'the judge call was never sent');
  assert.equal(judgeCall.approvedBy, null);
  for (const call of sent.filter(c => c.purpose === 'judge')) assert.equal(call.payloadText.includes('2,948.82'), false);

  // 30. The vault holds neither the key nor the token.
  const vaultText = JSON.stringify(engine.vault?.read());
  assert.equal(vaultText.includes(API_KEY), false);
  assert.equal(vaultText.includes(GITHUB_TOKEN), false);

  // 31. Capabilities say what runs where, honestly.
  const capabilities = await ask('venture.capabilities') as CapabilityStatus[];
  const capability = (id: string) => { const found = capabilities.find(c => c.id === id); assert.ok(found, id); return found; };
  assert.equal(capability('tier-wasm').state, process.platform === 'win32' ? 'unavailable' : 'planned');
  assert.deepEqual([capability('tier-container').state, capability('tier-container').reason], ['needs-setup', 'Needs Docker Desktop.']);
  assert.equal(capability('tier-wasm-lite').state, 'available');
  assert.equal(capability('agent-tools').state, 'available');
  assert.equal(capability('tier-hosted').state, 'planned');
  assert.equal(capability('tier-code').group, 'runtime');
  assert.equal(capability('durable-storage').state, 'planned');
});

test('the template path in the United States works with no AI and nothing sent', async t => {
  const { ask } = await newEngine(t, false);
  const idea = 'Bookkeeping for small online shops, done by templates with me checking every report.';

  const preview = await ask('venture.preview', { idea, countryCode: 'US' }) as PlanPreview;
  assert.equal(preview.questions.find(q => q.id === 'q_tax_rate')?.prefill, null);

  await ask('workspace.create', { name: 'Hudson Books', passphrase: PASSPHRASE, pack: 'services' });
  await ask('venture.create', { idea, countryCode: 'US', workingName: 'Hudson Books' });
  assert.equal((await ask('ontology.get')).current.currency, 'USD', 'the dictionary is republished in US dollars');

  const interview = await ask('venture.interview.next', { useTemplate: true }) as InterviewView;
  const ids = interview.interview.questions.map(q => q.id);
  for (const id of ['q_1', 'q_2', 'q_pricing_model', 'q_price', 'q_tax']) assert.ok(ids.includes(id), id);
  assert.equal(interview.interview.questions.find(q => q.id === 'q_1')?.by, 'template');
  const answers: [string, Record<string, unknown>][] = [
    ['q_1', { skipped: true }], ['q_2', { skipped: true }], ['q_pricing_model', { choiceId: 'hourly' }], ['q_price', { amount: '150' }], ['q_tax', { yes: false }],
  ];
  let answered = interview;
  for (const [questionId, answer] of answers) answered = await ask('venture.interview.answer', { questionId, answer }) as InterviewView;
  assert.equal(answered.done, true);

  const draft = (await ask('venture.blueprint.draft') as BlueprintView).blueprint;
  assert.equal(draft.source, 'template');
  // USD 150.00 an hour, 1 hour, no tax: 15000 cents.
  const quote = await ask('venture.price.quote', { offerId: 'offer_1' }) as PriceReceiptRecord;
  assert.equal(quote.totalMinor, '15000');
  assert.equal(quote.inputs.taxTreatment, 'none');
  assert.equal(quote.figures.some(f => ['cgst', 'sgst', 'igst'].includes(f.key) || (f.key === 'tax' && f.minor !== '0')), false);
  await ask('venture.blueprint.accept', { digest: draft.digest });
  const brief = await ask('venture.build.brief') as BriefRecord;
  assert.equal(brief.lint.ok, true, JSON.stringify(brief.lint.findings));
  assert.equal(brief.wordsBy, 'template');

  const presets = await ask('venture.models.presets') as ModelPreset[];
  const templates = presets.find(p => p.id === 'built-in-templates');
  assert.ok(templates);
  await ask('venture.models.connect', { presetId: 'built-in-templates', consentDigest: templates.consentDigest });
  assert.equal((await ask('trust.get')).send, 'nothing');

  const run = await ask('venture.simulation.run', {}) as SimulationRunRecord;
  assert.equal(run.passed, true, JSON.stringify(run.episodes.map(e => e.firstFailure)));
  assert.equal(run.modelMode, 'template');
  assert.equal(run.costMicros, '0');
  for (const episode of run.episodes) {
    assert.ok(episode.checks.every(c => c.passed), JSON.stringify(episode.checks));
    assert.ok(episode.judge.length > 0 && episode.judge.every(answer => answer.answer === 'not-judged'));
  }
  const launch = await ask('venture.launch.status') as LaunchStatus;
  const shadow = launch.stages.find(s => s.stage === 'shadow');
  assert.equal(shadow?.allowed, false);
  assert.equal(shadow?.reason, "Connect an AI and rehearse with it first. Template outlines can't be judged.");
  await assert.rejects(ask('venture.launch.advance', { to: 'shadow' }), code('LAUNCH_STAGE_BLOCKED'));

  // USD 150.00 an hour x 2 hours = 30000 cents, no tax.
  const client = await ask('venture.client.add', { name: 'Hudson Demo Client', countryCode: 'US' }) as ClientRecord;
  const order = await ask('venture.order.create', { clientId: client.id, offerId: 'offer_1', quantity: '2', request: 'Please tidy my October books for the shop.' }) as OrderRecord;
  assert.equal((await ask('venture.receipt.get', { id: order.priceReceiptId }) as PriceReceiptRecord).totalMinor, '30000');

  const outline = await ask('venture.delivery.run', { orderId: order.id }) as DeliveryRunRecord;
  assert.equal(outline.status, 'ready-for-review');
  assert.equal(outline.servedBy, 'template');
  assert.equal(outline.practice, false);
  assert.ok(outline.renderedText?.startsWith(OUTLINE_LINE), outline.renderedText ?? '');
  assert.equal((await ask('venture.delivery.review', { runId: outline.id, verdict: 'accepted' }) as DeliveryRunRecord).status, 'accepted');

  await ask('venture.order.deliver', { orderId: order.id, deliveredOn: '2026-10-04' });
  const prepared = await ask('venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01', dueInDays: 15 }) as InvoiceView;
  const issued = await ask('venture.invoice.issue', { invoiceId: prepared.invoice.id, digest: prepared.invoice.digest }) as InvoiceView;
  assert.equal(issued.invoice.documentTitle, 'INVOICE');
  assert.deepEqual(issued.invoice.taxLines, []);
  assert.equal(issued.invoice.totalMinor, '30000');
  const paid = await ask('venture.payment.record', { invoiceId: issued.invoice.id, amount: '300', receivedOn: '2026-10-05', method: 'card' }) as InvoiceView;
  assert.equal(paid.invoice.status, 'paid');
  const books = await ask('venture.books.summary', { from: '2026-10-01', to: '2026-10-31' }) as BooksSummary;
  const byOperation = Object.fromEntries(books.figures.map(f => [f.operation, f.minor]));
  assert.equal(byOperation.billed, '30000');
  assert.equal(byOperation.received, '30000');

  assert.deepEqual(await ask('venture.models.calls', { limit: 100 }), []);
  assert.equal((await ask('trust.get')).send, 'nothing');
});
