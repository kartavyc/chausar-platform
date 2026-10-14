/**
 * RP-05 Rhythm and delivery, a sheet of the week ahead page: which days and what time,
 * daily closing, the financial year start and the missed-brief rule, kept here; Save sends
 * `reportsx.setRhythm` with only the fields changed. Where briefs go is read from the phone
 * channels themselves (`phone.channels.list`, hosted-link): each channel's on or off and
 * whether it is verified, with the exact message shown before the first one is sent and a
 * link to Tools · Phone, where channels are switched on and verified. There is no second copy
 * of those switches here. Only the owner or a cofounder changes anything; every other seat reads.
 */
import { useState } from 'react';
import type { Language } from '../../app/presentation.ts';
import { Button } from '../../parts/Button';
import { Choice, YesNo } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { KeyValue } from '../../parts/KeyValue';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import type { PlaceRenderProps } from '../../places/types.ts';
import { words } from '../../places/types.ts';
import { PHONE, channels as validateChannels, type Channel } from '../tools/adapters/phone.ts';
import { useEngine, useSend, type Loaded } from '../trust/kit/engine.ts';
import { Group, Note, screenState } from '../trust/kit/Screen';
import { isAdmin, refusal, when } from './shared';
import { MONTH_DAY, TIME, validateRhythm, type Rhythm, type RhythmSettings } from './validate.ts';
import { WORDS, fill, type Words } from './words.ts';
import s from './Reports.module.css';

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const FIELDS = ['days', 'time', 'dailyClosing', 'financialYearStart', 'missedRule', 'mail', 'whatsapp'] as const;
type Channels = ReturnType<typeof validateChannels>;

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

/** A channel is verified once its relay side is on: the person started it from their own phone or mail. */
export function channelVerified(c: Channel): boolean { return c.relay?.status === 'on'; }

export interface RhythmSheetProps extends PlaceRenderProps { origin: HTMLElement | null; onClose: () => void }

export function RhythmSheet({ language, member, viewer, rpc, navigate, origin, onClose }: RhythmSheetProps) {
  const w = words(WORDS, language);
  const { state, reload } = useEngine(rpc, 'reportsx.rhythm', { language }, validateRhythm);
  const delivery = useEngine(rpc, PHONE.channels, {}, validateChannels);
  const saver = useSend(rpc, validateRhythm);
  const admin = isAdmin(member, viewer);
  const read = state.kind === 'ready' ? state.value : null;
  const base = saver.sent.kind === 'done' ? saver.sent.value : read;
  const phone = () => navigate({ place: 'tools', sub: 'phone' });
  return (
    <Sheet kind={w.weekahead} title={w.rhythm} onClose={onClose} origin={origin}>
      {base === null || read === null ? <State state={screenState(state)} /> : (
        <div className={s.stack}>
          {base.testMode && <Note>{w.testMode}</Note>}
          {admin
            ? <Editor key={JSON.stringify(settings(base))} rhythm={base} w={w} saver={saver} onSaved={reload} />
            : <ReadOnly rhythm={base} w={w} />}
          <Delivery rhythm={read} loaded={delivery.state} w={w} language={language} onPhone={phone} />
        </div>
      )}
    </Sheet>
  );
}

function dayNames(days: number[], w: Words): string {
  return DAYS.filter((d) => days.includes(d)).map((d) => w[`day${d}`]).join(', ');
}

