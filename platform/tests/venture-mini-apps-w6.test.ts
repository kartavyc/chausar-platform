// Mini apps (wave 6 package 6H1, DECISIONS D39). The owner asks for a small tool; the owner's AI writes one HTML page
// as data, and Chausar checks the code, stores it as a version and works out from the code what it needs. It runs only
// in the Ink app's locked frame, talking to Chausar through the MCP Apps bridge (venture.apps.call): nothing answers
// before the owner allows it, reads answer only within what was allowed, notes stay the app's own, amounts come from
// records and the calculator with receipts, and an action becomes a card on Today for the owner's approval. Versions
// with undo, pin to Today, export as one file, and delete (its notes go with it).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelTask, SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import { METHOD_LEVEL_OF } from '../runtime/venture/method-hints.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { APP_PROTOCOL_VERSION, MINI_FRAME_CSP, OFFLINE_LINE, appCodeFindings, permissionsOf } from '../runtime/venture/apps/frame.ts';
import { code, phone } from './venture-judge-helpers.ts';
import { chatConsent, chiefBusiness, type ChiefEnv } from './venture-chief-helpers.ts';
import { episodeOrder } from './venture-agent-helpers.ts';

const METHODS = ['venture.apps.list', 'venture.apps.get', 'venture.apps.make', 'venture.apps.grant', 'venture.apps.revoke', 'venture.apps.restore',
  'venture.apps.pin', 'venture.apps.export', 'venture.apps.call', 'venture.apps.remove'] as const;

const SHEET = '<h1>Who owes me</h1><table id="rows"></table><script>'
  + 'chausar.call("clients_list").then(function(r){return chausar.call("invoices_list");});'
  + 'chausar.call("notes_get");function remind(id){return chausar.call("propose",{kind:"draft-reminder",invoiceId:id});}</script>';
const WITH_ORDERS = SHEET.replace('</script>', 'chausar.call("orders_list");</script>');

type Made = { name: string; summary: string; html: string };
/** Scripts the owner's AI: each make call takes the next answer and records the task Chausar sent. */
function scriptMaker(env: ChiefEnv, answers: Made[]): ModelTask<any>[] {
  const tasks: ModelTask<any>[] = [];
  env.models.respond['chief-chat'] = task => {
    tasks.push(task);
    const next = answers.shift();
    assert.ok(next, 'Chausar asked the AI more times than this test scripted');
    return next;
  };
  return tasks;
}

