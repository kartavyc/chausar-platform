import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PhoneClient } from '../runtime/phone/client.ts';
import { PhoneError } from '../runtime/phone/contracts.ts';
import type { Brief, PhoneMethods, PhoneTransport } from '../runtime/phone/contracts.ts';
import { CompanionController } from '../../app/companion/shared/controller.ts';
import { DEMO_INVITE, MemoryPreviewBriefCache, MemoryPreviewCredentials, PreviewPhoneTransport, previewIdentity, previewPicker, previewReceipts } from '../../app/companion/shared/preview.ts';
import { readFile } from 'node:fs/promises';
import { approvalTitleText, emptyPhonePage, headlineText, phonePageView, phonePageWords } from '../../app/companion/shared/phone-page.ts';
import type { PhonePageView } from '../../app/companion/shared/phone-page.ts';
import type { CompanionViewState } from '../../app/companion/shared/view-contracts.ts';
import { createPhoneWebPreviewServer } from '../../scripts/phone-web-preview.mjs';

// PH-04 "The phone page" (experimental). Synthetic fixtures only.
type Handler = (method: keyof PhoneMethods, input: any, auth: { credential?: string; signal: AbortSignal }) => unknown | Promise<unknown>;
function fixture(options: { phonePage?: boolean; handler?: (original: Handler) => Handler } = {}) {
  let time = Date.now(); let sequence = 0; const clock = () => time;
  const preview = new PreviewPhoneTransport({ clock }); const original: Handler = (method, input, auth) => preview.request(method, input, auth);
  const handle = options.handler?.(original) ?? original;
  const transport: PhoneTransport = { request: async (method, input, auth) => await handle(method, input, auth) as any };
  const client = new PhoneClient({ channel: 'ios', transport, credentials: new MemoryPreviewCredentials(), cache: new MemoryPreviewBriefCache(clock), clock, crypto: globalThis.crypto });
  const controller = new CompanionController({ client, identity: previewIdentity('ios'), picker: previewPicker, receipts: previewReceipts, crypto: globalThis.crypto, mode: 'demo',
    requestId: () => `request_page_${++sequence}`, ...(options.phonePage === undefined ? {} : { experiments: { phonePage: options.phonePage } }) });
  return { client, controller, preview, advance: (ms: number) => { time += ms; }, now: clock };
}
async function paired(options: Parameters<typeof fixture>[0] = { phonePage: true }) {
  const f = fixture(options); await f.controller.start(); await f.controller.pair(DEMO_INVITE); assert.equal(f.controller.getState().client.pairing.status, 'paired'); return f;
}
const view = (f: ReturnType<typeof fixture>) => phonePageView(f.controller.getState(), f.now())!;
const calls = (f: ReturnType<typeof fixture>, method: keyof PhoneMethods) => f.preview.calls.filter(item => item === method).length;
const brief = (id: string, title: string, minutesAgo: number): Brief => ({ id, workspaceId: 'demo_shop', version: 'v1', generatedAt: new Date(Date.now() - minutesAgo * 60000).toISOString(), title, summary: 'Summary text with 1,250 that must never reach the page.', receiptIds: [] });

test('the phone page is off by default: no state, no tab route, no page calls', async () => {
  for (const options of [{}, { phonePage: false }]) {
    const f = await paired(options); const state = f.controller.getState();
    assert.equal(state.phonePage, undefined); assert.equal(phonePageView(state, f.now()), undefined);
    assert.throws(() => f.controller.navigate('phone-page'), (error: unknown) => error instanceof PhoneError && error.code === 'INVALID_REQUEST');
    await assert.rejects(f.controller.loadPhonePage(), (error: unknown) => error instanceof PhoneError && error.code === 'INVALID_REQUEST');
    await assert.rejects(f.controller.approveOnPhone('demo_internal_note'), (error: unknown) => error instanceof PhoneError);
    assert.throws(() => f.controller.dismissPhoneApproval());
    assert.equal(calls(f, 'approval.list'), 0);
  }
});

