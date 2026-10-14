/**
 * RP-05 Rhythm and delivery, a sheet of the week ahead page: which days and what time,
 * daily closing, the financial year start, the missed-brief rule, and delivery by mail
 * and by WhatsApp, each off by default with the exact message shown before the first is
 * sent and a Verify step. Save sends `reportsx.setRhythm` with only the fields changed.
 * Only the owner or a cofounder changes anything; every other seat reads.
 */
import { useState } from 'react';
import { Button } from '../../parts/Button';
import { Choice, YesNo } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { KeyValue } from '../../parts/KeyValue';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import type { PlaceRenderProps } from '../../places/types.ts';
import { words } from '../../places/types.ts';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { Group, Note, screenState } from '../trust/kit/Screen';
import { isAdmin, refusal } from './shared';
import { MONTH_DAY, TIME, validateRhythm, validateVerify, type Rhythm, type RhythmSettings } from './validate.ts';
import { WORDS, type Words } from './words.ts';
import s from './Reports.module.css';

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const FIELDS = ['days', 'time', 'dailyClosing', 'financialYearStart', 'missedRule', 'mail', 'whatsapp'] as const;

function settings(r: Rhythm): RhythmSettings {
  return { days: r.days, time: r.time, dailyClosing: r.dailyClosing, financialYearStart: r.financialYearStart, missedRule: r.missedRule, mail: r.mail, whatsapp: r.whatsapp };
}

/** Exactly the settings that differ from what the engine holds. */
export function changedFields(base: RhythmSettings, draft: RhythmSettings): Partial<RhythmSettings> {
  const out: Record<string, unknown> = {};
  const norm = (k: (typeof FIELDS)[number], v: RhythmSettings) => JSON.stringify(k === 'days' ? [...v.days].sort() : v[k]);
  for (const k of FIELDS) if (norm(k, base) !== norm(k, draft)) out[k] = draft[k];
  return out as Partial<RhythmSettings>;
}

export interface RhythmSheetProps extends PlaceRenderProps { origin: HTMLElement | null; onClose: () => void }

export function RhythmSheet({ language, member, viewer, rpc, origin, onClose }: RhythmSheetProps) {
  const w = words(WORDS, language);
  const { state, reload } = useEngine(rpc, 'reportsx.rhythm', {}, validateRhythm);
  const saver = useSend(rpc, validateRhythm);
  const admin = isAdmin(member, viewer);
  const base = saver.sent.kind === 'done' ? saver.sent.value : state.kind === 'ready' ? state.value : null;
  return (
    <Sheet kind={w.weekahead} title={w.rhythm} onClose={onClose} origin={origin}>
      {base === null ? <State state={screenState(state)} /> : admin
        ? <Editor key={JSON.stringify(settings(base))} rhythm={base} w={w} rpc={rpc} saver={saver} onVerified={() => { saver.clear(); reload(); }} />
        : <ReadOnly rhythm={base} w={w} />}
    </Sheet>
  );
}

function dayNames(days: number[], w: Words): string {
  return DAYS.filter((d) => days.includes(d)).map((d) => w[`day${d}`]).join(', ');
}

function ChannelState({ rhythm, channel, w }: { rhythm: Rhythm; channel: 'mail' | 'whatsapp'; w: Words }) {
  const verified = channel === 'mail' ? rhythm.mailVerified : rhythm.whatsappVerified;
  return (
    <div className={s.stack}>
      {channel === 'whatsapp' && rhythm.whatsappTemplate === 'not-approved' && <p className={s.quiet}>{`${w.partial} · ${w.templateNotApproved}`}</p>}
      <p className={s.quiet}>{verified ? w.verified : w.notVerified}</p>
      {rhythm.relay === 'not-available' && <p className={s.quiet}>{w.relayNotAvailable}</p>}
      <p className={s.quiet}>{w.preview}</p>
      <pre className={s.preview}>{channel === 'mail' ? rhythm.previews.mail : rhythm.previews.whatsapp}</pre>
    </div>
  );
}

function ReadOnly({ rhythm, w }: { rhythm: Rhythm; w: Words }) {
  return (
    <div className={s.stack}>
      <Note>{w.rhythmReadOnly}</Note>
      {rhythm.testMode && <Note>{w.testMode}</Note>}
      <KeyValue onReceipt={() => {}} pairs={[
        { name: w.days, value: dayNames(rhythm.days, w) },
        { name: w.time, value: rhythm.time, mono: true },
        { name: w.dailyClosing, value: rhythm.dailyClosing ? w.on : w.off },
        { name: w.fyStart, value: rhythm.financialYearStart, mono: true },
        { name: w.missedRule, value: w[rhythm.missedRule] },
        { name: w.mail, value: rhythm.mail.on ? w.on : w.off },
        { name: w.mailAddress, value: rhythm.mail.address ?? w.notSet },
        { name: w.whatsapp, value: rhythm.whatsapp.on ? w.on : w.off },
        { name: w.phone, value: rhythm.whatsapp.phone ?? w.notSet },
      ]} />
      <Group title={w.mail}><ChannelState rhythm={rhythm} channel="mail" w={w} /></Group>
      <Group title={w.whatsapp}><ChannelState rhythm={rhythm} channel="whatsapp" w={w} /></Group>
    </div>
  );
}

