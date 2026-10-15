/**
 * TR-08 Models · the Chausar allowance as a route (hosted-link `hosted.allowance.status`,
 * models-ext `modelsx.connectAllowance { model?, budgetMinor?, maxCostMinor? }`, hosted-link
 * `hosted.allowanceRevoke {}`). The month's grant, spend, reservations and balance are the hosted
 * service's own paise strings, shown as they come; a grant that is not set is said in words.
 * Hosted not set up, not paired, and demo mode are plain states, not errors.
 */
import { useState, type FormEvent } from 'react';
import { count, money } from '../../format/index.ts';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { KeyValue, type Pair } from '../../parts/KeyValue';
import { useEngine, useSend, type Loaded } from './kit/engine.ts';
import { Group, Note, Screen } from './kit/Screen';
import { AskTwice, Tag, dayText, powers, type P } from './common';
import { ModelsOutcome, modelWords, type MK } from './models-kit';
import { validateAllowance, validateAllowanceRevoked, validateAllowanceRoute, type Allowance } from './models-replies.ts';
import { rupeesToPaise } from './paise.ts';
import { COMMON } from './words.ts';
import s from './Trust.module.css';

/** Refusals of the status read that are states of this computer, each with its sentence. */
const STATES: Readonly<Record<string, MK>> = {
  HOSTED_NOT_CONFIGURED: 'allowance.notSetUp', HOSTED_NOT_PAIRED: 'allowance.notPaired', DEMO_EXTERNAL_DISABLED: 'allowance.demo', OPEN_DESKTOP: 'allowance.desktop',
};

export function ModelsAllowanceScreen(p: P) {
  const m = modelWords(p.language);
  const { state, reload } = useEngine(p.rpc, 'hosted.allowance.status', {}, validateAllowance);
  const said = state.kind === 'failed' ? STATES[state.code] : undefined;
  // A known state of this computer is drawn as the page's own words instead of the failed state.
  const loaded: Loaded<Allowance | MK> = said !== undefined ? { kind: 'ready', value: said } : state;
  return (
    <Screen where={m('allowance.where')} title={m('allowance.title')} loaded={loaded}>
      {(v) => (typeof v === 'string'
        ? <p className={s.status} role="status" data-allowance-state={v}>{m(v)}</p>
        : <AllowanceBody p={p} v={v} reload={reload} />)}
    </Screen>
  );
}

function AllowanceBody({ p, v, reload }: { p: P; v: Allowance; reload: () => void }) {
  const m = modelWords(p.language), c = words(COMMON, p.language);
  const { admin } = powers(p);
  const costTag = <> <Tag>{m('costTag')}</Tag></>;
  const grant = v.grantState === 'set' && v.grantMinor !== null ? money(v.grantMinor) : m(v.grantState === 'not-included' ? 'allowance.notIncluded' : 'allowance.grantNotSet');
  const pairs: Pair[] = [
    { name: m('allowance.month'), value: v.month, mono: true },
    { name: m('allowance.grant'), value: grant, mono: v.grantState === 'set' },
    { name: m('allowance.spent'), value: money(v.spentMinor), mono: true, after: costTag },
    { name: m('allowance.reserved'), value: money(v.reservedMinor), mono: true, after: costTag },
    { name: m('allowance.balance'), value: v.balanceMinor === null ? m('allowance.noBalance') : money(v.balanceMinor), mono: v.balanceMinor !== null },
  ];
  if (v.pricing !== null) pairs.push({ name: m('allowance.pricing'), value: m('allowance.pricingValue', { date: dayText(v.pricing.checkedOn, p.language), rate: money(v.pricing.fxPaisePerUsd), source: v.pricing.source }) });
  return (
    <>
      <Group title={m('allowance.monthTitle')}>
        <KeyValue onReceipt={p.openReceipt} pairs={pairs} />
        <Note>{m('allowance.note')}</Note>
      </Group>
      <Group title={m('allowance.modelsTitle')}>
        {v.models.length === 0 ? <p className={s.quiet}>{m('allowance.noModels')}</p> : (
          <ul className={s.list}>{v.models.map((x) => <li key={`${x.route} ${x.model}`} className={s.mono}>{x.model}</li>)}</ul>
        )}
      </Group>
      <Group title={m('allowance.connectTitle')}>
        {admin ? <><ConnectForm p={p} v={v} reload={reload} /><RevokeAll p={p} /></> : <Note>{c.adminOnly}</Note>}
      </Group>
    </>
  );
}

function ConnectForm({ p, v, reload }: { p: P; v: Allowance; reload: () => void }) {
  const m = modelWords(p.language);
  const [model, setModel] = useState<string | null>(null);
  const [budget, setBudget] = useState('');
  const [perCall, setPerCall] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validateAllowanceRoute);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    if (model !== null) payload['model'] = model;
    for (const [name, typed] of [['budgetMinor', budget], ['maxCostMinor', perCall]] as const) {
      if (typed.trim() === '') continue;
      const paise = rupeesToPaise(typed);
      if (paise === null) { setProblem(m('allowance.badRupees')); return; }
      payload[name] = paise;
    }
    setProblem(undefined);
    if (await send('modelsx.connectAllowance', payload) !== null && p.live(p.address)) reload();
  };
  return (
    <form className={s.form} onSubmit={(e) => void submit(e)} data-allowance-form="">
      {v.models.length > 0 && <Choice label={m('allowance.modelField')} options={v.models.map((x) => ({ value: x.model, label: x.model }))} value={model} onChange={setModel} />}
      <Field label={m('allowance.budgetField')} prefix="₹" value={budget} onChange={(e) => setBudget(e.currentTarget.value)} inputMode="decimal" placeholder={m('allowance.budgetHint')} />
      <Field label={m('allowance.perCallField')} prefix="₹" value={perCall} onChange={(e) => setPerCall(e.currentTarget.value)} inputMode="decimal" problem={problem} />
      <Button submit disabled={sent.kind === 'sending'}>{m('allowance.connect')}</Button>
      <ModelsOutcome sent={sent} language={p.language} done={(r) => m('allowance.connected', { model: r.model })} />
    </form>
  );
}

function RevokeAll({ p }: { p: P }) {
  const m = modelWords(p.language);
  const { sent, send } = useSend(p.rpc, validateAllowanceRevoked);
  return (
    <div className={s.stack}>
      <AskTwice label={m('allowance.revoke')} ask={m('allowance.revokeAsk')} confirmLabel={m('allowance.revokeYes')} onConfirm={() => void send('hosted.allowanceRevoke', {})}
        language={p.language} disabled={sent.kind === 'sending'} />
      <ModelsOutcome sent={sent} language={p.language} done={(r) => (r.failed.length === 0
        ? m('allowance.revoked', { n: count(String(r.revoked.length)) })
        : m('allowance.revokedSome', { n: count(String(r.revoked.length)), failed: count(String(r.failed.length)) }))} />
    </div>
  );
}
