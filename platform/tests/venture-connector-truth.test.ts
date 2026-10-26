// Connector truth (4J7, K6): every mode carries a rung of the truth ladder under its qualification, worked out from
// this build and this business's records; no mode claims write-verified without a real write that was read back; each
// connector has a capability set, and a field outside it is refused, never dropped; the act task's first turn lists the
// run's capabilities on and off; no posting tool is ever in a run's grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_NAMES } from '../runtime/venture/contracts.ts';
import type { ConnectorCard, ToolName, VentureDeps } from '../runtime/venture/contracts.ts';
import { CONNECTOR_CATALOGUE } from '../runtime/venture/build/catalogue.ts';
import { connectorCard } from '../runtime/venture/build/connectors.ts';
import {
  CONNECTOR_CAPABILITIES, LADDER_RUNGS, NO_EVIDENCE, checkConnectorFields, connectorEvidence, mailboxConnectorOf, modeLadder, postingLadder,
  runCapabilities, withTruth,
} from '../runtime/venture/build/connector-truth.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { actTask, newHarnessState } from '../runtime/venture/delivery/harness/loop.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { code, owner, setup } from './venture-views-env.ts';

const list = (deps: VentureDeps) => build['venture.connectors.list']!(deps, owner, {}) as Promise<ConnectorCard[]>;

test('every mode of every card carries a ladder rung; planned is documented, available is discovered without evidence', async () => {
  const env = await setup();
  const cards = await list(env.deps);
  assert.ok(cards.length >= CONNECTOR_CATALOGUE.length);
  for (const card of cards) {
    for (const mode of card.modes) {
      assert.ok(mode.ladder, `${card.id} ${mode.mode} has a rung`);
      assert.equal(mode.ladder, mode.status === 'planned' ? 'documented' : 'discovered', `${card.id} ${mode.mode}`);
    }
    for (const option of card.postingOptions) assert.ok(option.ladder, `${card.id} ${option.mode}`);
    assert.ok(Array.isArray(card.capabilities), card.id);
  }
  // Nothing on a new business claims a real write or a real read.
  assert.equal(cards.some(card => [...card.modes, ...card.postingOptions].some(mode => mode.ladder === 'write-verified' || mode.ladder === 'read-verified')), false);
  assert.deepEqual(LADDER_RUNGS, ['documented', 'discovered', 'read-verified', 'write-verified']);
});

test('a write mode is write-verified only with a recorded write read back; reads climb on a real read only', () => {
  const github = connectorCard(CONNECTOR_CATALOGUE.find(item => item.id === 'github')!, false);
  const books = connectorCard(CONNECTOR_CATALOGUE.find(item => item.id === 'chausar-books')!, false);
  const read = { mode: 'read' as const, status: 'available' as const };
  const write = { mode: 'write' as const, status: 'available' as const };
  assert.equal(modeLadder('github', read, NO_EVIDENCE), 'discovered');
  assert.equal(modeLadder('github', read, { reads: new Set(['github']), writes: new Set() }), 'read-verified');
  // A read never lifts a write mode; only a confirmed post through one of its posting modes does. A planned write stays
  // documented whatever is recorded.
  assert.equal(modeLadder('chausar-books', write, { reads: new Set(['chausar-books']), writes: new Set() }), 'discovered');
  assert.equal(modeLadder('linkedin', write, { reads: new Set(), writes: new Set(['linkedin:owner-browser-session']) }), 'write-verified');
  assert.equal(modeLadder('linkedin', write, { reads: new Set(), writes: new Set(['linkedin:api']) }), 'write-verified');
  assert.equal(modeLadder('linkedin', write, { reads: new Set(), writes: new Set(['linkedin:write']) }), 'discovered', 'no post is ever keyed :write');
  assert.equal(modeLadder('github', { mode: 'write', status: 'planned' }, { reads: new Set(['github']), writes: new Set(['github:owner-browser-session']) }), 'documented');
  // On the hosted server, what is read on this computer can't run at all.
  for (const id of ['tally', 'zoho-mail', 'google-workspace', 'google-calendar']) assert.equal(modeLadder(id, read, { reads: new Set([id]), writes: new Set() }, true), 'unavailable', id);
  assert.equal(modeLadder('github', read, NO_EVIDENCE, true), 'discovered');
  // A handoff opens the owner's own app: no read of the platform ever proves it.
  assert.equal(modeLadder('lovable', { mode: 'handoff', status: 'available' }, { reads: new Set(['lovable']), writes: new Set() }), 'discovered');
  assert.equal(withTruth(github, NO_EVIDENCE).modes.find(mode => mode.mode === 'read')!.ladder, 'discovered');
  assert.equal(withTruth(books, NO_EVIDENCE).modes.every(mode => mode.ladder !== 'write-verified'), true);
  // Posting: the browser on the hosted server, or a video platform, can't run here at all.
  assert.equal(postingLadder('linkedin', { mode: 'owner-browser-session', status: 'planned', reason: 'x' }, NO_EVIDENCE, true), 'unavailable');
  assert.equal(postingLadder('youtube', { mode: 'owner-browser-session', status: 'planned', reason: 'Posting a picture or video through the browser is not built yet.' }, NO_EVIDENCE), 'unavailable');
  assert.equal(postingLadder('linkedin', { mode: 'api', status: 'planned', reason: 'review' }, NO_EVIDENCE), 'documented');
  assert.equal(postingLadder('linkedin', { mode: 'owner-browser-session', status: 'available', reason: null }, NO_EVIDENCE), 'discovered');
  assert.equal(postingLadder('linkedin', { mode: 'owner-browser-session', status: 'available', reason: null }, { reads: new Set(), writes: new Set(['linkedin:owner-browser-session']) }), 'write-verified');
});

