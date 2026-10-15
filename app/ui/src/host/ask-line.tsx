/**
 * The host's ask line (SH-04, SH-05, TD-02): everything the frame's ask line is given beyond
 * `onAsk`, kept out of bootstrap.tsx.
 *
 * - Suggestions while typing (ask-suggestions.ts), debounced, from local engine reads only.
 * - "About:" a place sets with `setAbout` (BK-12). It clears when the person clears it or leaves
 *   that place; a question asked while it shows carries the reference as data (`AskQuestion`).
 * - Telling, not asking: a statement becomes a memory line to confirm, in a sheet with Confirm
 *   and Not now. Nothing is stored before Confirm: only then `books.memoryPropose` (and, for the
 *   owner, `books.memoryConfirm`) runs.
 * - Voice over `voice.*` (voice-controller.ts), the voice panel, a dropped voice note, reading
 *   a receipt aloud, and the same plumbing as Today's cash by voice listener.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Address, Language } from '../app/presentation.ts';
import type { AskLineProps, AskVoice } from '../app/AskLine';
import type { AddressBoundSheet } from '../app/composition.ts';
import { sameAddress, withSheet, withoutSheet } from '../app/routes.ts';
import { useT } from '../app/text';
import { Sheet } from '../parts/Sheet';
import { Button } from '../parts/Button';
import { State } from '../patterns/States';
import { money } from '../format/money.ts';
import type { PlaceRpc } from '../places/types.ts';
import { notBuilt } from '../bridge/todayx-contract.ts';
import { readAskAbout, readMemoryLine, type AskAbout, type AskQuestion } from '../bridge/voice-contract.ts';
import type { CashVoiceCapability } from '../screens/today/voice-cash.ts';
import { createSuggestionSource, isTelling, placeNames, SUGGESTION_DEBOUNCE_MS, type HostSuggestion } from './ask-suggestions.ts';
import { createVoiceController, type VoiceCapturePort, type VoiceController, type VoiceSpeakerPort } from './voice-controller.ts';
import { browserVoiceCapture, browserVoiceSpeaker, readVoiceNote } from './voice-capture.ts';
import { AskVoicePanel, SpeakReceipt } from './AskVoicePanel';

export const TELLING_SHEET = 'telling';
const RULES: Address = { place: 'trust', sub: 'rules' };
const MODELS: Address = { place: 'trust', sub: 'models' };
const SAVED: Address = { place: 'ask', sub: 'saved' };
const samePlace = (a: Address, b: Address) => a.place === b.place && a.sub === b.sub;

export type SetAbout = (about: { label: string; ref: { kind: string; id: string } } | null) => void;

export interface HostAskLineInput {
  readonly rpc: PlaceRpc;
  readonly language: Language;
  readonly viewer: boolean;
  /** Only the owner confirms a memory line; others leave it proposed. */
  readonly owner: boolean;
  readonly navigate: (address: Address) => void;
  /** The address shown now (the hash), or null. */
  readonly current: () => Address | null;
  /** A saved answer picked from the suggestions. Absent: Ask, Saved opens. */
  readonly onSaved?: ((id: string) => void) | undefined;
  /** Every question that leaves the ask line for Ask, with its reference as data. */
  readonly onQuestion?: ((question: AskQuestion) => void) | undefined;
  /** Test and preview seams: the listening and speaking ports. Default: this browser's. */
  readonly capture?: VoiceCapturePort | null | undefined;
  readonly speaker?: VoiceSpeakerPort | null | undefined;
}

export interface HostAskLine {
  readonly ask: Pick<AskLineProps, 'suggestions' | 'onChange' | 'onPick' | 'about' | 'voice' | 'onSubmitted' | 'renderVoice' | 'onDropNote'>;
  /** The `setAbout` a place drawn at `at` receives. */
  setAboutAt(at: Address): SetAbout;
  /** Called on every address change: leaving a place clears its "About:" and any telling sheet. */
  onAddress(address: Address | null): void;
  /** The telling sheet, bound to its address. */
  readonly sheet: AddressBoundSheet<ReactNode> | undefined;
  /** Today's cash by voice (TD-02), from the same voice plumbing. Absent until voice's status is read. */
  readonly cashVoice: CashVoiceCapability | undefined;
  /** "Read it aloud" for a receipt, while voice is on. */
  speak(receiptId: string): ReactNode;
  /** The last question that went to Ask. */
  lastQuestion(): AskQuestion | null;
}

type Telling = { readonly text: string; readonly address: Address; readonly phase: 'asking' | 'saving' | 'saved' | 'proposed' | 'not-built' | 'failed'; readonly origin: HTMLElement | null };

