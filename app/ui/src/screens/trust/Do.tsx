/**
 * TR-05 Do: three presets that only set the switches; each kind of action with its switch,
 * its daily limits on count and amount, and how often the rule would have agreed; the
 * always-waits list with no switches; the Limits group. Amounts are typed in rupees and
 * sent as whole paise made by string handling (paise.ts).
 */
import { useState, type FormEvent } from 'react';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice, YesNo } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { rupees } from './kit/figure.ts';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note } from './kit/Screen';
import { Frame, Outcome, countText, powers, type P } from './common';
import { paiseToTyped, rupeesToPaise, wholeNumber } from './paise.ts';
import { validateAutonomy, type Autonomy, type Caps, type KindRule } from './validate.ts';
import { COMMON, DO, fill } from './words.ts';
import s from './Trust.module.css';

const PRESET_CHOICES = ['ask-everything', 'routine', 'all-but-waits'] as const;

export function DoView({ p, mode, onChanged }: { p: P; mode: 'page' | 'sheet'; onChanged?: () => void }) {
  const c = words(COMMON, p.language);
  const { state, reload } = useEngine(p.rpc, 'trustx.autonomy', {}, validateAutonomy);
  return (
    <Frame p={p} mode={mode} where={c.whereRules} title={c.do} loaded={state}>
      {(a) => <DoBody p={p} a={a} reload={() => { reload(); onChanged?.(); }} />}
    </Frame>
  );
}

function DoBody({ p, a, reload }: { p: P; a: Autonomy; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(DO, p.language);
  const { admin } = powers(p);
  const { sent, send } = useSend(p.rpc, validateAutonomy);
  const change = async (payload: Record<string, unknown>) => {
    if (await send('trustx.setAutonomy', payload) !== null && p.live(p.address)) reload();
  };
  const busy = sent.kind === 'sending';
  return (
    <>
      <Group title={w.presetsTitle} note={w.presetNote}>
        {admin
          ? <Choice label={w.presetLabel} labelHidden options={PRESET_CHOICES.map((value) => ({ value, label: w[`preset.${value}`] }))}
              value={a.preset === 'custom' ? null : a.preset} onChange={(preset) => void change({ preset })} disabled={busy} />
          : a.preset !== 'custom' && <p className={s.text}>{w[`preset.${a.preset}`]}</p>}
        {a.preset === 'custom' && <p className={s.quiet}>{w.custom}</p>}
        {!admin && <Note>{c.adminOnly}</Note>}
        <Outcome sent={sent} language={p.language} />
      </Group>
      <Group title={w.kindsTitle}>
        {a.kinds.length === 0 ? <p className={s.quiet}>{w.kindsNone}</p> : (
          <ul className={s.list}>
            {a.kinds.map((k) => (
              <li key={k.kind} className={s.item} data-kind={k.kind}>
                <span className={s.itemHead}>
                  <span className={s.name}>{k.kind}</span>
                  {admin
                    ? <YesNo label={fill(w.runsAlone, { kind: k.kind })} value={k.on} onChange={(on) => void change({ kind: rule(k, { on }) })} disabled={busy} />
                    : <span>{k.on ? c.on : c.off}</span>}
                  <span className={s.quiet}>{k.agreement === null ? w.noHistory : fill(w.agreed, { agreed: countText(k.agreement.agreed), total: countText(k.agreement.total) })}</span>
                </span>
                <span className={s.quiet}>
                  {k.maxAmountMinorPerDay === null ? fill(w.limitCount, { count: countText(k.maxPerDay) }) : fill(w.limitBoth, { count: countText(k.maxPerDay), amount: rupees(k.maxAmountMinorPerDay) })}
                </span>
                {admin && <KindLimits p={p} k={k} onSave={(next) => change({ kind: next })} />}
              </li>
            ))}
          </ul>
        )}
      </Group>
      <Group title={w.waitsTitle}>
        <p className={s.text}>{w.waitsLead}</p>
        <ul className={s.ordered} data-always-waits="">
          {a.alwaysWaits.map((x) => <li key={x.id}>{x.words}</li>)}
        </ul>
      </Group>
      <Group title={w.limitsTitle}>
        {admin ? <CapsForm p={p} caps={a.caps} onSave={(caps) => change({ caps })} /> : (
          <ul className={s.list}>
            <li className={s.item}>{w.perCustomer}: {countText(a.caps.remindersPerCustomerPerDay)}</li>
            <li className={s.item}>{w.perDay}: {countText(a.caps.remindersPerDay)}</li>
            <li className={s.item}>{w.activeJobs}: {countText(a.caps.activeJobs)}</li>
            <li className={s.item}>{a.caps.monthlyAiCapMinor === null ? w.aiCapNone : `${w.aiCap}: ${rupees(a.caps.monthlyAiCapMinor)}`}</li>
          </ul>
        )}
      </Group>
    </>
  );
}

function rule(k: KindRule, patch: Partial<KindRule>): KindRule {
  return { kind: k.kind, on: k.on, maxPerDay: k.maxPerDay, maxAmountMinorPerDay: k.maxAmountMinorPerDay, ...patch };
}

function KindLimits({ p, k, onSave }: { p: P; k: KindRule; onSave: (next: KindRule) => Promise<void> }) {
  const c = words(COMMON, p.language), w = words(DO, p.language);
  const [countTyped, setCount] = useState(String(k.maxPerDay));
  const [amountTyped, setAmount] = useState(k.maxAmountMinorPerDay === null ? '' : paiseToTyped(k.maxAmountMinorPerDay));
  const [problems, setProblems] = useState<{ count?: string; amount?: string }>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const maxPerDay = wholeNumber(countTyped, 100000);
    const amount = amountTyped.trim() === '' ? null : rupeesToPaise(amountTyped);
    const next: { count?: string; amount?: string } = {};
    if (maxPerDay === null) next.count = w.badCount;
    if (amount === null && amountTyped.trim() !== '') next.amount = w.badAmount;
    setProblems(next);
    if (maxPerDay === null || next.amount !== undefined) return;
    void onSave(rule(k, { maxPerDay, maxAmountMinorPerDay: amount }));
  };
  return (
    <form className={s.form} onSubmit={submit}>
      <Field label={w.maxCount} value={countTyped} onChange={(e) => setCount(e.currentTarget.value)} inputMode="numeric" problem={problems.count} />
      <Field label={w.maxAmount} prefix="₹" value={amountTyped} onChange={(e) => setAmount(e.currentTarget.value)} inputMode="decimal" problem={problems.amount} />
      <Button submit>{c.save}</Button>
    </form>
  );
}

