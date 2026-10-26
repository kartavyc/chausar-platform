// Connector setup guides (4J7, K11): every catalogue connector has one, with numbered least-privilege steps, the step
// people skip, what the platform charges (dated only where the catalogue note says it) or "No charge", a line on how
// access is checked that is true for that connector, a "Sends:" line and the agents' limits; only a working connector
// has a hand-written guide; a connector this build does not link asks for no key; the validation fails on a connector
// without a guide; a half-configured connection names its missing setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConnectorCard, VentureDeps } from '../runtime/venture/contracts.ts';
import { houseStyleFindings, ventureAction } from '../runtime/venture/records.ts';
import { CONNECTOR_CATALOGUE, type CatalogueEntry } from '../runtime/venture/build/catalogue.ts';
import { connectorCard } from '../runtime/venture/build/connectors.ts';
import {
  CATALOGUE_NOTES_ON, NO_CHARGE, PLANNED_CHECKS, connectorWorks, guideOf, guideProblems, halfConfigured, hasHandGuide,
} from '../runtime/venture/build/guides.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { TOKEN_LINK } from '../runtime/venture/build/github.ts';
import { owner, setup } from './venture-views-env.ts';

const list = (deps: VentureDeps) => build['venture.connectors.list']!(deps, owner, {}) as Promise<ConnectorCard[]>;
const byId = (id: string) => guideOf(CONNECTOR_CATALOGUE.find(item => item.id === id)!);

test('every catalogue connector has a whole guide, and the validation passes for the catalogue', () => {
  assert.deepEqual(guideProblems(), []);
  for (const item of CONNECTOR_CATALOGUE) {
    const guide = connectorCard(item, false).guide!;
    assert.ok(guide, item.id);
    assert.ok(guide.steps.length >= 2, item.id);
    guide.steps.forEach((step, index) => assert.ok(step.startsWith(`${index + 1}. `), `${item.id} step ${index + 1} is numbered`));
    assert.ok(guide.skipped.length > 10, item.id);
    assert.ok(guide.checks.length > 10, item.id);
    // A connector that does not work here never claims an access check.
    if (!connectorWorks(item)) assert.equal(guide.checks, PLANNED_CHECKS, item.id);
    assert.match(guide.sends, /^Sends: /, item.id);
    assert.ok(guide.agentLimits.length > 10, item.id);
    assert.equal(guide.missing, null);
    assert.ok(guide.charges.line === NO_CHARGE ? guide.charges.checkedOn === null : guide.charges.line.length > 10, item.id);
    for (const text of [...guide.steps, guide.skipped, guide.checks, guide.sends, guide.agentLimits, guide.charges.line]) {
      assert.deepEqual(houseStyleFindings(text), [], `${item.id}: ${text}`);
      assert.equal(text.includes(String.fromCharCode(0x2014)), false, `${item.id}: no long dash`);
    }
  }
});

test('the validation fails on a connector without a guide; only a connector that works here has a hand-written guide', () => {
  const stray: CatalogueEntry = { id: 'made-up', name: 'Made Up', category: 'docs-ops', auth: 'API key', regions: ['global'], regionNote: null, note: 'x', vendorUrl: null, targets: ['read'] };
  assert.deepEqual(guideProblems([stray]), ['made-up: it has no guide.']);
  for (const item of CONNECTOR_CATALOGUE) assert.equal(hasHandGuide(item.id), connectorWorks(item), item.id);
  assert.equal(hasHandGuide('youtube'), false, 'publishing to YouTube from Chausar is planned');
  assert.equal(hasHandGuide('chausar-templates'), false, 'drafting from templates is planned');
});

test('the access check line is true for each connector', () => {
  assert.match(byId('github').checks, /does not read GitHub when you link the repo/);
  assert.match(byId('zoho-mail').checks, /before it keeps anything/);
  assert.match(byId('google-calendar').checks, /reads the address once before it keeps it/);
  assert.match(byId('bank-account').checks, /no bank provider is linked/);
  assert.match(byId('tally').checks, /does not reach TallyPrime on its own/);
  assert.match(byId('lovable').checks, /nothing to connect/);
  assert.equal(byId('stripe').checks, PLANNED_CHECKS);
});

