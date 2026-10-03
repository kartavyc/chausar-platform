import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneClient } from '../runtime/phone/client.ts';
import type { PhoneRequestRestoration } from '../runtime/phone/client.ts';
import { CompanionController } from '../../app/companion/shared/controller.ts';
import { DEMO_INVITE, demoDocument, MemoryPreviewBriefCache, MemoryPreviewCredentials, PreviewPhoneTransport, previewIdentity, previewPicker, previewReceipts } from '../../app/companion/shared/preview.ts';
import { approvalCanDecide, requestControls, uploadStatus } from '../../app/companion/native/src/ui/view-helpers.ts';
import type { CompanionReceiptReader, CompanionDocumentPicker } from '../../app/companion/shared/view-contracts.ts';
import type { PhoneMethods, PhoneTransport, SessionAuthority } from '../runtime/phone/contracts.ts';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
type Handler = (method: keyof PhoneMethods, input: any, auth: { credential?: string; signal: AbortSignal }) => unknown | Promise<unknown>;
function fixture(options: { receipts?: CompanionReceiptReader; picker?: CompanionDocumentPicker; handler?: (original: Handler) => Handler; requestRestoration?: PhoneRequestRestoration; mode?: 'demo' | 'live' } = {}) {
  let time = Date.now(); let sequence = 0;
  const clock = () => time; const credentials = new MemoryPreviewCredentials(); const cache = new MemoryPreviewBriefCache(clock); const preview = new PreviewPhoneTransport({ clock });
  const original: Handler = (method, input, auth) => preview.request(method, input, auth);
  const handle = options.handler?.(original) ?? original;
  const transport: PhoneTransport = { request: async (method, input, auth) => await handle(method, input, auth) as any };
  const client = new PhoneClient({ channel: 'ios', transport, credentials, cache, clock, crypto: globalThis.crypto, requestRestoration: options.requestRestoration });
  const controller = new CompanionController({ client, identity: previewIdentity('ios'), picker: options.picker ?? previewPicker, receipts: options.receipts ?? previewReceipts, crypto: globalThis.crypto, mode: options.mode ?? 'demo', requestId: () => `request_demo_${++sequence}` });
  return { client, controller, credentials, cache, transport, preview, advance: (ms: number) => { time += ms; }, time: clock };
}
async function paired(options: Parameters<typeof fixture>[0] = {}) { const f = fixture(options); await f.controller.start(); await f.controller.pair(DEMO_INVITE); assert.equal(f.controller.getState().client.pairing.status, 'paired'); return f; }

