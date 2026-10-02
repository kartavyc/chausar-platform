import assert from 'node:assert/strict';
import test from 'node:test';
import type {CalculationReceipt} from '../runtime/calculator.ts';
import {billed, clarify, incomplete, CLARIFICATION, OBJECTIVE, PERIOD, REPLY, SECRET, SOURCE_A, SOURCE_B,
  fixture} from './fixtures/phone-continuation-independent-acceptance.ts';

// Independent public phone acceptance. The synthetic provider interprets no
// natural language; literal plans are exercised through real Engine/Gateway guards.
test('phone clarification survives a new Engine and its reviewed short continuation yields one exact scoped receipt',
  {timeout: 120000}, async t => {
    const f = await fixture(t, [clarify, billed]), device = await f.pair();
    const first = await f.offer(device, {question: OBJECTIVE, sourceIds: [SOURCE_A], branch: 'main'});
    const firstInput = {requestId: 'independent-phone-original', question: OBJECTIVE};
    const firstResult = await device.phone('chat.start', firstInput);
    assert.equal(firstResult.status, 'succeeded'); assert.deepEqual(firstResult.result.receiptIds, []);
    assert.equal(firstResult.result.text, CLARIFICATION); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].body, first.preview.payload);
    const pendingId = firstResult.result.conversationId;
    const original = await f.desktop('conversation.get', {id: pendingId});
    assert.equal(original.kind, 'clarification'); assert.equal(original.answer.clarification, CLARIFICATION);
    const descriptor = await f.desktop('conversation.continuation', {id: pendingId});
    assert.equal(descriptor.originalQuestion, OBJECTIVE); assert.equal(descriptor.turnId, pendingId);
    assert.deepEqual(descriptor.sourceIds, [SOURCE_A]); assert.deepEqual(descriptor.exchanges,
      [{question: OBJECTIVE, clarification: CLARIFICATION}]);
    const nonceCall = device.signed('session.validate', {}, device.grant.credential);
    assert.equal((await device.wire(nonceCall)).status, 200);
    const oldDesktopToken = await f.restart();
    assert.equal((await f.desktopRaw('workspace.status', {}, oldDesktopToken)).status, 401);
    assert.equal((await device.phone('session.validate')).status, 'current');
    assert.deepEqual(await device.phone('request.status', {requestId: firstInput.requestId}), firstResult);
    assert.deepEqual(await f.desktop('conversation.get', {id: pendingId}), original);
    assert.deepEqual(await f.desktop('conversation.continuation', {id: pendingId}), descriptor);
    const nonceReplay = await device.wire(device.signed('session.validate', {}, device.grant.credential, nonceCall.nonce));
    assert.equal(nonceReplay.status, 400); assert.equal(nonceReplay.body.error?.code, 'INVALID_REQUEST');
    assert.equal(nonceReplay.body.result, undefined); assert.equal(f.calls.length, 1);

    // The newly reviewed period is explicit; sources/branch come from the retained original.
    const followup = await f.offer(device, {question: REPLY, continuationId: pendingId, period: PERIOD});
    assert.equal(followup.preview.naturalQuestion, REPLY); assert.equal(followup.preview.continuationId, pendingId);
    assert.ok(followup.preview.payload.includes(OBJECTIVE)); assert.ok(followup.preview.payload.includes(CLARIFICATION));
    assert.ok(followup.preview.payload.includes(pendingId)); assert.equal(followup.preview.payload.includes(SECRET), false);
    const secondInput = {requestId: 'independent-phone-continuation', question: REPLY};
    const second = await device.phone('chat.start', secondInput);
    assert.equal(second.status, 'succeeded'); assert.equal(second.result.receiptIds.length, 1);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].body, followup.preview.payload);
    const receipt: CalculationReceipt = await f.desktop('receipts.get', {id: second.result.receiptIds[0]});
    // 10103 + 22007 = 32110. The 900000 August row and 888888 other source are excluded.
    assert.equal(receipt.totalMinor, '32110'); assert.equal(receipt.operation, 'billed');
    assert.deepEqual(receipt.period, PERIOD); assert.deepEqual(receipt.requestedSourceIds, [SOURCE_A]);
    assert.equal(receipt.branch, 'main');
    assert.equal(receipt.rows.length, 2); assert.ok(receipt.rows.every(row => row.sourceId === SOURCE_A));
    assert.deepEqual(receipt.rows.map(row => row.amountMinor).sort(), ['10103', '22007']);
    assert.equal(receipt.coverage.completeness, 'reconciled-imports'); assert.equal(receipt.stale, false);
    assert.ok(second.result.text.includes(receipt.explanation)); assert.ok(second.result.text.includes(receipt.figures[0].display));
    assert.equal((await device.phone('receipt.read', {receiptId: receipt.id})).id, receipt.id);
    const retained = await f.desktop('conversation.get', {id: second.result.conversationId});
    assert.equal(retained.kind, 'grounded-conversation'); assert.equal(retained.answer.results[0].answer.id, receipt.id);
    await f.desktopRefuse('conversation.continuation', {id: pendingId}, 'CONVERSATION_CONTINUATION_RESOLVED');
    assert.deepEqual(await f.desktop('conversation.get', {id: pendingId}), original);
    assert.deepEqual(await device.phone('chat.start', secondInput), second);
    const alias = await device.phone('chat.start', {...secondInput, requestId: 'independent-phone-continuation-alias'});
    assert.equal(alias.status, 'succeeded'); assert.deepEqual(alias.result, second.result);
    await device.refuse('chat.start', {...secondInput, question: 'A different unreviewed question'}, 'REQUEST_EXISTS', 400);
    await device.refuse('chat.start', {requestId: 'independent-phone-unoffered', question: 'A different unreviewed question'}, 'OPEN_DESKTOP', 400);
    const otherDevice = await f.pair();
    assert.deepEqual(await otherDevice.phone('request.status', {requestId: secondInput.requestId}),
      {status: 'unknown', requestId: secondInput.requestId});
    assert.equal(f.calls.length, 2);
    await f.restart();
    assert.deepEqual(await device.phone('request.status', {requestId: secondInput.requestId}), second);
    assert.deepEqual(await device.phone('request.cancel', {requestId: secondInput.requestId}), second);
    assert.deepEqual(await f.desktop('conversation.get', {id: second.result.conversationId}), retained);
    assert.deepEqual(await f.desktop('receipts.get', {id: receipt.id}), receipt);
    const history = await f.desktop('conversation.history');
    assert.equal(history.items.filter((item: any) => item.id === pendingId).length, 1);
    assert.equal(history.items.filter((item: any) => item.id === second.result.conversationId).length, 1);
    assert.equal(f.calls.length, 2); f.assertLocal();
  });

