/**
 * Preview entry: the real host (`mountHost` from host/bootstrap) on the fake engine.
 * For previews, screenshots and the UI policy checker only. It is never served by the
 * desktop app or the loopback server.
 *
 * Query options:  ?scenario=populated|empty|first-run|locked|read-only
 *                 &lang=en|hi  &view=guided|simple|books  &theme=light|dark
 *                 &clock=YYYY-MM-DD  &tiles=0 (do not prepare the three figures)
 * The hash is the address, as in the app: #/books/sources, #/today?sheet=...
 *
 * `theme` sets `data-theme`, which exists only to fix a theme for pictures. Without it the
 * page follows the computer's colour scheme.
 */
import { createFakeEngine, FAKE_SCENARIOS } from '../src/bridge/fake.ts';
import type { FakeScenario } from '../src/bridge/fake.ts';
import { createHostController, mountHost } from '../src/host/bootstrap';
import { formatAddress } from '../src/app/routes.ts';
import { morePlaces, railPlaces } from '../src/app/places.ts';
import type { Address, Language, View } from '../src/app/presentation.ts';
import { placeModuleFor } from '../src/places/registry.ts';

const query = new URLSearchParams(window.location.search);
const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
  const value = query.get(name);
  return allowed.find(item => item === value) ?? fallback;
};
const scenario: FakeScenario = pick('scenario', FAKE_SCENARIOS, 'populated');
const language: Language = pick('lang', ['en', 'hi'] as const, 'en');
const view: View = pick('view', ['guided', 'simple', 'books'] as const, 'guided');
const theme = pick('theme', ['light', 'dark', 'system'] as const, 'system');
const clock = query.get('clock');
const prepareTiles = query.get('tiles') !== '0';

/** Every place and sub-place address of the desktop shell in this view, from the place list itself. */
function addresses(): { readonly address: string; readonly handledBy: string | null }[] {
  const places = [...railPlaces({ kind: 'desktop', view }), ...(view === 'simple' ? morePlaces() : [])];
  const out: Address[] = [];
  for (const place of places) {
    out.push({ place: place.id });
    for (const sub of place.subs) out.push({ place: place.id, sub: sub.id });
  }
  const seen = new Set<string>();
  return out.filter(address => { const key = formatAddress(address); if (seen.has(key)) return false; seen.add(key); return true; })
    .map(address => ({ address: formatAddress(address), handledBy: placeModuleFor(address)?.id ?? null }));
}

/** Keep the picture-only theme fixed: the host clears `data-theme` whenever it renders a new language or view. */
let heldTheme: 'light' | 'dark' | 'system' = theme;
function applyTheme() {
  const root = document.documentElement;
  if (heldTheme === 'system') { if (root.hasAttribute('data-theme')) root.removeAttribute('data-theme'); return; }
  if (root.getAttribute('data-theme') !== heldTheme) root.setAttribute('data-theme', heldTheme);
}
function holdTheme() {
  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

interface PreviewHandle {
  readonly options: { readonly scenario: FakeScenario; readonly language: Language; readonly view: View; readonly theme: string };
  readonly addresses: ReturnType<typeof addresses>;
  ready: boolean;
  readonly calls: readonly string[];
  setTheme(next: 'light' | 'dark' | 'system'): void;
}
declare global { interface Window { __chausarPreview?: PreviewHandle } }

async function start() {
  const engine = createFakeEngine({ scenario, language, ...(clock ? { clock } : {}) });
  const todayProducer = await engine.todayProducer();
  const controller = createHostController(engine, { todayProducer, now: () => Date.parse(`${engine.date()}T06:00:00.000Z`) });
  const container = document.getElementById('host');
  if (container === null) throw new Error('The preview page has no #host element.');
  const handle: PreviewHandle = {
    options: { scenario, language, view, theme }, addresses: addresses(), ready: false, calls: engine.calls,
    setTheme(next) { heldTheme = next; applyTheme(); },
  };
  window.__chausarPreview = handle;
  mountHost(container, controller, { language, view, firstRun: 'journey' });
  holdTheme();
  // Prepare the three configured figures once, the way the Prepare button does, so the charts and receipts show.
  let prepared = false;
  const settle = () => {
    const state = controller.snapshot();
    if (state.phase === 'locked' || state.phase === 'unavailable' || state.dictionaryReviewRequired) { handle.ready = true; return; }
    const consumer = controller.todayConsumer;
    const today = consumer?.snapshot();
    if (state.phase !== 'ready' || consumer === null || consumer === undefined || today === undefined) return;
    if (today.phase === 'failed' || today.phase === 'missing') { handle.ready = true; return; }
    if (today.phase !== 'ready') return;
    if (!prepared && prepareTiles && state.context?.member.role !== 'viewer' && today.response?.tiles.state === 'unavailable' && consumer.input?.configuration) {
      prepared = true;
      void consumer.prepare(today, () => true).finally(() => { handle.ready = true; });
      return;
    }
    if (!prepared || today.response?.tiles.state === 'prepared' || !prepareTiles) handle.ready = true;
  };
  controller.subscribe(settle);
  const poll = () => { settle(); if (!handle.ready) window.setTimeout(poll, 50); };
  poll();
}

void start();
