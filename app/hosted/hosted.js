/* Chausar hosted sign-in and businesses. Server values only ever become text nodes.
   Sign in with an email link (opened in this same browser) or a passkey. No passwords exist. */
const main = document.getElementById('main');

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const show = (...nodes) => main.replaceChildren(...nodes.filter(node => node != null && node !== false));
const errorLine = () => h('p', { class: 'error', role: 'alert' });

async function call(path, body) {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  let value = null;
  try { value = await response.json(); } catch { /* an empty answer */ }
  if (!response.ok || value?.error) throw Object.assign(new Error(value?.error?.message || 'The server could not do that. Try again.'), { code: value?.error?.code || 'HTTP_ERROR' });
  return value;
}
async function session() {
  const response = await fetch('/api/hosted/session', { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) return null;
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error?.message || 'The server could not answer.');
  return value;
}
async function busy(button, line, work) {
  button.disabled = true; line.textContent = '';
  try { await work(); } catch (error) { line.textContent = error.message || String(error); } finally { button.disabled = false; }
}

// Passkeys: base64url on the wire, ArrayBuffers for the browser.
const toBuffer = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)), c => c.charCodeAt(0)).buffer;
const toText = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function creationOptions(json) {
  return { ...json, challenge: toBuffer(json.challenge), user: { ...json.user, id: toBuffer(json.user.id) }, excludeCredentials: (json.excludeCredentials || []).map(item => ({ ...item, id: toBuffer(item.id) })) };
}
function requestOptions(json) { return { ...json, challenge: toBuffer(json.challenge), allowCredentials: [] }; }
function credentialJson(credential) {
  if (typeof credential.toJSON === 'function') return credential.toJSON();
  const r = credential.response, out = { clientDataJSON: toText(r.clientDataJSON) };
  if (r.attestationObject) { out.attestationObject = toText(r.attestationObject); if (typeof r.getTransports === 'function') out.transports = r.getTransports(); }
  if (r.authenticatorData) out.authenticatorData = toText(r.authenticatorData);
  if (r.signature) out.signature = toText(r.signature);
  if (r.userHandle) out.userHandle = toText(r.userHandle);
  return { id: credential.id, rawId: toText(credential.rawId), type: credential.type, response: out, clientExtensionResults: {} };
}
const passkeysHere = () => typeof window.PublicKeyCredential === 'function' && !!navigator.credentials;

function renderSignIn(message = '') {
  const email = h('input', { type: 'email', id: 'email', autocomplete: 'email webauthn', required: true, maxlength: 254, placeholder: 'you@example.com' });
  const line = errorLine(); line.textContent = message;
  const send = h('button', { class: 'btn', type: 'submit' }, 'Email me a link');
  const form = h('form', { onsubmit: event => { event.preventDefault(); void busy(send, line, async () => {
    const result = await call('/api/auth/magic-link', { email: email.value });
    renderSent(email.value.trim(), result.delivers === true);
  }); } }, h('label', { for: 'email' }, 'Email'), email, h('div', { class: 'row' }, send));
  const passkey = passkeysHere() ? h('button', { class: 'quiet', type: 'button', onclick: event => void busy(event.currentTarget, line, async () => {
    const options = await call('/api/auth/passkey/login/options', {});
    const credential = await navigator.credentials.get({ publicKey: requestOptions(options) });
    if (!credential) throw new Error('No passkey was chosen.');
    await call('/api/auth/passkey/login/verify', { credential: credentialJson(credential) });
    await start();
  }) }, 'Sign in with a passkey') : null;
  const trial = h('div', {});
  show(h('h1', {}, 'Sign in to Chausar'), h('p', { class: 'mute' }, 'No password. Use a link we send to your email, or a passkey on this device.'), form, passkey ? h('div', { class: 'row' }, passkey) : null, trial, line);
  void offerTrial(trial, line);
}

/* Ink v2 wave 4 (4J21, from 4J23): "Start without an account", only when the server's trials switch is on (its public
   health check says so). It starts a temporary business, then opens the app; the business is kept by adding an email. */
async function offerTrial(holder, line) {
  let health = null;
  try {
    const response = await fetch('/api/health', { credentials: 'same-origin', cache: 'no-store' });
    health = response.ok ? await response.json() : null;
  } catch { health = null; }
  if (health?.trials !== true || !holder.isConnected) return;
  const go = h('button', { class: 'quiet', type: 'button', onclick: event => void busy(event.currentTarget, line, async () => {
    await call('/api/hosted/trial', {});
    await call('/api/hosted/select', { businessId: null });
    window.location.assign('/app/');
  }) }, 'Start without an account');
  // When it is deleted, from the server's own limits (hosted/trial.ts): days after the last use once the business is
  // made, minutes before that. Without the numbers, the page says only that it is deleted when not used.
  const days = Number.isInteger(health.trialIdleDays) ? health.trialIdleDays : null;
  const minutes = Number.isInteger(health.trialEmptyMinutes) ? health.trialEmptyMinutes : null;
  const when = days && minutes
    ? `It is deleted ${days} ${days === 1 ? 'day' : 'days'} after you last use it, or ${minutes} minutes after if you have not made the business yet.`
    : 'If you stop using it, it is deleted.';
  holder.replaceChildren(h('h2', {}, 'Just looking?'),
    h('p', { class: 'mute' }, `Try Chausar first. The business is temporary until you add your email. ${when}`),
    h('div', { class: 'row' }, go));
}

