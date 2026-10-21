// P4 tests for the connector catalogue: 66 cards in 12 categories, honest modes and chips, starter cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { CONNECTOR_CATEGORIES, EXTERNAL_ORIGINS, STARTER_CONNECTORS } from '../runtime/venture/contracts.ts';
import type { BlueprintRecord, ConnectorCard, CountryProfile, VentureDeps } from '../runtime/venture/contracts.ts';
import { houseStyleFindings, ventureAction } from '../runtime/venture/records.ts';
import { CONNECTOR_CATALOGUE, handlers } from '../runtime/venture/build/index.ts';
import { connectorCard } from '../runtime/venture/build/connectors.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const clock = () => new Date('2026-10-15T10:00:00.000Z');
const list = (deps: VentureDeps, payload: Record<string, unknown> = {}) => handlers['venture.connectors.list']!(deps, owner, payload) as Promise<ConnectorCard[]>;
const code = (expected: string) => (error: any) => { assert.equal(error.code, expected, error.message); return true; };

const INDIA = {
  code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india',
  tax: { mode: 'gst', label: 'GST', standardRateBps: '1800', registrationNote: 'Check with a CA.', idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: '2026-10-15' },
  paymentRails: ['razorpay', 'cashfree', 'paypal'], dateOrder: 'day-month-year', complianceNotes: [],
} satisfies CountryProfile;

function setup() {
  const store = new VentureTestStore();
  const deps = { store, clock } as unknown as VentureDeps;
  return { store, deps };
}

async function seedIndia(deps: VentureDeps) {
  return ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books', country: INDIA,
    serviceType: 'bookkeeping', status: 'blueprint', launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null, playbookId: null,
    invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
}

/** Only the fields the connectors list reads: id, status and starterConnectorIds. */
async function acceptPlan(deps: VentureDeps, starterConnectorIds: string[]) {
  return ventureAction(deps, owner, 'approve', 'seed.accept', tx => {
    const blueprint = tx.put({ ...tx.base('venture-blueprint'), status: 'accepted', starterConnectorIds } as unknown as BlueprintRecord);
    tx.touch({ blueprintId: blueprint.id, acceptedBlueprintId: blueprint.id, status: 'build' });
  });
}

const cards = () => CONNECTOR_CATALOGUE.map(item => connectorCard(item, false));
const availableIds = (mode: 'handoff' | 'read' | 'write') =>
  cards().filter(card => card.modes.some(m => m.mode === mode && m.status === 'available')).map(card => card.id).sort();

test('1. 66 entries, unique ids, all 12 categories present', () => {
  assert.equal(CONNECTOR_CATALOGUE.length, 66);
  assert.equal(new Set(CONNECTOR_CATALOGUE.map(item => item.id)).size, 66);
  assert.deepEqual([...new Set(CONNECTOR_CATALOGUE.map(item => item.category))].sort(), [...CONNECTOR_CATEGORIES].sort());
  const labels = new Set(cards().map(card => card.categoryLabel));
  assert.deepEqual([...labels], ['Build', 'Site and domain', 'Payments', 'Email and inbox', 'Booking and calendar', 'Customers and CRM', 'Messaging and support',
    'Docs and ops', 'Marketing and social', 'Books, tax and invoicing', 'Legal and entity', 'Analytics and feedback']);
});

test('2. every vendorUrl is null or an https link whose origin is in EXTERNAL_ORIGINS', () => {
  for (const item of CONNECTOR_CATALOGUE) {
    if (item.vendorUrl === null) {
      assert.ok(['mail-app', 'chausar-crm', 'chausar-books', 'chausar-templates', 'bank-account'].includes(item.id), item.id);
      continue;
    }
    const url = new URL(item.vendorUrl);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.href, item.vendorUrl);
    assert.ok((EXTERNAL_ORIGINS as readonly string[]).includes(url.origin), `${item.id} ${url.origin}`);
  }
  assert.equal(CONNECTOR_CATALOGUE.find(item => item.id === 'meta-ads')?.vendorUrl, 'https://www.facebook.com/business');
  assert.equal(CONNECTOR_CATALOGUE.find(item => item.id === 'stripe-atlas')?.vendorUrl, 'https://stripe.com/atlas');
});