async function issuedInvoice(env: ChiefEnv) {
  const order = await episodeOrder(env);
  const draft = await env.call('venture.invoice.prepare', { orderId: order.id });
  return (await env.call('venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest })).invoice;
}

async function madeApp(env: ChiefEnv, html = SHEET) {
  await chatConsent(env);
  scriptMaker(env, [{ name: 'Who owes me', summary: 'A sheet of clients and what each owes.', html }]);
  return (await env.call('venture.apps.make', { ask: 'A sheet of my clients and what each owes me' })).app;
}

const call = (env: ChiefEnv, app: string, tool: string, args: Record<string, unknown> = {}) => env.call('venture.apps.call', { app, tool, arguments: args });

test('6H1: the methods are listed, owned by views, at their levels, and the changing ones need the app', () => {
  for (const method of METHODS) {
    assert.ok((VENTURE_METHODS as readonly string[]).includes(method), method);
    assert.equal(METHOD_OWNERS[method], 'views', method);
  }
  assert.equal(METHOD_LEVEL_OF['venture.apps.list'], 'read');
  assert.equal(METHOD_LEVEL_OF['venture.apps.get'], 'read');
  assert.equal(METHOD_LEVEL_OF['venture.apps.export'], 'read');
  assert.equal(METHOD_LEVEL_OF['venture.apps.make'], 'prepare');
  assert.equal(METHOD_LEVEL_OF['venture.apps.call'], 'prepare');
  assert.equal(METHOD_LEVEL_OF['venture.apps.grant'], 'approve');
  assert.equal(METHOD_LEVEL_OF['venture.apps.remove'], 'approve');
  for (const method of METHODS.filter(item => item !== 'venture.apps.list' && item !== 'venture.apps.get')) assert.ok(APP_ONLY_METHODS.includes(method), method);
});

test('6H1: the code check refuses reaching outside and amounts written into the code; needs come from the code', () => {
  assert.deepEqual(appCodeFindings(SHEET), []);
  assert.deepEqual(permissionsOf(SHEET), ['clients', 'invoices', 'notes', 'propose']);
  assert.equal(appCodeFindings('<script>fetch("/x")</script>').length, 1);
  assert.equal(appCodeFindings('<a href="https://example.com">site</a>').length, 1);
  assert.equal(appCodeFindings('<script src="https://cdn.example/x.js"></script>').length, 2);
  assert.equal(appCodeFindings('<iframe></iframe>').length, 1);
  assert.equal(appCodeFindings('<p>Fee ₹500 a month</p>').length, 1);
  assert.equal(appCodeFindings('<p>Fee Rs 500</p>').length, 1);
  assert.equal(appCodeFindings('<script>localStorage.x=1</script>').length, 1);
  assert.equal(appCodeFindings('<script>eval("1")</script>').length, 1);
  assert.deepEqual(appCodeFindings('<p>3 batches, 12 students</p>'), [], 'counts that are not money are fine');
});

test('6H1: the owner AI writes the app as data; code checks it and works out what it needs; nothing runs before Allow', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const tasks = scriptMaker(env, [{ name: 'Who owes me', summary: 'A sheet of clients and what each owes.', html: SHEET }]);
  await assert.rejects(env.call('venture.apps.make', { ask: 'A sheet of my clients' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.call('venture.apps.make', { ask: '   ' }), code('INVALID_VENTURE_REQUEST'));
  const made = await env.call('venture.apps.make', { ask: 'A sheet of my clients and what each owes me' });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].purpose, 'chief-chat');
  assert.equal(tasks[0].containsClientData, false, 'the AI gets the owner words, never client records');
  assert.doesNotMatch(JSON.stringify(tasks[0].input), /Asha Rao/);
  const app = made.app;
  assert.match(app.id, /^miniapp_/);
  assert.equal(app.name, 'Who owes me');
  assert.equal(app.version, 1);
  assert.deepEqual(app.permissions.map((item: any) => item.id), ['clients', 'invoices', 'notes', 'propose']);
  assert.deepEqual(app.ask.added, ['clients', 'invoices', 'notes', 'propose']);
  assert.equal(app.ask.first, true);
  assert.match(app.ask.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(app.tools, [], 'no tool answers before the owner allows it');
  assert.equal(app.pinned, false);
  assert.equal(app.uri, `ui://chausar/apps/${app.id}/v1`);
  assert.ok(app.document.includes(MINI_FRAME_CSP));
  assert.ok(app.document.includes(`protocolVersion:"${APP_PROTOCOL_VERSION}"`));
  assert.ok(app.document.endsWith(`<body>${SHEET}</body></html>`));
  assert.deepEqual(app.messages.map((item: any) => item.from), ['owner', 'chausar']);
  assert.match(app.messages[1].text, /^Here's a first version\. It reads your Clients and your invoices\. It can't send anything by itself; anything it proposes becomes a card on Today/);
  await assert.rejects(call(env, app.id, 'clients_list'), code('APP_NOT_ALLOWED'));
  const listed = await env.call('venture.apps.list');
  assert.deepEqual(listed.apps.map((item: any) => [item.id, item.allowed, item.reads]), [[app.id, false, ['Reads: Clients', 'Reads: Invoices', 'Keeps notes', 'Proposes cards']]]);
  assert.equal(listed.ideas.length, 3);
});

test('6H1: code that reaches outside or writes money is not kept; the reasons are said', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  scriptMaker(env, [{ name: 'Fees', summary: 'Fees.', html: '<p>Fee ₹500</p><script>fetch("https://x.example")</script>' }]);
  await assert.rejects(env.call('venture.apps.make', { ask: 'A fee sheet' }), (error: any) => {
    assert.equal(error.code, 'APP_CODE_REFUSED');
    assert.match(error.message, /internet/);
    assert.match(error.message, /money/);
    return true;
  });
  assert.equal(listRecords(env.store.read(), 'venture-mini-app').length, 0);
});

test('6H1: Allow grants exactly what was shown; reads answer within it, with minimum data and receipts', async () => {
  const env = await chiefBusiness();
  const invoice = await issuedInvoice(env);
  const app = await madeApp(env);
  await assert.rejects(env.call('venture.apps.grant', { app: app.id, digest: '0'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(env.call('venture.apps.grant', { app: app.id, digest: app.ask.digest }, phone), code('APP_APPROVAL_REQUIRED'));
  const granted = await env.call('venture.apps.grant', { app: app.id, digest: app.ask.digest });
  assert.equal(granted.app.ask, null);
  assert.deepEqual(granted.app.tools, ['clients_list', 'invoices_list', 'notes_get', 'notes_set', 'propose']);
  assert.equal(granted.line, 'Who owes me can run now, with only what you allowed.');

  const clients = await call(env, app.id, 'clients_list');
  assert.deepEqual(clients.structuredContent.clients, [{ id: env.client.id, name: 'Asha Rao' }], 'names only: no email');
  assert.equal(clients.content[0].type, 'text');
  const invoices = (await call(env, app.id, 'invoices_list')).structuredContent.invoices;
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].id, invoice.id);
  assert.equal(invoices[0].number, invoice.number);
  const receipt = await env.call('venture.receipt.get', { id: invoices[0].balance.receiptId }) as SumReceiptRecord;
  assert.equal(receipt.figures[0].display, invoices[0].balance.display);
  assert.equal(receipt.stale, false);
  assert.equal('balanceMinor' in invoices[0], false, 'no raw amounts to do sums with');

  await assert.rejects(call(env, app.id, 'orders_list'), code('APP_NOT_ALLOWED'), 'it never asked for orders');
  await assert.rejects(call(env, app.id, 'calculate', { operation: 'add', amounts: ['1'] }), code('APP_NOT_ALLOWED'));
  await assert.rejects(call(env, app.id, 'read_files'), code('APP_TOOL_UNKNOWN'));
  await assert.rejects(env.call('venture.apps.call', { app: app.id, tool: 'clients_list', arguments: {} }, phone), code('APP_APPROVAL_REQUIRED'));
});

test('6H1: notes are the app own, bounded and deleted with it', async () => {
  const env = await chiefBusiness();
  const app = await madeApp(env);
  await env.call('venture.apps.grant', { app: app.id, digest: app.ask.digest });
  assert.deepEqual((await call(env, app.id, 'notes_get')).structuredContent, { notes: {} });
  await call(env, app.id, 'notes_set', { key: 'attendance-mon', value: 'Asha:yes' });
  assert.deepEqual((await call(env, app.id, 'notes_get')).structuredContent, { notes: { 'attendance-mon': 'Asha:yes' } });
  await assert.rejects(call(env, app.id, 'notes_set', { key: 'bad key', value: 'x' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, app.id, 'notes_set', { key: 'big', value: 'x'.repeat(20_001) }), code('INVALID_VENTURE_REQUEST'));
  for (let i = 0; i < 5; i++) await call(env, app.id, 'notes_set', { key: `n${i}`, value: 'y'.repeat(19_000) });
  await assert.rejects(call(env, app.id, 'notes_set', { key: 'n9', value: 'y'.repeat(19_000) }), code('APP_NOTES_FULL'));
  await call(env, app.id, 'notes_set', { key: 'attendance-mon', value: null });
  assert.equal('attendance-mon' in (await call(env, app.id, 'notes_get')).structuredContent.notes, false);
  const removed = await env.call('venture.apps.remove', { app: app.id });
  assert.equal(removed.line, 'Who owes me and its notes are deleted.');
  assert.equal(listRecords(env.store.read(), 'venture-mini-app').length, 0);
  assert.doesNotMatch(JSON.stringify(env.store.read().conversations), /attendance|Asha:yes/);
  await assert.rejects(env.call('venture.apps.get', { app: app.id }), code('APP_NOT_FOUND'));
});

test('6H1: the calculator works amounts out in code with a receipt; the app never gets raw amounts', async () => {
  const env = await chiefBusiness();
  const app = await madeApp(env, '<script>chausar.call("calculate",{operation:"percent-off",amounts:["1500"],percent:"10"})</script>');
  assert.deepEqual(app.permissions.map((item: any) => item.id), ['calculator']);
  await env.call('venture.apps.grant', { app: app.id, digest: app.ask.digest });
  const off = (await call(env, app.id, 'calculate', { operation: 'percent-off', amounts: ['1500'], percent: '10' })).structuredContent.figure;
  assert.equal(off.display, 'INR 1,350.00');
  const receipt = await env.call('venture.receipt.get', { id: off.receiptId }) as SumReceiptRecord;
  assert.equal(receipt.subject.type, 'app-calc');
  assert.equal(receipt.totalMinor, '135000');
  assert.deepEqual(receipt.addends.map(item => item.display), ['INR 1,500.00', 'INR -150.00']);
  const times = (await call(env, app.id, 'calculate', { operation: 'times', amounts: ['499.50'], count: '3' })).structuredContent.figure;
  assert.equal(times.display, 'INR 1,498.50');
  const added = (await call(env, app.id, 'calculate', { operation: 'add', amounts: ['100', '250.25'] })).structuredContent.figure;
  assert.equal(added.display, 'INR 350.25');
  await assert.rejects(call(env, app.id, 'calculate', { operation: 'add', amounts: ['1e5'] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, app.id, 'calculate', { operation: 'percent-off', amounts: ['100'], percent: '101' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, app.id, 'calculate', { operation: 'divide', amounts: ['100'] }), code('INVALID_VENTURE_REQUEST'));
});

test('6H1: an action becomes one card on Today for the owner; nothing is sent', async () => {
  const env = await chiefBusiness();
  const invoice = await issuedInvoice(env);
  const app = await madeApp(env);
  await env.call('venture.apps.grant', { app: app.id, digest: app.ask.digest });
  const journalBefore = listRecords(env.store.read(), 'venture-journal-entry').length;
  const proposed = (await call(env, app.id, 'propose', { kind: 'draft-reminder', invoiceId: invoice.id })).structuredContent;
  assert.equal(proposed.line, 'On Today for your approval.');
  const records = listRecords(env.store.read(), 'venture-proposal');
  assert.equal(records.length, 1);
  assert.equal(records[0].source, 'app');
  assert.equal(records[0].appId, app.id);
  assert.equal(records[0].status, 'raised');
  assert.equal(records[0].proposalKind, 'draft-reminder');
  assert.match(records[0].line, /^From the app "Who owes me"\./);
  const queue = await env.call('venture.queue.list', { scope: 'current' });
  assert.ok(queue.rows.some((row: any) => row.title === records[0].title && row.kind === 'proposal'));
  const again = (await call(env, app.id, 'propose', { kind: 'draft-reminder', invoiceId: invoice.id })).structuredContent;
  assert.equal(again.line, 'It is on Today already.');
  assert.equal(listRecords(env.store.read(), 'venture-proposal').length, 1);
  assert.equal(listRecords(env.store.read(), 'venture-journal-entry').length, journalBefore, 'proposing sends nothing');
  await assert.rejects(call(env, app.id, 'propose', { kind: 'draft-reminder', invoiceId: 'invoice_missing' }), code('APP_PROPOSAL_REFUSED'));
  await assert.rejects(call(env, app.id, 'propose', { kind: 'brief-agent', invoiceId: invoice.id }), code('INVALID_VENTURE_REQUEST'));
});

test('6H1: a change is a new version; more needs ask again while the rest keeps working; undo goes back', async () => {
  const env = await chiefBusiness();
  const app = await madeApp(env);
  await env.call('venture.apps.grant', { app: app.id, digest: app.ask.digest });
  const tasks = scriptMaker(env, [{ name: 'Another name', summary: 'Now with orders.', html: WITH_ORDERS }]);
  const changed = (await env.call('venture.apps.make', { ask: 'Add each client order', app: app.id })).app;
  assert.ok(JSON.stringify(tasks[0].input).includes('chausar.call(\\"clients_list\\")'), 'the AI sees the current code to change it');
  assert.equal(changed.version, 2);
  assert.equal(changed.name, 'Who owes me', 'a change keeps the name');
  assert.deepEqual(changed.ask.added, ['orders']);
  assert.equal(changed.ask.first, false);
  assert.ok(!changed.tools.includes('orders_list'));
  assert.ok(changed.tools.includes('clients_list'));
  await call(env, app.id, 'clients_list');
  await assert.rejects(call(env, app.id, 'orders_list'), code('APP_NOT_ALLOWED'));
  assert.deepEqual(changed.versions.map((item: any) => [item.version, item.current]), [[1, false], [2, true]]);
  assert.match(changed.messages.at(-1).text, /^Here's version 2\./);
  const back = await env.call('venture.apps.restore', { app: app.id, version: 1 });
  assert.equal(back.app.version, 1);
  assert.deepEqual(back.undo, { version: 2 });
  assert.equal(back.app.ask, null);
  assert.equal(back.line, 'Now on version 1. Undo goes back.');
  await assert.rejects(env.call('venture.apps.restore', { app: app.id, version: 9 }), code('INVALID_VENTURE_REQUEST'));
  const revoked = await env.call('venture.apps.revoke', { app: app.id });
  assert.deepEqual(revoked.app.tools, []);
  assert.equal(revoked.app.ask.first, true);
});

test('6H1: pin to Today with undo, and export as one file that has no data', async () => {
  const env = await chiefBusiness();
  const app = await madeApp(env);
  const pinned = await env.call('venture.apps.pin', { app: app.id, pinned: true });
  assert.equal(pinned.app.pinned, true);
  assert.deepEqual(pinned.undo, { pinned: false });
  assert.equal(pinned.line, 'Pinned to Today.');
  assert.equal((await env.call('venture.apps.list')).apps[0].pinned, true);
  const file = await env.call('venture.apps.export', { app: app.id });
  assert.equal(file.fileName, 'who-owes-me.html');
  assert.equal(file.mediaType, 'text/html');
  assert.ok(file.document.includes(MINI_FRAME_CSP));
  assert.ok(file.document.includes(OFFLINE_LINE));
  assert.ok(!file.document.includes('ui/initialize'));
  assert.ok(file.document.endsWith(`<body>${SHEET}</body></html>`));
  await assert.rejects(env.call('venture.apps.export', { app: app.id }, phone), code('APP_APPROVAL_REQUIRED'));
});
