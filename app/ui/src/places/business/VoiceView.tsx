import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { VoiceInput, VoiceSections, VoiceView as VoiceData } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Icon } from '../../parts/Icon';
import { TileSection, messageOf } from './shared';
import b from './Business.module.css';
import s from './VoiceView.module.css';

/** The six sections, in the engine's order (agents/voice.ts VOICE_SECTIONS). */
const SECTIONS: readonly (keyof VoiceSections)[] = ['audience', 'howITalk', 'neverUse', 'wordsIUse', 'willNotClaim', 'format'];
/** The channels a voice can be for besides every channel (voice.ts VOICE_CHANNELS). */
const CHANNELS = ['email', 'whatsapp', 'instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'youtube-shorts', 'youtube'] as const;
const LANGUAGES = ['en', 'hi'] as const;
/** Every language and channel a voice can be for, in the order Add offers them ('' is every channel). */
const PAIRS: readonly { language: 'en' | 'hi'; channel: string }[] = LANGUAGES.flatMap((language) => ['', ...CHANNELS].map((channel) => ({ language, channel })));
const MIN_TEXTS = 3;
const MOST_TEXTS = 10;
/** The engine's shortest text for learning (voice.ts SAMPLE_CHARS.min). */
const SHORTEST = 20;

type Voice = VoiceData['voices'][number];
const keyOf = (voice: { language: string; channel: string | null }) => `${voice.language}|${voice.channel ?? ''}`;
const linesOf = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);
const emptySections = (): VoiceSections => ({ audience: [], howITalk: [], neverUse: [], wordsIUse: [], willNotClaim: [], format: [] });

/**
 * Business > Your voice (W4 4J22b, from 4J17's voice.ts; catalogue A8): how the business talks, in six sections (who
 * you talk to, how you talk, words you never use, words you use, what you will not claim, format), one voice per
 * language and channel, each on or off. Every draft is checked against the voices that are on (the engine's voice
 * check). Each change is the owner's approval: Save, a switch or Go back asks once more, then the engine keeps it as a
 * new version; the version before stays, and Go back sets the one the engine's view gives as undo. "Learn from your
 * writing" hands three to ten of the owner's own texts to the engine, which learns by code from all but the last and
 * checks the result on that last one: the voice is marked checked only when the engine says it passed. A learned voice
 * changes nothing until the owner uses it.
 */
export function VoiceView() {
  const t = useT();
  const engine = useEngine();
  const view = useResource('venture.voice.get', {});
  const [said, setSaid] = useState<{ key: string; line: string } | null>(null);
  const [added, setAdded] = useState<{ language: 'en' | 'hi'; channel: string | null }[]>([]);
  const data = view.data;

  async function set(voice: VoiceInput, key: string): Promise<VoiceData> {
    const answer = await engine.request('venture.voice.set', { voice });
    setSaid({ key, line: answer.line });
    view.reload();
    return answer;
  }

  if (view.error) return <p className={b.problem} role="alert">{messageOf(view.error)}</p>;
  if (!data) return <p className={b.note}>{t('business.loading')}</p>;
  const inUse = new Set(data.voices.map(keyOf));
  const fresh = added.filter((voice) => !inUse.has(keyOf(voice)));

  return (
    <div className={b.page}>
      <p className={b.line}>{data.line}</p>
      <div className={s.grid}>
        {data.voices.map((voice) => (
          <VoiceTile key={keyOf(voice)} voice={voice} said={said?.key === keyOf(voice) ? said.line : null} onSet={(input) => set(input, keyOf(voice))} />
        ))}
        {fresh.map((voice) => (
          <VoiceTile
            key={keyOf(voice)}
            voice={{ ...voice, on: true, sections: emptySections(), validated: false, version: 0, undo: null }}
            said={null}
            onSet={(input) => set(input, keyOf(voice))}
          />
        ))}
        <AddVoice taken={new Set([...inUse, ...fresh.map(keyOf)])} onAdd={(voice) => setAdded((was) => [...was, voice])} />
        <LearnTile draft={data.draft ?? null} line={said?.key === 'learn' ? said.line : null} onLearned={(line) => { setSaid({ key: 'learn', line }); view.reload(); }} onSet={(input) => set(input, keyOf(input as { language: string; channel: string | null }))} />
      </div>
    </div>
  );
}

/** "English, every channel", "Hindi, WhatsApp". */
function useVoiceName() {
  const t = useT();
  return (voice: { language: string; channel: string | null | undefined }) => t('business.voice.name', {
    language: t(`business.voice.language.${voice.language}`), channel: t(voice.channel ? `business.voice.channel.${voice.channel}` : 'business.voice.channel.all'),
  });
}

/** The owner's second yes before a voice changes, inside the tile. */
function SecondAsk({ busy, onYes, onNo }: { busy: boolean; onYes: () => void; onNo: () => void }) {
  const t = useT();
  return (
    <div className={s.ask} data-second-ask="">
      <p className={s.askLine}>{t('business.voice.ask')}</p>
      <div className={s.buttons}>
        <Button size="sm" disabled={busy} onClick={onNo}>{t('business.voice.notNow')}</Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={onYes}>{t('business.voice.yes')}</Button>
      </div>
    </div>
  );
}

