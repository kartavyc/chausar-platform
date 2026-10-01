import assert from 'node:assert/strict';
import test from 'node:test';
import { descendants, dialogFor, find, harness, hasText, namedButton, type Element } from './fixtures/conversation-acceptance-renderer.ts';

// Actual renderer, preload and structured-clone IPC registry. All RPC responses below
// are authored synthetic fixtures: these tests do NOT qualify Engine/Vault custody.
// No Electron GUI, actual archive, user workspace, provider, network or credentials.
const backupId = 'synthetic_archive', targetId = 'synthetic_copy', digest = 'd'.repeat(64);
const source = { vaultId: 'synthetic_vault', workspaceId: 'synthetic_business', revision: 7, captureId: 'synthetic_capture', enumerationId: 'synthetic_inventory' };
const namespaces = [
  { namespace: 'authority', disposition: 'included', entries: 1, bytes: 96, requirement: 'Encrypted authority bytes are included.' },
  { namespace: 'private-artifacts', disposition: 'included', entries: 1, bytes: 64, requirement: 'Typed encrypted private artifacts are included.' },
  { namespace: 'reports', disposition: 'outside-archive', entries: 3, bytes: 200, requirement: 'Stored reports require their own separate copy and qualification.' },
];
const externalKeyRequirements = [{ provider: 'other', namespace: 'operator/credential-wrappers', requirement: 'Keep the original passphrase or recovery kit outside the archive.' }];
const sourcePin = { format: 'chausar.backup-source-pin.v2', scope: 'authority-and-all-typed-private-artifacts', fullWorkspacePortable: false, source,
  authority: { bytes: 96, sha256: 'a'.repeat(64) }, artifacts: [{ id: 'synthetic_trial', purpose: 'private-trial', valueDigest: 'b'.repeat(64), bytes: 64, sha256: 'c'.repeat(64) }], namespaces, externalKeyRequirements };
const summary = { recordId: backupId, archiveDigest: digest, source, entries: 2, encryptedEntryBytes: 160,
  scope: sourcePin.scope, fullWorkspacePortable: false, inert: true, activation: 'root-only', namespaces, externalKeyRequirements,
  measurement: { encrypted: true, archiveCiphertextBytes: 900, pinCiphertextBytes: 500, qualification: 'test-fixture' } };