test('screens start unpaired and pairing exposes stable immutable synthetic workspace state without secrets', async () => {
  const f = fixture(); const initial = f.controller.getState(); assert.equal(f.controller.getState(), initial); assert.ok(Object.isFrozen(initial));
  let updates = 0; const unsubscribe = f.controller.subscribe(() => { updates += 1; });
  await f.controller.start(); await f.controller.pair(DEMO_INVITE);
  const state = f.controller.getState(); assert.equal(state.screen, 'briefs'); assert.equal(state.briefs.length, 2); assert.equal(state.mode, 'demo'); assert.match(state.notice!.text, /synthetic/); assert.ok(updates > 2);
  assert.equal(JSON.stringify(state).includes('synthetic-preview-credential'), false); assert.equal(JSON.stringify(state).includes(DEMO_INVITE), false); unsubscribe();
});
test('all screen routes work and unpaired errors reveal neither raw invite nor adapter message', async () => {
  const f = fixture(); await f.controller.start(); await f.controller.pair('private-invalid-invite'); assert.equal(f.controller.getState().client.pairing.status, 'unpaired'); assert.equal(JSON.stringify(f.controller.getState()).includes('private-invalid-invite'), false);
  for (const screen of ['pairing', 'briefs', 'chat', 'uploads', 'approvals', 'activity', 'device', 'receipt'] as const) { f.controller.navigate(screen); assert.equal(f.controller.getState().screen, screen); }
  await f.controller.sendChat('Hello'); assert.equal(f.controller.getState().messages.length, 0); assert.equal(f.preview.calls.includes('chat.start'), false);
});
test('chat pending activity is reconciled by ID and proof opens the receipt screen', async () => {
  const f = await paired(); await f.controller.sendChat('What changed?'); let state = f.controller.getState(); assert.equal(state.messages.length, 1); assert.equal(state.client.requests[0].status, 'pending');
  await f.controller.refreshRequest(state.client.requests[0].requestId); state = f.controller.getState(); assert.equal(state.messages.length, 2); assert.equal(state.messages[1].role, 'companion'); assert.equal(state.client.requests[0].status, 'succeeded');
  assert.equal(state.messages[1].conversationId, `chat_${state.client.requests[0].requestId}`);
  await f.controller.openReceipt(state.messages[1].receiptIds[0]); assert.equal(f.controller.getState().screen, 'receipt'); const receipt = f.controller.getState().receipt!; assert.ok('source' in receipt); assert.match(receipt.source, /Made-up/);
});
test('in-flight chat reservations publish before reply and remain cancellable while chat is busy', async () => {
  const entered = deferred<void>(); const reply = deferred<unknown>();
  const f = await paired({ handler: original => async (method, input, auth) => { if (method === 'chat.start') { entered.resolve(); return reply.promise; } return original(method, input, auth); } });
  const chatting = f.controller.sendChat('Hold this answer'); await entered.promise; const state = f.controller.getState();
  assert.equal(state.client.requests.length, 1); assert.equal(state.client.requests[0].status, 'pending'); assert.equal(state.client.pairing.status, 'paired'); assert.ok(state.busy.includes('chat'));
  assert.ok(requestControls(state, state.client.requests[0]).canCancel);
  await f.controller.cancelRequest(state.client.requests[0].requestId); reply.resolve({ status: 'pending', requestId: state.client.requests[0].requestId }); await chatting;
  assert.equal(f.controller.getState().client.requests[0].status, 'cancelled'); assert.equal(f.controller.getState().messages.length, 1);
});
test('a pending chat cancellation shows acknowledged cancellation rather than local completion', async () => {
  const f = await paired(); await f.controller.sendChat('Question'); const id = f.controller.getState().client.requests[0].requestId;
  await f.controller.cancelRequest(id); assert.equal(f.controller.getState().client.requests[0].status, 'cancelled'); assert.equal(f.preview.calls.filter(method => method === 'request.cancel').length, 1);
});
test('lost chat delivery stays unknown; reconnect never resends its question', async () => {
  const f = await paired(); f.preview.dropNextResponse('chat.start'); await f.controller.sendChat('Question');
  assert.equal(f.controller.getState().client.requests[0].status, 'unknown'); assert.equal(f.controller.getState().client.connection, 'offline'); assert.match(f.controller.getState().notice!.text, /unknown/);
  await f.controller.reconnect(); assert.equal(f.controller.getState().client.requests[0].status, 'succeeded'); assert.equal(f.preview.calls.filter(method => method === 'chat.start').length, 1);
});
test('picked documents keep the awaiting-confirmation state and import stays desktop-owned', async () => {
  const f = await paired(); await f.controller.chooseDocument(); const state = f.controller.getState();
  assert.equal(state.uploads[0].status, 'awaiting-confirmation'); assert.equal(uploadStatus(state.uploads[0].status), 'Confirmation needed'); assert.match(state.notice!.text, /desktop/);
  const request = state.client.requests[0]; assert.equal(request.status, 'succeeded'); if (request.status === 'succeeded') assert.ok('sourceTainted' in request.result && request.result.sourceTainted === true);
});
test('active upload can be cancelled from Activity and a late chunk never finishes import', async () => {
  const entered = deferred<void>(); const reply = deferred<unknown>();
  const f = await paired({ handler: original => async (method, input, auth) => { if (method === 'upload.chunk') { entered.resolve(); return reply.promise; } return original(method, input, auth); } });
  const uploading = f.controller.uploadDocument(demoDocument()); await entered.promise; const state = f.controller.getState(); const id = state.client.requests[0].requestId;
  assert.ok(state.busy.includes('upload')); assert.ok(requestControls(state, state.client.requests[0]).canCancel);
  await f.controller.cancelRequest(id); reply.resolve({ nextOffset: demoDocument().bytes.length }); await uploading;
  assert.equal(f.controller.getState().client.requests[0].status, 'cancelled'); assert.equal(f.controller.getState().uploads[0].status, 'cancelled'); assert.equal(f.preview.calls.includes('upload.finish'), false);
});
test('saved brief detail and catalogue remain read only offline with no outgoing request', async () => {
  const f = await paired(); await f.controller.openBrief('demo_weekly_brief'); const count = f.preview.calls.length; f.controller.disconnect();
  await f.controller.loadBriefs(); assert.equal(f.controller.getState().briefs.length, 1); assert.equal(f.controller.getState().briefs[0].freshness, 'cached');
  await f.controller.openBrief('demo_weekly_brief'); const state = f.controller.getState(); assert.equal(state.brief!.freshness, 'cached'); assert.equal(state.brief!.readOnly, true); assert.equal(f.preview.calls.length, count);
  await f.controller.reconnect(); assert.equal(f.controller.getState().briefs[0].freshness, 'cached'); await f.controller.loadBriefs(); assert.equal(f.controller.getState().briefs[0].freshness, 'current');
});
test('expired cached catalogue is empty and cannot supply authority', async () => {
  const f = await paired(); await f.controller.openBrief('demo_weekly_brief'); f.controller.disconnect(); f.advance(86400001); await f.controller.loadBriefs(); assert.equal(f.controller.getState().briefs.length, 0);
  await f.controller.sendChat('offline'); assert.equal(f.preview.calls.includes('chat.start'), false);
});
test('approval inbox shows simple and desktop-required actions while tokens stay private', async () => {
  const f = await paired(); await f.controller.loadApprovals(); assert.equal(f.controller.getState().approvalInbox.length, 2);
  await f.controller.inspectApproval('demo_internal_note'); assert.equal(Object.hasOwn(f.controller.getState().approval!, 'token'), false); assert.ok(approvalCanDecide(f.controller.getState(), f.time()));
  await f.controller.decideApproval('approve'); assert.equal(f.controller.getState().approval, undefined); assert.equal(f.controller.getState().client.requests[0].status, 'succeeded'); assert.equal(f.preview.calls.filter(method => method === 'approval.submit').length, 1);
  await f.controller.decideApproval('approve'); assert.equal(f.preview.calls.filter(method => method === 'approval.submit').length, 1);
});
test('offline approval taps are never sent or replayed and reconnection requires a fresh preview', async () => {
  const f = await paired(); await f.controller.inspectApproval('demo_internal_note'); f.controller.disconnect(); await f.controller.decideApproval('approve'); await f.controller.reconnect(); await f.controller.decideApproval('approve');
  assert.equal(f.preview.calls.includes('approval.submit'), false); assert.equal(f.controller.getState().approval, undefined);
  await f.controller.inspectApproval('demo_internal_note'); await f.controller.decideApproval('reject'); assert.equal(f.preview.calls.filter(method => method === 'approval.submit').length, 1);
});
test('expired previews and desktop-only actions cannot be submitted from native controls or controller', async () => {
  const f = await paired(); await f.controller.inspectApproval('demo_internal_note'); f.advance(300001); assert.equal(approvalCanDecide(f.controller.getState(), f.time()), false); await f.controller.decideApproval('approve'); assert.equal(f.preview.calls.includes('approval.submit'), false);
  await f.controller.inspectApproval('demo_money'); assert.equal(approvalCanDecide(f.controller.getState(), f.time()), false); await f.controller.decideApproval('reject'); assert.equal(f.preview.calls.includes('approval.submit'), false); assert.match(f.controller.getState().notice!.text, /desktop/);
});
test('operation version change requires a new review and never claims a successful decision', async () => {
  const f = await paired(); await f.controller.inspectApproval('demo_internal_note'); f.preview.changeOperationVersion('demo-note:2.0'); await f.controller.decideApproval('approve');
  assert.equal(f.controller.getState().approval, undefined); assert.match(f.controller.getState().notice!.text, /changed/); assert.equal(f.controller.getState().client.requests[0].status, 'unknown');
  await f.controller.inspectApproval('demo_internal_note'); assert.equal(f.controller.getState().approval!.operationVersion, 'demo-note:2.0');
});
test('lost approval response exposes unknown and only polls its ID on reconnect', async () => {
  const f = await paired(); await f.controller.inspectApproval('demo_internal_note'); f.preview.dropNextResponse('approval.submit'); await f.controller.decideApproval('approve'); assert.equal(f.controller.getState().client.requests[0].status, 'unknown');
  await f.controller.reconnect(); assert.equal(f.controller.getState().client.requests[0].status, 'succeeded'); assert.equal(f.preview.calls.filter(method => method === 'approval.submit').length, 1); assert.equal(f.controller.getState().approval, undefined);
});
test('forget erases workspace views, retained cache and credentials even offline', async () => {
  const f = await paired(); await f.controller.openBrief('demo_weekly_brief'); await f.controller.loadApprovals(); await f.controller.sendChat('Hello'); await f.controller.chooseDocument(); f.controller.disconnect(); await f.controller.forgetDevice(); const state = f.controller.getState();
  assert.equal(state.screen, 'pairing'); assert.equal(state.client.pairing.status, 'unpaired'); assert.deepEqual([state.briefs.length, state.messages.length, state.uploads.length, state.approvalInbox.length, state.client.requests.length], [0, 0, 0, 0, 0]); assert.equal(await f.credentials.load(), undefined);
});
test('revocation acknowledged by the server clears views and failed revocation cannot claim success', async () => {
  const f = await paired(); await f.controller.openBrief('demo_weekly_brief'); await f.controller.revokeDevice(); assert.equal(f.controller.getState().client.pairing.status, 'revoked'); assert.equal(f.controller.getState().briefs.length, 0);
  const offline = await paired(); offline.controller.disconnect(); await offline.controller.revokeDevice(); assert.match(offline.controller.getState().notice!.text, /offline/); assert.notEqual(offline.controller.getState().client.pairing.status, 'revoked');
});
test('a document picked before forget cannot upload into a new session', async () => {
  const document = deferred<ReturnType<typeof demoDocument>>(); const entered = deferred<void>();
  const f = await paired({ picker: { pick: async () => { entered.resolve(); return document.promise; } } }); const choosing = f.controller.chooseDocument(); await entered.promise; await f.controller.forgetDevice(); document.resolve(demoDocument()); await choosing;
  assert.equal(f.preview.calls.includes('upload.begin'), false); assert.equal(f.controller.getState().uploads.length, 0); assert.equal(f.controller.getState().busy.length, 0);
});
test('late receipt IO cannot restore workspace data after server-detected revocation', async () => {
  const receipt = deferred<Awaited<ReturnType<CompanionReceiptReader['read']>>>(); const entered = deferred<void>();
  const f = await paired({ receipts: { read: async () => { entered.resolve(); return receipt.promise; } } }); const reading = f.controller.openReceipt('demo_receipt_invoice'); await entered.promise; f.preview.revoke(); await f.controller.loadBriefs(); receipt.resolve(await previewReceipts.read('demo_receipt_invoice')); await reading;
  assert.equal(f.controller.getState().client.pairing.status, 'revoked'); assert.equal(f.controller.getState().receipt, undefined); assert.equal(f.controller.getState().briefs.length, 0);
});
test('late receipt and brief loads respect later user navigation', async () => {
  const receipt = deferred<Awaited<ReturnType<CompanionReceiptReader['read']>>>(); const entered = deferred<void>();
  const f = await paired({ receipts: { read: async () => { entered.resolve(); return receipt.promise; } } }); const reading = f.controller.openReceipt('demo_receipt_invoice'); await entered.promise; f.controller.navigate('chat'); receipt.resolve(await previewReceipts.read('demo_receipt_invoice')); await reading; assert.equal(f.controller.getState().screen, 'chat'); assert.equal(f.controller.getState().receipt, undefined);
  const brief = deferred<unknown>(); const briefEntered = deferred<void>(); const b = await paired({ handler: original => async (method, input, auth) => { if (method === 'brief.read') { briefEntered.resolve(); await brief.promise; } return original(method, input, auth); } }); const opening = b.controller.openBrief('demo_weekly_brief'); await briefEntered.promise; b.controller.navigate('activity'); brief.resolve(undefined); await opening; assert.equal(b.controller.getState().screen, 'activity'); assert.equal(b.controller.getState().brief, undefined);
});