test('switched on: same count as the inbox, Approve only on the simple reversible row, In the app elsewhere', async () => {
  const f = await paired(); f.controller.navigate('phone-page'); assert.equal(f.controller.getState().screen, 'phone-page');
  await f.controller.loadPhonePage(); await f.controller.loadApprovals();
  const page = view(f); const state = f.controller.getState();
  assert.equal(page.experimental, true); assert.equal(page.readOnly, false);
  assert.equal(page.review.status, 'loaded'); assert.equal(page.review.count, state.approvalInbox.length); assert.equal(page.review.count, 2);
  assert.deepEqual(page.review.rows.map(row => [row.approvalId, row.action]), [['demo_internal_note', 'approve'], ['demo_money', 'in-the-app']]);
  assert.equal(calls(f, 'approval.inspect'), 0, 'loading the page mints no approval challenge');
  // Headlines only: brief titles, never summaries.
  assert.deepEqual(page.weekAhead.sort(), ['A quieter cash check', 'Your week, at a glance']);
  assert.equal(JSON.stringify(state.phonePage).includes('Synthetic preview:'), false);
  // Laptop last seen is the engine-stamped validation time.
  assert.equal(page.lastSeen.known, true);
  const pairing = state.client.pairing; assert.ok(pairing.status === 'paired' && page.lastSeen.known && page.lastSeen.at === pairing.authority.validatedAt);
});

test('rows without an engine eligibility hint say In the app and cannot start an approval', async () => {
  const f = await paired({ phonePage: true, handler: original => async (method, input, auth) => method === 'approval.list'
    ? [{ approvalId: 'demo_internal_note', title: 'Save the review note' }] : original(method, input, auth) });
  await f.controller.loadPhonePage();
  assert.deepEqual(view(f).review.rows.map(row => row.action), ['in-the-app']);
  await f.controller.approveOnPhone('demo_internal_note');
  assert.equal(calls(f, 'approval.inspect'), 0); assert.equal(f.controller.getState().phonePage!.confirm, undefined);
  assert.match(f.controller.getState().notice!.text, /desktop/);
});

test('Approve goes through inspect, a held single-use token and submit; the count then refreshes', async () => {
  const f = await paired(); await f.controller.loadPhonePage();
  await f.controller.approveOnPhone('demo_internal_note');
  const state = f.controller.getState(); assert.equal(calls(f, 'approval.inspect'), 1); assert.equal(calls(f, 'approval.submit'), 0);
  assert.deepEqual(state.phonePage!.confirm && { id: state.phonePage!.confirm.approvalId, title: state.phonePage!.confirm.title }, { id: 'demo_internal_note', title: 'Save the internal review note' });
  assert.equal(JSON.stringify(state).includes('b'.repeat(64)), false, 'the token never enters view state');
  assert.equal(view(f).confirm!.expired, false);
  await f.controller.confirmPhoneApproval();
  assert.equal(calls(f, 'approval.submit'), 1); assert.equal(view(f).review.count, 1);
  assert.deepEqual(view(f).review.rows.map(row => row.action), ['in-the-app']);
  assert.equal(f.controller.getState().phonePage!.confirm, undefined); assert.match(f.controller.getState().notice!.text, /Approved/);
  const request = f.controller.getState().client.requests.at(-1)!; assert.equal(request.status, 'succeeded');
});

test('Not now drops the decision without submitting', async () => {
  const f = await paired(); await f.controller.loadPhonePage(); await f.controller.approveOnPhone('demo_internal_note');
  f.controller.dismissPhoneApproval(); assert.equal(f.controller.getState().phonePage!.confirm, undefined);
  await f.controller.confirmPhoneApproval(); assert.equal(calls(f, 'approval.submit'), 0);
});