test('3. available modes are exactly what this build does; everything else is planned and unqualified', () => {
  assert.deepEqual(availableIds('handoff'), ['bolt', 'lovable', 'mail-app', 'replit', 'v0']);
  assert.deepEqual(availableIds('read'), ['bank-account', 'chausar-books', 'chausar-crm', 'github', 'tally']);
  assert.deepEqual(availableIds('write'), ['chausar-books', 'chausar-crm']);

  const byId = new Map(cards().map(card => [card.id, card]));
  const mode = (id: string, name: 'handoff' | 'read' | 'write') => byId.get(id)!.modes.find(m => m.mode === name);
  assert.deepEqual(mode('lovable', 'handoff'), { mode: 'handoff', status: 'available', qualification: 'fixture-tested', what: 'Opens Lovable with your brief filled in. You press send there.' });
  assert.deepEqual(mode('replit', 'handoff'), { mode: 'handoff', status: 'available', qualification: 'fixture-tested', what: 'Opens Replit with your brief filled in. You press send there.' });
  assert.deepEqual(mode('bolt', 'handoff'), { mode: 'handoff', status: 'available', qualification: 'built-in', what: 'Copies your brief. Paste it into Bolt.' });
  assert.deepEqual(mode('v0', 'handoff'), { mode: 'handoff', status: 'available', qualification: 'built-in', what: 'Copies your brief. Paste it into v0.' });
  assert.deepEqual(mode('mail-app', 'handoff'), { mode: 'handoff', status: 'available', qualification: 'built-in', what: 'Chausar drafts a reply or an invoice; you send it from your own mail app.' });
  assert.deepEqual(mode('github', 'read'), { mode: 'read', status: 'available', qualification: 'fixture-tested', what: 'Reads commits, files and checks of one repo. Never writes.' });
  assert.deepEqual(mode('tally', 'read'), { mode: 'read', status: 'available', qualification: 'fixture-tested', what: 'Reads into the back office, under Sources. Needs TallyPrime running on this computer.' });
  assert.deepEqual(mode('zoho-books', 'read'), { mode: 'read', status: 'planned', qualification: 'unqualified', what: 'Needs a Zoho sign-in. Not in this build.' });
  assert.equal(mode('chausar-templates', 'write')?.status, 'planned');
  assert.equal(mode('chausar-templates', 'handoff'), undefined);

  for (const card of cards()) {
    for (const m of card.modes) {
      if (m.status === 'planned') assert.equal(m.qualification, 'unqualified', `${card.id} ${m.mode}`);
      else assert.notEqual(m.qualification, 'unqualified', `${card.id} ${m.mode}`);
    }
    if (card.vendorUrl !== null && !['lovable', 'replit', 'bolt', 'v0'].includes(card.id)) {
      assert.deepEqual(card.modes[0], { mode: 'handoff', status: 'planned', qualification: 'unqualified', what: 'Planned: Chausar will prepare what to paste there. For now, Visit site opens it.' }, card.id);
    }
  }

  const stripe = byId.get('stripe')!;
  assert.deepEqual(stripe.chips, ['planned: handoff', 'planned: read', 'planned: write']);
  assert.deepEqual(byId.get('lovable')!.chips, ['handoff', 'planned: read', 'planned: write']);
  assert.deepEqual(byId.get('github')!.chips, ['read', 'planned: handoff', 'planned: write']);
  assert.match(mode('github', 'write')!.what, /grant write access\. Chausar only reads today\./);
  assert.match(mode('github', 'write')!.what, /stage an edit from it/);
  assert.deepEqual(byId.get('bank-account')!.chips, ['read']);
  assert.deepEqual(mode('bank-account', 'read'), {
    mode: 'read', status: 'available', qualification: 'built-in',
    what: 'Imports a bank statement file you download, read only, counting each row once. A live bank link with consent and an end date is planned: no provider is linked yet.',
  });
  assert.deepEqual(byId.get('youtube')!.chips, ['planned: handoff', 'planned: write']);
  assert.deepEqual(byId.get('chausar-books')!.chips, ['read', 'write']);
  assert.deepEqual(byId.get('mail-app')!.chips, ['handoff']);
  assert.deepEqual(byId.get('zoho-books')!.chips, ['planned: handoff', 'planned: read', 'planned: write']);
  assert.deepEqual(byId.get('gst-registration')!.chips, ['planned: handoff']);
});