test('reopened controller restores cached briefs and actual conversation references without replay', async () => {
  const f = await paired(); await f.controller.openBrief('demo_weekly_brief');
  f.preview.dropNextResponse('chat.start'); await f.controller.sendChat('Synthetic question whose acknowledgment is lost');
  const requestId = f.controller.getState().client.requests[0].requestId;
  const client = new PhoneClient({ channel: 'ios', transport: f.transport, credentials: f.credentials, cache: f.cache, clock: f.time,
    requestRestoration: { list: async () => [{ requestId, kind: 'chat' }] } });
  const controller = new CompanionController({ client, identity: previewIdentity('ios'), picker: previewPicker, receipts: previewReceipts, crypto: globalThis.crypto, mode: 'demo' });
  const observed: ReturnType<typeof controller.getState>[] = []; controller.subscribe(() => observed.push(controller.getState()));
  await controller.start(); const state = controller.getState();
  assert.ok(observed.some(view => view.client.pairing.status === 'validation-required' && view.briefs.some(brief => brief.freshness === 'cached')));
  assert.equal(state.messages.length, 1); assert.equal(state.messages[0].role, 'companion');
  assert.equal(state.messages[0].requestId, requestId); assert.equal(state.messages[0].conversationId, `chat_${requestId}`);
  assert.deepEqual(state.messages[0].receiptIds, ['demo_receipt_invoice']);
  assert.equal(f.preview.calls.filter(method => method === 'chat.start').length, 1);
  assert.equal(f.preview.calls.some(method => method.startsWith('upload.') || method === 'approval.submit'), false);
  const reads = f.preview.calls.filter(method => method === 'request.status').length;
  await controller.reconnect(); assert.equal(controller.getState().messages.length, 1);
  assert.equal(f.preview.calls.filter(method => method === 'request.status').length, reads, 'same-session terminal state remains a retained snapshot');
});

