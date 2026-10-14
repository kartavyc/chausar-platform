/**
 * TR-05 Do, drawn over the jobs-ext autonomy methods through adapters/jobs.ts: three presets
 * that only set the switches; each kind of action with its switch, its daily count, what it
 * used today and how often you agreed; the always-waits list (and every kind on it) with no
 * switches; the Limits group, with the monthly AI cap read from Trust · Models. Books adds
 * each kind's id and impact and the two further limits; Simple leaves out the per-kind forms.
 */
import { useState, type FormEvent } from 'react';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice, YesNo } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { State } from '../../patterns/States';
import { rupees } from './kit/figure.ts';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, screenState } from './kit/Screen';
import { CAP_RANGE, DAILY_COUNT, JOBS, PRESET_CHOICES, autonomy, caps as validateCaps, kindChanged, presetChanged, typedCount,
  type Autonomy, type CapKey, type Caps, type DoKind } from './adapters/jobs.ts';
import { Frame, Outcome, countText, powers, type P } from './common';
import { validateModels } from './validate.ts';
import { COMMON, DO, fill } from './words.ts';
import s from './Trust.module.css';

type DoWords = ReturnType<typeof words<keyof typeof DO.en>>;

/** The always-waits items jobs-ext writes, in this screen's own words; anything else is shown as written. */
const WAIT_KEYS: Readonly<Record<string, keyof typeof DO.en>> = {
  'money': 'wait.money', 'messages to outsiders': 'wait.messages', 'deleting': 'wait.deleting', 'prices': 'wait.prices', 'stock': 'wait.stock',
  'listings': 'wait.listings', 'sharing': 'wait.sharing', 'invites to outsiders': 'wait.invites', 'webhooks': 'wait.webhooks', 'tax filings (prepare only)': 'wait.tax',
};

export function DoView({ p, mode, onChanged }: { p: P; mode: 'page' | 'sheet'; onChanged?: () => void }) {
  const c = words(COMMON, p.language);
  const { state, reload } = useEngine(p.rpc, JOBS.autonomy, {}, autonomy);
  return (
    <Frame p={p} mode={mode} where={c.whereRules} title={c.do} loaded={state}>
      {(a) => <DoBody p={p} a={a} reload={() => { reload(); onChanged?.(); }} />}
    </Frame>
  );
}

function DoBody({ p, a, reload }: { p: P; a: Autonomy; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(DO, p.language);
  const { admin } = powers(p);
  const books = p.view === 'books', simple = p.view === 'simple';
  const presets = useSend(p.rpc, presetChanged);
  const kinds = useSend(p.rpc, kindChanged);
  const after = (done: unknown) => { if (done !== null && p.live(p.address)) reload(); };
  const setKind = async (k: DoKind, on: boolean, dailyCount: number) => after(await kinds.send(JOBS.setAutonomy, { kind: k.kind, on, dailyCount }));
  const busy = presets.sent.kind === 'sending' || kinds.sent.kind === 'sending';
  const switchable = a.kinds.filter((k) => k.switchable), waiting = a.kinds.filter((k) => !k.switchable);
  return (
    <>
      <Note>{a.master ? w.masterOn : w.masterOff}</Note>
      <Group title={w.presetsTitle} note={w.presetNote}>
        {admin
          ? <Choice label={w.presetLabel} labelHidden options={PRESET_CHOICES.map((value) => ({ value, label: w[`preset.${value}`] }))}
              value={a.preset === 'custom' ? null : a.preset} disabled={busy}
              onChange={async (preset) => after(await presets.send(JOBS.preset, { preset }))} />
          : a.preset !== 'custom' && <p className={s.text}>{w[`preset.${a.preset}`]}</p>}
        {a.preset === 'custom' && <p className={s.quiet}>{w.custom}</p>}
        {!admin && <Note>{c.adminOnly}</Note>}
        <Outcome sent={presets.sent} language={p.language} />
      </Group>
      <Group title={w.kindsTitle} note={simple ? undefined : w.amountNotBuilt}>
        {switchable.length === 0 ? <p className={s.quiet}>{w.kindsNone}</p> : (
          <ul className={s.list}>
            {switchable.map((k) => (
              <li key={k.kind} className={s.item} data-kind={k.kind}>
                <span className={s.itemHead}>
                  <span className={s.name}>{k.title}</span>
                  {admin
                    ? <YesNo label={fill(w.runsAlone, { kind: k.title })} value={k.on} onChange={(on) => void setKind(k, on, k.dailyCount)} disabled={busy} />
                    : <span>{k.on ? c.on : c.off}</span>}
                </span>
                {books && <span className={s.mono}>{fill(w.kindId, { kind: k.kind, impact: w[`impact.${k.impact}`] })}</span>}
                <span className={s.quiet}>{fill(w.limitCount, { count: countText(k.dailyCount), used: countText(k.usedToday) })}</span>
                {!simple && <span className={s.quiet}>{k.agreement.approved === 0 && k.agreement.declined === 0 ? w.noHistory
                  : fill(w.agreed, { approved: countText(k.agreement.approved), declined: countText(k.agreement.declined) })}</span>}
                {admin && !simple && <KindLimit p={p} w={w} k={k} disabled={busy} onSave={(n) => setKind(k, k.on, n)} />}
              </li>
            ))}
          </ul>
        )}
        <Outcome sent={kinds.sent} language={p.language} />
      </Group>
      <Group title={w.waitsTitle}>
        <p className={s.text}>{w.waitsLead}</p>
        <ul className={s.ordered} data-always-waits="">
          {a.alwaysWaits.items.map((item, i) => {
            const key = WAIT_KEYS[item];
            return <li key={`${i}-${item}`}>{key === undefined ? item : w[key]}</li>;
          })}
        </ul>
        {waiting.length > 0 && !simple && (
          <>
            <p className={s.quiet}>{w.waitingKinds}</p>
            <ul className={s.list} data-waiting-kinds="">
              {waiting.map((k) => <li key={k.kind} className={s.item}>{k.title}{books && <span className={s.mono}> {fill(w.kindId, { kind: k.kind, impact: w[`impact.${k.impact}`] })}</span>}</li>)}
            </ul>
          </>
        )}
      </Group>
      <Group title={w.limitsTitle}>
        {admin ? <CapsForm p={p} w={w} caps={a.caps} books={books} onSaved={reload} /> : <CapsList w={w} caps={a.caps} books={books} />}
        <AiCap p={p} w={w} />
      </Group>
    </>
  );
}

function KindLimit({ p, w, k, disabled, onSave }: { p: P; w: DoWords; k: DoKind; disabled: boolean; onSave: (dailyCount: number) => Promise<void> }) {
  const c = words(COMMON, p.language);
  const [typed, setTyped] = useState(String(k.dailyCount));
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = typedCount(typed, [DAILY_COUNT.min, DAILY_COUNT.max]);
    setProblem(n === null ? fill(w.badCount, { low: countText(DAILY_COUNT.min), high: countText(DAILY_COUNT.max) }) : undefined);
    if (n !== null) void onSave(n);
  };
  return (
    <form className={s.form} onSubmit={submit}>
      <Field label={fill(w.maxCount, { kind: k.title })} value={typed} onChange={(e) => setTyped(e.currentTarget.value)} inputMode="numeric" problem={problem} />
      <Button submit disabled={disabled}>{c.save}</Button>
    </form>
  );
}