export function useHostAskLine(input: HostAskLineInput): HostAskLine {
  const { rpc, language, viewer, owner, navigate, current } = input;
  const latest = useRef(input);
  latest.current = input;
  const lang = language === 'hi' ? 'hi' : 'en';
  const langRef = useRef<'en' | 'hi'>(lang);
  langRef.current = lang;
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;

  /* Voice: one controller per engine port. Off until its status says on. */
  const voice: VoiceController = useMemo(() => createVoiceController(rpc,
    input.capture !== undefined ? input.capture : browserVoiceCapture(),
    input.speaker !== undefined ? input.speaker : browserVoiceSpeaker(), () => langRef.current), [rpc]);
  useEffect(() => { void voice.refresh(); return () => { voice.reset(); voice.stopSpeaking(); }; }, [voice]);
  const snap = useSyncExternalStore(voice.subscribe, voice.snapshot, voice.snapshot);

  /* Suggestions. */
  const source = useMemo(() => createSuggestionSource(rpc, () => placeNames(tRef.current)), [rpc]);
  const [suggestions, setSuggestions] = useState<readonly HostSuggestion[]>([]);
  const shownRef = useRef<readonly HostSuggestion[]>([]);
  shownRef.current = suggestions;
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); seq.current++; }, []);
  const onChange = useCallback((text: string) => {
    const mine = ++seq.current;
    if (timer.current !== null) clearTimeout(timer.current);
    if (text.trim().length === 0) { setSuggestions([]); return; }
    timer.current = setTimeout(() => {
      void source.suggest(text).then(list => { if (mine === seq.current) setSuggestions(list); }, () => undefined);
    }, SUGGESTION_DEBOUNCE_MS);
  }, [source]);

  /* About. */
  const [about, setAboutState] = useState<{ readonly at: Address; readonly value: AskAbout } | null>(null);
  const aboutRef = useRef(about);
  aboutRef.current = about;
  const setAboutAt = useCallback((at: Address): SetAbout => (value) => {
    const here = latest.current.current();
    if (here === null || !samePlace(here, at)) return;
    if (value === null) { if (aboutRef.current !== null && samePlace(aboutRef.current.at, at)) setAboutState(null); return; }
    const checked = readAskAbout(value);
    if (checked === null) return;
    const prior = aboutRef.current;
    if (prior !== null && samePlace(prior.at, at) && prior.value.label === checked.label && prior.value.ref.kind === checked.ref.kind && prior.value.ref.id === checked.ref.id) return;
    setAboutState({ at: withoutSheet(at), value: checked });
  }, []);

  /* Telling. */
  const [telling, setTelling] = useState<Telling | null>(null);
  const tellingRef = useRef(telling);
  tellingRef.current = telling;
  const lastQuestion = useRef<AskQuestion | null>(null);

  const onAddress = useCallback((address: Address | null) => {
    const a = aboutRef.current;
    if (a !== null && (address === null || !samePlace(a.at, address))) setAboutState(null);
    const told = tellingRef.current;
    if (told !== null && (address === null || !sameAddress(told.address, address))) setTelling(null);
    setSuggestions([]); seq.current++;
  }, []);

  const onSubmitted = useCallback((text: string, by: 'typed' | 'voice') => {
    setSuggestions([]); seq.current++;
    const here = latest.current.current();
    if (isTelling(text) && here !== null) {
      const address = withSheet(here, TELLING_SHEET);
      setTelling({ text, address, phase: 'asking', origin: document.activeElement instanceof HTMLElement ? document.activeElement : null });
      latest.current.navigate(address);
      return true;
    }
    const a = aboutRef.current;
    const question: AskQuestion = { text, about: a !== null && here !== null && samePlace(a.at, here) ? { kind: a.value.ref.kind, id: a.value.ref.id } : null, by };
    lastQuestion.current = question;
    latest.current.onQuestion?.(question);
    return false;
  }, []);

  const onPick = useCallback((id: string): string | void => {
    const picked = shownRef.current.find(s => s.id === id);
    setSuggestions([]); seq.current++;
    if (picked === undefined) return;
    const target = picked.target;
    switch (target.kind) {
      case 'place': latest.current.navigate(target.address); return;
      case 'calculation': return target.text;
      case 'saved':
        if (latest.current.onSaved) latest.current.onSaved(target.id); else latest.current.navigate(SAVED);
        return;
      case 'customer': {
        const here = latest.current.current();
        if (here !== null) setAboutState({ at: withoutSheet(here), value: { label: target.name, ref: { kind: 'customer', id: target.id } } });
        return;
      }
    }
  }, []);

  const closeTelling = useCallback(() => {
    const told = tellingRef.current;
    setTelling(null);
    if (told !== null) {
      const here = latest.current.current();
      if (here !== null && sameAddress(here, told.address)) latest.current.navigate(withoutSheet(told.address));
    }
  }, []);
  const confirmTelling = useCallback(async () => {
    const told = tellingRef.current;
    if (told === null || told.phase !== 'asking' || latest.current.viewer) return;
    const step = (phase: Telling['phase']) => setTelling(now => now !== null && now.text === told.text && sameAddress(now.address, told.address) ? { ...now, phase } : now);
    step('saving');
    try {
      const line = readMemoryLine(await latest.current.rpc.request('books.memoryPropose', { text: told.text.slice(0, 2000), kind: 'claim' }));
      if (line === null) { step('failed'); return; }
      if (!latest.current.owner) { step('proposed'); return; }
      const confirmed = readMemoryLine(await latest.current.rpc.request('books.memoryConfirm', { id: line.id }));
      step(confirmed === null ? 'proposed' : 'saved');
    } catch (error) { step(notBuilt(error) ? 'not-built' : 'failed'); }
  }, []);

  const sheet: AddressBoundSheet<ReactNode> | undefined = telling === null ? undefined : {
    address: telling.address,
    content: <TellingSheet telling={telling} viewer={viewer} onConfirm={() => { void confirmTelling(); }} onClose={closeTelling} />,
  };

  /* Voice for the ask line. */
  const status = snap.status.kind === 'ready' ? snap.status.value : null;
  const openRules = useCallback(() => latest.current.navigate(RULES), []);
  const askVoice: AskVoice | undefined = viewer ? undefined : snap.status.kind === 'not-built'
    ? { on: false, notBuilt: true, onHoldStart: () => undefined, onHoldEnd: () => undefined, onOpenSettings: openRules }
    : status === null ? undefined : {
      on: status.enabled,
      listening: snap.phase.kind === 'listening',
      ...(status.mode === 'paid' && status.provider?.ratePerMinuteMinor ? { costPerMinute: money(status.provider.ratePerMinuteMinor) } : {}),
      onHoldStart: () => voice.start(),
      onHoldEnd: () => { void voice.stop(); },
      onOpenSettings: openRules,
    };
  const renderVoice = useCallback((ask: (text: string) => void, edit: (text: string) => void) =>
    <AskVoicePanel voice={voice} ask={ask} edit={edit} onOpenModels={() => latest.current.navigate(MODELS)} />, [voice]);
  const onDropNote = useCallback((file: File) => {
    const s = voice.snapshot().status;
    if (s.kind !== 'ready' || !s.value.enabled) { openRules(); return; }
    void readVoiceNote(file).then(note => { if (note !== null) void voice.dropNote(note); });
  }, [voice, openRules]);

  /* TD-02: Today's cash by voice, live when voice is on. */
  const listen = useMemo(() => voice.listenOnce(), [voice]);
  const cashVoice: CashVoiceCapability | undefined = viewer || status === null ? undefined
    : { on: status.enabled, rpc, listen, onOpenSettings: openRules };

  return {
    ask: {
      suggestions: suggestions.length > 0 ? suggestions : undefined, onChange, onPick,
      ...(about !== null ? { about: { name: about.value.label, onClear: () => setAboutState(null) } } : {}),
      ...(askVoice !== undefined ? { voice: askVoice, renderVoice, onDropNote } : {}),
      onSubmitted,
    },
    setAboutAt, onAddress, sheet, cashVoice,
    speak: (receiptId: string) => viewer ? null : <SpeakReceipt voice={voice} receiptId={receiptId} language={lang} />,
    lastQuestion: () => lastQuestion.current,
  };
}