test('an intentionally incomplete continuation plan remains unknown without arithmetic, parent consumption or redispatch',
  {timeout: 120000}, async t => {
    const f = await fixture(t, [clarify, incomplete]), device = await f.pair();
    await f.offer(device, {question: OBJECTIVE, sourceIds: [SOURCE_A], branch: 'main'});
    const first = await device.phone('chat.start', {requestId: 'independent-incomplete-original', question: OBJECTIVE});
    const pendingId = first.result.conversationId, descriptor = await f.desktop('conversation.continuation', {id: pendingId});
    const next = await f.offer(device, {question: REPLY, continuationId: pendingId, period: PERIOD});
    const beforeReceipts = f.engine.vault!.read().receipts;
    const input = {requestId: 'independent-incomplete-reply', question: REPLY};
    const unknown = await device.phone('chat.start', input);
    assert.deepEqual(unknown, {status: 'unknown', requestId: input.requestId});
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].body, next.preview.payload);
    const failed = f.engine.vault!.read().modelReceipts.find(row => row.id === next.preview.id)!;
    assert.equal(failed.status, 'failed'); assert.equal(failed.errorCode, 'INVALID_CONVERSATION_PLAN');
    assert.deepEqual(f.engine.vault!.read().receipts, beforeReceipts);
    assert.deepEqual(await f.desktop('conversation.continuation', {id: pendingId}), descriptor);
    assert.deepEqual(await device.phone('chat.start', input), unknown);
    assert.deepEqual(await device.phone('request.status', {requestId: input.requestId}), unknown);
    assert.deepEqual(await device.phone('request.cancel', {requestId: input.requestId}), unknown);
    const aliasInput = {...input, requestId: 'independent-incomplete-alias'};
    assert.deepEqual(await device.phone('chat.start', aliasInput), {status: 'unknown', requestId: aliasInput.requestId});
    await f.restart();
    assert.deepEqual(await device.phone('request.status', {requestId: input.requestId}), unknown);
    assert.deepEqual(await device.phone('chat.start', input), unknown);
    assert.deepEqual(await f.desktop('conversation.continuation', {id: pendingId}), descriptor);
    assert.deepEqual(f.engine.vault!.read().receipts, beforeReceipts);
    const history = await f.desktop('conversation.history');
    assert.equal(history.items.filter((item: any) => item.id === pendingId).length, 1);
    assert.equal(history.items.some((item: any) => item.question === REPLY), false);
    assert.equal(f.calls.length, 2); f.assertLocal();
  });