test('least privilege: GitHub asks for one repo read only and no commit statuses; a planned connector asks for no key now', () => {
  const github = byId('github');
  assert.ok(github.steps.some(step => /Only select repositories/.test(step)));
  assert.ok(github.steps.some(step => /Read-only/.test(step) && /No access/.test(step)));
  assert.equal(github.steps.some(step => /Commit statuses/.test(step)), false);
  // The token link the build page opens asks for the same, and nothing more.
  assert.equal(TOKEN_LINK.includes('statuses='), false);
  assert.deepEqual([...new URL(TOKEN_LINK).searchParams.entries()].filter(([, value]) => value === 'read').map(([key]) => key).sort(), ['actions', 'contents', 'deployments', 'metadata']);
  assert.equal(github.sends, 'Sends: nothing, so nothing here can change your repo. Chausar reads it and never pushes.');
  const zoho = byId('zoho-books');
  assert.equal(zoho.sends, 'Sends: nothing, so nothing here can change Zoho Books.');
  assert.match(zoho.steps[0], /^1\. Nothing to set up in Chausar yet: linking Zoho Books is planned\.$/);
  assert.match(zoho.skipped, /Don't make a key/);
  assert.match(zoho.agentLimits, /can't use Zoho Books/);
  const youtube = byId('youtube');
  assert.match(youtube.steps[0], /linking YouTube is planned/);
  assert.equal(youtube.steps.some(step => /^\d+\. Chausar copies/.test(step)), false, 'copying for YouTube is planned, so nothing says Chausar does it');
  assert.match(byId('chausar-templates').steps[1], /needs no key or sign-in/);
  assert.match(byId('linkedin').agentLimits, /waits for your approval/);
  assert.match(byId('linkedin').sends, /from the LinkedIn account you signed in to/);
});

test('the mailbox and calendar guides: app passwords, 2-Step Verification, the admin block, the secret address; no "no key yet"', () => {
  const zoho = byId('zoho-mail');
  assert.ok(zoho.steps.some(step => /app-specific password/.test(step)));
  assert.ok(zoho.steps.some(step => /IMAP Access/.test(step)));
  const gmail = byId('google-workspace');
  assert.ok(gmail.steps.some(step => /2-Step Verification/.test(step)));
  assert.ok(gmail.steps.some(step => /admin can block app passwords/.test(step)));
  assert.ok(byId('google-calendar').steps.some(step => /Secret address in iCal format/.test(step)));
  for (const guide of [zoho, gmail, byId('google-calendar')]) {
    assert.equal(/Don't make a key/.test(guide.skipped), false);
    assert.ok(guide.steps.some(step => /desktop app/.test(step)));
  }
});

test('charges keep a date only where the catalogue note says them', () => {
  assert.deepEqual(byId('cloudflare').charges, { line: 'Pages and DNS are free, and domains are sold at cost.', checkedOn: CATALOGUE_NOTES_ON });
  assert.deepEqual(byId('chausar-books').charges, { line: NO_CHARGE, checkedOn: null });
  assert.deepEqual(byId('stripe').charges, { line: 'Chausar has not checked its prices. Read its own pricing page before you sign up.', checkedOn: null });
  for (const id of ['stripe-atlas', 'firstbase', 'paddle', 'lemon-squeezy', 'namecheap', 'porkbun', 'dodo-payments']) assert.equal(byId(id).charges.checkedOn, null, id);
});

test('a half-configured connection names its missing setting on its card', async () => {
  const env = await setup();
  assert.equal(halfConfigured(env.deps, env.store.read(), env.venture.id, 'bank-account'), null);
  await ventureAction(env.deps, owner, 'admin', 'seed.bank', tx => {
    tx.put({ ...tx.base('venture-bank-account'), label: 'HDFC current', currency: 'INR', consent: null, polls: [] } as never);
    tx.put({ ...tx.base('venture-build-follow'), repo: { owner: 'ledger', name: 'site' }, tokenState: 'in-memory', linkedAt: tx.now, lastStatus: null } as never);
    tx.put({ ...tx.base('venture-mailbox'), host: 'imap.gmail.com', port: 993, user: 'me@cafe.example', status: 'connected', uidValidity: null, cursor: null, lastSync: null, line: 'x' } as never);
    tx.put({ ...tx.base('venture-calendar-feed'), host: 'calendar.google.com', status: 'set', lastRead: tx.now, digest: 'd', line: 'Read.', events: [] } as never);
  });
  const cards = await list(env.deps);
  const missing = (id: string) => cards.find(card => card.id === id)!.guide!.missing;
  assert.equal(missing('bank-account'), 'Missing: a statement file for HDFC current. Import one under Bank.');
  assert.equal(missing('github'), 'Missing: the GitHub token. Chausar keeps it only while the app is open, so paste it again.');
  assert.match(missing('google-workspace')!, /^Missing: the app password\./);
  assert.equal(missing('zoho-mail'), null, 'a Gmail server is not Zoho');
  assert.match(missing('google-calendar')!, /^Missing: the calendar address\./);
  assert.equal(missing('stripe'), null);
  env.deps.secrets.set('mailbox:password' as never, 'x');
  env.deps.secrets.set('network:calendar' as never, 'https://calendar.google.com/x.ics');
  const again = await list(env.deps);
  assert.equal(again.find(card => card.id === 'google-workspace')!.guide!.missing, null);
  assert.equal(again.find(card => card.id === 'google-calendar')!.guide!.missing, null);
});

test("guides: the UI's fake engine keeps the engine's own guides and capability sets, word for word (4J21)", async () => {
  const { readFile } = await import('node:fs/promises');
  const { connectorCapabilities } = await import('../runtime/venture/build/connector-truth.ts');
  const fake = JSON.parse(await readFile(new URL('../../app/ui/src/engine/fixtures-guides.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const ids = Object.keys(fake).filter(id => id !== 'about');
  assert.ok(ids.length > 0);
  for (const id of ids) {
    const item = CONNECTOR_CATALOGUE.find(entry => entry.id === id);
    assert.ok(item, `${id} is in the engine's catalogue`);
    assert.deepEqual(fake[id], { guide: guideOf(item), capabilities: connectorCapabilities(id) }, id);
  }
});