function renderSent(email, delivers) {
  show(h('h1', {}, delivers ? 'Check your email' : 'Find the link'),
    delivers
      ? h('p', {}, `A sign-in link is on its way to ${email}. Open it in this browser. It works once, for fifteen minutes.`)
      : h('p', {}, `This test server sends no email. The sign-in link for ${email} is printed on its console. Open it in this browser. It works once, for fifteen minutes.`),
    h('div', { class: 'row' }, h('button', { class: 'quiet', type: 'button', onclick: () => renderSignIn() }, 'Use another email')));
}

function renderHome(me) {
  const line = errorLine();
  const user = me.user;
  const open = async (businessId, button) => busy(button, line, async () => { await call('/api/hosted/select', { businessId }); window.location.assign('/app/'); });
  const businesses = user.businesses.length
    ? h('ul', { class: 'list' }, user.businesses.map(business => h('li', {}, h('span', {}, business.name),
      h('button', { class: 'quiet', type: 'button', onclick: event => open(business.id, event.currentTarget) }, 'Open'))))
    : h('p', { class: 'mute' }, 'No business yet.');
  const full = user.businesses.length >= me.limits.businesses;
  const start = h('button', { class: 'btn', type: 'button', disabled: full, onclick: event => open(null, event.currentTarget) }, 'Start a business');
  const addPasskey = passkeysHere() ? h('button', { class: 'quiet', type: 'button', onclick: event => void busy(event.currentTarget, line, async () => {
    const options = await call('/api/auth/passkey/register/options', {});
    const credential = await navigator.credentials.create({ publicKey: creationOptions(options) });
    if (!credential) throw new Error('No passkey was made.');
    await call('/api/auth/passkey/register/verify', { credential: credentialJson(credential), name: 'Passkey' });
    await start();
  }) }, 'Add a passkey') : null;
  const passkeys = user.passkeys.length
    ? h('ul', { class: 'list' }, user.passkeys.map(passkey => h('li', {}, h('span', {}, passkey.name),
      h('button', { class: 'quiet', type: 'button', onclick: event => void busy(event.currentTarget, line, async () => { await call('/api/auth/passkey/remove', { id: passkey.id }); await start(); }) }, 'Remove'))))
    : h('p', { class: 'mute' }, 'No passkey yet.');
  const signOut = everywhere => event => void busy(event.currentTarget, line, async () => { await call('/api/auth/sign-out', { everywhere }); renderSignIn(); });
  const remove = user.businesses.length === 0 ? h('button', { class: 'quiet danger', type: 'button', onclick: () => renderDeleteAccount(user.email) }, 'Delete account') : null;
  show(h('h1', {}, 'Your businesses'), businesses, h('div', { class: 'row' }, start), full ? h('p', { class: 'mute' }, `This server keeps ${me.limits.businesses} businesses per account for now.`) : null,
    h('p', { class: 'warn' }, "Hosted Chausar is experimental. Practise here; don't issue real invoices yet."),
    h('h2', {}, 'Passkeys'), passkeys, addPasskey ? h('div', { class: 'row' }, addPasskey) : null,
    h('h2', {}, user.email), h('div', { class: 'row' }, h('button', { class: 'quiet', type: 'button', onclick: signOut(false) }, 'Sign out'),
      h('button', { class: 'quiet', type: 'button', onclick: signOut(true) }, 'Sign out everywhere'), remove), line);
}

function renderDeleteAccount(email) {
  const line = errorLine();
  const typed = h('input', { type: 'email', id: 'confirm', autocomplete: 'off', placeholder: email });
  const go = h('button', { class: 'btn', type: 'submit' }, 'Delete my account');
  show(h('h1', {}, 'Delete your account'), h('p', {}, 'Type your email to delete your account and sign out everywhere.'),
    h('form', { onsubmit: event => { event.preventDefault(); void busy(go, line, async () => { await call('/api/account/delete', { email: typed.value }); renderSignIn(); }); } },
      h('label', { for: 'confirm' }, 'Email'), typed, h('div', { class: 'row' }, go, h('button', { class: 'quiet', type: 'button', onclick: () => void start() }, 'Keep it'))), line);
}

async function start() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('signin');
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  if (token) {
    try { await call('/api/auth/magic-link/verify', { token }); }
    catch (error) { renderSignIn(error.message); return; }
  }
  try {
    const current = await session();
    if (current) renderHome(current.me); else renderSignIn();
  } catch (error) { renderSignIn(error.message); }
}

// A link opened in this same tab changes only the address's fragment, so listen for that too.
window.addEventListener('hashchange', () => { if (window.location.hash.includes('signin=')) void start(); });
void start();