/** Where briefs go, as hosted-link holds it, and the exact message for each before the first one is sent. */
function Delivery({ rhythm, loaded, w, language, onPhone }: { rhythm: Rhythm; loaded: Loaded<Channels>; w: Words; language: Language; onPhone: () => void }) {
  const preview = (id: Channel['id']) => id === 'mail' ? rhythm.previews.mail : id === 'whatsapp' ? rhythm.previews.whatsapp : null;
  return (
    <Group title={w.channels} note={w.channelsWhere}>
      <div className={s.stack}>
        {loaded.kind === 'loading' && <Note status>{w.channelsLoading}</Note>}
        {loaded.kind === 'not-built' && <Note>{w.channelsNotBuilt}</Note>}
        {loaded.kind === 'locked' && <State state={screenState(loaded)} />}
        {loaded.kind === 'failed' && <Note>{fill(w.channelsFailed, { code: loaded.code })}</Note>}
        {loaded.kind === 'ready' && (
          <>
            {loaded.value.stale && <Note>{loaded.value.refreshedAt !== null ? `${w.channelsStale} ${when(loaded.value.refreshedAt, w, language)}` : w.channelsStale}</Note>}
            {loaded.value.channels.length === 0 && <Note>{w.channelsNone}</Note>}
            {loaded.value.channels.map((c) => {
              const text = preview(c.id);
              return (
                <section key={c.id} className={s.stack} aria-label={w[`channel.${c.id}`]}>
                  <p className={s.say}>{`${w[`channel.${c.id}`]} · ${c.on ? w.channelOn : w.channelOff}`}</p>
                  <p className={s.quiet}>{channelVerified(c) ? w.channelVerified : w.channelNotVerified}</p>
                  {c.id === 'whatsapp' && rhythm.whatsappTemplate === 'not-approved' && <p className={s.quiet}>{`${w.partial} · ${w.templateNotApproved}`}</p>}
                  {text !== null && (
                    <>
                      <p className={s.quiet}>{w.preview}</p>
                      <pre className={s.preview}>{text}</pre>
                    </>
                  )}
                </section>
              );
            })}
          </>
        )}
        <div><Button variant="link" onClick={onPhone}>{w.channelsLink}</Button></div>
      </div>
    </Group>
  );
}

function ReadOnly({ rhythm, w }: { rhythm: Rhythm; w: Words }) {
  return (
    <div className={s.stack}>
      <Note>{w.rhythmReadOnly}</Note>
      <KeyValue onReceipt={() => {}} pairs={[
        { name: w.days, value: dayNames(rhythm.days, w) },
        { name: w.time, value: rhythm.time, mono: true },
        { name: w.dailyClosing, value: rhythm.dailyClosing ? w.on : w.off },
        { name: w.fyStart, value: rhythm.financialYearStart, mono: true },
        { name: w.missedRule, value: w[rhythm.missedRule] },
      ]} />
    </div>
  );
}

interface EditorProps { rhythm: Rhythm; w: Words; saver: ReturnType<typeof useSend<Rhythm>>; onSaved: () => void }

function Editor({ rhythm, w, saver, onSaved }: EditorProps) {
  const [draft, setDraft] = useState<RhythmSettings>(() => settings(rhythm));
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof RhythmSettings>(k: K, v: RhythmSettings[K]) => { setDraft((d) => ({ ...d, [k]: v })); setProblem(null); };
  const changed = changedFields(settings(rhythm), draft);
  const dirty = Object.keys(changed).length > 0;

  const save = () => {
    if (!TIME.test(draft.time)) return setProblem(w.badTime);
    if (!MONTH_DAY.test(draft.financialYearStart)) return setProblem(w.badFy);
    if (draft.days.length === 0) return setProblem(w.badDays);
    void saver.send('reportsx.setRhythm', changed as Record<string, unknown>).then((r) => { if (r !== null) onSaved(); });
  };

  return (
    <form className={s.stack} onSubmit={(e) => { e.preventDefault(); save(); }}>
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
      {problem !== null && <Note status>{problem}</Note>}
      {saver.sent.kind === 'refused' && <Note status>{refusal(saver.sent.code, w)}</Note>}
      {saver.sent.kind === 'done' && !dirty && <Note status>{w.saved}</Note>}
      {saver.sent.kind !== 'done' && !dirty && <Note>{w.nothingChanged}</Note>}
      <div><Button variant="filled" submit disabled={!dirty || saver.sent.kind === 'sending'}>{saver.sent.kind === 'sending' ? w.saving : w.save}</Button></div>
    </form>
  );
}