test('4. every payment rail in the country table exists in the catalogue as a payments card', () => {
  for (const rail of ['razorpay', 'cashfree', 'paypal', 'stripe', 'lemon-squeezy', 'paddle']) {
    const item = CONNECTOR_CATALOGUE.find(entry => entry.id === rail);
    assert.ok(item, rail);
    assert.equal(item.category, 'payments');
  }
});

test('5. the WhatsApp card carries its business-rules note; cards are plain, honest words', () => {
  const whatsapp = cards().find(card => card.id === 'whatsapp')!;
  assert.equal(whatsapp.note, "WhatsApp's business rules limit AI-first chat services; read them before using WhatsApp for client support.");
  for (const card of cards()) {
    for (const text of [card.name, card.note, card.auth, card.regionNote ?? '', ...card.modes.map(m => m.what)]) {
      assert.deepEqual(houseStyleFindings(text), [], `${card.id}: ${text}`);
      assert.ok(text.length <= 200, `${card.id}: ${text}`);
    }
    assert.ok(card.note.length > 0 && card.auth.length > 0);
    assert.ok(card.regions.length > 0 && card.regions.every(region => region === 'global' || region === 'india'));
    // No card claims a capability this build lacks in its note.
    assert.doesNotMatch(card.note, /\b(syncs|imports automatically|sends for you|posts for you)\b/i, card.id);
  }
  assert.equal(cards().find(card => card.id === 'stripe')!.regionNote, 'In India, new accounts are by invitation only.');
  assert.deepEqual(cards().find(card => card.id === 'tally')!.regions, ['india']);
});

