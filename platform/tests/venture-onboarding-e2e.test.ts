// P-e2e-docs (onboarding v2): connect an AI first, let it read About you, keep the business with no passphrase, then
// the journey as before, through the real Engine with demo mode, experimental file storage and a temp folder. The one
// model answer is hand-written here (a synthetic recording), and GitHub answers from the existing recording in
// fixtures/venture/e2e/github-sync.json; no network.
import { formatMoney } from '../runtime/owner-format.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { numberGuard } from '../runtime/calculator.ts';
import { formatMinor } from '../runtime/currency.ts';
import type {
  BlueprintView, BriefRecord, BuildStatus, ClientRecord, InvoiceView, ModelCallRecord, ModelPreset, ModelReplayFixture,
  ModelStatusView, OrderRecord, PlaybookRecord, PriceReceiptRecord, SimulationRunRecord, VentureView,
} from '../runtime/venture/contracts.ts';
import { AI_OPTION_IDS, AI_OPTION_WORDS } from '../runtime/venture/onboarding-contracts.ts';
import type { AiOptionsView, AiStatusView } from '../runtime/venture/onboarding-contracts.ts';
import { createReplayTransport } from '../runtime/venture/models/index.ts';
import { createFixtureGitHubTransport } from '../runtime/venture/build/index.ts';
import { memoryDeviceKeyStore, type DeviceKeyStore } from '../runtime/device-custody.ts';
import type { BackupView, BusinessList, CustodyView } from '../runtime/workspace-custody-contracts.ts';
import { answerInterview } from './fixtures/venture/compose-unit/harness.ts';
import { anthropicEntry } from './fixtures/venture/compose-unit/plans.ts';

const KEY = ("sk" + "-ant-test-onboarding-e2e-not-a-real-key-5d21");
const GITHUB_TOKEN = 'github_pat_test_not_a_real_token_00';
const githubRecording = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/github-sync.json', import.meta.url), 'utf8'));

/** What the owner says on About you, and the AI's reading of it: the one model call, made before any vault. */
const ABOUT = 'I walk dogs for busy nurses in Leeds while they are on shift. Weekly walks and holiday cover.';
const READ = {
  familyId: 'local-services', countryCode: null, evidence: null,
  offers: [{ name: 'Weekly walks', line: 'Regular walks on the days you work.' }, { name: 'Holiday cover', line: 'Daily visits while you are away.' }],
};
const RECORDING: ModelReplayFixture = {
  label: 'synthetic recording', note: 'A hand-written About you answer for the onboarding journey. No paid call was made.',
  responses: [anthropicEntry('decide', READ, [ABOUT, 'familyId', 'untrusted'])],
};
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };

/** options.keys composes the engine the way server.ts does (workspaceCustody), with an in-memory key store in place of
 * the operating system's, so Keep this plan can make the vault with no passphrase. */
async function newEngine(t: any, fixture: ModelReplayFixture, options: { directory?: string; keys?: DeviceKeyStore } = {}) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'chausar-onboarding-e2e-'));
  const engine = new Engine({
    directory, demo: true, storage: 'experimental-file',
    venture: {
      host: 'test', modelTransport: createReplayTransport(fixture),
      // The existing GitHub recording; its AGENTS.md carries the id of the newest brief.
      githubTransport: store => createFixtureGitHubTransport(githubRecording, () => ({
        briefId: [...store.read().conversations].reverse().find((r: any) => r.kind === 'venture-brief')?.briefId ?? '' })),
      // Docker is absent here, so no container command runs.
      sandbox: { process: async () => { throw new Error('docker not found'); } },
    },
    ...(options.keys ? { workspaceCustody: { deviceKeys: options.keys, autoBackups: true } } : {}),
  });
  t.after(async () => { await engine.close().catch(() => {}); if (!options.directory) await rm(directory, { recursive: true, force: true }); });
  const ask = (method: string, payload: Record<string, unknown> = {}): Promise<any> => engine.request(method, payload);
  return { engine, ask, directory };
}

async function filesUnder(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(path)); else out.push(path);
  }
  return out;
}

