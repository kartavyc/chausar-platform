import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Address } from '../../app/ui/src/app/presentation';
import { mountHost } from '../../app/ui/src/host/bootstrap';
import type { MountedHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import { createFakeEngine } from '../../app/ui/src/bridge/fake';
import type { FakeScenario } from '../../app/ui/src/bridge/fake';
import { createShellPort, type BrowserShell, type DesktopShellBridge, type ShellPort } from '../../app/ui/src/bridge/shell';
import type { PlaceModule, PlaceRenderProps } from '../../app/ui/src/places/types';
import { LOCAL } from '../../app/ui/src/screens/first-run/text';

// SH-10 and FR-04 through the actual host on the fake engine. The shell port is the actual
// adapter over a synthetic preload bridge (or a synthetic browser window); nothing opens.
const ADDRESS = 'https://www.gst.gov.in/help?topic=gstr-3b#due';
const LINK_PLACE: Address = { place: 'tools', sub: 'smallapps' };
const seen: { openLink: PlaceRenderProps['openLink'] | 'unset' } = { openLink: 'unset' };

vi.mock('../../app/ui/src/places/registry', async importOriginal => {
  const actual = await importOriginal<typeof import('../../app/ui/src/places/registry')>();
  const linkPlace: PlaceModule = {
    id: 'synthetic-link-place',
    handles: address => address.place === 'tools' && address.sub === 'smallapps',
    render: props => {
      seen.openLink = props.openLink;
      return <div data-synthetic-link-place="">
        <p>{ADDRESS}</p>
        {props.openLink !== undefined && <button type="button" onClick={() => props.openLink?.(ADDRESS)}>Synthetic outside link</button>}
      </div>;
    },
  };
  return { ...actual, placeModuleFor: (address: Address, list?: readonly PlaceModule[]) => linkPlace.handles(address) ? linkPlace : actual.placeModuleFor(address, list) };
});

const cleanups: Array<() => void> = [];
function desktopBridge(openReply: unknown = 'opened') {
  const opened: unknown[] = [], printed: Array<{ kind: unknown; marked: string | undefined; kit: string | null }> = [];
  let releasePrint: () => void = () => {};
  const bridge: DesktopShellBridge = {
    async openExternal(url) { opened.push(url); return openReply; },
    print(kind) {
      printed.push({ kind, marked: document.documentElement.dataset['print'], kit: document.querySelector('[data-print-kit]')?.textContent ?? null });
      return new Promise(accept => { releasePrint = () => accept('printed'); });
    },
  };
  return { bridge, opened, printed, release: () => releasePrint() };
}
async function mountOnFake(scenario: FakeScenario, shell: ShellPort | undefined, journey = false) {
  const engine = createFakeEngine({ scenario });
  const controller = createHostController(engine, { todayProducer: await engine.todayProducer() });
  const container = document.createElement('div'); document.body.append(container);
  let mounted: MountedHost | null = null;
  await act(async () => { mounted = mountHost(container, controller, { view: 'guided', ...(journey ? { firstRun: 'journey' as const } : {}), ...(shell ? { shell } : {}) }); });
  cleanups.push(() => { mounted?.unmount(); controller.dispose(); container.remove(); });
  return { engine, user: userEvent.setup() };
}
async function goToLinkPlace() {
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  await act(async () => { window.location.hash = `#/${LINK_PLACE.place}/${LINK_PLACE.sub}`; });
  await waitFor(() => expect(document.querySelector('[data-synthetic-link-place]')).not.toBeNull(), { timeout: 5000 });
}

beforeEach(() => {
  seen.openLink = 'unset';
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in shell fixtures'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const cleanup of cleanups.splice(0)) cleanup(); });
  document.body.replaceChildren(); window.location.hash = '';
  delete document.documentElement.dataset['print'];
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

test('a place\'s outside link opens only after "Open in your browser" in the link dialog, with the full address shown as text', { timeout: 20000 }, async () => {
  const desktop = desktopBridge();
  const { user } = await mountOnFake('populated', createShellPort(desktop.bridge, null));
  await goToLinkPlace();
  await user.click(screen.getByRole('button', { name: 'Synthetic outside link' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(ADDRESS).tagName).toBe('P');
  expect(dialog.querySelector('a')).toBeNull();
  expect(desktop.opened).toEqual([]);
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(desktop.opened).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Synthetic outside link' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Open in your browser' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(desktop.opened).toEqual([ADDRESS]);
});

test('an address the shell refuses keeps the dialog open with the reason, and opens nothing', { timeout: 20000 }, async () => {
  const desktop = desktopBridge('refused');
  const { user } = await mountOnFake('populated', createShellPort(desktop.bridge, null));
  await goToLinkPlace();
  await user.click(screen.getByRole('button', { name: 'Synthetic outside link' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Open in your browser' }));
  await within(dialog).findByText(/Chausar cannot open this address/);
  expect(within(dialog).getByRole('button', { name: 'Open in your browser' }).hasAttribute('disabled')).toBe(true);
  expect(desktop.opened).toEqual([ADDRESS]);
});

test('without a shell port places get no link opener and the address stays text', { timeout: 20000 }, async () => {
  await mountOnFake('populated', undefined);
  await goToLinkPlace();
  expect(seen.openLink).toBeUndefined();
  expect(screen.queryByRole('button', { name: 'Synthetic outside link' })).toBeNull();
});

test('the recovery kit\'s Print asks the shell for print(\'recovery-kit\') with only the kit, in English and Hindi, marked for paper', { timeout: 30000 }, async () => {
  const desktop = desktopBridge();
  const en = LOCAL.en, hi = LOCAL.hi;
  // A locked fake engine: "Use your recovery kit" starts the journey on a computer with no open vault.
  const { user } = await mountOnFake('locked', createShellPort(desktop.bridge, null), true);
  await user.click(await screen.findByRole('button', { name: 'Use your recovery kit' }, { timeout: 5000 }));
  await user.click(await screen.findByRole('button', { name: en['FR-01.business.btn'] }, { timeout: 5000 }));
  await screen.findByRole('heading', { name: en['FR-02.title'] });
  await user.click(screen.getByRole('button', { name: en['FR.journey.continue.btn'] }));
  await screen.findByRole('heading', { name: en['FR-03.title'] }, { timeout: 5000 });
  await user.type(screen.getByLabelText(en['FR-03.name']!), 'Synthetic print shop');
  await user.type(screen.getByLabelText(en['FR-03.passphrase']!), 'Synthetic print passphrase');
  await user.type(screen.getByLabelText(en['FR-03.repeat']!), 'Synthetic print passphrase');
  await user.click(screen.getByRole('button', { name: en['FR-03.create.btn'] }));
  await screen.findByRole('heading', { name: en['FR-04.title'] }, { timeout: 5000 });
  const code = document.querySelector('[data-recovery-code]')?.textContent ?? '';
  expect(code.length).toBeGreaterThan(0);
  // At rest there is no print copy and nothing is marked for paper.
  expect(document.querySelector('[data-print-kit]')).toBeNull();
  expect(document.documentElement.dataset['print']).toBeUndefined();
  await user.click(screen.getByRole('button', { name: en['FR-04.print.btn'] }));
  await waitFor(() => expect(desktop.printed).toHaveLength(1));
  const [asked] = desktop.printed;
  expect(asked!.kind).toBe('recovery-kit');
  expect(asked!.marked).toBe('recovery-kit');
  // One page: the code and the three lines in both languages, outside the app's own tree.
  const copy = document.querySelector('[data-print-kit]') as HTMLElement;
  expect(copy.parentElement).toBe(document.body);
  for (const key of ['FR-04.where', 'FR-04.how', 'FR-04.new'] as const) {
    expect(asked!.kit).toContain(en[key]); expect(asked!.kit).toContain(hi[key]);
  }
  expect(copy.textContent?.replace(/\s/g, '')).toContain(code.replace(/\s/g, ''));
  expect(screen.getByRole('button', { name: en['FR-04.print.btn'] }).hasAttribute('disabled')).toBe(true);
  await act(async () => { desktop.release(); });
  await waitFor(() => expect(document.querySelector('[data-print-kit]')).toBeNull());
  expect(document.documentElement.dataset['print']).toBeUndefined();
  expect(desktop.opened).toEqual([]);
});

test('in the browser the same seam opens a new tab with no opener and prints with the browser\'s dialog', async () => {
  const opens: unknown[][] = [];
  let marked: string | undefined;
  const browser: BrowserShell = {
    open: (...args: unknown[]) => { opens.push(args); return null; },
    print: () => { marked = document.documentElement.dataset['print']; },
    document,
  };
  let clock = 0;
  const port = createShellPort(null, browser, () => clock);
  expect(await port.openExternal('javascript:alert(1)')).toBe('refused');
  expect(await port.openExternal('http://example.com/')).toBe('refused');
  expect(await port.openExternal('https://Example.com/a')).toBe('opened');
  expect(await port.openExternal('https://example.com/b')).toBe('refused');
  clock += 1000;
  expect(await port.openExternal('https://example.com/b')).toBe('opened');
  expect(opens).toEqual([['https://example.com/a', '_blank', 'noopener,noreferrer'], ['https://example.com/b', '_blank', 'noopener,noreferrer']]);
  await port.print('recovery-kit');
  expect(marked).toBe('recovery-kit');
  expect(document.documentElement.dataset['print']).toBeUndefined();
});

test('a preload without the shell functions refuses and prints nothing', async () => {
  const port = createShellPort({}, null);
  expect(await port.openExternal('https://example.com/')).toBe('refused');
  await port.print('page');
  expect(document.documentElement.dataset['print']).toBeUndefined();
});