test('new questions retain answer references without adding a continuation field to chat.start', async () => {
  const sent: unknown[] = [];
  const f = await paired({ handler: original => (method, input, auth) => { if (method === 'chat.start') sent.push(structuredClone(input)); return original(method, input, auth); } });
  await f.controller.sendChat('First synthetic question'); await f.controller.refreshRequest('request_demo_1');
  await f.controller.sendChat('Second synthetic question'); await f.controller.refreshRequest('request_demo_2');
  assert.deepEqual(f.controller.getState().messages.filter(message => message.role === 'companion').map(message => message.conversationId), ['chat_request_demo_1', 'chat_request_demo_2']);
  assert.deepEqual(sent, [{ requestId: 'request_demo_1', question: 'First synthetic question' }, { requestId: 'request_demo_2', question: 'Second synthetic question' }]);
});

test('repeated chat taps admit only one question while the first reply is pending', async () => {
  const entered = deferred<void>(); const reply = deferred<unknown>(); let starts = 0;
  const f = await paired({ handler: original => (method, input, auth) => { if (method === 'chat.start') { starts += 1; entered.resolve(); return reply.promise; } return original(method, input, auth); } });
  const sending = f.controller.sendChat('A synthetic question'); await entered.promise;
  await f.controller.sendChat('A repeated tap'); assert.equal(starts, 1); assert.equal(f.controller.getState().messages.length, 1);
  reply.resolve({ status: 'succeeded', requestId: 'request_demo_1', result: { conversationId: 'actual_returned_conversation', text: 'Synthetic completed answer', receiptIds: [] } });
  await sending; assert.equal(f.controller.getState().messages[1].conversationId, 'actual_returned_conversation');
});

