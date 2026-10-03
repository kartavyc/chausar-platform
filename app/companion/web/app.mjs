import { requestLabel } from '../shared/view-contracts.ts';

// This UI consumes the same controller as the native apps. It has no relay URL,
// embedded account credential, approval queue, or independent authority state.
const app = document.querySelector('#app');
const screens = [
  ['briefs', 'Briefs', 'M4 3h10l4 4v14H4z M14 3v5h4 M7 12h8 M7 16h8'],
  ['chat', 'Chat', 'M4 4h16v12H9l-5 4z M8 8h8 M8 12h5'],
  ['uploads', 'Uploads', 'M12 16V3 M7 8l5-5 5 5 M4 14v7h16v-7'],
  ['approvals', 'Approvals', 'M12 3l8 4v6c0 4-4 7-8 9-4-2-8-5-8-9V7z M8 12l3 3 5-6'],
  ['activity', 'Activity', 'M3 12h4l3-8 4 16 3-8h4'],
  ['device', 'Device', 'M6 2h12v20H6z M10 18h4'],
];
let controller;
let state;
let chatDraft = '';
let fileError = '';
let fileBusy = false;
let confirmation;
let receiptOrigin = 'briefs';
let lastAnnouncement = '';
let lastBinding;
let lastViewKey;
let sessionExpired = false;
let screenElement;
let headerStatus;
let sidebarStatus;
let noticeElement;
let announcer;
const navigation = new Map();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function append(parent, ...children) { children.filter(Boolean).forEach(child => parent.append(child)); return parent; }
function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path'); shape.setAttribute('d', path); svg.append(shape); return svg;
}
function button(text, action, options = {}) {
  const node = element('button', options.className, text); node.type = 'button'; node.disabled = !!options.disabled;
  if (options.id) node.id = options.id;
  node.addEventListener('click', () => run(action)); return node;
}
function run(action) {
  // The controller publishes sanitized notices. An unexpected adapter failure is
  // intentionally never rendered or logged because it may include credentials.
  try { Promise.resolve(action()).catch(() => announce('The preview could not complete that step. Try reconnecting.')); }
  catch { announce('The preview could not complete that step. Try reconnecting.'); }
}
function announce(text) { if (announcer && text !== lastAnnouncement) { announcer.textContent = text; lastAnnouncement = text; } }
function heading(title, description) {
  const block = element('div', 'screen-heading');
  const titleNode = element('h1', '', title); titleNode.id = 'screen-title'; titleNode.tabIndex = -1;
  return append(block, titleNode, description && element('p', '', description));
}
function card(title, ...children) { return append(element('section', 'card'), title && element('h2', '', title), ...children); }
function note(text, warning = false) { return element('p', `note${warning ? ' warning' : ''}`, text); }
function empty(title, text, action) { return append(element('div', 'empty'), element('h2', '', title), element('p', '', text), action); }
function time(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed) : 'Unavailable';
}
function details(items) {
  const list = element('dl', 'details');
  items.forEach(([label, value]) => append(list, element('dt', '', label), element('dd', '', value))); return list;
}
function isBusy() { return fileBusy || state.busy.length > 0; }
function requestBusy(requestId, action) {
  return state.busy.some(key => ['start', 'pair', 'connection', 'device', `${action}_${requestId}`].includes(key));
}
function isOnline() { return state.client.connection === 'online' && state.client.pairing.status === 'paired' && Date.parse(state.client.pairing.authority.expiresAt) > Date.now(); }
function can(capability) { return isOnline() && state.client.pairing.authority.capabilities.includes(capability) && !isBusy(); }
function unavailableText() {
  if (state.client.pairing.status === 'revoked') return 'This device has been revoked. Pair again with a new workspace invite.';
  if (state.client.pairing.status === 'expired') return 'This device session has expired. Pair again with a new workspace invite.';
  if (state.client.pairing.status === 'unpaired') return 'Pair this device to send requests to the remote engine.';
  return 'Reconnect to validate your session before sending requests. Cached briefs remain read-only.';
}
function pairingAction() { return button('Pair this device', () => navigate('pairing'), { className: 'primary' }); }
function connectionNotice() {
  if (isOnline()) return undefined;
  const block = element('div', 'stack');
  append(block, note(unavailableText(), true));
  if (['unpaired', 'expired', 'revoked'].includes(state.client.pairing.status)) append(block, pairingAction());
  else append(block, button('Reconnect and validate', () => controller.reconnect(), { disabled: isBusy() }));
  return block;
}
function proofButtons(ids) {
  if (!ids.length) return element('p', 'subtle', 'No proof receipt was returned.');
  const block = element('div', 'proof-list');
  ids.forEach((id, index) => append(block, button(`View proof ${index + 1} · ${id}`, () => {
    if (state.screen !== 'receipt') receiptOrigin = state.screen;
    return controller.openReceipt(id);
  }, { className: 'link-button', disabled: !isOnline() || isBusy() })));
  if (!isOnline()) append(block, element('p', 'small muted', 'Proof receipts need a fresh online read.'));
  return block;
}
function navigate(screen) {
  confirmation = undefined; fileError = ''; controller.navigate(screen);
  requestAnimationFrame(() => document.querySelector('#screen-title')?.focus({ preventScroll: true }));
}

