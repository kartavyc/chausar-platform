import { createHostController, mountHost } from '/ui/host.js';
// Enterprise browser shell: the session lives in an HttpOnly cookie, never in script.
const container = document.getElementById('host');
function denied(code) { return Object.assign(new Error('The workspace session is unavailable.'), { code }); }
const port = { async request(method, payload) {
  const response = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chausar-Request': '1' }, body: JSON.stringify({ method, payload }), cache: 'no-store', credentials: 'same-origin' });
  if (response.status === 401) { location.assign('/auth/login'); throw denied('UNAUTHENTICATED'); }
  const value = await response.json();
  if (!response.ok || value.error) throw denied(value.error?.code ?? 'REQUEST_FAILED');
  return value.result;
} };
const controller = createHostController(port, { todayProducer: {} });
const mounted = mountHost(container, controller, { onLegacyReturn: () => location.assign('/ui/index.html') });
const check = () => { void controller.checkAuthority().catch(() => controller.invalidate('ACCESS_DENIED')); };
const focus = () => { if (document.visibilityState === 'visible') check(); };
window.addEventListener('focus', check); document.addEventListener('visibilitychange', focus);
const timer = setInterval(focus, 5000);
window.addEventListener('pagehide', () => { clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', focus); mounted.dispose(); }, { once: true });
