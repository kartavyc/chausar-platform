import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import { compileDictionary, starterPacks } from '../runtime/ontology.ts';
import { checkAgainstMenu, parseDescriptor, words, type Menu } from '../runtime/smallapps/descriptor.ts';
import { plan } from '../runtime/smallapps/planner.ts';
import { coreRows, writebackRow } from '../runtime/smallapps/catalogue-adapter.ts';

const code = (...expected: string[]) => (error: any) => { assert.ok(expected.includes(error?.code), `got ${error?.code}`); return true; };
const dictionary = compileDictionary(structuredClone(starterPacks.find(p => p.pack === 'ecommerce')!));
const actions = coreRows([{ id: 'local', title: 'Chausar local workspace', operations: [{ id: 'reminder-draft', title: 'Create a payment reminder draft', impact: 'reversible' }] }]).rows;
const menu: Menu = { dictionary, actions, branches: ['main', 'west'] };
const base = plan('sales this month with a reminder button', menu, ['*']).descriptor!;
const check = (change: (d: any) => void) => () => { const d = structuredClone(base) as any; change(d); return checkAgainstMenu(parseDescriptor(d), menu, ['*']); };

test('M5: the review proof strings are refused by the number lexicon itself', () => {
  for (const label of ['बाईस प्रतिशत गिरावट', 'Sales down bais percent', 'Revenue fell by a fifth', 'Dues doubled', 'Sales triple', 'Overdue is nil', 'Revenue chhattis hazaar'])
    assert.throws(() => words(label), code('UNGROUNDED_NUMBER'), label);
});

test('M5: Hindi numerals to a hundred, ordinals, fractions, multiples, percentages and zero words are refused in English, romanised Hindi and Devanagari', () => {
  const deva = 'इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस अडतीस उनतालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास इक्यावन बावन तिरेपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ इकसठ बासठ तिरेसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी इक्यानबे बानबे तिरानबे चौरानबे पचानबे छियानबे सत्तानबे अट्ठानबे निन्यानबे पाँच पांच';
  const roman = 'ikkees bais teis chaubees pachchis chhabbis sattais atthais untees ikattees battees taintees chauntees paintees chhattis saintees adtees untalis iktalis bayalis taintalis chavalis paintalis chhiyalis saintalis adtalis unchas ikyavan bavan tirpan chauvan pachpan chhappan sattavan atthavan unsath iksath basath tiresath chausath painsath chhiyasath sadsath adsath unhattar ikhattar bahattar tihattar chauhattar pachhattar chhihattar sathattar atthattar unasi ikyasi bayasi tirasi chaurasi pachasi chhiyasi sattasi atthasi navasi ikyanve banve tiranve chauranve pachanve chhiyanve sattanve attanve ninyanve';
  const others = ['Sales first', 'Second best sales', 'Sales third', 'Revenue fell a fifth', 'Sales halved', 'Sales thirds', 'Sales tenths', 'Sales percent', 'Sales percentage', 'Dues double',
    'Dues tripled', 'Sales twice', 'Sales thrice', 'Sales twofold', 'Sales tenfold', 'Sales once', 'Overdue none', 'Overdue zero', 'Overdue nothing', 'Overdue nought',
    'Bikri pehla', 'Bikri doosra', 'Bikri teesra', 'Bikri aadha', 'Bikri chauthai', 'Bikri tihai', 'Bikri dugna', 'Bikri tigna', 'Bikri do guna', 'Bikri pratishat', 'Udhaar shunya', 'Udhaar sifar',
    'Udhaar kuch nahi', 'उधार कुछ नहीं', 'उधार शून्य', 'उधार सिफ़र', 'बिक्री दोगुनी', 'बिक्री आधी', 'बिक्री पहली', 'बिक्री प्रतिशत', 'बिक्री फीसदी', 'बिक्री तिगुना', 'बिक्री चौथाई'];
  for (const label of [...deva.split(' ').map(w => `बिक्री ${w}`), ...roman.split(' ').map(w => `Sales ${w}`), ...others])
    assert.throws(() => words(label), code('UNGROUNDED_NUMBER'), label);
});

test('M5: the menu allowlist refuses every label word outside the menu, so spellings the lexicon misses still fail', () => {
  const offMenu = ['Sales bayees', 'Sales chhattees', 'Sales b a i s', 'Sales saath', 'Bikri ke saath vasooli', 'Sales up a quarter', 'Revenue fell by a quarter', 'Sales a quarter',
    'Dues quadrupling', 'Sales trebling', 'Sales down', 'Sales jumped', 'Overdue cleared', 'Sales record high', 'बिक्री गिरावट', 'Sales bees se zyada', 'Sales lots', 'Margin is good'];
  for (const label of offMenu) {
    assert.throws(check(d => { d.cards[0].label = label; }), code('SMALLAPP_WORDS_OFF_MENU', 'UNGROUNDED_NUMBER'), label);
    assert.throws(check(d => { d.title = label; }), code('SMALLAPP_WORDS_OFF_MENU', 'UNGROUNDED_NUMBER'), label);
  }
  // At least the words the lexicon does not know are refused by the allowlist, not let through.
  assert.throws(check(d => { d.cards[0].label = 'Sales bayees'; }), code('SMALLAPP_WORDS_OFF_MENU'));
  assert.throws(check(d => { d.cards[0].label = 'Sales up a quarter'; }), code('SMALLAPP_WORDS_OFF_MENU'));
  // Table row labels go through the same allowlist.
  const changed = structuredClone(plan('sales, collections and dues this month', menu, ['*']).descriptor!) as any;
  assert.equal(changed.cards[0].kind, 'table'); changed.cards[0].rows[0].label = 'Sales jumped';
  assert.throws(() => checkAgainstMenu(parseDescriptor(changed), menu, ['*']), code('SMALLAPP_WORDS_OFF_MENU'));
});

