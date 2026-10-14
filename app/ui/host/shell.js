import { createHostController, createDesktopRequestPort, mountHost } from '/ui/host.js';
const container = document.getElementById('host');
let token = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', location.pathname);
const desktop = location.protocol === 'chausar:' ? window.chausar : null;
const desktopRequests = desktop ? createDesktopRequestPort(desktop) : null;
function denied(code) { return Object.assign(new Error('The workspace session is unavailable.'), { code }); }
const port = { async request(method, payload) {
  if (desktopRequests) return desktopRequests.request(method, payload);
  if (!token) throw denied('UNAUTHENTICATED');
  const response = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }), cache: 'no-store', credentials: 'omit' });
  const value = await response.json();
  if (!response.ok || value.error) throw denied(value.error?.code ?? 'REQUEST_FAILED');
  return value.result;
} };
// Business calendar, timezone and metric policy await explicit trusted configuration.
const controller = createHostController(port, { todayProducer: {} });
// The new UI is the default. A return to the legacy renderer is offered only when the trusted
// host served the document that says it is available (an explicit --legacy-renderer launch).
const legacyAvailable = document.documentElement?.dataset?.legacy === 'available';
const mounted = mountHost(container, controller, legacyAvailable ? { onLegacyReturn: () => location.assign(desktop ? '/index.html' : `/index.html${token ? '#token=' + encodeURIComponent(token) : ''}`) } : {});
const check = () => { void controller.checkAuthority().catch(() => controller.invalidate('ACCESS_DENIED')); };
const focus = () => { if (document.visibilityState === 'visible') check(); };
window.addEventListener('focus', check); document.addEventListener('visibilitychange', focus);
const timer = setInterval(focus, 5000);
const unsubscribe = desktop?.onEngineStatus(status => { if (status.state !== 'ready') controller.invalidate('ACCESS_DENIED'); else check(); });
window.addEventListener('pagehide', () => { token = null; clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', focus); unsubscribe?.(); mounted.dispose(); }, { once: true });
