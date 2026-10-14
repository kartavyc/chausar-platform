import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { TextProvider } from '../../app/ui/src/app/text';
import { Banners } from '../../app/ui/src/parts/Banner';
import { DemoClockControl } from '../../app/ui/src/app/DemoClockControl';
import { UnlockControl } from '../../app/ui/src/host/UnlockControl';
import { useIdleLock } from '../../app/ui/src/app/useIdleLock';
import { HelpSheet } from '../../app/ui/src/app/HelpSheet';
import { LinkDialog } from '../../app/ui/src/app/LinkDialog';
import { FaultReport, faultReportText } from '../../app/ui/src/app/FaultReport';
import { State } from '../../app/ui/src/patterns/States';
import { Frame } from '../../app/ui/src/app/Frame';
import { WorkspaceMenu } from '../../app/ui/src/app/WorkspaceMenu';
import { KEY_MAP } from '../../app/ui/src/app/keys';
import { notBuiltFromCapabilities, shellBanners } from '../../app/ui/src/app/shell-banners';
import type { BannerItem, Language } from '../../app/ui/src/app/presentation';
import type { ShellReply } from '../../app/ui/src/bridge/todayx-contract';
import en from '../../app/ui/src/text/en.json';
import hi from '../../app/ui/src/text/hi.json';

// Synthetic props only. jsdom computes no layout: the narrow check is the frame's own
// media-query branch with matchMedia mocked, not a width measurement.
const wrap = (node: ReactNode, language: Language = 'en') => render(<TextProvider language={language}>{node}</TextProvider>);