test('6. starter flags and ordering for an India venture, before and after the plan is accepted', async () => {
  const { deps } = setup();
  const none = await list(deps);
  assert.equal(none.length, 66);
  assert.ok(none.every(card => !card.starter), 'no venture yet: no starter cards');

  await seedIndia(deps);
  const before = await list(deps);
  assert.equal(before.length, 66);
  const expectedStarters = STARTER_CONNECTORS.map(id => (id === '<payment-rail>' ? 'razorpay' : id));
  assert.deepEqual(before.filter(card => card.starter).map(card => card.id).sort(), [...expectedStarters].sort());
  // Starter cards first, then category order, then name.
  assert.deepEqual(before.slice(0, 6).map(card => card.id), ['github', 'lovable', 'razorpay', 'mail-app', 'cal-com', 'chausar-books']);
  assert.deepEqual(before.slice(6, 9).map(card => card.id), ['bolt', 'replit', 'v0']);
  const rest = before.slice(6);
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i - 1], b = rest[i];
    const order = CONNECTOR_CATEGORIES.indexOf(a.category) - CONNECTOR_CATEGORIES.indexOf(b.category);
    assert.ok(order < 0 || (order === 0 && a.name.toLowerCase() <= b.name.toLowerCase()), `${a.id} before ${b.id}`);
  }

  await acceptPlan(deps, ['replit', 'github', 'cashfree', 'mail-app', 'calendly', 'chausar-books']);
  const after = await list(deps);
  assert.deepEqual(after.slice(0, 6).map(card => card.id), ['github', 'replit', 'cashfree', 'mail-app', 'calendly', 'chausar-books']);
  assert.equal(after.find(card => card.id === 'lovable')!.starter, false);

  const starterOnly = await list(deps, { starterOnly: true });
  assert.deepEqual(starterOnly.map(card => card.id), ['github', 'replit', 'cashfree', 'mail-app', 'calendly', 'chausar-books']);
  const payments = await list(deps, { category: 'payments' });
  assert.equal(payments.length, 7);
  assert.equal(payments[0].id, 'cashfree');
  assert.ok(payments.every(card => card.category === 'payments'));
  await assert.rejects(list(deps, { category: 'ai-models' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(list(deps, { starterOnly: 'yes' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(list(deps, { other: true }), code('INVALID_VENTURE_REQUEST'));
});

test('7. handlers keys equal the sixteen owned methods', () => {
  assert.deepEqual(Object.keys(handlers).sort(), [
    'venture.bank.consent', 'venture.bank.import',
    'venture.build.brief', 'venture.build.handoff', 'venture.build.handoffOpened', 'venture.build.link', 'venture.build.status', 'venture.build.sync', 'venture.connectors.list',
    'venture.leads.add', 'venture.leads.draft', 'venture.leads.list', 'venture.leads.recordSend',
    'venture.site.apply', 'venture.site.revert', 'venture.site.stage',
  ]);
});

test('the architecture Connectors table names cards whose available modes it claims (the doc test rule)', () => {
  // Rows from ARCHITECTURE-B2C.md section 6, so this package stays in line with the doc P6 checks in Phase C.
  const rows: [string, string][] = [
    ['Lovable, Replit, Bolt, v0, GitHub', 'handoff (brief link or copy); GitHub read'],
    ['Vercel, Netlify, Cloudflare, Porkbun', 'planned: handoff'],
    ['Razorpay, Cashfree, Stripe, PayPal, Paddle', 'planned: handoff, read, write'],
    ['Your own mail app, Google Workspace, Resend', 'Your own mail app: handoff (you send a draft); others planned'],
    ['Cal.com, Calendly, Google Calendar', 'planned: handoff, read'],
    ['Chausar CRM, HubSpot, Zoho CRM, Attio', 'Chausar CRM read and write; others planned'],
    ['WhatsApp, Telegram, Slack, Discord', 'planned: handoff, write'],
    ['Notion, Google Drive, Linear, Airtable', 'planned'],
    ['LinkedIn, X, Instagram, Buffer', 'planned'],
    ['Chausar back office, TallyPrime, Zoho Books, Xero', 'Chausar back office read and write; TallyPrime read; others planned'],
    ['Stripe Atlas, India company and LLP, GST registration', 'planned: handoff (checklist), no legal advice'],
    ['PostHog, Plausible, Tally forms', 'planned: handoff (brief adds analytics)'],
  ];
  const all = cards();
  const plainName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase();
  for (const [examples, modes] of rows) {
    const matched = examples.split(',').map(item => item.trim().toLowerCase())
      .flatMap(item => all.filter(card => plainName(card.name) === item));
    const claims = new Set<string>();
    for (const segment of modes.split(';').map(part => part.trim())) {
      if (segment.startsWith('planned')) continue;
      for (const word of segment.match(/\b(handoff|read|write)\b/g) ?? []) claims.add(word);
    }
    for (const card of matched) {
      for (const m of card.modes.filter(item => item.status === 'available')) assert.ok(claims.has(m.mode), `${card.id} ${m.mode} not claimed in "${modes}"`);
    }
    for (const claim of claims) {
      assert.ok(matched.some(card => card.modes.some(m => m.mode === claim && m.status === 'available')), `"${claim}" claimed in "${modes}" but no card has it`);
    }
  }
});