test('a hint the fresh preview contradicts turns the row into In the app and never submits', async () => {
  const f = await paired({ phonePage: true, handler: original => async (method, input, auth) => method === 'approval.list'
    ? [{ approvalId: 'demo_money', title: 'Payment', eligibility: 'simple-reversible' }] : original(method, input, auth) });
  await f.controller.loadPhonePage(); assert.equal(view(f).review.rows[0].action, 'approve');
  await f.controller.approveOnPhone('demo_money');
  assert.equal(calls(f, 'approval.inspect'), 1); assert.equal(f.controller.getState().phonePage!.confirm, undefined);
  assert.equal(view(f).review.rows[0].action, 'in-the-app'); assert.match(f.controller.getState().notice!.text, /in the app/);
  await f.controller.confirmPhoneApproval(); assert.equal(calls(f, 'approval.submit'), 0);
});

test('an expired preview disables Approve and is refused without a submit', async () => {
  const f = await paired(); await f.controller.loadPhonePage(); await f.controller.approveOnPhone('demo_internal_note');
  f.advance(300001); assert.equal(view(f).confirm!.expired, true);
  await f.controller.confirmPhoneApproval();
  assert.equal(calls(f, 'approval.submit'), 0); assert.match(f.controller.getState().notice!.text, /expired/);
});

test('a preview that changed after inspect is refused by the engine and shown as changed', async () => {
  const f = await paired(); await f.controller.loadPhonePage(); await f.controller.approveOnPhone('demo_internal_note');
  f.preview.changeOperationVersion('demo-note:2.0'); await f.controller.confirmPhoneApproval();
  assert.equal(calls(f, 'approval.submit'), 1); assert.match(f.controller.getState().notice!.text, /changed/);
  assert.equal(f.controller.getState().phonePage!.confirm, undefined);
});

test('the week ahead is at most three headlines, latest first; a headline with any digit becomes fixed words', async () => {
  const briefs = [brief('b_old', 'Old and quiet', 50), brief('b_one', 'Sales rose 12 percent', 1), brief('b_two', 'A calm week ahead', 2), brief('b_three', 'GST due on १५ October', 3), brief('b_four', 'Supplier call', 4)];
  const f = await paired({ phonePage: true, handler: original => async (method, input, auth) => method === 'brief.list' ? structuredClone(briefs) : original(method, input, auth) });
  await f.controller.loadPhonePage();
  assert.deepEqual(view(f).weekAhead, [phonePageWords.en.figureHeadline, 'A calm week ahead', phonePageWords.en.figureHeadline]);
  assert.equal(headlineText('   '), phonePageWords.en.figureHeadline); assert.equal(headlineText(' Two   spaces '), 'Two spaces');
  assert.equal(headlineText('Rs ٣ due'), phonePageWords.en.figureHeadline);
  assert.equal(JSON.stringify(f.controller.getState().phonePage).includes('1,250'), false, 'brief summaries are not kept');
});

test('approval row and confirm titles pass the digit check: a title with a figure becomes fixed words', async () => {
  const f = await paired({ phonePage: true, handler: original => async (method, input, auth) => {
    if (method === 'approval.list') return [{ approvalId: 'demo_internal_note', title: 'Pay ₹4,500', eligibility: 'simple-reversible' },
      { approvalId: 'demo_money', title: 'GST due on १५ October' }, { approvalId: 'demo_plain', title: '  Save   the note ' }];
    if (method === 'approval.inspect') {
      const challenge = await original(method, input, auth) as { preview: Record<string, unknown> };
      return { ...challenge, preview: { ...challenge.preview, title: 'Pay ₹4,500 to Sharma' } };
    }
    return original(method, input, auth);
  } });
  await f.controller.loadPhonePage();
  assert.deepEqual(view(f).review.rows.map(row => row.title), [phonePageWords.en.figureTitle, phonePageWords.en.figureTitle, 'Save the note']);
  await f.controller.approveOnPhone('demo_internal_note');
  assert.equal(view(f).confirm!.title, phonePageWords.en.figureTitle);
  assert.equal(view(f).confirm!.approvalId, 'demo_internal_note');
  assert.doesNotMatch(JSON.stringify(view(f)), /4,500|१५/);
  assert.equal(approvalTitleText('Rs ٣ refund'), phonePageWords.en.figureTitle);
  assert.equal(approvalTitleText(''), phonePageWords.en.figureTitle);
  assert.equal(phonePageWords.en.figureTitle, 'A change with figures. See it in the app.');
});