function stubMedia(narrow: boolean) {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: narrow && media.includes('max-width: 1023px'), media, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
  }));
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in frame checks'));
  stubMedia(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const reply: ShellReply = {
  workspace: { demo: true },
  clock: { mode: 'demo', date: '2026-09-30' },
  banners: [
    { kind: 'driving', program: 'Tally' },
    { kind: 'demo-clock', date: '2026-09-30' },
    { kind: 'read-only', holder: 'Laptop 2' },
    { kind: 'jobs-paused' },
    { kind: 'no-connection' },
  ],
  autoLockMinutes: 10,
};

test('banners keep the fixed order, show at most two and fold the rest into "and N more"', async () => {
  const user = userEvent.setup();
  const dismiss = vi.fn();
  const items = shellBanners(reply, 'en', { dismissJobsPaused: dismiss });
  /* Arrive shuffled: the order is the frame's, not the caller's. */
  const shuffled: BannerItem[] = [items[4]!, items[2]!, items[0]!, items[3]!, items[1]!];
  const { container } = wrap(<Banners items={shuffled} />);
  const shown = () => [...container.querySelectorAll('[data-banner]')].map((el) => el.getAttribute('data-banner'));
  expect(shown()).toEqual(['driving', 'demo-clock']);
  expect(screen.getByText('Chausar is driving Tally. Press Ctrl Alt Pause to stop.')).toBeTruthy();
  expect(screen.getByText('Demo clock: 30 Sep 2026.')).toBeTruthy();
  const more = screen.getByRole('button', { name: 'and 3 more' });
  expect(more.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Jobs were paused while Chausar was closed.')).toBeNull();
  await user.click(more);
  expect(shown()).toEqual(['driving', 'demo-clock', 'read-only', 'jobs-paused', 'no-connection']);
  expect(screen.getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded')).toBe('true');
  /* Jobs paused is dismissable; it is the only banner here with a callback. */
  await user.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
});

test('two banners or fewer never fold', () => {
  wrap(<Banners items={shellBanners({ ...reply, banners: [{ kind: 'no-connection' }, { kind: 'jobs-paused' }] }, 'en')} />);
  expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
});

test('the demo clock control sets the date once and then only moves forward', async () => {
  const user = userEvent.setup();
  const onSet = vi.fn(), onAdvance = vi.fn();
  const view = wrap(<DemoClockControl state={{ kind: 'not-set' }} onSet={onSet} onAdvance={onAdvance} />);
  const field = screen.getByLabelText('Start date');
  fireEvent.change(field, { target: { value: '2026-02-30' } });
  await user.click(screen.getByRole('button', { name: 'Set the start date' }));
  expect(onSet).not.toHaveBeenCalled();
  expect(screen.getByText('Type a whole date, such as 2026-09-30.')).toBeTruthy();
  fireEvent.change(field, { target: { value: '2026-09-30' } });
  await user.click(screen.getByRole('button', { name: 'Set the start date' }));
  expect(onSet).toHaveBeenCalledExactlyOnceWith('2026-09-30');

  view.rerender(<TextProvider language="en"><DemoClockControl state={{ kind: 'set', date: '2026-09-30', display: '30 Sep 2026' }} onSet={onSet} onAdvance={onAdvance} /></TextProvider>);
  expect(screen.queryByLabelText('Start date')).toBeNull();
  const buttons = screen.getAllByRole('button').map((b) => b.textContent);
  expect(buttons).toEqual(['Move forward a day', 'Move forward a week']);
  expect(buttons.some((b) => /back|earlier|previous/i.test(b ?? ''))).toBe(false);
  expect(screen.getByText('The clock never goes back.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Move forward a day' }));
  await user.click(screen.getByRole('button', { name: 'Move forward a week' }));
  expect(onAdvance.mock.calls).toEqual([['day'], ['week']]);
  expect(onSet).toHaveBeenCalledTimes(1);
});

test('a real workspace gets the fixed words instead of the demo clock control', () => {
  wrap(<DemoClockControl state={{ kind: 'real' }} onSet={vi.fn()} onAdvance={vi.fn()} />);
  expect(screen.getByText('This workspace is real. The demo clock is not available.')).toBeTruthy();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

test('the unlock control clears the field at once and calls unlock once per press', async () => {
  const user = userEvent.setup();
  let release!: () => void;
  const unlock = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const view = wrap(<UnlockControl unlock={unlock} onRecoveryKit={vi.fn()} device={{ name: 'Windows Hello', supported: false, onUnlock: vi.fn() }} />);
  const field = screen.getByLabelText('Passphrase or PIN') as HTMLInputElement;
  expect(field.type).toBe('password');
  await user.type(field, 'synthetic pass{Enter}');
  expect(field.value).toBe('');
  expect(unlock).toHaveBeenCalledExactlyOnceWith('synthetic pass');
  /* A second press while the first is on its way does nothing. */
  await user.type(field, 'again{Enter}');
  expect(field.value).toBe('');
  expect(unlock).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
  /* No Windows Hello link when the computer does not support it; the recovery link is there. */
  expect(screen.queryByRole('button', { name: /Windows Hello/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Use your recovery kit' })).toBeTruthy();

  view.rerender(<TextProvider language="en"><UnlockControl unlock={unlock} result={{ kind: 'wrong' }} device={{ name: 'Windows Hello', supported: true, onUnlock: vi.fn() }} /></TextProvider>);
  const wrong = screen.getByRole('alert').textContent ?? '';
  expect(wrong).toBe('That is not the passphrase.');
  expect(wrong).not.toMatch(/\d/);
  expect(screen.getByRole('button', { name: 'Unlock with Windows Hello' })).toBeTruthy();

  view.rerender(<TextProvider language="en"><UnlockControl unlock={unlock} result={{ kind: 'wait', until: '14:05' }} /></TextProvider>);
  expect(screen.getByRole('alert').textContent).toBe('Too many tries. Try again at 14:05.');
  expect((screen.getByLabelText('Passphrase or PIN') as HTMLInputElement).disabled).toBe(true);
});

function IdleProbe({ minutes, onIdle }: { minutes: number; onIdle: () => void }) {
  useIdleLock({ minutes, onIdle });
  return null;
}

test('idle lock fires after the time with no input, and input starts the wait again', () => {
  vi.useFakeTimers();
  const onIdle = vi.fn();
  render(<IdleProbe minutes={10} onIdle={onIdle} />);
  act(() => { vi.advanceTimersByTime(9 * 60_000); });
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
  act(() => { vi.advanceTimersByTime(9 * 60_000); });
  window.dispatchEvent(new PointerEvent('pointerdown'));
  act(() => { vi.advanceTimersByTime(9 * 60_000); });
  expect(onIdle).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(onIdle).toHaveBeenCalledTimes(1);
  act(() => { vi.advanceTimersByTime(60 * 60_000); });
  expect(onIdle).toHaveBeenCalledTimes(1);
});

test('help lists every key in KEY_MAP, the words and what works with no internet', () => {
  const { container } = wrap(<HelpSheet offline={{ offline: { works: ['books-answers', 'receipts'], waits: ['plain-questions', 'future-code'] } }} />);
  const listed = [...container.querySelectorAll('[data-key]')].map((el) => el.getAttribute('data-key'));
  expect(listed).toEqual(KEY_MAP.map((k) => k.id));
  for (const k of KEY_MAP) {
    const row = container.querySelector(`[data-key="${k.id}"]`) as HTMLElement;
    expect(row.textContent).toContain(k.windows);
    expect(row.textContent).toContain((en as Record<string, string>)[k.textKey]);
  }
  for (const word of ['Receipt', 'Recipe', 'Meaning', 'Source', 'Approval', 'Send level', 'Seat', 'The pen', 'Demo clock']) expect(screen.getByText(word)).toBeTruthy();
  expect(screen.getByText('Answers from your books')).toBeTruthy();
  expect(screen.getByText('Questions in plain words')).toBeTruthy();
  expect(screen.getByText('Another part, code future-code')).toBeTruthy();
});

test('help in Hindi has the same keys and its own words', () => {
  const { container } = wrap(<HelpSheet offline={null} platform="mac" />, 'hi');
  expect(container.querySelectorAll('[data-key]')).toHaveLength(KEY_MAP.length);
  expect(screen.getByText((hi as Record<string, string>)['SH-12.offline.notLoaded']!)).toBeTruthy();
  expect(container.textContent).toContain('Cmd K');
});

test('the link dialog shows the full address as text and opens only on request', async () => {
  const user = userEvent.setup();
  const url = 'https://example.invalid/a/very/long/path?with=query&and=more#fragment';
  const onOpen = vi.fn(), onCancel = vi.fn();
  wrap(<LinkDialog url={url} onOpen={onOpen} onCancel={onCancel} />);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(url).tagName).toBe('P');
  expect(dialog.querySelector('a')).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Open in your browser' }));
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(url);
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalled();
});

test('the fault report starts with the fixed line and sends nothing by default', async () => {
  const user = userEvent.setup();
  const report = { appVersion: '0.1.0-preview.1', os: 'windows-10', eventKinds: ['ask.question'], routeHealth: [{ kind: 'local', state: 'ok' }], errorCodes: ['REQUEST_FAILED'], createdAt: '2026-10-14T09:00:00Z' };
  const onSave = vi.fn(), onSend = vi.fn(), onDontSend = vi.fn();
  const view = wrap(<FaultReport report={report} onSave={onSave} />);
  const header = 'No names, amounts, file names, cell values or questions are in this report.';
  expect(screen.getByText(header)).toBeTruthy();
  expect(faultReportText(report, header).split('\n')[0]).toBe(header);
  expect(screen.queryByRole('button', { name: 'Send report' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Save as a file' }));
  expect(onSave).toHaveBeenCalledTimes(1);
  view.rerender(<TextProvider language="en"><FaultReport report={report} onSave={onSave} crash={{ onSend, onDontSend }} /></TextProvider>);
  expect(onSend).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: "Don't send" }));
  expect(onDontSend).toHaveBeenCalledTimes(1);
  expect(onSend).not.toHaveBeenCalled();
});

test('not built yet names the day and the missing part from a capabilities group', () => {
  const state = notBuiltFromCapabilities({ groups: [{ group: 'approvals', state: 'missing', day: 7, methods: 'approvals.*' }] }, 'approvals');
  expect(state).not.toBeNull();
  wrap(<State state={state!} />);
  expect(screen.getByText('Not built yet. This arrives on day 7.')).toBeTruthy();
  expect(screen.getByText('Missing part: approvals.')).toBeTruthy();
});

function frame(sheet?: ReactNode) {
  return (
    <TextProvider language="en">
      <Frame
        shell={{ kind: 'desktop', view: 'guided' }}
        address={{ place: 'today' }}
        onNavigate={vi.fn()}
        counts={{ today: { exact: '4', display: '4' } }}
        menu={{ workspace: { name: 'Demo shop', demo: true, who: 'You, the owner' }, view: 'guided', onSetView: vi.fn(), language: 'en', onSetLanguage: vi.fn(), onLock: vi.fn(), onAbout: vi.fn() }}
        banners={shellBanners(reply, 'en')}
        ask={{ onAsk: vi.fn() }}
        status={{ sources: { text: 'Sources' }, model: { text: 'Model' }, third: { text: 'Nothing left' } }}
        sheet={sheet}
      >
        <p>Page</p>
      </Frame>
    </TextProvider>
  );
}

test('under 1024 the rail becomes a top bar with the wordmark, the place menu and the count', () => {
  stubMedia(true);
  const { container } = render(frame());
  const rail = container.querySelector('nav[data-region="rail"]') as HTMLElement;
  const summary = rail.querySelector('summary') as HTMLElement;
  expect(summary).toBeTruthy();
  expect(summary.textContent).toContain('Today');
  expect(summary.textContent).toContain('4');
  expect(rail.textContent).toContain('chausar');
});

test('wide windows keep the rail; banners sit above the page and the sheet, not inside the page column', () => {
  const { container } = render(frame(<section data-region="sheet">Sheet</section>));
  expect(container.querySelector('nav[data-region="rail"] summary')).toBeNull();
  const banners = container.querySelector('[data-banner]') as HTMLElement;
  const page = container.querySelector('main[data-region="page"]') as HTMLElement;
  const sheet = container.querySelector('[data-region="sheet"]') as HTMLElement;
  expect(page.contains(banners)).toBe(false);
  expect(banners.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(banners.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  /* The page column and the banner strip are siblings' descendants, never one inside the other. */
  expect(page.parentElement?.contains(banners)).toBe(false);
});

test('the workspace menu lists workspaces only when there is more than one, each marked demo or real', async () => {
  const user = userEvent.setup();
  const onSwitch = vi.fn(), onHelp = vi.fn();
  const base = { workspace: { name: 'Demo shop', demo: true, who: 'You, the owner' }, view: 'guided' as const, onSetView: vi.fn(), language: 'en' as const, onSetLanguage: vi.fn(), onLock: vi.fn(), onAbout: vi.fn() };
  const view = wrap(<WorkspaceMenu {...base} workspaces={[{ id: 'a', name: 'Demo shop', demo: true }]} onSwitchWorkspace={onSwitch} />);
  await user.click(screen.getByRole('button', { name: 'Workspace, view and language' }));
  expect(screen.queryByText('Workspaces')).toBeNull();
  expect(screen.getByRole('menuitem', { name: 'Lock now' })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: 'About this build' })).toBeTruthy();
  await user.keyboard('{Escape}');
  view.rerender(<TextProvider language="en"><WorkspaceMenu {...base} workspaceId="a" workspaces={[{ id: 'a', name: 'Demo shop', demo: true }, { id: 'b', name: 'Kiran Retail', demo: false }]} onSwitchWorkspace={onSwitch} onHelp={onHelp} /></TextProvider>);
  await user.click(screen.getByRole('button', { name: 'Workspace, view and language' }));
  expect(screen.getByText('Workspaces')).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: /Kiran Retail/ }).textContent).toMatch(/Kiran Retail\s*real/);
  for (const name of ['Simple', 'Guided', 'Books', 'English', 'हिंदी', 'Lock now', 'Help', 'About this build']) expect(screen.getByRole('menuitem', { name })).toBeTruthy();
  await user.click(screen.getByRole('menuitem', { name: /Kiran Retail/ }));
  expect(onSwitch).toHaveBeenCalledExactlyOnceWith('b');
});