function CapsForm({ p, caps, onSave }: { p: P; caps: Caps; onSave: (caps: Caps) => Promise<void> }) {
  const c = words(COMMON, p.language), w = words(DO, p.language);
  const [typed, setTyped] = useState({
    perCustomer: String(caps.remindersPerCustomerPerDay), perDay: String(caps.remindersPerDay), jobs: String(caps.activeJobs),
    ai: caps.monthlyAiCapMinor === null ? '' : paiseToTyped(caps.monthlyAiCapMinor),
  });
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const set = (key: keyof typeof typed) => (e: { currentTarget: HTMLInputElement }) => {
    const value = e.currentTarget.value;
    setTyped((t) => ({ ...t, [key]: value }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const perCustomer = wholeNumber(typed.perCustomer), perDay = wholeNumber(typed.perDay), jobs = wholeNumber(typed.jobs);
    const ai = typed.ai.trim() === '' ? null : rupeesToPaise(typed.ai);
    if (perCustomer === null || perDay === null || jobs === null) { setProblem(w.badCount); return; }
    if (ai === null && typed.ai.trim() !== '') { setProblem(w.badAmount); return; }
    setProblem(undefined);
    void onSave({ remindersPerCustomerPerDay: perCustomer, remindersPerDay: perDay, activeJobs: jobs, monthlyAiCapMinor: ai });
  };
  return (
    <form className={s.stack} onSubmit={submit}>
      <div className={s.split}>
        <Field label={w.perCustomer} value={typed.perCustomer} onChange={set('perCustomer')} inputMode="numeric" />
        <Field label={w.perDay} value={typed.perDay} onChange={set('perDay')} inputMode="numeric" />
        <Field label={w.activeJobs} value={typed.jobs} onChange={set('jobs')} inputMode="numeric" />
        <Field label={w.aiCap} prefix="₹" value={typed.ai} onChange={set('ai')} inputMode="decimal" placeholder={w.aiCapHint} />
      </div>
      {problem !== undefined && <p className={s.problem}>{problem}</p>}
      <span><Button submit>{c.save}</Button></span>
    </form>
  );
}