test('M5: ordinary planner titles and labels, and plain hand-written ones, still pass', () => {
  for (const line of ['sales this month', 'compare net sales this month vs last month for west', 'pichhle mahine ki bikri aur udhaar dikhao', 'sales, collections and dues this month table',
    'profit this quarter', 'dues', 'follow up list with a reminder button', 'is saal ka kharcha', 'refunds last year', 'Show sales and collections last month with a reminder button and a follow-up book',
    'purchases all time', 'billed today', 'net sales yesterday for west']) {
    const result = plan(line, menu, ['*']);
    assert.equal(result.supported, true, line);
    assert.doesNotThrow(() => checkAgainstMenu(parseDescriptor(result.descriptor), menu, ['*']), line);
  }
  for (const label of ['Net sales, this month', 'Collections against last month', 'West sales', 'Receivable aging', 'Udhaar aur vasooli', 'बिक्री और वसूली', 'Revenue (earned), this quarter',
    'Follow-up book', 'Payment reminder draft', 'Sales for main', 'My shop summary', 'Costs and purchases, last financial year', 'Dues, all time'])
    assert.doesNotThrow(check(d => { d.cards[0].label = label; d.title = label; }), label);
});

test('L6: only an inside-undoable, unflagged, plainly worded writeback row does not always wait; always-waits is never removed', () => {
  const row = { system: 'google-workspace', action: 'sheets.append', title: 'Add a row to a Google Sheet', kind: 'inside-undoable', tier: 1, alwaysWaits: false, status: 'experimental',
    installed: true, recipe: { requiredFields: ['spreadsheetId', 'sheet', 'values'] }, connections: [] };
  assert.equal(writebackRow(row).alwaysWaits, false);
  assert.equal(writebackRow(row).impact, 'reversible');
  assert.equal(writebackRow({ ...row, alwaysWaits: true }).alwaysWaits, true);
  assert.equal(writebackRow({ ...row, title: 'Send the sheet by email' }).alwaysWaits, true);
  assert.equal(writebackRow({ ...row, action: 'rows.delete' }).alwaysWaits, true);
  assert.equal(writebackRow({ ...row, action: 'payout.create' }).alwaysWaits, true);
  assert.equal(writebackRow({ ...row, action: 'sheets.sendCopy' }).alwaysWaits, true, 'camelCase words are read');
  for (const kind of ['seen-outside', 'money', 'cannot-undo']) assert.equal(writebackRow({ ...row, kind }).alwaysWaits, true, kind);
  for (const bad of [{ kind: 'harmless' }, { kind: undefined }, { tier: 'routine' }, { tier: 3 }, { installed: 'yes' }, { recipe: undefined }, { connections: undefined }])
    assert.throws(() => writebackRow({ ...row, ...bad }), code('SMALLAPP_ROW_INVALID'));
});

test('L1: follow-up history returns only the versions the caller can see now and says how many were withheld', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'models-ext': { clock: () => '2026-10-14T09:00:00.000Z' } } });
  t.after(async () => { try { await engine.request('workspace.lock'); } catch { /* already locked */ } await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Demo Shop', passphrase: 'correct horse battery staple 42', demo: true, pack: 'ecommerce' });
  // Version one is about a customer whose records sit in the main branch; version two drops the customer.
  const entry = (await engine.request('smallapps.records.add', { who: 'Customer one accounts desk', when: '2026-10-16', said: 'Promised to pay 400 on Friday', customerId: 'cust-1' })).entry;
  await engine.request('smallapps.records.update', { id: entry.id, expectedVersion: 1, customerId: null, who: 'Accounts desk', said: 'Call back' });
  const added = await engine.request('members.add', { name: 'West viewer', role: 'viewer', branches: ['west'] });
  const west: Context = { memberId: added.id, role: added.role, epoch: added.epoch, channel: 'desktop' };

  const seen = await engine.requestAs(west, 'smallapps.records.history', { id: entry.id });
  assert.deepEqual(seen.versions.map((v: any) => v.version), [2]);
  assert.equal(seen.versionsWithheld, 1);
  assert.equal(seen.words, 'One earlier version is outside your current access and is not shown.');
  assert.ok(!JSON.stringify(seen).includes('cust-1') && !JSON.stringify(seen).includes('Promised'));
  const listed = (await engine.requestAs(west, 'smallapps.records.list', {})).entries.find((e: any) => e.id === entry.id);
  assert.equal(listed.version, 2); assert.equal(listed.versionsWithheld, 1); assert.equal(listed.customerId, null);

  // The owner sees every version and nothing is withheld.
  const all = await engine.request('smallapps.records.history', { id: entry.id });
  assert.deepEqual(all.versions.map((v: any) => v.version), [1, 2]); assert.equal(all.versionsWithheld, 0); assert.equal(all.words, null);
  assert.equal((await engine.request('smallapps.records.list', {})).entries.find((e: any) => e.id === entry.id).versionsWithheld, 0);

  // Re-scoping to the customer hides the whole entry from the west viewer, in list and history alike.
  await engine.request('smallapps.records.update', { id: entry.id, expectedVersion: 2, customerId: 'cust-1' });
  assert.ok(!(await engine.requestAs(west, 'smallapps.records.list', {})).entries.some((e: any) => e.id === entry.id));
  await assert.rejects(engine.requestAs(west, 'smallapps.records.history', { id: entry.id }), code('SMALLAPP_RECORD_NOT_FOUND'));
});