const MAIN_CAPS: readonly CapKey[] = ['reminderPerCustomerPerDay', 'reminderPerDay', 'activeJobCap'];
const MORE_CAPS: readonly CapKey[] = ['failureLimit', 'groupMax'];
function shownCaps(caps: Caps, books: boolean): CapKey[] {
  return [...MAIN_CAPS, ...(books ? MORE_CAPS.filter((k) => caps[k] !== null) : [])];
}

function CapsList({ w, caps, books }: { w: DoWords; caps: Caps; books: boolean }) {
  return (
    <ul className={s.list}>
      {shownCaps(caps, books).map((k) => <li key={k} className={s.item}>{w[`cap.${k}`]}: {countText(caps[k] ?? 0)}</li>)}
    </ul>
  );
}

function CapsForm({ p, w, caps, books, onSaved }: { p: P; w: DoWords; caps: Caps; books: boolean; onSaved: () => void }) {
  const c = words(COMMON, p.language);
  const keys = shownCaps(caps, books);
  const [typed, setTyped] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, String(caps[k] ?? '')])));
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validateCaps);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const changed: Record<string, number> = {};
    for (const k of keys) {
      const n = typedCount(typed[k] ?? '', CAP_RANGE[k]);
      if (n === null) { setProblem(fill(w.badCap, { name: w[`cap.${k}`], low: countText(CAP_RANGE[k][0]), high: countText(CAP_RANGE[k][1]) })); return; }
      if (n !== caps[k]) changed[k] = n;
    }
    setProblem(undefined);
    if (Object.keys(changed).length === 0) return;
    if (await send(JOBS.setCaps, changed) !== null && p.live(p.address)) onSaved();
  };
  return (
    <form className={s.stack} onSubmit={(e) => void submit(e)}>
      <div className={s.split}>
        {keys.map((k) => <Field key={k} label={w[`cap.${k}`]} value={typed[k] ?? ''} inputMode="numeric"
          onChange={(e) => { const value = e.currentTarget.value; setTyped((t) => ({ ...t, [k]: value })); }} />)}
      </div>
      {problem !== undefined && <p className={s.problem}>{problem}</p>}
      <span><Button submit disabled={sent.kind === 'sending'}>{c.save}</Button></span>
      <Outcome sent={sent} language={p.language} />
    </form>
  );
}

/** The monthly AI cap lives with the model routes (`trustx.models`); it is changed on Trust · Models. */
function AiCap({ p, w }: { p: P; w: DoWords }) {
  const { state } = useEngine(p.rpc, 'trustx.models', {}, validateModels);
  if (state.kind !== 'ready') return <State state={screenState(state)} />;
  const cap = state.value.monthlyCapMinor;
  return (
    <p className={s.text}>
      {cap === null ? w.aiCapNone : fill(w.aiCap, { cap: rupees(cap) })}{' '}
      <Button variant="link" onClick={() => p.navigate({ place: 'trust', sub: 'models' })}>{w.aiCapWhere}</Button>
    </p>
  );
}