function buildShell() {
  const banner = element('div', 'demo-banner');
  append(banner, element('strong', '', 'Developer preview. '), document.createTextNode('Synthetic sample data · live relay pairing is not connected.'));
  banner.id = 'preview-banner';
  const shell = element('div', 'shell');
  const sidebar = element('aside', 'sidebar');
  const brand = append(element('div', 'brand'), element('span', 'brand-mark', 'C'), append(element('div'), document.createTextNode('Chausar'), element('small', '', 'YOUR COMPANION')));
  const nav = element('nav', 'navigation'); nav.setAttribute('aria-label', 'Companion');
  for (const [name, title, path] of screens) {
    const navButton = button('', () => navigate(name), { className: 'nav-button', id: `nav-${name}` });
    append(navButton, icon(path), element('span', '', title)); navigation.set(name, navButton); nav.append(navButton);
  }
  sidebarStatus = element('div', 'sidebar-foot'); append(sidebar, brand, nav, sidebarStatus);
  const content = element('main', 'content'); content.id = 'screen'; content.tabIndex = -1;
  const topbar = element('div', 'topbar');
  headerStatus = element('span', 'status-chip'); headerStatus.id = 'connection-status';
  append(topbar, element('span', 'eyebrow', 'Remote engine · phone companion'), headerStatus);
  noticeElement = element('div'); screenElement = element('div', 'screen-body');
  announcer = element('div', 'sr-only'); announcer.setAttribute('role', 'status'); announcer.setAttribute('aria-live', 'polite'); announcer.setAttribute('aria-atomic', 'true');
  append(content, topbar, noticeElement, screenElement, announcer);
  append(shell, sidebar, content); app.replaceChildren(banner, shell); app.setAttribute('aria-busy', 'false');
}

