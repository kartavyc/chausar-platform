import { useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address } from '../../app/ui/src/app/presentation';
import { AskLine, useVoiceHold } from '../../app/ui/src/app/AskLine';
import type { PlaceModule, PlaceRenderProps } from '../../app/ui/src/places/types';
import { mountHost, type MountedHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import { useHostAskLine } from '../../app/ui/src/host/ask-line';
import type { VoiceCapturePort, VoiceSpeakerPort, VoiceTake } from '../../app/ui/src/host/voice-controller';
import { createFakeEngine, type FakeEngine } from '../../app/ui/src/bridge/fake';
import { registerAskLineFixtures, type VoiceFixtureOptions } from '../../app/ui/src/bridge/fixtures/ask-line';
import type { AskQuestion } from '../../app/ui/src/bridge/voice-contract';
import { CashVoice } from '../../app/ui/src/screens/today/CashVoice';

// Synthetic demo shop and replies only; nothing reaches a network.
const cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in these checks'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const undo of cleanups.splice(0)) undo(); });
  cleanup(); document.body.replaceChildren(); window.location.hash = '';
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

function fixtures(options: VoiceFixtureOptions = {}) {
  const registered = registerAskLineFixtures(options);
  cleanups.push(registered.undo);
  return registered;
}

async function mount(engine: FakeEngine, options: Parameters<typeof mountHost>[2] = {}) {
  const controller = createHostController(engine, { todayProducer: await engine.todayProducer() });
  const container = document.createElement('div'); document.body.append(container);
  let mounted: MountedHost | null = null;
  await act(async () => { mounted = mountHost(container, controller, { view: 'guided', ...options }); });
  cleanups.push(() => { mounted?.unmount(); controller.dispose(); container.remove(); });
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
}
const askField = () => {
  const element = document.querySelector('[data-region="ask"] input');
  if (!(element instanceof HTMLInputElement)) throw Error('ask field missing');
  return element;
};

/* -------------------------------------------------------------------- suggestions */

test('typing shows up to five suggestions with their kind, moved through and picked by keyboard', { timeout: 20000 }, async () => {
  fixtures();
  const engine = createFakeEngine({ scenario: 'populated' });
  await mount(engine);
  const user = userEvent.setup();
  const before = engine.calls.length;
  await user.type(askField(), 'kiran');
  const list = await screen.findByRole('listbox', { name: 'Suggestions' }, { timeout: 3000 });
  const options = within(list).getAllByRole('option');
  expect(options.length).toBeLessThanOrEqual(5);
  expect(options.map(o => o.textContent)).toEqual(['Kiran Retail Democustomer', 'Received from Kiran Retail Demosaved answer', 'Sunrise Kirana Democustomer']);
  expect(askField().getAttribute('aria-expanded')).toBe('true');
  expect(askField().getAttribute('role')).toBe('combobox');
  await user.keyboard('{ArrowDown}');
  expect(askField().getAttribute('aria-activedescendant')).toBe(options[0]!.id);
  expect(options[0]!.getAttribute('aria-selected')).toBe('true');
  await user.keyboard('{Enter}');
  // A customer becomes what the line is about.
  expect(await screen.findByText('About: Kiran Retail Demo')).toBeTruthy();
  // Suggestions are local engine reads; nothing typed goes to a model.
  expect(engine.calls.slice(before).filter(c => !['askx.suggest', 'records.search', 'askx.search'].includes(c))).toEqual([]);

  // A place opens its address.
  await user.clear(askField());
  await user.type(askField(), 'sources');
  await screen.findByRole('listbox', { name: 'Suggestions' }, { timeout: 3000 });
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(window.location.hash).toBe('#/books/sources'));
  // Leaving the place clears "About:".
  await waitFor(() => expect(screen.queryByText('About: Kiran Retail Demo')).toBeNull());

  // Esc closes the list without leaving the field.
  await user.clear(askField());
  await user.type(askField(), 'money');
  await screen.findByRole('listbox', { name: 'Suggestions' }, { timeout: 3000 });
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox', { name: 'Suggestions' })).toBeNull();
});

test('suggestions are debounced: quick typing reads the engine once for the settled text', { timeout: 20000 }, async () => {
  fixtures();
  const engine = createFakeEngine({ scenario: 'populated' });
  await mount(engine);
  const before = engine.calls.filter(c => c === 'records.search').length;
  fireEvent.change(askField(), { target: { value: 'k' } });
  fireEvent.change(askField(), { target: { value: 'ki' } });
  fireEvent.change(askField(), { target: { value: 'kir' } });
  await screen.findByRole('listbox', { name: 'Suggestions' }, { timeout: 3000 });
  expect(engine.calls.filter(c => c === 'records.search').length - before).toBe(1);
});

