import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Context, Fact } from '../runtime/contracts.ts';
import { linkDigest, macMatches, parseCard } from '../runtime/ca-enterprise/card.ts';

// Synthetic businesses, customers and amounts only.
const passphrase = 'Synthetic-ca-client-fixture';
const linkCode = 'QWERTYUPASDFGHJK';
const wording = { version: 'v-test', text: 'Synthetic consent wording for tests.' };
const noon = Date.parse('2026-10-15T06:30:00.000Z'); // India date 2026-10-15; close month 2026-09
const code = (name: string) => (e: any) => { assert.equal(e.code, name, e.message); return true; };
const customers = ['Zephyrine Quillon Traders', 'Marigold Vexley Stores'];
const amounts = ['918273645', '827364519', '736451928'];
function fact(id: string, sourceId: string, kind: string, validFrom: string, fields: Record<string, unknown>): Fact {
  return { id, entityId: id, sourceId, sourceRow: 1, kind, validFrom, validTo: null, learnedAt: '2026-10-10T09:00:00.000Z', supersededAt: null, fields, branch: 'main' };
}
function envelope(id: string, sourceId: string, group: string, operation: string, status: string, period: { from: string; to: string }) {
  return { id, connectionId: null, sourceId, company: 'main', branch: 'main', group, operation, recipeId: `${group}.${operation}`, recipeVersion: '1', recipeDigest: '', road: 'file',
    fetchedAt: '2026-10-12T08:00:00.000Z', requestedPeriod: period, period: status === 'accepted' ? period : null, status, refusal: status === 'accepted' ? null : { code: 'SYNTHETIC_REFUSAL', reason: 'Synthetic.' },
    abstention: null, checks: [], observed: { rowCount: 1, total: '0', unit: 'INR' }, sourceTotals: null, unmappedFields: [], excludedRows: 0, contentHash: id, sensitivity: 'financial', notices: [],
    read: null, pending: null, committed: status === 'accepted' ? { importId: `import-${id}`, at: '2026-10-12T08:00:00.000Z', rows: 1, duplicate: false } : null, createdBy: 'owner' };
}

async function fixture(t: any, options: { wording?: unknown; wordingFile?: string; demoWorkspace?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ca-client-'));
  const moduleOptions: Record<string, unknown> = { clock: () => noon };
  if (options.wording !== undefined) moduleOptions.consentWording = options.wording;
  if (options.wordingFile !== undefined) moduleOptions.consentWordingFile = options.wordingFile;
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'ca-enterprise': moduleOptions } });
  const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function call(method: string, payload: any = {}) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: any = {}) { const r = await call(method, payload); assert.equal(r.status, 200, `${method}: ${JSON.stringify(r.body.error)}`); return r.body.result; }
  const fails = async (method: string, payload: any, expected: string) => { const r = await call(method, payload); assert.equal(r.body.error?.code, expected, `${method}: ${JSON.stringify(r.body)}`); };
  await rpc('workspace.create', { name: 'Synthetic client shop', passphrase, demo: options.demoWorkspace === true });
  const as = (ctx: Context, method: string, payload: any = {}) => engine.requestAs(ctx, method, payload);
  async function seat(seat: 'ca' | 'accountant', name: string, endsOn?: string): Promise<Context> {
    const invited = await rpc('trustx.invite', { seat, name, ...(endsOn ? { endsOn } : {}) }); assert.equal(invited.state, 'applied');
    const accepted = await rpc('auth.accept', { token: invited.invite.token }); return { ...accepted.context, channel: 'desktop' };
  }
  async function member(name: string, role: string): Promise<Context> {
    const invite = await rpc('auth.invite', { name, role }); const accepted = await rpc('auth.accept', { token: invite.token }); return { ...accepted.context, channel: 'desktop' };
  }
  return { engine, store: engine.vault!, rpc, call, fails, as, seat, member, directory };
}

test('consent waits for the founder\'s wording in a real workspace', async t => {
  const f = await fixture(t);
  let status = await f.rpc('castatus.get');
  assert.deepEqual(status, { link: null, consent: null, wording: { version: 'pending', approved: false, text: null }, lastCardAt: null });
  await f.fails('castatus.consent', { agree: true, version: 'pending' }, 'CA_NOT_LINKED');
  await f.fails('castatus.card', {}, 'CA_NOT_LINKED');
  await f.fails('castatus.link', { firmName: 'Synthetic and Co', code: 'lowercase-code!!' }, 'CA_LINK_CODE_INVALID');
  await f.fails('castatus.link', { firmName: '', code: linkCode }, 'CA_REQUEST_INVALID');
  await f.fails('castatus.link', { firmName: 'Synthetic and Co', code: linkCode, extra: 1 }, 'CA_REQUEST_INVALID');
  const linked = await f.rpc('castatus.link', { firmName: 'Synthetic and Co', code: linkCode });
  assert.equal(linked.firmName, 'Synthetic and Co');
  await f.fails('castatus.consent', { agree: true, version: 'pending' }, 'CA_CONSENT_WORDING_PENDING');
  await f.fails('castatus.consent', { agree: true, version: 'draft-unapproved' }, 'CA_CONSENT_WORDING_PENDING');
  await f.fails('castatus.card', {}, 'CA_NO_CONSENT');
  assert.deepEqual(await f.rpc('castatus.consent', { agree: false, version: 'pending' }), { consent: null });
  status = await f.rpc('castatus.get');
  assert.equal(status.link.firmName, 'Synthetic and Co'); assert.equal(status.consent, null); assert.equal(JSON.stringify(status).includes(linkCode), false, 'the code never comes back');
  // A malformed wording file counts as not supplied.
  const file = join(f.directory, 'wording.json'); await writeFile(file, JSON.stringify({ version: 'v-file', text: 'x', extra: true }));
  const g = await fixture(t, { wordingFile: file });
  assert.equal((await g.rpc('castatus.get')).wording.version, 'pending');
});