test('host receipts preserve exact scoped text and project no synthetic metadata', async () => {
  const text = '  Synthetic receipt text\n<source> remains plain text.\n  ';
  const f = await paired({ mode: 'live', receipts: { read: async id => ({ id, workspaceId: 'demo_shop', text, title: 'Untrusted extra field', credential: 'untrusted-extra-value' } as any) } });
  await f.controller.openReceipt('synthetic_host_receipt');
  assert.equal(f.controller.getState().screen, 'receipt');
  assert.deepEqual(f.controller.getState().receipt, { id: 'synthetic_host_receipt', workspaceId: 'demo_shop', text });
  assert.equal(JSON.stringify(f.controller.getState()).includes('untrusted-extra-value'), false);
  f.controller.disconnect(); assert.equal(f.controller.getState().receipt, undefined);
});

test('host receipt text accepts the host bound including empty text', async () => {
  for (const text of ['', 'x'.repeat(64000)]) {
    const f = await paired({ mode: 'live', receipts: { read: async id => ({ id, workspaceId: 'demo_shop', text }) } });
    await f.controller.openReceipt('synthetic_host_receipt'); assert.deepEqual(f.controller.getState().receipt, { id: 'synthetic_host_receipt', workspaceId: 'demo_shop', text });
  }
});