test('the native screen draws row and confirm titles only through the digit check', async () => {
  const source = await readFile(new URL('../../app/companion/native/src/ui/screens.tsx', import.meta.url), 'utf8');
  const page = source.slice(source.indexOf('export function PhonePageScreen'));
  assert.doesNotMatch(page, /\{row\.title\}|\$\{row\.title\}|\{view\.confirm\.title\}/);
  assert.match(page, /approvalTitleText\(row\.title, words\)/);
  assert.match(page, /approvalTitleText\(view\.confirm\.title, words\)/);
});

test('fixed words carry no digits', () => {
  for (const [key, text] of Object.entries(phonePageWords.en)) assert.doesNotMatch(text, /\p{Nd}/u, key);
});

test('offline the saved view stays readable and read only: no Approve, no confirm, no remote call', async () => {
  const f = await paired(); await f.controller.openBrief('demo_weekly_brief'); await f.controller.loadPhonePage(); await f.controller.approveOnPhone('demo_internal_note');
  const seen = view(f).lastSeen; f.controller.disconnect();
  let page = view(f);
  assert.equal(page.readOnly, true); assert.equal(page.review.saved, true); assert.equal(page.confirm, undefined); assert.equal(f.controller.getState().phonePage!.confirm, undefined);
  assert.deepEqual(page.review.rows.map(row => row.action), ['in-the-app', 'in-the-app']); assert.equal(page.review.count, 2);
  assert.deepEqual(page.lastSeen, seen, 'last seen keeps the last real validation time');
  const before = f.preview.calls.length; await f.controller.loadPhonePage(); page = view(f);
  assert.equal(f.preview.calls.length, before); assert.deepEqual(page.weekAhead, ['Your week, at a glance']);
  await f.controller.approveOnPhone('demo_internal_note'); assert.equal(f.preview.calls.length, before);
  // Reconnecting does not revive Approve until the list is fresh again.
  await f.controller.reconnect(); assert.equal(view(f).review.saved, true); assert.deepEqual(view(f).review.rows.map(row => row.action), ['in-the-app', 'in-the-app']);
  await f.controller.loadPhonePage(); assert.equal(view(f).review.rows[0].action, 'approve');
});

test('laptop last seen is Not known until the engine validates, and never a guessed or future time', async () => {
  const f = fixture({ phonePage: true }); await f.controller.start();
  assert.deepEqual(phonePageView(f.controller.getState(), f.now())!.lastSeen, { known: false });
  const state = f.controller.getState();
  const future: CompanionViewState = { ...state, phonePage: { ...emptyPhonePage(), lastSeenAt: new Date(f.now() + 60000).toISOString() } };
  assert.deepEqual(phonePageView(future, f.now())!.lastSeen, { known: false });
  const garbage: CompanionViewState = { ...state, phonePage: { ...emptyPhonePage(), lastSeenAt: 'yesterday' } };
  assert.deepEqual(phonePageView(garbage, f.now())!.lastSeen, { known: false });
  assert.equal(phonePageView(f.controller.getState(), f.now())!.review.status, 'not-loaded');
});

test('an engine that does not serve approval.list shows the review list as in the app, headlines still load', async () => {
  const f = await paired({ phonePage: true, handler: original => async (method, input, auth) => { if (method === 'approval.list') throw new PhoneError('OPEN_DESKTOP'); return original(method, input, auth); } });
  await f.controller.loadPhonePage(); const page = view(f);
  assert.equal(page.review.status, 'unavailable'); assert.equal(page.review.count, undefined); assert.equal(page.weekAhead.length, 2);
});

test('the client refuses an unknown eligibility hint from the transport', async () => {
  const f = await paired({ phonePage: true, handler: original => async (method, input, auth) => method === 'approval.list'
    ? [{ approvalId: 'demo_internal_note', title: 'Note', eligibility: 'anything-goes' }] : original(method, input, auth) });
  await f.controller.loadPhonePage();
  assert.equal(view(f).review.status, 'not-loaded'); assert.match(f.controller.getState().notice!.text, /could not confirm/);
});