const row = (connectorId: string, outcome: 'answered' | 'failed' | 'skipped') => ({ connectorId, outcome, line: 'x', account: null, expiresOn: null });
const post = (state: string, outcome: unknown) => ({ connectorId: 'x', mode: 'owner-browser-session', state, outcome, journal: [] });

test('evidence comes from records: a live GitHub read, a statement import, an answered mailbox or calendar, a platform-confirmed post', async () => {
  const env = await setup();
  const ventureId = env.venture.id;
  assert.deepEqual([...connectorEvidence(env.store.read(), ventureId).reads], []);
  await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx => {
    // An answered row for a connector with no live read of its own (the bank consent, TallyPrime) proves nothing.
    tx.put({ ...tx.base('venture-connector-check'), rows: [row('tally', 'answered'), row('bank-account', 'answered'), row('zoho-books', 'failed')] });
    tx.put({ ...tx.base('venture-build-read'), repo: { owner: 'a', name: 'b' }, calls: [{ path: '/repos/a/b', status: 200, etag: null, bodyDigest: 'x', fetchedAt: tx.now }], transport: 'fixture' } as never);
    tx.put({ ...tx.base('venture-connector-post'), ...post('outcome_unknown', null) } as never);
    tx.put({ ...tx.base('venture-connector-post'), ...post('applied', { line: 'I found it', url: 'https://x.com/a/status/1', by: 'owner' }) } as never);
    tx.put({ ...tx.base('venture-connector-post'), ...post('applied', { line: 'Posted', url: null, by: 'platform' }) } as never);
  });
  const evidence = connectorEvidence(env.store.read(), ventureId);
  assert.deepEqual([...evidence.reads], [], 'answered rows with no read behind them, a failed row and a recorded GitHub read prove nothing');
  assert.deepEqual([...evidence.writes], [], "a post that may have gone out, the owner's \"I found it\" and one with no address prove nothing");
  await ventureAction(env.deps, owner, 'prepare', 'seed.evidence2', tx => {
    tx.put({ ...tx.base('venture-build-read'), repo: { owner: 'a', name: 'b' }, calls: [{ path: '/repos/a/b', status: 200, etag: null, bodyDigest: 'x', fetchedAt: tx.now }], transport: 'github-api' } as never);
    tx.put({ ...tx.base('venture-bank-import'), accountId: 'bank_1', fileDigest: 'f', transactions: [] } as never);
    tx.put({ ...tx.base('venture-connector-post'), ...post('applied', { line: 'Posted', url: 'https://x.com/a/status/2', by: 'platform' }) } as never);
  });
  const later = connectorEvidence(env.store.read(), ventureId);
  assert.deepEqual([...later.reads].sort(), ['bank-account', 'github']);
  assert.deepEqual([...later.writes], ['x:owner-browser-session']);
  const cards = await list(env.deps);
  assert.equal(cards.find(card => card.id === 'github')!.modes.find(mode => mode.mode === 'read')!.ladder, 'read-verified');
  assert.equal(cards.find(card => card.id === 'tally')!.modes.find(mode => mode.mode === 'read')!.ladder, 'discovered');
  // The newest check's failed GitHub row takes the read away until a read answers again.
  await ventureAction(env.deps, owner, 'prepare', 'seed.evidence3', tx => { tx.put({ ...tx.base('venture-connector-check'), rows: [row('github', 'failed')] }); });
  assert.equal(connectorEvidence(env.store.read(), ventureId).reads.has('github'), false);
});