test('host receipt identity, workspace and text validation refuse mismatched readback', async () => {
  const invalid = [
    { id: 'different_receipt', workspaceId: 'demo_shop', text: 'Synthetic text' },
    { id: 'synthetic_host_receipt', workspaceId: 'different_workspace', text: 'Synthetic text' },
    { id: 'synthetic_host_receipt', workspaceId: 'demo_shop', text: 'x'.repeat(64001) },
    { id: 'synthetic_host_receipt', workspaceId: 'demo_shop', text: 42 },
    await previewReceipts.read('synthetic_host_receipt'),
  ];
  for (const receipt of invalid) {
    const f = await paired({ mode: 'live', receipts: { read: async () => receipt as any } });
    await f.controller.openReceipt('synthetic_host_receipt');
    assert.equal(f.controller.getState().receipt, undefined); assert.match(f.controller.getState().notice!.text, /could not confirm/);
  }
});

test('repeated receipt taps, back and disconnect discard late host receipt reads', async () => {
  for (const leave of ['back', 'disconnect'] as const) {
    const receipt = deferred<Awaited<ReturnType<CompanionReceiptReader['read']>>>(); const entered = deferred<void>(); let reads = 0;
    const f = await paired({ mode: 'live', receipts: { read: async () => { reads += 1; entered.resolve(); return receipt.promise; } } });
    const reading = f.controller.openReceipt('synthetic_host_receipt'); await entered.promise;
    await f.controller.openReceipt('synthetic_host_receipt'); assert.equal(reads, 1);
    if (leave === 'back') f.controller.navigate('chat'); else f.controller.disconnect();
    receipt.resolve({ id: 'synthetic_host_receipt', workspaceId: 'demo_shop', text: 'Late synthetic host receipt' }); await reading;
    assert.equal(f.controller.getState().receipt, undefined); if (leave === 'back') assert.equal(f.controller.getState().screen, 'chat');
    assert.equal(f.controller.getState().busy.length, 0);
  }
});

test('receipt result cannot outlive the freshly validated session expiry', async () => {
  const receipt = deferred<Awaited<ReturnType<CompanionReceiptReader['read']>>>(); const entered = deferred<void>();
  const f = await paired({ mode: 'live', receipts: { read: async () => { entered.resolve(); return receipt.promise; } } });
  const reading = f.controller.openReceipt('synthetic_host_receipt'); await entered.promise; f.advance(86400001);
  receipt.resolve({ id: 'synthetic_host_receipt', workspaceId: 'demo_shop', text: 'Expired synthetic host receipt' }); await reading;
  assert.equal(f.controller.getState().receipt, undefined); assert.equal(f.controller.getState().client.pairing.status, 'validation-required');
});

test('replacement session or binding clears retained UI and cannot receive an old receipt', async () => {
  for (const change of ['session', 'binding'] as const) {
    let replacement: SessionAuthority | undefined;
    const receipt = deferred<Awaited<ReturnType<CompanionReceiptReader['read']>>>(); const entered = deferred<void>();
    const f = await paired({ receipts: { read: async () => { entered.resolve(); return receipt.promise; } },
      handler: original => (method, input, auth) => method === 'session.validate' && replacement ? { status: 'current', authority: structuredClone(replacement) } : original(method, input, auth) });
    await f.controller.sendChat('Old synthetic question'); await f.controller.refreshRequest('request_demo_1');
    await f.controller.loadApprovals(); await f.controller.openBrief('demo_weekly_brief');
    assert.equal(f.controller.getState().messages[1].conversationId, 'chat_request_demo_1');
    const reading = f.controller.openReceipt('synthetic_host_receipt'); await entered.promise;
    const grant = await f.credentials.load(); assert.ok(grant);
    replacement = { ...grant.authority, ...(change === 'session' ? { sessionId: 'replacement_session' } : { binding: { ...grant.authority.binding, epoch: 2 } }) };
    await f.credentials.save({ ...grant, authority: replacement }); await f.client.restore();
    let state = f.controller.getState(); assert.deepEqual([state.messages.length, state.briefs.length, state.approvalInbox.length, state.client.requests.length], [0, 0, 0, 0]);
    assert.equal(state.brief, undefined); assert.equal(state.receipt, undefined);
    await f.controller.reconnect(); f.controller.navigate('activity');
    receipt.resolve({ id: 'synthetic_host_receipt', workspaceId: 'demo_shop', text: 'Old synthetic receipt' }); await reading;
    state = f.controller.getState(); assert.equal(state.screen, 'activity'); assert.equal(state.receipt, undefined); assert.equal(state.messages.length, 0);
    assert.equal(f.preview.calls.filter(method => method === 'chat.start').length, 1);
  }
});