function TellingSheet({ telling, viewer, onConfirm, onClose }: { telling: Telling; viewer: boolean; onConfirm: () => void; onClose: () => void }) {
  const t = useT();
  const done = telling.phase === 'saved' || telling.phase === 'proposed';
  return <Sheet kind={t('SH-04.telling.kind')} title={t('SH-04.telling.title')} origin={telling.origin} onClose={onClose}
    primary={viewer || done || telling.phase === 'not-built' ? undefined : { label: t('SH-04.telling.confirm'), onPress: onConfirm, disabled: telling.phase !== 'asking' }}
    actions={<Button variant="quiet" onClick={onClose}>{t(done ? 'BTN.close' : 'BTN.notNow')}</Button>}>
    <blockquote data-telling-text="">{telling.text}</blockquote>
    <p>{t('SH-04.telling.note')}</p>
    {viewer && <p role="status">{t('SH-04.telling.viewer')}</p>}
    {telling.phase === 'saved' && <p role="status">{t('SH-04.telling.saved')}</p>}
    {telling.phase === 'proposed' && <p role="status">{t('SH-04.telling.proposed')}</p>}
    {telling.phase === 'failed' && <p role="status">{t('SH-04.telling.failed')}</p>}
    {telling.phase === 'not-built' && <State state={{ kind: 'not-built' }} />}
  </Sheet>;
}