/** The key is in no file under the engine's folder, in no call record (payload or error) and in no vault record. */
async function assertKeyNowhere(engine: Engine, directory: string, calls: ModelCallRecord[]) {
  for (const file of await filesUnder(directory)) assert.equal((await readFile(file)).includes(KEY), false, file);
  assert.equal(JSON.stringify(calls).includes(KEY), false, 'no call record holds the key');
  if (engine.vault) assert.equal(JSON.stringify(engine.vault.read()).includes(KEY), false, 'no vault record holds the key');
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

test('onboarding end to end: connect first, read About you, keep the business with no passphrase, then plan, price, accept, build, rehearse, invoice and open it again', async t => {
  const keys = memoryDeviceKeyStore();
  const { engine, ask, directory } = await newEngine(t, RECORDING, { keys });

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

  // 2. About you: the connected AI reads the owner's words (quick work) and suggests offers, with no price in them.
  const read = await ask('venture.about.read', { text: ABOUT });
  assert.deepEqual([read.source, read.family.id, read.offers], ['ai', 'local-services', READ.offers]);
  assert.equal(read.idea, ABOUT, 'the plan starts from the owner\'s own words');
  assert.equal(engine.vault, null, 'nothing is saved yet');

  // 3. Keep this plan: no passphrase and no folder. The engine names the folder from the business and this computer's
  // key store keeps the vault key; then venture.create adopts the AI and the call it made.
  const created = await ask('workspace.create', { name: 'Night Shift Walkers', pack: 'services', folder: null });
  assert.deepEqual([created.folder, created.unlock, created.recoveryCode, created.recoveryKit], ['night-shift-walkers', 'this-computer', null, null]);
  assert.equal(keys.items(), 1, 'the key store holds one computer secret');
  assert.equal((await ask('workspace.status')).unlock, 'this-computer');
  const view = await ask('venture.create', { idea: read.idea, countryCode: 'GB', workingName: 'Night Shift Walkers' }) as VentureView;
  assert.equal(view.venture.workingName, 'Night Shift Walkers');
  await assert.rejects(ask('venture.ai.status'), code('VENTURE_EXISTS'));
  // About you's list of fields is read after setup too (Settings, About you); it was refused here until 15 Nov 2026.
  assert.ok((await ask('venture.about.families')).families.length > 0);
  const status = await ask('venture.models.status') as ModelStatusView;
  const live = status.connections.filter(connection => connection.status === 'connected');
  assert.deepEqual(live.map(connection => connection.presetId).sort(), ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5']);
  assert.ok(live.every(connection => connection.keyLoaded), 'the key moved to the vault host shelf, in memory');
  assert.equal((await ask('trust.get')).send, 'shape');
  const sent = await ask('venture.models.calls', { limit: 100 }) as ModelCallRecord[];
  assert.deepEqual(sent.map(call => [call.id, call.purpose]), [[read.callId, 'decide']], 'What was sent lists the call made before the vault');
  for (const call of sent) {
    assert.equal(call.payloadText.includes(KEY), false);
    assert.equal(call.containsClientData, false);
    assert.equal(call.replay, true);
  }
  await assertKeyNowhere(engine, directory, sent);

  // 4. The first plan is the card About you showed: version 1, in the AI's words, with no price until the owner types
  // one. GBP 18 and GBP 60.50, not VAT registered. Prices become receipts, then accept.
  await answerInterview(engine);
  const card = { name: 'Night Shift Walkers', by: 'model', callId: read.callId, offers: read.offers };
  const v1 = (await ask('venture.blueprint.draft', { useTemplate: true, shown: card }) as BlueprintView).blueprint;
  assert.deepEqual([v1.version, v1.source, v1.status], [1, 'model', 'draft']);
  assert.deepEqual(v1.offers.map(offer => [offer.id, offer.name.value, offer.pricing.unitPriceMinor]), [['offer_1', 'Weekly walks', null], ['offer_2', 'Holiday cover', null]]);
  const priced = (await ask('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', unitPrice: '18' }, { id: 'offer_2', unitPrice: '60.50' }] } }) as BlueprintView).blueprint;
  assert.deepEqual(priced.offers.map(offer => [offer.pricing.unitPriceMinor, offer.pricing.unitPriceLabel]), [['1800', 'told-by-you'], ['6050', 'told-by-you']]);
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
  const accepted = (await ask('venture.blueprint.accept', { digest: priced.digest }) as BlueprintView).blueprint;
  assert.equal(accepted.status, 'accepted');

  // 5. Build and run. The brief copies the price from its receipt.
  const brief = await ask('venture.build.brief', { useTemplate: true }) as BriefRecord;
  assert.equal(brief.lint.ok, true, JSON.stringify(brief.lint.findings));
  assert.ok(brief.markdown.includes(formatMoney('1800', 'GBP')), 'the price is copied from the receipt');

  // Follow the build on GitHub, read only, from the existing recording (its repo name is the recording's, not this plan's).
  await ask('venture.build.link', { repo: 'https://github.com/demo-owner/ledger-cafe-books', token: GITHUB_TOKEN });
  const sync = await ask('venture.build.sync') as BuildStatus;
  assert.deepEqual([sync.lastCommit?.by, sync.briefMarker, sync.uiWorkflow, sync.checks], ['lovable', 'found', 'found', 'passed']);

  const playbook = await ask('venture.delivery.playbook') as PlaybookRecord;
  assert.equal(playbook.steps.find(step => step.id === 'draft')!.title, accepted.deliverySteps[2].title.value, 'the drafting step is the plan\'s third step');

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
  // B2: the invoice leaves the app in the exact form; the receipt's figures name the same amounts in minor units.
  const receiptDisplays = new Set(orderReceipt.figures.map(figure => formatMinor(figure.minor, 'GBP')));
  for (const amount of amounts) assert.ok(receiptDisplays.has(amount), `${amount} comes from the receipt`);

  // numberGuard on the invoice text. The whole text also holds the invoice number, the issue and due dates and the
  // receipt id, which are not money and never in a price receipt, so the guard runs on the money lines between the two
  // rules, and the lines outside them are checked to hold no money at all.
  const sections = issued.documentText.split(/^-{8,}$/m);
  assert.equal(sections.length, 3, 'the invoice has a header, money lines and a footer');
  assert.ok(sections[1].includes(formatMinor('1800', 'GBP')));
  assert.equal(numberGuard(sections[1], orderReceipt).accepted, true);
  for (const outside of [sections[0], sections[2]]) assert.doesNotMatch(outside, /GBP/, 'no money outside the guarded lines');

  // At the end of the journey: no file, call record or vault record holds the key.
  await assertKeyNowhere(engine, directory, await ask('venture.models.calls', { limit: 100 }) as ModelCallRecord[]);

  // Accepting the plan and issuing the invoice were important changes, so an automatic backup is due; the engine
  // writes one when it shuts down. A new engine on the same folder (a restart) lists the business by name and opens it from
  // the list with no passphrase and no folder typed, with the invoice still there.
  const custody = await ask('workspace.custody.get') as CustodyView;
  assert.deepEqual([custody.business?.unlock, custody.business?.recovery, custody.business?.backups.auto], ['this-computer', 'not-made', true]);
  await engine.shutdown();
  const again = await newEngine(t, RECORDING, { directory, keys });
  const listed = await again.ask('workspace.list') as BusinessList;
  assert.deepEqual(listed.businesses.map(business => [business.name, business.folder, business.opens]), [['Night Shift Walkers', 'night-shift-walkers', 'with-this-computer']]);
  const backups = await again.ask('workspace.backups.list') as { backups: BackupView[] };
  assert.ok(backups.backups.some(backup => backup.kind === 'auto'), 'an automatic backup was written');
  await again.ask('workspace.open', { folder: listed.businesses[0].folder });
  const invoices = await again.ask('venture.invoice.list') as InvoiceView['invoice'][];
  assert.ok(invoices.some(invoice => invoice.id === issued.invoice.id), 'the issued invoice is still there');
});