/* ------------------------------------------------------- telling, not asking */

test('a statement becomes a memory line to confirm, and nothing is stored before Confirm', { timeout: 20000 }, async () => {
  const registered = fixtures();
  const engine = createFakeEngine({ scenario: 'populated' });
  const onQuestion = vi.fn();
  await mount(engine, { onQuestion });
  const user = userEvent.setup();
  await user.type(askField(), 'our year starts in April{Enter}');
  const sheet = await screen.findByRole('heading', { name: 'Remember this?' });
  expect(sheet).toBeTruthy();
  expect(document.querySelector('[data-telling-text]')?.textContent).toBe('our year starts in April');
  expect(engine.calls).not.toContain('books.memoryPropose');
  expect(onQuestion).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Not now' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Remember this?' })).toBeNull());
  expect(engine.calls).not.toContain('books.memoryPropose');
  expect(registered.memory).toEqual([]);

  await user.type(askField(), 'our year starts in April{Enter}');
  await screen.findByRole('heading', { name: 'Remember this?' });
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText('Remembered, as told by you.')).toBeTruthy();
  expect(registered.memory).toEqual([{ id: 'memory_demo_1', text: 'our year starts in April', kind: 'claim', status: 'told-by-owner' }]);
});

test('telling shows "not built yet" when no method for proposing a memory exists', { timeout: 20000 }, async () => {
  const engine = createFakeEngine({ scenario: 'populated' });
  await mount(engine);
  const user = userEvent.setup();
  await user.type(askField(), 'we close the books on the 5th{Enter}');
  await screen.findByRole('heading', { name: 'Remember this?' });
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText('Not built yet.', { exact: false })).toBeTruthy();
});

/* ------------------------------------------------- the host's ask line, as a harness */

function capture(said: string | null): VoiceCapturePort {
  let on = false;
  return {
    begin(_kind, _language, onWords) { on = true; if (said) setTimeout(() => onWords(said), 0); return true; },
    async end(): Promise<VoiceTake | null> { const was = on; on = false; return was && said !== null ? { transcript: said, durationMs: 1500 } : null; },
    cancel() { on = false; },
  };
}

function Harness({ engine, place, said = null, onAsk, onQuestion, start = { place: 'books', sub: 'customers' }, speaker = null }: {
  engine: FakeEngine; place?: PlaceModule; said?: string | null; onAsk: (text: string) => void; onQuestion?: (q: AskQuestion) => void; start?: Address;
  speaker?: VoiceSpeakerPort | null;
}) {
  const [address, setAddress] = useState<Address>(start);
  const at = useRef(address);
  const line = useHostAskLine({
    rpc: engine, language: 'en', viewer: false, owner: true, current: () => at.current, onQuestion, capture: capture(said), speaker,
    navigate: a => { at.current = a; setAddress(a); line.onAddress(a); },
  });
  const hold = useVoiceHold(line.ask.voice);
  const props: PlaceRenderProps = {
    address, language: 'en', view: 'guided', member: { id: 'member-demo', role: 'owner' }, viewer: false, rpc: engine, live: () => true,
    openReceipt: () => undefined, navigate: a => { if (a) { at.current = a; setAddress(a); line.onAddress(a); } }, setAbout: line.setAboutAt(address),
  };
  return <>
    <p data-address="">{`${address.place}/${address.sub ?? ''}`}</p>
    {place?.handles(address) && place.render(props)}
    <AskLine {...line.ask} onAsk={onAsk} hold={hold} />
    {line.speak('receipt_demo')}
    {line.cashVoice && <CashVoice voice={line.cashVoice} onSave={text => onAsk(`cash:${text}`)} />}
  </>;
}
const show = (ui: ReactElement) => render(<TextProvider language="en">{ui}</TextProvider>);

/** A place module from another lane (work-books' customer page, BK-12) that says what the line is about. */
const customerPage: PlaceModule = {
  id: 'customer-test',
  handles: a => a.place === 'books' && a.sub === 'customers',
  render: props => <section>
    <h2>Kiran Retail Demo</h2>
    <button type="button" onClick={() => props.setAbout?.({ label: 'Kiran Retail Demo', ref: { kind: 'customer', id: 'customer_demo_1' } })}>Ask about this customer</button>
    <button type="button" onClick={() => props.navigate({ place: 'today' })}>Leave</button>
  </section>,
};