test('a demo workspace uses the unapproved draft wording; a wording file is read and validated', async t => {
  const f = await fixture(t, { demoWorkspace: true });
  const status = await f.rpc('castatus.get');
  assert.equal(status.wording.version, 'draft-unapproved'); assert.equal(status.wording.approved, false); assert.match(status.wording.text, /never holds a figure/);
  await f.rpc('castatus.link', { firmName: 'Demo and Co', code: linkCode });
  await f.fails('castatus.consent', { agree: true, version: 'v-other' }, 'CA_CONSENT_VERSION_MISMATCH');
  const given = await f.rpc('castatus.consent', { agree: true, version: 'draft-unapproved' });
  assert.equal(given.consent.version, 'draft-unapproved');
  const card = await f.rpc('castatus.card');
  assert.equal(card.consent, 'draft-unapproved'); assert.equal(macMatches(linkCode, parseCard(card)), true);

  const directory = await mkdtemp(join(tmpdir(), 'chausar-ca-wording-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'wording.json'); await writeFile(file, JSON.stringify({ version: 'v-file-1', text: 'Synthetic founder wording.' }));
  const g = await fixture(t, { wordingFile: file });
  assert.deepEqual((await g.rpc('castatus.get')).wording, { version: 'v-file-1', approved: true, text: 'Synthetic founder wording.' });
});

test('the card is computed from this workspace only, carries no figure and no name, and is issued only to the right people', async t => {
  const f = await fixture(t, { wording });
  await f.store.update(state => {
    state.facts.push(
      fact('s1', 'synthetic-sales', 'invoice', '2026-09-05', { customerName: customers[0], amountMinor: amounts[0], gstin: '27ABCDE1234F1Z5', phone: '+91 98765 43210' }),
      fact('s2', 'synthetic-sales', 'invoice', '2026-09-06', { customerName: customers[1], amountMinor: amounts[1] }),
      fact('b1', 'synthetic-bank', 'bank-line', '2026-09-03', { narration: `NEFT from ${customers[0]}`, amountMinor: amounts[2] }),
      fact('g1', 'synthetic-gstr1', 'invoice', '2026-09-07', { customerName: customers[1], amountMinor: amounts[0] }));
    state.imports.push({ id: 'import-1', at: '2026-10-13T07:00:00.000Z', sourceId: 'synthetic-sales', format: 'csv', totalsMinor: amounts[0] });
    const cx = ((state.extensions ??= {})['connectors-ext'] ??= { version: 1, connections: [], envelopes: [], signIns: [] }) as any;
    const september = { from: '2026-09-01', to: '2026-09-30' };
    cx.envelopes.push(envelope('e1', 'synthetic-bank', 'bank-statements', 'statement', 'accepted', september),
      envelope('e2', 'synthetic-gstr1', 'gst-downloads', 'gstr1-outward-invoices', 'accepted', september),
      envelope('e3', 'synthetic-26as', 'form26as-ais', 'form26as-tds-credit', 'refused', september));
    const draft = (id: string, st: string) => ({ id, name: `synthetic_${id}`, author: 'Workspace owner', createdAt: '2026-10-01T00:00:00.000Z', state: st, reviews: [] });
    ((state.extensions as any)['work-books'] ??= {}).books = { drafts: [draft('d1', 'draft'), draft('d2', 'cosigned'), draft('d3', 'published')] };
    const reports = ((state.extensions as any)['reports-tools-trust'] ??= { reports: {}, trust: {}, tools: {} });
    reports.reports.questions = [{ id: 'q1', at: '2026-10-02T05:00:00.000Z', path: '/nowhere/question-1.html', sourceIds: [] }, { id: 'q2', at: '2026-09-20T05:00:00.000Z', path: '/nowhere/question-2.html', sourceIds: [] }];
  });
  await f.rpc('castatus.link', { firmName: 'Synthetic and Co', code: linkCode });
  await f.rpc('castatus.consent', { agree: true, version: 'v-test' });
  const accountant = await f.seat('accountant', 'Synthetic accountant');
  const ca = await f.seat('ca', 'Synthetic CA', '2026-12-31');
  const staff = await f.member('Synthetic viewer', 'viewer');

  const card = await f.rpc('castatus.card');
  assert.deepEqual(parseCard(card), card); assert.equal(macMatches(linkCode, card), true);
  assert.equal(card.link, linkDigest(linkCode)); assert.equal(card.workspaceId, f.store.read().workspace.id);
  assert.equal(card.month, '2026-09'); assert.equal(card.issuedAt, new Date(noon).toISOString());
  assert.deepEqual(card.close, { bank: 'done', gst: 'in-progress', tds: 'refused', tb: 'not-done' });
  assert.equal(card.booksReadAt, '2026-10-13T07:00:00.000Z');
  assert.deepEqual(card.questions, { count: 2, oldestAt: '2026-09-20T05:00:00.000Z' });
  assert.deepEqual(card.handover.tb, 'not-ready'); assert.deepEqual(card.handover.bankRec, 'not-ready'); assert.deepEqual(card.handover.tdsMatch, 'not-ready');
  assert.ok(card.dueNext && card.dueNext.date >= '2026-10-15' && /^[a-z0-9]/.test(card.dueNext.code));
  assert.deepEqual(card.seats, [{ seat: 'accountant', endsOn: null }, { seat: 'ca', endsOn: '2026-12-31' }]);
  assert.equal(card.cosign.meanings, 1, 'one meaning draft waits for a co-sign');
  for (const key of ['recipes', 'accountClasses'] as const) assert.ok(Number.isSafeInteger(card.cosign[key]));
  const json = JSON.stringify(card);
  for (const secret of [...customers, ...amounts, '27ABCDE1234F1Z5', '98765', 'Synthetic accountant', 'Synthetic CA', 'Synthetic client shop', linkCode]) assert.equal(json.includes(secret), false, `card carries ${secret}`);

  // The firm's seats may issue the card too; a later card is always strictly newer.
  const second = await f.as(accountant, 'castatus.card'); assert.ok(second.issuedAt > card.issuedAt);
  const third = await f.as(ca, 'castatus.card'); assert.ok(third.issuedAt > second.issuedAt);
  await assert.rejects(f.as(staff, 'castatus.card'), code('FORBIDDEN'));
  await assert.rejects(f.as(accountant, 'castatus.link', { firmName: 'X', code: linkCode }), code('FORBIDDEN'));
  const activity = f.store.read().activity.filter((a: any) => a.event === 'castatus.card.issued');
  assert.equal(activity.length, 3); assert.deepEqual(Object.keys(activity[0].details), ['by']);
  assert.equal((await f.rpc('castatus.get')).lastCardAt, third.issuedAt);

  // Inside the client (CA-03 banner).
  assert.deepEqual(await f.rpc('castatus.inside'), { inside: false });
  assert.deepEqual(await f.as(ca, 'castatus.inside'), { inside: true, firmName: 'Synthetic and Co', workspaceName: 'Synthetic client shop', seat: 'ca', endsOn: '2026-12-31', can: ['read', 'export'] });
  assert.deepEqual((await f.as(accountant, 'castatus.inside')).can, ['read', 'export', 'prepare']);
  assert.deepEqual(await f.as(staff, 'castatus.inside'), { inside: false });

  // Withdrawing consent or unlinking stops the card; a new link needs a new agreement.
  await f.rpc('castatus.consent', { agree: false, version: 'v-test' });
  await f.fails('castatus.card', {}, 'CA_NO_CONSENT');
  await f.rpc('castatus.consent', { agree: true, version: 'v-test' });
  await f.rpc('castatus.link', { firmName: 'Other and Co', code: 'MNBVCXZLKJHGFDSA' });
  await f.fails('castatus.card', {}, 'CA_NO_CONSENT');
  assert.deepEqual(await f.rpc('castatus.unlink'), { unlinked: true });
  await f.fails('castatus.card', {}, 'CA_NOT_LINKED');
  assert.equal((await f.rpc('castatus.get')).link, null);
});

test('a workspace without any source gives an honest empty card', async t => {
  const f = await fixture(t, { wording });
  await f.rpc('castatus.link', { firmName: 'Synthetic and Co', code: linkCode });
  await f.rpc('castatus.consent', { agree: true, version: 'v-test' });
  const card = await f.rpc('castatus.card');
  assert.deepEqual(card.cosign, { meanings: 0, recipes: 0, accountClasses: 0 }, 'counts come from books.meanings, books.recipes and accounts.list');
  assert.deepEqual(card.close, { bank: 'not-done', gst: 'not-done', tds: 'not-done', tb: 'not-done' });
  assert.equal(card.booksReadAt, null); assert.deepEqual(card.questions, { count: 0, oldestAt: null }); assert.deepEqual(card.seats, []);
  assert.deepEqual(card.handover, { tb: 'not-ready', bankRec: 'not-ready', gstMatch: 'not-ready', tdsMatch: 'not-ready', ageing: 'not-ready' });
});