interface EditorProps {
  rhythm: Rhythm; w: Words; rpc: PlaceRenderProps['rpc'];
  saver: ReturnType<typeof useSend<Rhythm>>; onVerified: () => void;
}

function Editor({ rhythm, w, rpc, saver, onVerified }: EditorProps) {
  const [draft, setDraft] = useState<RhythmSettings>(() => settings(rhythm));
  const [problem, setProblem] = useState<string | null>(null);
  const verifier = useSend(rpc, validateVerify);
  const [verifying, setVerifying] = useState<'mail' | 'whatsapp' | null>(null);
  const set = <K extends keyof RhythmSettings>(k: K, v: RhythmSettings[K]) => { setDraft((d) => ({ ...d, [k]: v })); setProblem(null); };
  const changed = changedFields(settings(rhythm), draft);
  const dirty = Object.keys(changed).length > 0;

  const save = () => {
    if (!TIME.test(draft.time)) return setProblem(w.badTime);
    if (!MONTH_DAY.test(draft.financialYearStart)) return setProblem(w.badFy);
    if (draft.days.length === 0) return setProblem(w.badDays);
    void saver.send('reportsx.setRhythm', changed as Record<string, unknown>);
  };
  const verify = (channel: 'mail' | 'whatsapp') => {
    setVerifying(channel);
    void verifier.send('reportsx.verifyChannel', { channel }).then((r) => { if (r !== null) onVerified(); });
  };
  const verifyLine = (channel: 'mail' | 'whatsapp') => verifying !== channel ? null
    : verifier.sent.kind === 'sending' ? <Note status>{w.verifying}</Note>
    : verifier.sent.kind === 'refused' ? <Note status>{refusal(verifier.sent.code, w)}</Note>
    : verifier.sent.kind === 'done' ? <Note status>{verifier.sent.value.verified ? w.verified : w.notVerified}</Note> : null;

  return (
    <form className={s.stack} onSubmit={(e) => { e.preventDefault(); save(); }}>
      {rhythm.testMode && <Note>{w.testMode}</Note>}
      <Group title={w.days}>
        <div className={s.days} role="group" aria-label={w.days}>
          {DAYS.map((d) => {
            const on = draft.days.includes(d);
            return <button key={d} type="button" className={s.day} aria-pressed={on}
              onClick={() => set('days', on ? draft.days.filter((x) => x !== d) : [...draft.days, d])}>{w[`day${d}`]}</button>;
          })}
        </div>
      </Group>
      <Field label={w.time} value={draft.time} inputMode="numeric" maxLength={5} onChange={(e) => set('time', e.currentTarget.value)} />
      <Group title={w.dailyClosing}><YesNo label={w.dailyClosing} value={draft.dailyClosing} onChange={(v) => set('dailyClosing', v)} /></Group>
      <Field label={w.fyStart} value={draft.financialYearStart} maxLength={5} onChange={(e) => set('financialYearStart', e.currentTarget.value)} />
      <Choice<'run-late' | 'skip'> label={w.missedRule} options={[{ value: 'run-late', label: w['run-late'] }, { value: 'skip', label: w.skip }]}
        value={draft.missedRule} onChange={(v) => set('missedRule', v)} />
      <Group title={w.mail}>
        <YesNo label={w.mail} value={draft.mail.on} onChange={(v) => set('mail', { ...draft.mail, on: v })} />
        <Field label={w.mailAddress} type="email" value={draft.mail.address ?? ''} maxLength={320}
          onChange={(e) => { const v = e.currentTarget.value; set('mail', { ...draft.mail, address: v.length > 0 ? v : null }); }} />
        <div><Button onClick={() => verify('mail')} disabled={verifier.sent.kind === 'sending'}>{w.verify}</Button></div>
        {verifyLine('mail')}
        <ChannelState rhythm={rhythm} channel="mail" w={w} />
      </Group>
      <Group title={w.whatsapp}>
        <YesNo label={w.whatsapp} value={draft.whatsapp.on} onChange={(v) => set('whatsapp', { ...draft.whatsapp, on: v })} />
        <Field label={w.phone} type="tel" value={draft.whatsapp.phone ?? ''} maxLength={32}
          onChange={(e) => { const v = e.currentTarget.value; set('whatsapp', { ...draft.whatsapp, phone: v.length > 0 ? v : null }); }} />
        <div><Button onClick={() => verify('whatsapp')} disabled={verifier.sent.kind === 'sending'}>{w.verify}</Button></div>
        {verifyLine('whatsapp')}
        <ChannelState rhythm={rhythm} channel="whatsapp" w={w} />
      </Group>
      {problem !== null && <Note status>{problem}</Note>}
      {saver.sent.kind === 'refused' && <Note status>{refusal(saver.sent.code, w)}</Note>}
      {saver.sent.kind === 'done' && !dirty && <Note status>{w.saved}</Note>}
      {saver.sent.kind !== 'done' && !dirty && <Note>{w.nothingChanged}</Note>}
      <div><Button variant="filled" submit disabled={!dirty || saver.sent.kind === 'sending'}>{saver.sent.kind === 'sending' ? w.saving : w.save}</Button></div>
    </form>
  );
}