test("the mailbox reads verify Zoho Mail or Gmail only by the server's name; the calendar feed verifies Google Calendar", async () => {
  const env = await setup();
  const ventureId = env.venture.id;
  await ventureAction(env.deps, owner, 'prepare', 'seed.mail', tx => {
    tx.put({ ...tx.base('venture-mailbox'), host: 'imap.zoho.in', port: 993, user: 'me@cafe.example', status: 'connected', uidValidity: null, cursor: null, lastSync: null, line: 'x' } as never);
    tx.put({ ...tx.base('venture-connector-check'), rows: [row('mailbox', 'answered')] });
    // A read recorded with no outcome (written before outcomes were kept) proves nothing; whatever its line says.
    tx.put({ ...tx.base('venture-calendar-feed'), host: 'calendar.google.com', status: 'set', lastRead: tx.now, digest: 'd', line: 'Read 3 meetings.', events: [] } as never);
  });
  assert.deepEqual([...connectorEvidence(env.store.read(), ventureId).reads].sort(), ['zoho-mail']);
  await ventureAction(env.deps, owner, 'prepare', 'seed.feed-read', tx => {
    const feed = tx.list('venture-calendar-feed')[0];
    tx.replace({ ...feed, lastOutcome: 'answered' } as never);
  });
  assert.deepEqual([...connectorEvidence(env.store.read(), ventureId).reads].sort(), ['google-calendar', 'zoho-mail']);
  const cards = await list(env.deps);
  const read = (id: string) => cards.find(card => card.id === id)!.modes.find(mode => mode.mode === 'read')!;
  assert.deepEqual([read('zoho-mail').status, read('zoho-mail').ladder], ['available', 'read-verified']);
  assert.deepEqual([read('google-workspace').status, read('google-workspace').ladder], ['available', 'discovered'], 'a Zoho server says nothing about Gmail');
  assert.deepEqual([read('google-calendar').status, read('google-calendar').ladder], ['available', 'read-verified']);
  assert.equal(cards.find(card => card.id === 'google-workspace')!.modes.find(mode => mode.mode === 'write')!.ladder, 'documented', 'sending from Gmail stays planned');
  const hosted = await list({ ...env.deps, host: 'hosted-web' });
  for (const id of ['zoho-mail', 'google-workspace', 'google-calendar', 'tally']) {
    assert.equal(hosted.find(card => card.id === id)!.modes.find(mode => mode.mode === 'read')!.ladder, 'unavailable', id);
  }
  assert.equal(mailboxConnectorOf('imap.gmail.com'), 'google-workspace');
  assert.equal(mailboxConnectorOf('imap.mail.example'), null);
  // A failed morning read takes the calendar's read away; a mailbox disconnected since its answered row reads nothing.
  await ventureAction(env.deps, owner, 'prepare', 'seed.after', tx => {
    tx.replace({ ...tx.list('venture-calendar-feed')[0], lastOutcome: 'failed', line: 'Read 3 meetings.' } as never);
    tx.replace({ ...tx.list('venture-mailbox')[0], status: 'disconnected' } as never);
  });
  assert.deepEqual([...connectorEvidence(env.store.read(), ventureId).reads], []);
});

test('each connector has a capability set; a field outside it is CONNECTOR_FIELD_UNSUPPORTED, naming the field', () => {
  for (const id of Object.keys(CONNECTOR_CAPABILITIES)) assert.ok(CONNECTOR_CATALOGUE.some(item => item.id === id), `${id} is a catalogue connector`);
  // Only connectors with a working mode take any operation at all.
  for (const card of CONNECTOR_CATALOGUE.map(item => connectorCard(item, false))) {
    const works = card.modes.some(mode => mode.status === 'available') || card.postingOptions.some(option => option.status === 'available');
    if (!works && !['linkedin', 'x'].includes(card.id)) assert.equal(CONNECTOR_CAPABILITIES[card.id], undefined, card.id);
  }
  checkConnectorFields('bank-account', 'import-statement', ['csv', 'account']);
  assert.throws(() => checkConnectorFields('bank-account', 'import-statement', ['csv', 'account', 'password']), (error: any) => {
    assert.equal(error.code, 'CONNECTOR_FIELD_UNSUPPORTED');
    assert.match(error.message, /"password"/);
    return true;
  });
  // The browser posts from whoever signed in, so it takes the text only: an account is refused, never dropped.
  checkConnectorFields('linkedin', 'post', ['text']);
  assert.deepEqual(CONNECTOR_CAPABILITIES.linkedin[0].fields, ['text']);
  assert.equal(Object.hasOwn(CONNECTOR_CAPABILITIES.linkedin[0], 'labelOnly'), false);
  assert.throws(() => checkConnectorFields('linkedin', 'post', ['text', 'account']), code('CONNECTOR_FIELD_UNSUPPORTED'));
  assert.throws(() => checkConnectorFields('x', 'post', ['text', 'image']), code('CONNECTOR_FIELD_UNSUPPORTED'));
  assert.throws(() => checkConnectorFields('zoho-books', 'read-books', []), code('CONNECTOR_FIELD_UNSUPPORTED'));
  checkConnectorFields('zoho-mail', 'read-inbox', ['host', 'port', 'user', 'appPassword']);
  checkConnectorFields('google-calendar', 'read-feed', ['url']);
});