const archive = { summary, creationId: 'backup_synthetic_creation', sourcePin };
const receipt = { targetId, creationId: 'restore_synthetic_creation', archiveDigest: digest, sourcePin, entries: 2, bytes: 160, inert: true, activation: 'root-only' };
const restored = { receipt, summary, sourcePin };
function typed(code: string, message = 'Explicit synthetic RPC refusal.') { return Object.assign(new Error(message), { code }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
type Dispatch = (method: string, payload: Record<string, unknown>) => Promise<unknown>;
async function fixture(override?: Dispatch) {
  const h = await harness({ mount: true, dispatch: async (method, payload) => {
    if (method === 'dashboard.get') return { factCount: 1, sourceCount: 1, policy: { send: 'nothing' } };
    if (method === 'models.list') return [];
    if (['workspace.lock', 'sources.delete', 'members.revoke', 'trust.update'].includes(method)) return {};
    assert.ok(method.startsWith('workspace.backup.v2.'), `Unexpected authored fixture route: ${method}`);
    if (override) return override(method, payload);
    return respond(method, payload);
  } });
  h.renderer.state.workspace = { id: source.workspaceId, name: 'Synthetic archive renderer fixture' };
  h.renderer.state.status = { open: true };
  await h.renderer.showWorkspace();
  const workspace = dialogFor(h.body, 'Your workspace');
  await namedButton(workspace, 'Encrypted archive').dispatch('click');
  return { ...h, workspace, dialog: dialogFor(h.body, 'Encrypted archive') };
}
function respond(method: string, payload: Record<string, unknown>): unknown {
  if (method === 'workspace.backup.v2.create') return { ...summary, recordId: payload.destinationId };
  if (method === 'workspace.backup.v2.read') return { ...archive, summary: { ...summary, recordId: payload.backupId } };
  if (method === 'workspace.backup.v2.restoreInert') return { ...receipt, targetId: payload.targetId };
  if (['workspace.backup.v2.readRestored', 'workspace.backup.v2.inspectRestored'].includes(method)) return { ...restored, summary: { ...summary, recordId: payload.backupId }, receipt: { ...receipt, targetId: payload.targetId } };
  if (method === 'workspace.backup.v2.diagnostics') return { qualification: 'synthetic-renderer-fixture', fullWorkspacePortable: false, source, namespaces, externalKeyRequirements };
  assert.fail(`Unexpected authored archive fixture route: ${method}`);
}
function control(dialog: Element, label: string) { return find(dialog, node => node.tagName === 'input' && node.attributes['aria-label'] === label); }
function formFor(dialog: Element, label: string) { return find(dialog, node => node.tagName === 'form' && hasText(node, label)); }
function consent(form: Element) { return find(form, node => node.tagName === 'input' && node.attributes.type === 'checkbox'); }
const text = (node: Element) => descendants(node).map(child => child.textContent || '').join('\n');
const writes = (h: Awaited<ReturnType<typeof fixture>>) => h.calls.filter(call => ['workspace.backup.v2.create', 'workspace.backup.v2.restoreInert'].includes(call.method));
async function review(h: Awaited<ReturnType<typeof fixture>>, id = backupId) {
  control(h.dialog, 'Existing archive ID').value = id;
  await formFor(h.dialog, 'Read archive by ID').dispatch('submit');
  return formFor(h.dialog, 'Create closed copy once');
}
function chooseCopy(dialog: Element, form: Element) { control(dialog, 'New closed copy ID').value = targetId; consent(form).checked = true; }
function existingCopy(dialog: Element, id = backupId, target = targetId) { control(dialog, 'Copy archive ID').value = id; control(dialog, 'Existing copy ID').value = target; }

test('workspace toolbar preserves v1 controls and opens blank archive controls without a side effect', { timeout: 5000 }, async () => {
  const h = await fixture();
  namedButton(h.workspace, 'Back up vault'); namedButton(h.workspace, 'Export encrypted workspace'); namedButton(h.workspace, 'Lock vault');
  assert.equal(h.calls.some(call => call.method.startsWith('workspace.backup.')), false);
  assert.equal(control(h.dialog, 'New archive ID').value, '');
  assert.equal(control(h.dialog, 'Existing archive ID').value, '');
  assert.equal(control(h.dialog, 'Existing copy archive digest').attributes.readonly, '');
  assert.equal(consent(formFor(h.dialog, 'Create encrypted archive once')).checked, false);
  assert.equal(descendants(h.dialog).some(node => node.tagName === 'input' && node.attributes.type === 'password'), false);
  assert.match(text(h.dialog), /unsupported storage or custody profiles/);
});

test('archive creation is explicitly confirmed once and reads exact authenticated scope before offering copy', { timeout: 5000 }, async () => {
  const h = await fixture(), create = formFor(h.dialog, 'Create encrypted archive once');
  control(h.dialog, 'New archive ID').value = backupId;
  await create.dispatch('submit'); assert.equal(writes(h).length, 0);
  assert.match(text(create), /Confirm encrypted archive creation first/);
  consent(create).checked = true;
  await Promise.all([create.dispatch('submit'), create.dispatch('submit')]);
  assert.deepEqual(writes(h).map(call => call.payload), [{ destinationId: backupId, confirmed: true }]);
  assert.deepEqual(h.calls.filter(call => call.method === 'workspace.backup.v2.read').map(call => call.payload), [{ backupId }]);
  const copy = formFor(h.dialog, 'Create closed copy once');
  assert.equal(consent(copy).checked, false);
  assert.equal(control(h.dialog, 'New closed copy ID').value, '');
  assert.equal(control(h.dialog, 'Reviewed archive digest').value, digest);
  assert.equal(control(h.dialog, 'Reviewed archive digest').attributes.readonly, '');
  assert.match(text(h.dialog), /not a complete portable workspace/);
  assert.match(text(h.dialog), /reports: Stored reports require their own separate copy/);
  assert.match(text(h.dialog), /Keep the original passphrase or recovery kit outside the archive/);
  assert.equal(h.rejected.length, 0, 'Actual structured-clone preload accepted strict defined JSON payloads.');
});

test('closed-copy creation retains the read digest, rechecks source and verifies exact closed receipt', { timeout: 5000 }, async () => {
  const h = await fixture(), copy = await review(h);
  control(h.dialog, 'New closed copy ID').value = targetId;
  await copy.dispatch('submit'); assert.equal(writes(h).length, 0);
  assert.match(text(copy), /Confirm the closed-copy creation first/);
  consent(copy).checked = true;
  // A DOM edit cannot substitute a digest for the authenticated read's retained value.
  control(h.dialog, 'Reviewed archive digest').value = 'f'.repeat(64);
  await Promise.all([copy.dispatch('submit'), copy.dispatch('submit')]);
  assert.deepEqual(writes(h), [{ method: 'workspace.backup.v2.restoreInert', payload: { backupId, targetId, reviewedDigest: digest, confirmed: true } }]);
  assert.equal(h.calls.filter(call => call.method === 'workspace.backup.v2.read').length, 2, 'Review and explicit pre-write re-resolution both read actual route.');
  assert.deepEqual(h.calls.filter(call => call.method === 'workspace.backup.v2.readRestored').map(call => call.payload), [{ backupId, targetId, creationId: receipt.creationId, reviewedDigest: digest }]);
  assert.match(text(h.dialog), /Closed encrypted copy verified/);
  assert.match(text(h.dialog), /remains inert and has not become an active workspace/);
  assert.ok(text(h.dialog).includes(JSON.stringify(receipt, null, 2)));
  assert.ok(text(h.dialog).includes(JSON.stringify(sourcePin, null, 2)));
  assert.equal(h.renderer.state.workspace.id, source.workspaceId);
  assert.equal(h.calls.some(call => /activate|workspace\.(open|restore)$/.test(call.method)), false);
  assert.equal(h.rejected.length, 0);
});

test('a newly selected archive discards previous review and consent, including detached submit handlers', { timeout: 5000 }, async () => {
  const h = await fixture(), oldCopy = await review(h); chooseCopy(h.dialog, oldCopy);
  const selected = control(h.dialog, 'Existing archive ID'); selected.value = 'synthetic_other_archive'; await selected.dispatch('input');
  assert.equal(descendants(h.dialog).some(node => hasText(node, 'Create closed copy once')), false);
  await oldCopy.dispatch('submit'); assert.equal(writes(h).length, 0);
  await formFor(h.dialog, 'Read archive by ID').dispatch('submit');
  assert.equal(consent(formFor(h.dialog, 'Create closed copy once')).checked, false);
  assert.equal(control(h.dialog, 'New closed copy ID').value, '');
  assert.match(text(h.dialog), /synthetic_other_archive/);
});

test('file paths and malformed managed IDs are refused locally without payload expansion', { timeout: 5000 }, async () => {
  const h = await fixture(), create = formFor(h.dialog, 'Create encrypted archive once'); consent(create).checked = true;
  for (const id of ['', '../archive', 'D:/archive', 'C:\\archive', 'name with spaces', 'a'.repeat(101)]) {
    control(h.dialog, 'New archive ID').value = id; await create.dispatch('submit');
  }
  assert.equal(writes(h).length, 0);
  const copy = await review(h); consent(copy).checked = true; control(h.dialog, 'New closed copy ID').value = '../target'; await copy.dispatch('submit');
  assert.equal(writes(h).length, 0);
  existingCopy(h.dialog, '../archive', targetId); await formFor(h.dialog, 'Inspect existing closed copy').dispatch('submit');
  assert.equal(h.calls.filter(call => call.method === 'workspace.backup.v2.inspectRestored').length, 0);
  assert.match(text(h.dialog), /Do not enter a file path/);
});

test('lost archive creation response never retries and exposes explicit archive ID readback', { timeout: 5000 }, async () => {
  const h = await fixture(async (method, payload) => { if (method === 'workspace.backup.v2.create') throw typed('TRANSPORT_LOST', 'Synthetic whole creation response lost.'); return respond(method, payload); });
  const create = formFor(h.dialog, 'Create encrypted archive once'); control(h.dialog, 'New archive ID').value = backupId; consent(create).checked = true;
  await create.dispatch('submit');
  assert.match(text(create), /TRANSPORT_LOST: Synthetic whole creation response lost/);
  assert.match(text(create), /Use Read archive by ID with synthetic_archive/);
  assert.equal(control(h.dialog, 'Existing archive ID').value, backupId);
  assert.equal(h.calls.filter(call => call.method === 'workspace.backup.v2.read').length, 0);
  await create.dispatch('submit'); assert.equal(writes(h).length, 1);
  await formFor(h.dialog, 'Read archive by ID').dispatch('submit');
  assert.ok(text(h.dialog).includes(digest)); assert.equal(writes(h).length, 1);
});

test('lost whole-copy response retains exact refs and digest for explicit read-only discovery', { timeout: 5000 }, async () => {
  const h = await fixture(async (method, payload) => { if (method === 'workspace.backup.v2.restoreInert') throw typed('TRANSPORT_LOST', 'Synthetic copy committed but response lost.'); return respond(method, payload); });
  const copy = await review(h); chooseCopy(h.dialog, copy); await copy.dispatch('submit');
  assert.match(text(copy), /TRANSPORT_LOST: Synthetic copy committed but response lost/);
  assert.match(text(copy), /Use Inspect existing closed copy/);
  assert.equal(control(h.dialog, 'Copy archive ID').value, backupId); assert.equal(control(h.dialog, 'Existing copy ID').value, targetId);
  assert.equal(control(h.dialog, 'Existing copy archive digest').value, digest); assert.equal(control(h.dialog, 'Exact copy creation ID').value, '');
  assert.equal(h.calls.filter(call => call.method === 'workspace.backup.v2.inspectRestored').length, 0, 'No automatic recovery or retry.');
  await copy.dispatch('submit'); assert.equal(writes(h).length, 1);
  await formFor(h.dialog, 'Inspect existing closed copy').dispatch('submit');
  assert.deepEqual(h.calls.filter(call => call.method === 'workspace.backup.v2.inspectRestored').map(call => call.payload), [{ backupId, targetId, reviewedDigest: digest }]);
  assert.equal(h.calls.filter(call => call.method === 'workspace.backup.v2.read').length, 2, 'Unknown response uses retained original review, not a newly selected digest.');
  assert.equal(control(h.dialog, 'Exact copy creation ID').value, receipt.creationId);
  assert.match(text(h.dialog), /Closed encrypted copy verified/);
  await namedButton(h.dialog, 'Read exact copy receipt').dispatch('click');
  assert.deepEqual(h.calls.filter(call => call.method === 'workspace.backup.v2.readRestored').map(call => call.payload), [{ backupId, targetId, creationId: receipt.creationId, reviewedDigest: digest }]);
  assert.equal(writes(h).length, 1);
});

test('restart-style copy discovery reads the entered archive and needs no manually entered hash', { timeout: 5000 }, async () => {
  const h = await fixture(); existingCopy(h.dialog);
  assert.equal(control(h.dialog, 'Existing copy archive digest').value, '');
  await formFor(h.dialog, 'Inspect existing closed copy').dispatch('submit');
  assert.deepEqual(h.calls.filter(call => call.method.startsWith('workspace.backup.v2.')), [
    { method: 'workspace.backup.v2.read', payload: { backupId } },
    { method: 'workspace.backup.v2.inspectRestored', payload: { backupId, targetId, reviewedDigest: digest } },
  ]);
  assert.equal(control(h.dialog, 'Existing copy archive digest').value, digest);
  assert.equal(writes(h).length, 0);
  h.dialog.close(); await h.dialog.dispatch('close'); assert.equal(h.dialog.children.length, 0);
  await namedButton(h.workspace, 'Encrypted archive').dispatch('click');
  const reopened = dialogFor(h.body, 'Encrypted archive');
  assert.equal(control(reopened, 'Copy archive ID').value, '');
  assert.equal(control(reopened, 'Existing copy archive digest').value, '');
  assert.equal(control(reopened, 'Exact copy creation ID').value, '');
});

test('acknowledged creation and incomplete readback remain distinct and recover only through read', { timeout: 5000 }, async () => {
  let failRead = true;
  const h = await fixture(async (method, payload) => { if (method === 'workspace.backup.v2.read' && failRead) throw typed('TRANSPORT_LOST'); return respond(method, payload); });
  const create = formFor(h.dialog, 'Create encrypted archive once'); control(h.dialog, 'New archive ID').value = backupId; consent(create).checked = true;
  await create.dispatch('submit'); assert.match(text(create), /Archive creation was acknowledged, but its readback is incomplete/);
  await create.dispatch('submit'); assert.equal(writes(h).length, 1);
  failRead = false; await formFor(h.dialog, 'Read archive by ID').dispatch('submit');
  assert.equal(writes(h).length, 1); assert.ok(text(h.dialog).includes(digest));
});

test('acknowledged closed copy retains creation ID when final readback is unavailable', { timeout: 5000 }, async () => {
  let failRead = true;
  const h = await fixture(async (method, payload) => { if (method === 'workspace.backup.v2.readRestored' && failRead) throw typed('TRANSPORT_LOST'); return respond(method, payload); });
  const copy = await review(h); chooseCopy(h.dialog, copy); await copy.dispatch('submit');
  assert.match(text(copy), /Copy creation was acknowledged, but its readback is incomplete/);
  assert.equal(control(h.dialog, 'Exact copy creation ID').value, receipt.creationId);
  assert.doesNotMatch(text(h.dialog), /Closed encrypted copy verified/);
  failRead = false; await namedButton(h.dialog, 'Read exact copy receipt').dispatch('click');
  assert.match(text(h.dialog), /Closed encrypted copy verified/); assert.equal(writes(h).length, 1);
});

test('unsupported installed profile shows its real typed refusal without falling back to v1', { timeout: 5000 }, async () => {
  const h = await fixture(async () => { throw typed('BACKUP_STORAGE_PROFILE_REQUIRED', 'Synthetic unsupported storage profile.'); });
  const create = formFor(h.dialog, 'Create encrypted archive once'); control(h.dialog, 'New archive ID').value = backupId; consent(create).checked = true;
  await create.dispatch('submit');
  assert.match(text(h.dialog), /BACKUP_STORAGE_PROFILE_REQUIRED: Synthetic unsupported storage profile/);
  assert.doesNotMatch(text(h.dialog), /Closed encrypted copy verified/);
  assert.equal(h.calls.some(call => ['workspace.backup', 'workspace.export', 'workspace.restore'].includes(call.method)), false);
});

test('owner or evidence revocation clears metadata and rejects a late archive response', { timeout: 5000 }, async () => {
  for (const method of ['members.revoke', 'sources.delete', 'trust.update', 'workspace.lock']) {
    const pending = deferred<unknown>(), started = deferred<void>();
    const h = await fixture(async (name, payload) => { if (name === 'workspace.backup.v2.read') { started.resolve(); return pending.promise; } return respond(name, payload); });
    control(h.dialog, 'Existing archive ID').value = backupId;
    const action = formFor(h.dialog, 'Read archive by ID').dispatch('submit'); await started.promise;
    await h.renderer.request(method, {});
    assert.equal(h.dialog.children.length, 0, method);
    pending.resolve(archive); await action;
    assert.equal(h.dialog.children.length, 0); assert.equal(descendants(h.body).includes(h.dialog), false);
    assert.equal(writes(h).length, 0);
  }
});

test('closing or navigating away clears the archive and cannot paint a pending response', { timeout: 5000 }, async () => {
  const pending = deferred<unknown>(), started = deferred<void>();
  const h = await fixture(async (method, payload) => { if (method === 'workspace.backup.v2.read') { started.resolve(); return pending.promise; } return respond(method, payload); });
  control(h.dialog, 'Existing archive ID').value = backupId;
  const action = formFor(h.dialog, 'Read archive by ID').dispatch('submit'); await started.promise;
  h.dialog.close(); pending.resolve(archive); await action; assert.equal(h.dialog.children.length, 0);
  const next = await fixture(); await review(next);
  next.renderer.applyWorkspaceStatus({ open: true, workspace: next.renderer.state.workspace });
  assert.equal(next.dialog.children.length, 0, 'Actual navigate() discards archive evidence before changing generation.');
});

test('changing archive selection while read is pending discards the obsolete result', { timeout: 5000 }, async () => {
  const pending = deferred<unknown>(), started = deferred<void>();
  const h = await fixture(async (method, payload) => {
    if (method === 'workspace.backup.v2.read' && payload.backupId === backupId) { started.resolve(); return pending.promise; }
    return respond(method, payload);
  });
  const selected = control(h.dialog, 'Existing archive ID'); selected.value = backupId;
  const action = formFor(h.dialog, 'Read archive by ID').dispatch('submit'); await started.promise;
  selected.value = 'synthetic_new_selection'; await selected.dispatch('input');
  await formFor(h.dialog, 'Read archive by ID').dispatch('submit');
  pending.resolve(archive); await action;
  assert.match(text(h.dialog), /synthetic_new_selection/);
  assert.equal(descendants(h.dialog).filter(node => node.tagName === 'dd' && node.textContent === backupId).length, 0);
  assert.equal(writes(h).length, 0);
});

test('changed source evidence between review and publication refuses without any restore call', { timeout: 5000 }, async () => {
  let reads = 0;
  const h = await fixture(async (method, payload) => {
    if (method === 'workspace.backup.v2.read' && ++reads > 1) return { ...archive, creationId: 'backup_other_creation' };
    return respond(method, payload);
  });
  const copy = await review(h); chooseCopy(h.dialog, copy); await copy.dispatch('submit');
  assert.match(text(copy), /BACKUP_READBACK_MISMATCH/);
  assert.equal(writes(h).length, 0); assert.doesNotMatch(text(h.dialog), /Closed encrypted copy verified/);
});

test('wrong archive/copy digest, pin, identity or inert flags never render a verified receipt', { timeout: 5000 }, async () => {
  const variants = [
    { ...restored, summary: { ...summary, recordId: 'synthetic_other' } },
    { ...restored, summary: { ...summary, fullWorkspacePortable: true } },
    { ...restored, summary: { ...summary, archiveDigest: 'e'.repeat(64) } },
    { ...restored, receipt: { ...receipt, targetId: 'synthetic_other' } },
    { ...restored, receipt: { ...receipt, sourcePin: { ...sourcePin, source: { ...source, revision: 8 } } } },
    { ...restored, receipt: { ...receipt, bytes: 161 } },
    { ...restored, receipt: { ...receipt, inert: false } },
  ];
  for (const variant of variants) {
    const h = await fixture(async (method, payload) => method === 'workspace.backup.v2.inspectRestored' ? variant : respond(method, payload));
    existingCopy(h.dialog); await formFor(h.dialog, 'Inspect existing closed copy').dispatch('submit');
    assert.match(text(h.dialog), /BACKUP_READBACK_MISMATCH/); assert.doesNotMatch(text(h.dialog), /Closed encrypted copy verified/); assert.equal(writes(h).length, 0);
  }
});

test('archive-specific current custody revocation clears the previously retained review', { timeout: 5000 }, async () => {
  let revoked = false;
  const h = await fixture(async (method, payload) => { if (revoked) throw typed('BACKUP_SOURCE_CHANGED'); return respond(method, payload); });
  await review(h); assert.ok(text(h.dialog).includes(digest)); revoked = true;
  await namedButton(h.dialog, 'Read archive diagnostics').dispatch('click');
  assert.equal(h.dialog.children.length, 0); assert.equal(descendants(h.body).includes(h.dialog), false);
  assert.match(text(h.notifications), /BACKUP_SOURCE_CHANGED/); assert.equal(writes(h).length, 0);
});

test('final copy readback cannot replace retained source scope while keeping a matching original receipt', { timeout: 5000 }, async () => {
  const changedSource = { ...source, revision: 8 }, changedPin = { ...sourcePin, source: { ...source, revision: 8 } };
  const h = await fixture(async (method, payload) => method === 'workspace.backup.v2.readRestored'
    ? { ...restored, summary: { ...summary, source: changedSource }, sourcePin: changedPin } : respond(method, payload));
  const copy = await review(h); chooseCopy(h.dialog, copy); await copy.dispatch('submit');
  assert.match(text(copy), /BACKUP_READBACK_MISMATCH/);
  assert.match(text(copy), /Copy creation was acknowledged, but its readback is incomplete/);
  assert.doesNotMatch(text(h.dialog), /Closed encrypted copy verified/); assert.equal(writes(h).length, 1);
});

test('current source readiness refusal removes retained metadata and remains visible as a typed error', { timeout: 5000 }, async () => {
  for (const code of ['SOURCE_NOT_READY', 'CONNECTOR_SEMANTIC_QUALIFICATION_CHANGED', 'SEMANTIC_SOURCE_NOT_READY']) {
    let refused = false;
    const h = await fixture(async (method, payload) => { if (refused) throw typed(code, 'Synthetic source is no longer ready.'); return respond(method, payload); });
    const copy = await review(h); chooseCopy(h.dialog, copy); refused = true;
    await copy.dispatch('submit');
    assert.equal(h.dialog.children.length, 0); assert.ok(text(h.notifications).includes(`${code}: Synthetic source is no longer ready`)); assert.equal(writes(h).length, 0);
  }
});

test('diagnostics is an explicit strict empty-object read without creation or activation', { timeout: 5000 }, async () => {
  const h = await fixture(); await namedButton(h.dialog, 'Read archive diagnostics').dispatch('click');
  assert.deepEqual(h.calls.filter(call => call.method.startsWith('workspace.backup.v2.')), [{ method: 'workspace.backup.v2.diagnostics', payload: {} }]);
  assert.match(text(h.dialog), /synthetic-renderer-fixture/); assert.equal(writes(h).length, 0); assert.equal(h.rejected.length, 0);
});