function pairingScreen() {
  const input = element('input'); input.id = 'pairing-invite'; input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false;
  input.setAttribute('autocapitalize', 'none'); input.setAttribute('autocorrect', 'off'); input.maxLength = 512; input.required = true;
  input.setAttribute('aria-describedby', 'invite-help'); input.disabled = isBusy();
  const label = append(element('label', '', 'Workspace invite'), input);
  const help = element('p', 'small muted', state.mode === 'demo' ? 'For this synthetic preview, use DEMO-COMPANION. No real workspace is contacted.' : 'Use an invite created on your trusted desktop. Your invite is never placed in a URL.'); help.id = 'invite-help';
  const submit = element('button', 'primary wide', isBusy() ? 'Pairing…' : 'Pair this device'); submit.type = 'submit'; submit.disabled = isBusy();
  const form = append(element('form', 'stack'), label, help, submit);
  form.addEventListener('submit', event => { event.preventDefault(); const invite = input.value.trim(); input.value = ''; if (invite) run(() => controller.pair(invite)); });
  const instructions = card('Your engine, within reach',
    element('p', 'subtle', 'The companion sends questions and documents to your remote Chausar engine. It reads briefs and simple action previews returned by that engine.'),
    details([['1 · Invite', 'Create a device invite on your desktop.'], ['2 · Pair', 'Enter the invite on this device.'], ['3 · Validate', 'Every approval requires a fresh online session and matching action version.']]),
    note('Offline reading is limited to encrypted cached briefs. Approvals are never stored for offline replay.'));
  return append(element('div'), heading('Pair your companion', 'A small window into your Chausar workspace.'), append(element('div', 'section-grid'), card('Connect this device', form), instructions));
}
function briefsScreen() {
  const root = append(element('div'), heading('Your business, at a glance', 'Read a brief. Follow the proof. Take the next step when the engine is online.'));
  if (state.brief) {
    const { brief, freshness } = state.brief;
    const cacheText = freshness === 'cached' ? 'Cached · read-only' : 'Fresh from the engine';
    const back = button('← All briefs', () => navigate('briefs'), { className: 'quiet' });
    append(root, back, append(element('section', 'card'),
      append(element('div', 'row'), element('h2', '', brief.title), element('span', 'pill', cacheText)),
      element('p', 'small muted', `Generated ${time(brief.generatedAt)} · Version ${brief.version}`),
      freshness === 'cached' && note(`Saved ${time(brief.cachedAt)}. Cache expires ${time(brief.expiresAt)}. This snapshot cannot authorize an action.`, true),
      element('p', 'brief-summary', brief.summary), element('div', 'divider'), element('h3', '', 'Every number has a receipt'), proofButtons(brief.receiptIds)));
    return root;
  }
  const cachedSession = ['paired', 'validation-required'].includes(state.client.pairing.status);
  const controls = append(element('div', 'actions'), button(isOnline() ? 'Refresh briefs' : 'Show saved briefs', () => controller.loadBriefs(), { disabled: isOnline() ? !can('brief.read') : !cachedSession || isBusy() }));
  append(root, connectionNotice(), controls);
  const list = element('div', 'screen-list');
  state.briefs.forEach(brief => {
    const item = button('', () => controller.openBrief(brief.id), { className: 'list-item', disabled: isBusy() });
    const freshnessLabel = brief.freshness === 'cached' ? `Saved snapshot · ${isOnline() ? 'Open for a fresh read' : 'Read cached copy'}` : isOnline() ? 'Open brief' : 'Read cached copy if available';
    append(item, element('strong', '', brief.title), element('span', '', `${time(brief.generatedAt)} · ${freshnessLabel}`)); append(list, item);
  });
  append(root, state.briefs.length ? list : empty('No briefs yet', 'Pair this device, then refresh to see the briefs your engine has prepared.'));
  return root;
}
function chatScreen() {
  const root = append(element('div'), heading('Ask your workspace', 'Questions run on your remote engine. Answers can point back to proof receipts.'), connectionNotice());
  if (state.messages.some(message => message.role === 'companion')) append(root, note('Answers are retained snapshots. Open a proof receipt online for a fresh read.'));
  const thread = element('div', 'chat-thread'); thread.setAttribute('aria-label', 'Conversation');
  state.messages.forEach(message => {
    const bubble = append(element('article', `message ${message.role}`), element('p', 'message-role', message.role === 'owner' ? 'You' : 'Chausar · retained answer'), element('p', 'message-text', message.text));
    if (message.conversationId) append(bubble, details([['Conversation', message.conversationId]]));
    if (message.requestId) {
      const request = state.client.requests.find(item => item.requestId === message.requestId);
      if (request) append(bubble, element('p', 'pending-help', requestLabel(request)));
    }
    if (message.receiptIds.length) append(bubble, proofButtons(message.receiptIds)); append(thread, bubble);
  });
  append(root, state.messages.length ? thread : empty('A useful first question', 'Try “What changed in the sample business?” in this developer preview.'));
  const input = element('textarea'); input.id = 'chat-question'; input.maxLength = 4000; input.value = chatDraft; input.placeholder = 'What would you like to understand?';
  input.setAttribute('aria-describedby', 'chat-help'); input.addEventListener('input', () => { chatDraft = input.value; });
  const submit = element('button', 'primary', 'Send question'); submit.type = 'submit'; submit.disabled = !can('chat');
  const help = element('p', '', 'No connection? Your question stays here until you send it.'); help.id = 'chat-help';
  const form = append(element('form', 'card composer'), append(element('label', '', 'Your question'), input), append(element('div', 'composer-foot'), help, submit));
  form.addEventListener('submit', event => { event.preventDefault(); if (!can('chat')) return; const question = input.value.trim(); if (!question) { input.focus(); return; } chatDraft = ''; input.value = ''; run(() => controller.sendChat(question)); });
  return append(root, form);
}
function uploadsScreen() {
  const root = append(element('div'), heading('Bring a document', 'Send a bill, statement, or data file to your engine. Review it on the desktop before it becomes trusted business data.'), connectionNotice());
  const input = element('input'); input.type = 'file'; input.id = 'upload-file'; input.accept = '.jpg,.jpeg,.png,.pdf,.csv,image/jpeg,image/png,application/pdf,text/csv'; input.disabled = !can('upload');
  input.setAttribute('aria-describedby', 'upload-help');
  const help = element('p', 'small muted', 'JPEG, PNG, PDF, or CSV · up to 10 MB. Choosing a file sends it while online.'); help.id = 'upload-help';
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; input.value = ''; if (!file || !can('upload')) return;
    const types = new Set(['image/jpeg', 'image/png', 'application/pdf', 'text/csv']);
    const extensionType = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', csv: 'text/csv' };
    const mediaType = file.type || extensionType[file.name.split('.').at(-1)?.toLowerCase()];
    if (!types.has(mediaType) || file.size <= 0 || file.size > 10 * 1024 * 1024 || file.name.length > 200 || /[\x00-\x1f/\\]/.test(file.name)) {
      fileError = 'Choose a JPEG, PNG, PDF, or CSV file with a valid name, between 1 byte and 10 MB.'; render(); return;
    }
    fileError = ''; fileBusy = true; render();
    try { const bytes = new Uint8Array(await file.arrayBuffer()); await controller.uploadDocument({ name: file.name, mediaType, bytes }); }
    catch { fileError = 'The file could not be read. Choose it again to retry.'; }
    finally { fileBusy = false; render(); }
  });
  append(root, card('Choose a document', append(element('label', '', 'Document file'), input), help,
    note('Uploads remain unconfirmed source material. The companion does not approve an import or treat document text as instructions.'),
    fileBusy && element('p', 'small muted', 'Reading the selected file…'), fileError && element('p', 'note error', fileError)));
  if (state.uploads.length) {
    const items = element('div', 'screen-list');
    state.uploads.forEach(upload => {
      const request = state.client.requests.find(item => item.requestId === upload.requestId);
      append(items, card(upload.name, element('span', `pill ${request?.status || ''}`, request ? requestLabel(request) : upload.status),
        element('p', 'pending-help', 'Use Activity to check completion or request cancellation.')));
    });
    append(root, element('div', 'divider'), element('h2', '', 'Recent uploads'), items);
  }
  return root;
}
function approvalsScreen() {
  const root = append(element('div'), heading('Decide with the details', 'Only simple, reversible actions can be decided here. Each tap checks the current session and exact action version online.'), connectionNotice());
  if (state.approval) {
    const preview = state.approval;
    const expired = Date.parse(preview.expiresAt) <= Date.now();
    const desktop = preview.eligibility === 'open-desktop';
    const content = append(element('section', 'card'),
      append(element('div', 'row'), element('h2', '', preview.title), element('span', 'pill', desktop ? 'Desktop required' : 'Simple · reversible')),
      element('p', 'brief-summary', preview.summary),
      details([['Operation', preview.operationVersion], ['Revision', String(preview.actionRevision)], ['Expires', time(preview.expiresAt)], ['Action', preview.actionId], ['Preview proof', preview.digest]]),
      note(desktop ? 'Open your trusted desktop to review and decide this action.' : 'This decision applies only to the preview above. If its version or contents change, review a new preview.'),
      element('p', 'small muted expiry', expired ? 'This preview has expired. Refresh the details to review again.' : 'A decision expires with this preview. No approval is queued offline.'));
    const permitted = can('approval.simple') && !desktop && !expired;
    append(content, append(element('div', 'actions'),
      button('Approve this version', () => controller.decideApproval('approve'), { className: 'primary', disabled: !permitted, id: 'approval-approve' }),
      button('Reject this version', () => controller.decideApproval('reject'), { disabled: !permitted, id: 'approval-reject' }),
      button('Refresh details', () => controller.inspectApproval(preview.approvalId), { disabled: !isOnline() || isBusy() })));
    append(root, button('← Approval inbox', () => navigate('approvals'), { className: 'quiet' }), content);
    return root;
  }
  append(root, append(element('div', 'actions'), button('Refresh approvals', () => controller.loadApprovals(), { disabled: !can('approval.simple') })));
  const list = element('div', 'screen-list');
  state.approvalInbox.forEach(item => {
    const action = button('', () => controller.inspectApproval(item.approvalId), { className: 'list-item', disabled: !isOnline() || isBusy() });
    append(action, element('strong', '', item.title), element('span', '', 'Inspect the current preview before deciding')); append(list, action);
  });
  append(root, state.approvalInbox.length ? list : empty('Nothing waiting for a decision', 'Refresh the inbox while connected. In this preview, every action is synthetic.'));
  return root;
}
function requestTitle(request) {
  if (request.status === 'succeeded') {
    if ('conversationId' in request.result) return 'Chat answer';
    if ('uploadId' in request.result) return 'Upload';
    return 'Approval decision';
  }
  const upload = state.uploads.find(item => item.requestId === request.requestId);
  if (upload) return `Upload · ${upload.name}`;
  if (state.messages.some(item => item.requestId === request.requestId)) return 'Chat question';
  return 'Remote action';
}
function activityScreen() {
  const root = append(element('div'), heading('Know where things stand', 'An unknown outcome means the reply was lost. Check status before trying a new request; reconnect never resends an approval.'), connectionNotice());
  append(root, note('Completed results are retained snapshots. Open proof receipts online for a fresh read.'));
  const list = element('div', 'screen-list');
  state.client.requests.forEach(request => {
    const open = ['pending', 'unknown', 'cancelling'].includes(request.status);
    const info = append(element('div', 'activity-info'), element('h3', '', requestTitle(request)), element('span', `pill ${request.status}`, requestLabel(request)), element('p', '', `Request ${request.requestId}`));
    if (request.status === 'succeeded') {
      const result = request.result;
      if ('conversationId' in result) append(info, element('span', 'pill', 'Retained answer'), details([['Conversation', result.conversationId]]), element('p', 'brief-summary', result.text), proofButtons(result.receiptIds));
      else if ('uploadId' in result) append(info, note('Retained upload result · confirmation needed on desktop.'), details([['Upload', result.uploadId], ['Source', result.sourceId]]));
      else append(info, note(`Retained decision: ${result.decision}`), details([['Approval', result.approvalId], ['Action', result.actionId]]));
    }
    const actions = element('div', 'activity-actions');
    if (open) append(actions,
      button('Check status', () => controller.refreshRequest(request.requestId), { disabled: !isOnline() || requestBusy(request.requestId, 'status'), id: `status-${request.requestId}` }),
      button(request.status === 'cancelling' ? 'Cancel requested' : 'Request cancellation', () => controller.cancelRequest(request.requestId), { disabled: !isOnline() || requestBusy(request.requestId, 'cancel') || request.status === 'cancelling', id: `cancel-${request.requestId}` }));
    append(list, append(element('article', 'activity-item'), info, actions));
  });
  append(root, state.client.requests.length ? list : empty('No requests yet', 'Sent questions, uploads, and action decisions appear here.'));
  append(root, element('p', 'screen-footer', 'Cancellation is a request to the engine. It is confirmed only when the engine reports “Cancelled”. A completed operation may finish before cancellation arrives.'));
  return root;
}
function confirmDevice(action) { confirmation = action; render(); }
function deviceScreen() {
  const pairing = state.client.pairing;
  const binding = pairing.status === 'paired' ? pairing.authority.binding : pairing.binding;
  const root = append(element('div'), heading('Your device connection', 'A saved session allows cached reading. Current authority always comes from fresh online validation.'));
  append(root, card('Connection',
    details([['Network', state.client.connection], ['Pairing', pairing.status.replaceAll('-', ' ')], ...(binding ? [['Workspace', binding.workspaceId], ['Device', binding.deviceId], ['Binding epoch', String(binding.epoch)]] : [])]),
    pairing.status === 'paired' && element('p', 'small muted', `Last validated ${time(pairing.authority.validatedAt)} · Session expires ${time(pairing.authority.expiresAt)}`),
    append(element('div', 'actions'),
      button('Reconnect and validate', () => controller.reconnect(), { className: 'primary', disabled: isBusy() }),
      button('Go offline', () => controller.disconnect(), { disabled: state.client.connection === 'offline' || isBusy() }),
      button('Pair with an invite', () => navigate('pairing'), { disabled: isBusy() }))));
  append(root, element('div', 'divider'), card('Remove access',
    element('p', 'subtle', 'Forget removes this browser’s saved session and cached briefs. Revoke also asks the online engine to remove this device’s access.'),
    append(element('div', 'actions'),
      button('Forget this device', () => confirmDevice('forget'), { className: 'danger', disabled: isBusy() }),
      button('Revoke this device', () => confirmDevice('revoke'), { className: 'danger', disabled: !isOnline() || isBusy() })),
    confirmation && append(element('div', 'confirm'), element('h3', '', confirmation === 'revoke' ? 'Revoke this device?' : 'Forget this device?'),
      element('p', 'small', 'You will need a new pairing invite. Saved access and cached briefs on this device will be removed.'),
      append(element('div', 'actions'),
        button(confirmation === 'revoke' ? 'Confirm revocation' : 'Confirm forget', () => { const selected = confirmation; confirmation = undefined; return selected === 'revoke' ? controller.revokeDevice() : controller.forgetDevice(); }, { className: 'danger', disabled: isBusy() }),
        button('Keep this device', () => { confirmation = undefined; render(); })))));
  if (state.mode === 'demo') append(root, element('p', 'screen-footer', 'This browser preview uses synthetic remote responses and a memory-only session. Offline cached reading works within the current preview session; reload requires pairing the sample workspace again. Encrypted brief storage is exercised when browser storage is available. Production pairing and protected session storage need the shared relay and selected platform adapters.'));
  return root;
}
function receiptScreen() {
  const receipt = state.receipt;
  const hostText = receipt && 'text' in receipt;
  const root = append(element('div'), heading('Follow the proof', hostText ? 'Receipt text returned by your engine.' : 'Read the source, calculation method, and coverage behind a result.'));
  append(root, button(`← Back to ${receiptOrigin}`, () => navigate(receiptOrigin), { className: 'quiet' }));
  if (!receipt) return append(root, empty('No receipt selected', 'Open a proof receipt from a brief or chat answer while online.'));
  if (hostText) {
    const text = element('p', 'brief-summary', receipt.text);
    return append(root, card('Proof receipt', element('span', 'pill', 'Engine receipt'), details([['Receipt', receipt.id], ['Workspace', receipt.workspaceId]]), text));
  }
  return append(root, card(receipt.title, element('span', 'pill', state.mode === 'demo' ? 'Synthetic proof' : 'Engine receipt'),
    details([['Receipt', receipt.id], ['Generated', time(receipt.generatedAt)], ['Source', receipt.source], ['Method', receipt.method], ['Coverage', receipt.coverage]]),
    element('p', 'brief-summary', receipt.details)));
}
function render() {
  if (!controller) return;
  state = controller.getState();
  const pairing = state.client.pairing;
  const binding = pairing.status === 'paired' ? pairing.authority.binding : pairing.binding;
  const bindingKey = binding && `${binding.workspaceId}/${binding.memberId}/${binding.deviceId}/${binding.epoch}`;
  const accessLost = ['unpaired', 'revoked', 'expired'].includes(pairing.status);
  if (lastBinding && (lastBinding !== bindingKey || accessLost)) { chatDraft = ''; fileError = ''; confirmation = undefined; receiptOrigin = 'briefs'; }
  lastBinding = accessLost ? undefined : bindingKey;
  const viewKey = `${state.screen}/${state.brief?.brief.id || ''}/${state.approval?.approvalId || ''}/${state.receipt?.id || ''}`;
  const viewChanged = lastViewKey !== undefined && lastViewKey !== viewKey;
  lastViewKey = viewKey;
  const active = document.activeElement;
  const activeId = active?.id;
  const selection = active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : undefined;
  const statusText = state.client.connection === 'connecting' ? 'Validating connection…' : state.client.connection === 'online' ? (isOnline() ? 'Online · validated' : pairing.status === 'unpaired' ? 'Online · pair this device' : 'Online · session check required') : binding ? 'Offline · cached reading' : 'Offline · not paired';
  headerStatus.replaceChildren(element('span', `dot ${state.client.connection}`), document.createTextNode(statusText));
  sidebarStatus.replaceChildren(element('span', `dot ${state.client.connection}`), document.createTextNode(statusText), element('p', '', 'The engine does the work. This companion keeps you informed.'));
  navigation.forEach((item, name) => {
    if (state.screen === name) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    item.querySelector('.nav-count')?.remove();
    if (name === 'approvals' && state.approvalInbox.length) append(item, element('span', 'nav-count', state.approvalInbox.length));
  });
  noticeElement.replaceChildren();
  if (state.notice) append(noticeElement, append(element('div', `notice ${state.notice.tone}`), element('span', '', state.notice.text), button('Dismiss', () => controller.dismissNotice(), { className: 'quiet' })));
  const views = { pairing: pairingScreen, briefs: briefsScreen, chat: chatScreen, uploads: uploadsScreen, approvals: approvalsScreen, activity: activityScreen, device: deviceScreen, receipt: receiptScreen };
  screenElement.replaceChildren((views[state.screen] || pairingScreen)());
  const busyText = state.busy.length ? ' Working…' : '';
  announce(`${statusText}.${busyText}${state.notice ? ` ${state.notice.text}` : ''}`);
  // Preserve composer focus across controller updates; pairing invites are cleared
  // on submit and are never retained outside their password input.
  if (viewChanged) document.querySelector('#screen-title')?.focus({ preventScroll: true });
  else if (activeId && activeId !== 'screen-title') {
    const next = document.getElementById(activeId);
    if (next && !next.disabled) { next.focus({ preventScroll: true }); if (selection && next instanceof HTMLTextAreaElement) next.setSelectionRange(...selection); }
  }
}
function updateApprovalExpiry() {
  const expiredSession = state?.client.pairing.status === 'paired' && Date.parse(state.client.pairing.authority.expiresAt) <= Date.now();
  if (expiredSession !== sessionExpired) { sessionExpired = expiredSession; render(); }
  if (state?.screen !== 'approvals' || !state.approval) return;
  const expired = Date.parse(state.approval.expiresAt) <= Date.now();
  if (expired) {
    for (const id of ['approval-approve', 'approval-reject']) { const node = document.getElementById(id); if (node) node.disabled = true; }
    const expiry = screenElement.querySelector('.expiry'); if (expiry) expiry.textContent = 'This preview has expired. Refresh the details to review again.';
  }
}
try {
  const { createWebPreviewController } = await import('../shared/web-runtime.ts');
  controller = await createWebPreviewController();
  buildShell(); controller.subscribe(render); render(); await controller.start();
  window.addEventListener('offline', () => controller.disconnect());
  window.addEventListener('online', () => run(() => controller.reconnect()));
  window.addEventListener('pagehide', () => controller.disconnect());
  window.setInterval(updateApprovalExpiry, 1000);
} catch {
  app.setAttribute('aria-busy', 'false');
  app.replaceChildren(append(element('main', 'boot'), element('h1', '', 'Preview could not start'), element('p', '', 'Run the phone web preview server from this repository, then refresh. No live workspace is contacted.')));
}