test('the entry points that send to a connector check its fields against the capability set', async () => {
  const { readFile } = await import('node:fs/promises');
  const at = (path: string) => readFile(new URL(`../runtime/venture/${path}`, import.meta.url), 'utf8');
  for (const [path, call] of [
    ['build/bank-methods.ts', "checkConnectorFields('bank-account', 'import-statement'"], ['build/github.ts', "checkConnectorFields('github', 'read-repo'"],
    ['build/handoff.ts', 'checkConnectorFields(builder'], ['build/posting.ts', "checkConnectorFields(connectorId, 'post'"],
    ['network/mailbox.ts', "checkConnectorFields(inbox, 'read-inbox'"], ['network/calendar-feed.ts', "checkConnectorFields('google-calendar', 'read-feed'"],
  ] as const) assert.ok((await at(path)).includes(call), `${path} calls ${call}`);
});

test("the act task's first turn lists capabilities on and off; later turns do not repeat it", () => {
  const grant: ToolName[] = ['files.list', 'files.read', 'sandbox.python', 'agent.delegate', 'handoff.owner'];
  const limits = { maxTurns: 6, maxToolCalls: 20, maxCallsPerTurn: 4, maxCostMicros: '1000000' } as never;
  const ctx = {
    serviceType: 'bookkeeping', offer: { name: 'Books', description: 'Monthly books' }, clientRequest: 'Close my books.', playbook: { steps: [] },
    dictionaryManifest: '', files: [], containsClientData: false, allowed: [], host: 'hosted-web', delegate: [],
  } as never;
  const state = newHarnessState(grant, limits, []);
  const task = actTask(ctx, state);
  const capabilities = (task.input as Record<string, any>).capabilities;
  assert.ok(capabilities, 'the first turn carries the list');
  assert.deepEqual(capabilities.on, ['files.list', 'files.read', 'handoff.owner']);
  assert.deepEqual(capabilities.off.map((item: any) => item.tool), ['sandbox.python', 'agent.delegate']);
  for (const item of capabilities.off) assert.ok(item.why.length > 10, item.tool);
  const later = actTask(ctx, { ...state, used: { ...state.used, turns: 1 } });
  assert.equal((later.input as Record<string, any>).capabilities, undefined);
  // The plain shape, for any caller.
  assert.deepEqual(runCapabilities(['files.read', 'agent.delegate'], ['files.read'], () => null).off, [{ tool: 'agent.delegate', why: 'It is not offered on this run.' }]);
});

test('no agent tool posts, so a posting tool is never in a run grant, signed in or not', () => {
  const posting = (name: string) => /^(posting|post|publish|linkedin|x|instagram)\./.test(name) || /\.(post|publish|upload)$/.test(name);
  assert.equal(TOOL_NAMES.some(posting), false, TOOL_NAMES.filter(posting).join(', '));
});

test('K18: a report link in a draft must be one a tool result or the owner gave, copied verbatim', async () => {
  const { checkReceipts, sourcesFromRun } = await import('../runtime/venture/delivery/judge/claim-check.ts');
  // W2 2F's monthly report: the top post's address comes from the client's export, inside the work receipt.
  const link = 'https://www.linkedin.com/feed/update/urn:li:activity:7381';
  const sources = sourcesFromRun({ receipts: [{ id: 'receipt_w1', explanation: 'social.report over the LinkedIn export', figures: [{ label: 'Top post by engagements', display: `${link} (52 engagements)` }] }] });
  const owner = { url: 'https://cafe-aroma.example/menu', digest: null, sourceId: 'owner' };
  const references = (text: string) => checkReceipts(text, { sources, links: [owner] }, { references: true }).references.filter(item => item.kind === 'link');
  assert.deepEqual(references(`The top post was ${link}.`).map(item => item.found), [true]);
  assert.deepEqual(references('Read the menu at https://cafe-aroma.example/menu.').map(item => item.found), [true]);
  // One the agent built, or changed by a character, is not held.
  assert.deepEqual(references('The top post was https://www.linkedin.com/feed/update/urn:li:activity:7382.').map(item => item.found), [false]);
  assert.deepEqual(references('See https://www.linkedin.com/company/cafe-aroma/posts for more.').map(item => item.found), [false]);
});