test('a replaced session during a new start invalidates an old document picker', async () => {
  let replacement: SessionAuthority | undefined; const document = deferred<ReturnType<typeof demoDocument>>(); const entered = deferred<void>();
  const f = await paired({ picker: { pick: async () => { entered.resolve(); return document.promise; } },
    handler: original => (method, input, auth) => method === 'session.validate' && replacement ? { status: 'current', authority: structuredClone(replacement) } : original(method, input, auth) });
  const choosing = f.controller.chooseDocument(); await entered.promise;
  const grant = await f.credentials.load(); assert.ok(grant); replacement = { ...grant.authority, sessionId: 'replacement_session' };
  await f.credentials.save({ ...grant, authority: replacement }); await f.controller.start();
  document.resolve(demoDocument()); await choosing;
  assert.equal(f.preview.calls.includes('upload.begin'), false); assert.equal(f.controller.getState().uploads.length, 0);
  assert.equal(f.controller.getState().client.pairing.status, 'paired');
});

test('start and reconnect cannot supersede an in-flight device revocation', async () => {
  const entered = deferred<void>(); const released = deferred<void>();
  const f = await paired({ handler: original => async (method, input, auth) => { if (method === 'session.revoke') { entered.resolve(); await released.promise; } return original(method, input, auth); } });
  const revoking = f.controller.revokeDevice(); await entered.promise; await f.controller.start(); await f.controller.reconnect();
  assert.ok(f.controller.getState().busy.includes('device'));
  released.resolve(); await revoking;
  assert.equal(f.controller.getState().client.pairing.status, 'revoked'); assert.equal(f.controller.getState().screen, 'pairing');
  assert.match(f.controller.getState().notice!.text, /removed from the workspace/);
});

test('client-driven disconnect clears current details while retaining labelled answer snapshots', async () => {
  const f = await paired({ receipts: { read: async id => ({ id, workspaceId: 'demo_shop', text: 'Synthetic host receipt' }) } });
  await f.controller.sendChat('Synthetic question'); await f.controller.refreshRequest('request_demo_1');
  await f.controller.openBrief('demo_weekly_brief'); await f.controller.openReceipt('synthetic_host_receipt');
  assert.ok(f.controller.getState().receipt); f.client.disconnect();
  let state = f.controller.getState(); assert.equal(state.receipt, undefined); assert.equal(state.brief, undefined);
  assert.equal(state.messages[1].conversationId, 'chat_request_demo_1');
  await f.controller.openBrief('demo_weekly_brief'); state = f.controller.getState(); assert.equal(state.brief!.freshness, 'cached');
  assert.ok('readOnly' in state.brief! && state.brief!.readOnly);
});

test('foreground revalidation preserves previously returned details until a connection loss', async () => {
  let pause = false; const entered = deferred<void>(); const release = deferred<void>();
  const f = await paired({ receipts: { read: async id => ({ id, workspaceId: 'demo_shop', text: 'Synthetic host receipt' }) },
    handler: original => async (method, input, auth) => { if (pause && method === 'session.validate') { entered.resolve(); await release.promise; } return original(method, input, auth); } });
  await f.controller.openBrief('demo_weekly_brief'); await f.controller.openReceipt('synthetic_host_receipt');
  assert.ok(f.controller.getState().brief); assert.ok(f.controller.getState().receipt);
  pause = true; const validating = f.client.validate(); await entered.promise;
  const state = f.controller.getState(); assert.equal(state.client.pairing.status, 'validation-required');
  assert.equal(state.brief?.freshness, 'current'); assert.equal(state.receipt?.id, 'synthetic_host_receipt');
  release.resolve(); await validating;
  f.client.disconnect(); assert.equal(f.controller.getState().brief, undefined); assert.equal(f.controller.getState().receipt, undefined);
});

test('server-detected access loss clears views and retains its fixed public notice', async () => {
  for (const loss of ['revoked', 'expired'] as const) {
    const f = await paired(); await f.controller.openBrief('demo_weekly_brief');
    if (loss === 'revoked') f.preview.revoke(); else f.advance(86400001);
    await f.controller.loadBriefs(); const state = f.controller.getState();
    assert.equal(state.client.pairing.status, loss); assert.equal(state.briefs.length, 0); assert.equal(state.brief, undefined);
    assert.equal(state.notice?.tone, 'error'); assert.match(state.notice!.text, loss === 'revoked' ? /no longer has access/ : /session expired/);
  }
});