test('revoking the device clears the page, including last seen', async () => {
  const f = await paired(); await f.controller.loadPhonePage(); await f.controller.revokeDevice();
  const page = phonePageView(f.controller.getState(), f.now())!;
  assert.equal(page.review.status, 'not-loaded'); assert.deepEqual(page.weekAhead, []); assert.deepEqual(page.lastSeen, { known: false });
});

// Web client DOM: the renderer only shows what the display model allows.
async function dom() {
  const jsdom = 'jsdom'; const { JSDOM } = await import(jsdom); const window = new JSDOM('<!doctype html><body></body>').window;
  const modulePath = '../../app/companion/web/phone-page.mjs'; const { renderPhonePage } = await import(modulePath);
  return { document: window.document as Document, renderPhonePage: renderPhonePage as (input: unknown) => HTMLElement };
}
const baseView = (patch: Partial<PhonePageView> = {}): PhonePageView => ({ experimental: true, readOnly: false,
  review: { status: 'loaded', count: 3, saved: false, rows: [{ approvalId: 'note', title: 'Save the review note', action: 'approve' }, { approvalId: 'money', title: 'Pay the supplier', action: 'in-the-app' }, { approvalId: 'mail', title: 'Send a reminder', action: 'in-the-app' }] },
  weekAhead: ['One', 'Two', 'Three'], lastSeen: { known: false }, ...patch });

test('web client renders Approve only on approve rows, In the app elsewhere, three headlines and Not known', async () => {
  const { document, renderPhonePage } = await dom(); const taps: string[] = [];
  const root = renderPhonePage({ document, view: baseView(), words: phonePageWords.en, busy: false, run: (action: () => unknown) => { action(); },
    formatTime: () => 'formatted', formatCount: (count: number) => `count:${count}`,
    actions: { refresh: () => taps.push('refresh'), approve: (id: string) => taps.push(`approve:${id}`), confirm: () => taps.push('confirm'), notNow: () => taps.push('not-now') } });
  document.body.append(root);
  assert.equal(root.dataset.experimental, 'true'); assert.match(document.querySelector('#phone-page-experimental')!.textContent!, /Experimental/);
  assert.equal(document.querySelector('#phone-review-count')!.textContent, 'count:3');
  const rows = [...document.querySelectorAll('.phone-row')];
  assert.deepEqual(rows.map(row => [row.getAttribute('data-approval-id'), row.querySelector('button')?.textContent ?? row.querySelector('.phone-in-app')?.textContent]),
    [['note', 'Approve'], ['money', 'In the app'], ['mail', 'In the app']]);
  assert.equal(document.querySelectorAll('.phone-row button').length, 1);
  assert.deepEqual([...document.querySelectorAll('.phone-headlines li')].map(item => item.textContent), ['One', 'Two', 'Three']);
  assert.equal(document.querySelector('#phone-last-seen')!.textContent, 'Laptop last seen: Not known');
  (document.querySelector('.phone-row button') as HTMLButtonElement).click(); assert.deepEqual(taps, ['approve:note']);
});