test('real member and device grants fence retained phone results and brief-only capability never dispatches',
  {timeout: 120000}, async t => {
    const f = await fixture(t, [billed]);
    const member = await f.desktop('members.add', {name: 'Synthetic independent paired owner', role: 'owner', branches: ['*']});
    const session = await f.desktop('auth.session', {memberId: member.id});
    const device = await f.pair({memberId: member.id, desktopToken: session.token});
    const question = 'Measure selected September invoices.';
    await f.offer(device, {question, sourceIds: [SOURCE_A], branch: 'main', period: PERIOD}, session.token);
    const input = {requestId: 'independent-member-result', question}, result = await device.phone('chat.start', input);
    assert.equal(result.status, 'succeeded'); assert.equal(f.calls.length, 1);
    const receipt = await f.desktop('receipts.get', {id: result.result.receiptIds[0]}, session.token);
    assert.equal(receipt.totalMinor, '32110'); assert.equal(receipt.memberId, member.id);
    const readOnly = await f.pair({capabilities: ['brief.read']});
    assert.equal((await readOnly.phone('session.validate')).status, 'current');
    await readOnly.refuse('chat.start', {requestId: 'independent-read-only', question}, 'CAPABILITY_FORBIDDEN', 403);
    assert.deepEqual(await readOnly.phone('request.status', {requestId: input.requestId}), {status: 'unknown', requestId: input.requestId});
    await f.desktop('members.revoke', {id: member.id});
    for (const [method, payload] of [['session.validate', {}], ['request.status', {requestId: input.requestId}],
      ['receipt.read', {receiptId: receipt.id}]] as const) await device.refuse(method, payload, 'ACCESS_REVOKED', 401);
    await f.restart(); await device.refuse('request.status', {requestId: input.requestId}, 'ACCESS_REVOKED', 401);
    assert.equal((await readOnly.phone('session.validate')).status, 'current');
    assert.equal(f.calls.length, 1); f.assertLocal();
  });

test('locked workspace and current source or paired-device withdrawal withhold retained phone answers after encrypted reopening',
  {timeout: 120000}, async t => {
    const f = await fixture(t, [billed]), device = await f.pair();
    const question = 'Measure only selected September invoices.';
    await f.offer(device, {question, sourceIds: [SOURCE_A], branch: 'main', period: PERIOD});
    const input = {requestId: 'independent-withdrawn-result', question}, result = await device.phone('chat.start', input);
    assert.equal(result.status, 'succeeded'); assert.equal(f.calls.length, 1);
    const receiptId = result.result.receiptIds[0]; assert.equal((await device.phone('receipt.read', {receiptId})).id, receiptId);
    const bytes = await f.ciphertext(); assert.equal(JSON.parse(bytes.toString()).format, 'chausar.vault.v1');
    assert.equal(bytes.includes(Buffer.from(SECRET)), false);
    await f.desktop('workspace.lock');
    await device.refuse('request.status', {requestId: input.requestId}, 'VAULT_LOCKED', 400);
    await device.refuse('receipt.read', {receiptId}, 'VAULT_LOCKED', 400);
    await f.desktop('workspace.open', {folder: 'continuation', passphrase: 'Synthetic independent phone continuation credential'});
    assert.deepEqual(await device.phone('request.status', {requestId: input.requestId}), result);
    await f.desktop('trust.update', {allowedSources: [SOURCE_B]});
    for (const [method, payload] of [['request.status', {requestId: input.requestId}], ['chat.start', input],
      ['receipt.read', {receiptId}]] as const) await device.refuse(method, payload, 'TRANSPORT_UNKNOWN', 503);
    assert.deepEqual(await f.desktop('conversation.history'), {items: []});
    await f.restart(); await device.refuse('receipt.read', {receiptId}, 'TRANSPORT_UNKNOWN', 503);
    assert.equal((await device.phone('session.validate')).status, 'current');
    await f.desktop('phone.revoke', {sessionId: device.grant.authority.sessionId});
    await device.refuse('session.validate', {}, 'ACCESS_REVOKED', 401);
    await f.restart(); await device.refuse('request.status', {requestId: input.requestId}, 'ACCESS_REVOKED', 401);
    assert.equal(f.calls.length, 1); f.assertLocal();
  });