/** One voice in use (or one being added): on or off, its version, the checked mark, and its six sections to edit. */
function VoiceTile({ voice, said, onSet }: { voice: Voice; said: string | null; onSet: (input: VoiceInput) => Promise<VoiceData> }) {
  const t = useT();
  const name = useVoiceName();
  const formOf = () => Object.fromEntries(SECTIONS.map((key) => [key, voice.sections[key].join('\n')])) as Record<keyof VoiceSections, string>;
  const [form, setForm] = useState<Record<keyof VoiceSections, string>>(formOf);
  // A new version in use (saved here, gone back to, or learned and used) is what the fields show from then on; the
  // version the tile opened with never resets what is being typed.
  const shownVersion = useRef(voice.version);
  useEffect(() => {
    if (shownVersion.current === voice.version) return;
    shownVersion.current = voice.version;
    setForm(formOf());
  }, [voice.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [asking, setAsking] = useState<VoiceInput | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState<keyof VoiceSections | null>(null);
  const base = { language: voice.language, channel: voice.channel };

  async function yes() {
    if (!asking) return;
    setBusy(true);
    setProblem(null);
    try {
      await onSet(asking);
      setAsking(null);
    } catch (error) {
      setAsking(null);
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  const typed = (): VoiceSections => Object.fromEntries(SECTIONS.map((key) => [key, linesOf(form[key])])) as unknown as VoiceSections;
  // Nothing to save while the sections say what is in use.
  const unchanged = SECTIONS.every((key) => JSON.stringify(linesOf(form[key])) === JSON.stringify(voice.sections[key]));
  return (
    <TileSection
      title={name(voice)}
      meta={(
        <span className={s.meta}>
          {(voice.version ?? 0) > 0 && <span>{t('business.voice.version', { version: String(voice.version) })}</span>}
          {voice.validated && <span className={s.checked} data-validated=""><Icon name="check" size={14} />{t('business.voice.checked')}</span>}
        </span>
      )}
    >
      <label className={s.switch}>
        <input type="checkbox" role="switch" aria-label={t('business.voice.onFor', { name: name(voice) })} checked={voice.on} disabled={busy || (voice.version ?? 0) === 0} onChange={() => setAsking({ ...base, on: !voice.on, sections: structuredClone(voice.sections) })} />
        <span>{t('business.voice.on')}</span>
      </label>
      <div className={s.sections}>
        {SECTIONS.map((key) => (
          <Field
            key={key}
            multiline
            rows={key === 'neverUse' || key === 'wordsIUse' ? 2 : 3}
            label={t(`business.voice.section.${key}`)}
            // Shown only while the field has focus, so a page of voices stays short at rest.
            hint={focused === key ? t(`business.voice.hint.${key}`) : undefined}
            onFocus={() => setFocused(key)}
            onBlur={() => setFocused((was) => (was === key ? null : was))}
            value={form[key]}
            onChange={(event) => { const value = event.currentTarget.value; setForm((was) => ({ ...was, [key]: value })); setAsking(null); }}
          />
        ))}
      </div>
      {problem && <p className={b.problem} role="alert">{problem}</p>}
      {said && <p className={b.said} role="status">{said}</p>}
      {asking ? <SecondAsk busy={busy} onYes={() => void yes()} onNo={() => setAsking(null)} /> : (
        <div className={s.buttons}>
          {voice.undo && (
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => setAsking(structuredClone(voice.undo!))}>
              {t('business.voice.back', { version: String((voice.version ?? 1) - 1) })}
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            aria-label={t('business.voice.saveFor', { name: name(voice) })}
            disabled={busy}
            locked={unchanged}
            lockedReason={t('business.voice.unchanged')}
            onClick={() => { if (!unchanged) setAsking({ ...base, on: voice.on, sections: typed() }); }}
          >
            {t('business.voice.save')}
          </Button>
        </div>
      )}
    </TileSection>
  );
}

/** Another voice: a language and a channel that has none yet, written from empty and saved like the rest. */
function AddVoice({ taken, onAdd }: { taken: ReadonlySet<string>; onAdd: (voice: { language: 'en' | 'hi'; channel: string | null }) => void }) {
  const t = useT();
  const id = useId();
  // It starts on the first language and channel with no voice yet, and moves on when that one is added.
  const free = PAIRS.find((pair) => !taken.has(`${pair.language}|${pair.channel}`));
  const [language, setLanguage] = useState<'en' | 'hi'>(free?.language ?? 'en');
  const [channel, setChannel] = useState<string>(free?.channel ?? '');
  const exists = taken.has(`${language}|${channel}`);
  useEffect(() => {
    if (!exists || !free) return;
    setLanguage(free.language);
    setChannel(free.channel);
  }, [exists, free?.language, free?.channel]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <TileSection title={t('business.voice.add')}>
      <div className={s.pickers}>
        <div className={s.picker}>
          <label className={s.label} htmlFor={`${id}-language`}>{t('business.voice.language')}</label>
          <select id={`${id}-language`} className={s.select} value={language} onChange={(event) => setLanguage(event.currentTarget.value as 'en' | 'hi')}>
            {LANGUAGES.map((one) => <option key={one} value={one}>{t(`business.voice.language.${one}`)}</option>)}
          </select>
        </div>
        <div className={s.picker}>
          <label className={s.label} htmlFor={`${id}-channel`}>{t('business.voice.channel')}</label>
          <select id={`${id}-channel`} className={s.select} value={channel} onChange={(event) => setChannel(event.currentTarget.value)}>
            <option value="">{t('business.voice.channel.any')}</option>
            {CHANNELS.map((one) => <option key={one} value={one}>{t(`business.voice.channel.${one}`)}</option>)}
          </select>
        </div>
      </div>
      {exists && <p className={b.note}>{t('business.voice.exists')}</p>}
      <div className={s.buttons}>
        <Button size="sm" disabled={exists} onClick={() => onAdd({ language, channel: channel || null })}>{t('business.voice.addButton')}</Button>
      </div>
    </TileSection>
  );
}

/** Learn from your writing: three to ten of the owner's texts, the engine's draft, and Use this voice (a second yes). */
function LearnTile({ draft, line, onLearned, onSet }: {
  draft: VoiceData['draft'] | null; line: string | null; onLearned: (line: string) => void; onSet: (input: VoiceInput) => Promise<VoiceData>;
}) {
  const t = useT();
  const engine = useEngine();
  const name = useVoiceName();
  const noteId = useId();
  const [texts, setTexts] = useState<string[]>(() => Array.from({ length: MIN_TEXTS }, () => ''));
  const [asking, setAsking] = useState<VoiceInput | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filled = texts.filter((text) => text.trim().length >= SHORTEST).length;

  async function learn() {
    if (filled < MIN_TEXTS) return;
    setBusy(true);
    setProblem(null);
    try {
      const answer = await engine.request('venture.voice.learn', { samples: texts.filter((text) => text.trim().length >= SHORTEST) });
      onLearned(answer.line);
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function yes() {
    if (!asking) return;
    setBusy(true);
    setProblem(null);
    try {
      await onSet(asking);
      setAsking(null);
    } catch (error) {
      setAsking(null);
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TileSection title={t('business.voice.learn')} className={s.learn}>
      <p className={b.note}>{t('business.voice.learnLead')}</p>
      <div className={s.texts}>
        {texts.map((text, at) => (
          <Field
            key={at}
            multiline
            rows={3}
            label={t('business.voice.text', { n: String(at + 1) })}
            value={text}
            onChange={(event) => { const value = event.currentTarget.value; setTexts((was) => was.map((one, i) => (i === at ? value : one))); }}
          />
        ))}
      </div>
      <div className={s.buttons}>
        {texts.length < MOST_TEXTS && <Button size="sm" variant="quiet" onClick={() => setTexts((was) => [...was, ''])}>{t('business.voice.addText')}</Button>}
        <Button
          size="sm"
          variant={draft ? 'secondary' : 'primary'}
          disabled={busy}
          locked={filled < MIN_TEXTS}
          lockedReason={t('business.voice.needTexts')}
          lockedNoteId={filled < MIN_TEXTS ? noteId : undefined}
          onClick={() => void learn()}
        >
          {t('business.voice.learnButton')}
        </Button>
      </div>
      {filled < MIN_TEXTS && <p id={noteId} className={b.note}>{t('business.voice.needTexts')}</p>}
      {problem && <p className={b.problem} role="alert">{problem}</p>}
      {draft && (
        <section className={s.draft} aria-label={t('business.voice.draft')}>
          <p className={s.draftHead}>
            <span>{name(draft)}</span>
            {draft.validated && <span className={s.checked} data-validated=""><Icon name="check" size={14} />{t('business.voice.checked')}</span>}
          </p>
          {/* Just learned: the engine's whole answer; later, its held-out check line. */}
          {line ? <p className={b.said} role="status">{line}</p> : <p className={b.note}>{draft.line}</p>}
          <dl className={s.learned}>
            {(['howITalk', 'wordsIUse', 'format'] as const).filter((key) => draft.sections[key].length).map((key) => (
              <div key={key} className={s.learnedRow}>
                <dt>{t(`business.voice.section.${key}`)}</dt>
                <dd data-content="">{draft.sections[key].join(', ')}</dd>
              </div>
            ))}
          </dl>
          {asking ? <SecondAsk busy={busy} onYes={() => void yes()} onNo={() => setAsking(null)} /> : (
            <div className={s.buttons}>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => setAsking({ language: draft.language, channel: draft.channel, on: true, sections: structuredClone(draft.sections) })}>{t('business.voice.use')}</Button>
            </div>
          )}
        </section>
      )}
    </TileSection>
  );
}