test('setAbout from a place module: "About:" shows, the question carries the reference as data, and it clears', async () => {
  fixtures();
  const engine = createFakeEngine();
  const onAsk = vi.fn(), onQuestion = vi.fn();
  show(<Harness engine={engine} place={customerPage} onAsk={onAsk} onQuestion={onQuestion} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Ask about this customer' }));
  expect(screen.getByText('About: Kiran Retail Demo')).toBeTruthy();
  await user.type(askField(), 'what is owed{Enter}');
  expect(onAsk).toHaveBeenCalledWith('what is owed');
  expect(onQuestion).toHaveBeenCalledWith({ text: 'what is owed', about: { kind: 'customer', id: 'customer_demo_1' }, by: 'typed' });
  // The label is never put into the question text.
  expect(onAsk.mock.calls[0]![0]).not.toContain('Kiran');

  await user.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.queryByText('About: Kiran Retail Demo')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Ask about this customer' }));
  await user.click(screen.getByRole('button', { name: 'Leave' }));
  expect(screen.queryByText('About: Kiran Retail Demo')).toBeNull();
  await user.type(askField(), 'billed last month{Enter}');
  expect(onQuestion).toHaveBeenLastCalledWith({ text: 'billed last month', about: null, by: 'typed' });
});

test('a picked calculation goes to Ask as its question', async () => {
  fixtures();
  const engine = createFakeEngine();
  const onAsk = vi.fn();
  show(<Harness engine={engine} onAsk={onAsk} />);
  const user = userEvent.setup();
  await user.type(askField(), 'billed');
  const option = await screen.findByRole('option', { name: /Amount billed/ }, { timeout: 3000 });
  expect(option.textContent).toContain('calculation');
  await user.click(option);
  expect(onAsk).toHaveBeenCalledWith('Amount billed');
});

/* --------------------------------------------------------------------- voice */

const holdMic = async (name: string) => {
  const mic = screen.getByRole('button', { name });
  await act(async () => { fireEvent.pointerDown(mic, { button: 0, pointerId: 1 }); });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  await act(async () => { fireEvent.pointerUp(mic, { button: 0, pointerId: 1 }); });
};

test('voice off by default: the microphone opens Trust, Rules', async () => {
  fixtures();
  const engine = createFakeEngine();
  show(<Harness engine={engine} onAsk={vi.fn()} />);
  const mic = await screen.findByRole('button', { name: 'Voice is off. Open Trust, Rules, Send to switch it on.' });
  await userEvent.setup().click(mic);
  expect(screen.getByText('trust/rules')).toBeTruthy();
  expect(engine.calls.filter(c => c.startsWith('voice.'))).toEqual(['voice.status']);
});

test('voice not built: the microphone says so', async () => {
  const engine = createFakeEngine();
  show(<Harness engine={engine} onAsk={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Voice is not built yet on this computer.' })).toBeTruthy();
});

test('hold to talk: words as heard, the amount shown back large, nahi named, and nothing runs before the text is confirmed', async () => {
  fixtures({ enabled: true, mode: 'local' });
  const engine = createFakeEngine();
  const onAsk = vi.fn();
  show(<Harness engine={engine} onAsk={onAsk} said="do lakh nahi mila" />);
  await screen.findByRole('button', { name: 'Hold to talk' });
  await holdMic('Hold to talk');
  expect(await screen.findByText('Your question: do lakh nahi mila')).toBeTruthy();
  expect(screen.getByText('Speech is turned into text on this computer.')).toBeTruthy();
  expect(screen.getByText('“nahi” changes the meaning.')).toBeTruthy();
  // No rupees or paise were said: the number is read back as its words, never as money.
  expect(screen.getByText('do lakh. Is that right?')).toBeTruthy();
  expect(screen.queryByText('₹2,00,000. Is that right?')).toBeNull();
  expect(onAsk).not.toHaveBeenCalled();
  expect(engine.calls).not.toContain('voice.confirm');
  expect(screen.queryByRole('button', { name: 'Ask this' })).toBeNull();

  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Yes' }));
  expect(onAsk).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Ask this' }));
  await waitFor(() => expect(onAsk).toHaveBeenCalledExactlyOnceWith('do lakh nahi mila'));
  expect(engine.calls.indexOf('voice.confirm')).toBeGreaterThan(engine.calls.indexOf('voice.stop'));
});

test('Change puts the heard words in the field and confirms nothing', async () => {
  fixtures({ enabled: true, mode: 'local' });
  const engine = createFakeEngine();
  const onAsk = vi.fn();
  show(<Harness engine={engine} onAsk={onAsk} said="paanch hazaar rupaye" />);
  await screen.findByRole('button', { name: 'Hold to talk' });
  await holdMic('Hold to talk');
  expect(await screen.findByText('₹5,000. Is that right?')).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Change' }));
  expect((askField() as HTMLInputElement).value).toBe('paanch hazaar rupaye');
  expect(onAsk).not.toHaveBeenCalled();
  expect(engine.calls).not.toContain('voice.confirm');
});

test('voice states: could not hear, and paid speech shows its cost', async () => {
  fixtures({ enabled: true, mode: 'paid' });
  const engine = createFakeEngine();
  show(<Harness engine={engine} onAsk={vi.fn()} said={null} />);
  const mic = await screen.findByRole('button', { name: 'Hold to talk' });
  expect(mic.getAttribute('title')).toBe('₹2 a minute');
  await holdMic('Hold to talk');
  expect(await screen.findByText('Not sure what was said.')).toBeTruthy();
  expect(screen.getByText('Paid speech: ₹2 a minute. 3 minutes this month, ₹6.')).toBeTruthy();
});

test('a dropped voice note is heard and read back the same way', async () => {
  fixtures({ enabled: true, mode: 'local' });
  const engine = createFakeEngine();
  show(<Harness engine={engine} onAsk={vi.fn()} />);
  await screen.findByRole('button', { name: 'Hold to talk' });
  const file = new File([new TextEncoder().encode('do lakh')], 'note.webm', { type: 'audio/webm' });
  await act(async () => { fireEvent.drop(screen.getByRole('search'), { dataTransfer: { files: [file], types: ['Files'] } }); });
  // The note's length is read from its metadata, or counted as unknown after a short wait.
  expect(await screen.findByText('do lakh. Is that right?', undefined, { timeout: 5000 })).toBeTruthy();
  expect(engine.calls).toContain('voice.dropNote');
});

test('cash by voice: the host supplies the listener from the same voice plumbing when voice is on', async () => {
  fixtures({ enabled: true, mode: 'local' });
  const engine = createFakeEngine();
  const onAsk = vi.fn();
  show(<Harness engine={engine} onAsk={onAsk} said="do lakh" />);
  const button = await screen.findByRole('button', { name: 'Hold to say it' });
  await act(async () => { fireEvent.keyDown(button, { key: ' ' }); });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  await act(async () => { fireEvent.keyUp(button, { key: ' ' }); });
  const yes = await screen.findByText('₹2,00,000. Is that right?');
  expect(yes).toBeTruthy();
  expect(engine.calls.filter(c => c.startsWith('voice.') || c.startsWith('modelsx.'))).toEqual(['voice.status', 'voice.start', 'voice.stop', 'modelsx.speechInterpret']);
  await userEvent.setup().click(within(document.querySelector('[data-cash-voice]') as HTMLElement).getByRole('button', { name: 'Yes' }));
  await waitFor(() => expect(onAsk).toHaveBeenCalledWith('cash:200000'));
});

test('cash by voice stays off until voice is on', async () => {
  fixtures({});
  const engine = createFakeEngine();
  show(<Harness engine={engine} onAsk={vi.fn()} />);
  await screen.findByRole('button', { name: 'Voice is off. Open Trust, Rules, Send to switch it on.' });
  expect(screen.queryByRole('button', { name: 'Hold to say it' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Voice is off' })).toBeTruthy();
});

test('an answer is spoken from the figures of its receipt, and Stop speaking stops it', async () => {
  fixtures({ enabled: true, mode: 'local' });
  const engine = createFakeEngine();
  const said: string[][] = [];
  const speaker: VoiceSpeakerPort = { speak: texts => { said.push([...texts]); return true; }, stop: vi.fn() };
  show(<Harness engine={engine} onAsk={vi.fn()} speaker={speaker} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Read it aloud' }));
  expect(await screen.findByText('Speaking the answer')).toBeTruthy();
  expect(said).toEqual([['The figure on this receipt is', '25 lakh 36 thousand 850 rupees']]);
  await user.click(screen.getByRole('button', { name: 'Stop speaking' }));
  expect(speaker.stop).toHaveBeenCalled();
  await waitFor(() => expect(engine.calls).toContain('voice.stopSpeaking'));
  expect(screen.getByRole('button', { name: 'Read it aloud' })).toBeTruthy();
});
