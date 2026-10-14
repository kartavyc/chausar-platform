/**
 * TR-08 Models: one row per route with its health and its provider's terms, the order the
 * routes are tried in, the costs (no receipt: they are costs, labelled "cost"), the monthly
 * limit (typed in rupees, sent as whole paise by string handling), and the voice row.
 * This module takes over `trust/models`; the order the host's route picker showed stays
 * visible here as an ordered list.
 */
import { OutsideLink } from './kit/OutsideLink';
import { useState, type FormEvent } from 'react';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { KeyValue, type Pair } from '../../parts/KeyValue';
import { rupees } from './kit/figure.ts';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, Screen } from './kit/Screen';
import { Outcome, Tag, countText, dayText, powers, type P } from './common';
import { paiseToTyped, rupeesToPaise } from './paise.ts';
import { validateModels, type Models, type Route } from './validate.ts';
import { COMMON, MODELS, fill } from './words.ts';
import s from './Trust.module.css';

const HEALTH = ['ready', 'signed-out', 'not-installed', 'version-not-tested', 'timed-out', 'error'] as const;

export function ModelsScreen(p: P) {
  const c = words(COMMON, p.language);
  const { state, reload } = useEngine(p.rpc, 'trustx.models', {}, validateModels);
  return <Screen where={c.whereModels} title={c.models} loaded={state}>{(m) => <ModelsBody p={p} m={m} reload={reload} />}</Screen>;
}

function ModelsBody({ p, m, reload }: { p: P; m: Models; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(MODELS, p.language);
  const { admin } = powers(p);
  const cost = <> <Tag>{c.cost}</Tag></>;
  return (
    <>
      <Group title={w.orderTitle}>
        {m.routes.length === 0 ? <p className={s.quiet}>{w.routesNone}</p> : (
          <ol className={s.ordered} data-route-order="">{m.routes.map((r) => <li key={r.id}>{r.label}</li>)}</ol>
        )}
      </Group>
      {m.routes.length > 0 && (
        <Group title={w.routesTitle}>
          <ul className={s.list}>{m.routes.map((r) => <RouteRow key={r.id} p={p} r={r} />)}</ul>
        </Group>
      )}
      <Group title={w.costTitle}>
        <KeyValue onReceipt={p.openReceipt} pairs={[
          { name: w.spend, value: m.spendThisMonthMinor === null ? w.notShown : rupees(m.spendThisMonthMinor), mono: m.spendThisMonthMinor !== null, after: m.spendThisMonthMinor === null ? undefined : cost },
          { name: w.cap, value: m.monthlyCapMinor === null ? w.noCap : rupees(m.monthlyCapMinor), mono: m.monthlyCapMinor !== null, after: m.monthlyCapMinor === null ? undefined : cost },
        ]} />
        <Note>{w.capNote}</Note>
        {admin ? <CapForm p={p} cap={m.monthlyCapMinor} reload={reload} /> : <Note>{c.adminOnly}</Note>}
      </Group>
      <Group title={w.voiceTitle}>
        <KeyValue onReceipt={p.openReceipt} pairs={[
          { name: w.voiceProvider, value: m.voice.provider ?? w.voiceNone },
          { name: w.minutes, value: m.voice.minutesThisMonth === null ? w.notCounted : countText(m.voice.minutesThisMonth), mono: m.voice.minutesThisMonth !== null },
        ]} />
      </Group>
    </>
  );
}

function RouteRow({ p, r }: { p: P; r: Route }) {
  const c = words(COMMON, p.language), w = words(MODELS, p.language);
  const health = (HEALTH as readonly string[]).includes(r.health) ? w[`health.${r.health as (typeof HEALTH)[number]}`] : r.health;
  const pairs: Pair[] = [];
  if (r.terms === null) pairs.push({ name: w.terms, value: w.noTerms });
  else {
    pairs.push({ name: w.keeps, value: r.terms.keeps }, { name: w.keepsFor, value: r.terms.keepsFor }, { name: w.trains, value: r.terms.trains ? w.yes : w.no },
      { name: w.country, value: r.terms.country },
      { name: w.terms, value: fill(w.readOn, { date: dayText(r.terms.readOn, p.language) }),
        after: <> <OutsideLink url={r.terms.termsUrl} label={w.termsLink} openLink={p.openLink} /></> });
  }
  pairs.push({ name: w.lastCost, value: r.lastAnswerCostMinor === null ? w.noLastCost : rupees(r.lastAnswerCostMinor), mono: r.lastAnswerCostMinor !== null,
    after: r.lastAnswerCostMinor === null ? undefined : <> <Tag>{c.cost}</Tag></> });
  return (
    <li className={s.item} data-route={r.id}>
      <span className={s.itemHead}>
        <span className={s.name}>{r.label}</span>
        <Tag>{health}</Tag>
        {p.view === 'books' && <span className={s.mono}>{r.id} · {r.kind}</span>}
      </span>
      {p.view === 'simple' && r.terms !== null
        ? <p className={s.quiet}>{fill(w.readOn, { date: dayText(r.terms.readOn, p.language) })}</p>
        : <KeyValue onReceipt={p.openReceipt} pairs={pairs} />}
    </li>
  );
}

function CapForm({ p, cap, reload }: { p: P; cap: string | null; reload: () => void }) {
  const w = words(MODELS, p.language);
  const [typed, setTyped] = useState(cap === null ? '' : paiseToTyped(cap));
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validateModels);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const paise = typed.trim() === '' ? null : rupeesToPaise(typed);
    if (paise === null && typed.trim() !== '') { setProblem(w.badCap); return; }
    setProblem(undefined);
    if (await send('trustx.setModelCap', { monthlyCapMinor: paise }) !== null && p.live(p.address)) reload();
  };
  return (
    <form className={s.form} onSubmit={(e) => void submit(e)}>
      <Field label={w.capField} prefix="₹" value={typed} onChange={(e) => setTyped(e.currentTarget.value)} inputMode="decimal" problem={problem} placeholder={w.capHint} />
      <Button submit disabled={sent.kind === 'sending'}>{w.setCap}</Button>
      <Outcome sent={sent} language={p.language} />
    </form>
  );
}