test('web client confirm step and read-only view', async () => {
  const { document, renderPhonePage } = await dom(); const taps: string[] = [];
  const input = (view: PhonePageView) => ({ document, view, words: phonePageWords.en, busy: false, run: (action: () => unknown) => { action(); }, formatTime: () => 'Monday, ten past nine', formatCount: String,
    actions: { refresh: () => taps.push('refresh'), approve: () => taps.push('approve'), confirm: () => taps.push('confirm'), notNow: () => taps.push('not-now') } });
  const confirming = renderPhonePage(input(baseView({ confirm: { approvalId: 'note', title: 'Save the internal review note', expiresAt: new Date().toISOString(), expired: false }, lastSeen: { known: true, at: new Date().toISOString() } })));
  assert.equal(confirming.querySelectorAll('.phone-row button').length, 0, 'the row button gives way to the confirm step');
  (confirming.querySelector('#phone-confirm-approve') as HTMLButtonElement).click(); (confirming.querySelector('#phone-confirm-not-now') as HTMLButtonElement).click();
  assert.deepEqual(taps, ['confirm', 'not-now']); assert.equal(confirming.querySelector('#phone-last-seen')!.textContent, 'Laptop last seen: Monday, ten past nine');
  const expired = renderPhonePage(input(baseView({ confirm: { approvalId: 'note', title: 'Note', expiresAt: new Date(0).toISOString(), expired: true } })));
  assert.equal((expired.querySelector('#phone-confirm-approve') as HTMLButtonElement).disabled, true);
  const readOnly = renderPhonePage(input(baseView({ readOnly: true, review: { status: 'loaded', count: 1, saved: true, rows: [{ approvalId: 'note', title: 'Note', action: 'in-the-app' }] }, weekAhead: [] })));
  assert.deepEqual([...readOnly.querySelectorAll('button')].map(node => node.id), ['phone-page-refresh']);
  assert.match(readOnly.textContent!, /Read only/); assert.match(readOnly.textContent!, /not ready yet/);
  const unavailable = renderPhonePage(input(baseView({ review: { status: 'unavailable', rows: [], saved: false } })));
  assert.equal(unavailable.querySelector('#phone-review-count'), null); assert.match(unavailable.textContent!, /in the app on your computer/);
});

test('web client draws a row or confirm title with a figure as fixed words, aria-label too', async () => {
  const { document, renderPhonePage } = await dom();
  const root = renderPhonePage({ document, words: phonePageWords.en, busy: false, run: (action: () => unknown) => { action(); }, formatTime: String, formatCount: String,
    actions: { refresh: () => {}, approve: () => {}, confirm: () => {}, notNow: () => {} },
    view: baseView({ review: { status: 'loaded', count: 3, saved: false, rows: [
      { approvalId: 'pay', title: 'Pay ₹4,500', action: 'approve' }, { approvalId: 'gst', title: 'GST due on १५ October', action: 'in-the-app' },
      { approvalId: 'note', title: 'Save the review note', action: 'approve' }] },
      confirm: { approvalId: 'note', title: 'Save note 2', expiresAt: new Date(Date.now() + 60000).toISOString(), expired: false } }) });
  assert.deepEqual([...root.querySelectorAll('.phone-rows .phone-row-title')].map(node => node.textContent),
    [phonePageWords.en.figureTitle, phonePageWords.en.figureTitle, 'Save the review note', phonePageWords.en.figureTitle]);
  assert.equal(root.querySelector('.phone-row button')!.getAttribute('aria-label'), `Approve: ${phonePageWords.en.figureTitle}`);
  assert.doesNotMatch(root.textContent!, /4,500|१५|note 2/);
});

function get(port: number, path: string) {
  return new Promise<string>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, agent: false }, response => { let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve(`${response.statusCode}\n${body}`)); });
    req.on('error', reject); req.end();
  });
}
async function withPreview(options: { phonePage?: boolean } | undefined, run: (port: number) => Promise<void>) {
  const server = createPhoneWebPreviewServer(options);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { await run((server.address() as AddressInfo).port); }
  finally { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); }
}

test('web preview shows the page only when started with the explicit option', async () => {
  await withPreview(undefined, async port => {
    const page = await get(port, '/'); assert.match(page, /^200/); assert.doesNotMatch(page, /chausar-experiment/);
    assert.match(await get(port, '/app/companion/web/phone-page.mjs'), /^200\n[\s\S]*renderPhonePage/);
    const shared = await get(port, '/app/companion/shared/phone-page.ts'); assert.match(shared, /^200/); assert.doesNotMatch(shared, /export type/);
  });
  await withPreview({ phonePage: true }, async port => {
    assert.match(await get(port, '/'), /<meta name="chausar-experiment" content="phone-page">/);
    assert.match(await get(port, '/index.html'), /chausar-experiment/);
  });
});
