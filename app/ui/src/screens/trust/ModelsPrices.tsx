/**
 * TR-08 Models · prices and the exchange rate (models-ext `modelsx.pricing`, `setFx`, `setPrice`,
 * `applyPricing`, `cost`, `catalogue`). The engine keeps a dated price table in micro-dollars per
 * million tokens and converts it to paise with the rate an owner sets; this screen only shows and
 * sends exact strings. A rupee rate the engine cannot work out (no exchange rate) is said in words.
 * These are owner and cofounder changes the engine applies directly; none needs a second approval.
 */
import { useState, type FormEvent } from 'react';
import { money } from '../../format/index.ts';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { KeyValue } from '../../parts/KeyValue';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, Screen } from './kit/Screen';
import { Loads, Tag, dayText, powers, type P } from './common';
import { ModelsOutcome, dollarsText, dollarsToMicro, modelWords } from './models-kit';
import { validateApplied, validateCatalogue, validateCost, validateFx, validatePrice, validatePricing, type CatalogueRoute, type PriceRow, type Pricing } from './models-replies.ts';
import { rupeesToPaise, wholeNumber } from './paise.ts';
import { COMMON } from './words.ts';
import s from './Trust.module.css';

export function ModelsPricesScreen(p: P) {
  const m = modelWords(p.language);
  const { state, reload } = useEngine(p.rpc, 'modelsx.pricing', {}, validatePricing);
  return <Screen where={m('prices.where')} title={m('prices.title')} loaded={state}>{(v) => <PricesBody p={p} v={v} reload={reload} />}</Screen>;
}

function PricesBody({ p, v, reload }: { p: P; v: Pricing; reload: () => void }) {
  const m = modelWords(p.language), c = words(COMMON, p.language);
  const { admin } = powers(p);
  const catalogue = useEngine(p.rpc, 'modelsx.catalogue', {}, validateCatalogue);
  return (
    <>
      <Group title={m('prices.fxTitle')}>
        <KeyValue onReceipt={p.openReceipt} pairs={v.fx === null
          ? [{ name: m('prices.fx'), value: m('prices.fxNone') }]
          : [{ name: m('prices.fx'), value: m('prices.fxValue', { rate: money(v.fx.paisePerUsd) }), mono: true }, { name: m('prices.fxOn'), value: dayText(v.fx.asOf, p.language) }]} />
        {admin ? <FxForm p={p} reload={reload} /> : <Note>{c.adminOnly}</Note>}
      </Group>
      <Group title={m('prices.tableTitle')} note={m('prices.tableNote')}>
        {v.entries.length === 0 ? <p className={s.quiet}>{m('prices.tableNone')}</p> : (
          <table className={s.table}>
            <thead>
              <tr>{(['kind', 'model', 'input', 'output', 'inputInr', 'outputInr', 'readOn', 'source'] as const).map((k) => <th key={k} scope="col">{m(`prices.col.${k}`)}</th>)}</tr>
            </thead>
            <tbody>{v.entries.map((e) => <PriceLine key={`${e.kind} ${e.model}`} p={p} e={e} />)}</tbody>
          </table>
        )}
        {admin && <PriceForm p={p} kinds={catalogue.state.kind === 'ready' ? catalogue.state.value.map((r) => r.kind) : []} reload={reload} />}
      </Group>
      <Loads title={m('prices.routesTitle')} loaded={catalogue.state}>
        {(routes) => <RoutesPriced p={p} routes={routes} admin={admin} />}
      </Loads>
    </>
  );
}

function PriceLine({ p, e }: { p: P; e: PriceRow }) {
  const m = modelWords(p.language);
  const inr = (paise: string | null) => (paise === null ? m('notCounted') : <><span className={s.mono}>{money(paise)}</span> <Tag>{m('costTag')}</Tag></>);
  return (
    <tr data-price={`${e.kind} ${e.model}`}>
      <td>{e.kind}</td>
      <td className={s.mono}>{e.model}</td>
      <td className={s.mono}>{dollarsText(e.inputUsdMicroPerMillion)}</td>
      <td className={s.mono}>{dollarsText(e.outputUsdMicroPerMillion)}</td>
      <td>{inr(e.inputPerMillionMinor)}</td>
      <td>{inr(e.outputPerMillionMinor)}</td>
      <td>{dayText(e.asOf, p.language)}</td>
      {/* The source is outside text: shown as text, never followed. */}
      <td>{e.source} <Tag>{m(e.verified ? 'prices.checked' : 'prices.notChecked')}</Tag></td>
    </tr>
  );
}

function FxForm({ p, reload }: { p: P; reload: () => void }) {
  const m = modelWords(p.language);
  const [rate, setRate] = useState('');
  const [asOf, setAsOf] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validateFx);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const paise = rupeesToPaise(rate);
    if (paise === null || paise === '0') { setProblem(m('prices.badRate')); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) { setProblem(m('prices.badDate')); return; }
    setProblem(undefined);
    if (await send('modelsx.setFx', { paisePerUsd: paise, asOf }) !== null && p.live(p.address)) reload();
  };
  return (
    <form className={s.form} onSubmit={(e) => void submit(e)}>
      <Field label={m('prices.rateField')} prefix="₹" value={rate} onChange={(e) => setRate(e.currentTarget.value)} inputMode="decimal" problem={problem} placeholder={m('prices.rateHint')} />
      <Field label={m('prices.dateField')} type="date" value={asOf} onChange={(e) => setAsOf(e.currentTarget.value)} />
      <Button submit disabled={sent.kind === 'sending'}>{m('prices.setFx')}</Button>
      <ModelsOutcome sent={sent} language={p.language} done={() => m('prices.fxSaved')} />
    </form>
  );
}

function PriceForm({ p, kinds, reload }: { p: P; kinds: readonly string[]; reload: () => void }) {
  const m = modelWords(p.language);
  const [kind, setKind] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [asOf, setAsOf] = useState('');
  const [source, setSource] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validatePrice);
  if (kinds.length === 0) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const inputMicro = dollarsToMicro(input), outputMicro = dollarsToMicro(output);
    if (kind === null || model.trim() === '') { setProblem(m('prices.badModel')); return; }
    if (inputMicro === null || outputMicro === null) { setProblem(m('prices.badDollars')); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || source.trim() === '') { setProblem(m('prices.badDated')); return; }
    setProblem(undefined);
    const done = await send('modelsx.setPrice', { kind, model: model.trim(), price: { inputUsdMicroPerMillion: inputMicro, outputUsdMicroPerMillion: outputMicro, asOf, source: source.trim() } });
    if (done !== null && p.live(p.address)) reload();
  };
  return (
    <form className={s.form} onSubmit={(e) => void submit(e)} data-price-form="">
      <p className={s.label}>{m('prices.enterTitle')}</p>
      <Choice label={m('prices.kindField')} options={kinds.map((value) => ({ value, label: value }))} value={kind} onChange={setKind} />
      <Field label={m('prices.modelField')} value={model} onChange={(e) => setModel(e.currentTarget.value)} />
      <Field label={m('prices.inputField')} prefix="$" value={input} onChange={(e) => setInput(e.currentTarget.value)} inputMode="decimal" />
      <Field label={m('prices.outputField')} prefix="$" value={output} onChange={(e) => setOutput(e.currentTarget.value)} inputMode="decimal" />
      <Field label={m('prices.dateField')} type="date" value={asOf} onChange={(e) => setAsOf(e.currentTarget.value)} />
      <Field label={m('prices.sourceField')} value={source} onChange={(e) => setSource(e.currentTarget.value)} problem={problem} />
      <Button submit disabled={sent.kind === 'sending'}>{m('prices.setPrice')}</Button>
      <ModelsOutcome sent={sent} language={p.language} done={() => m('prices.priceSaved')} />
    </form>
  );
}

function RoutesPriced({ p, routes, admin }: { p: P; routes: CatalogueRoute[]; admin: boolean }) {
  const m = modelWords(p.language);
  const configured = routes.flatMap((r) => r.configured.map((x) => ({ ...x, kind: r.kind, label: r.label, costModel: r.costModel })));
  const apply = useSend(p.rpc, validateApplied);
  const [applying, setApplying] = useState<string | null>(null);
  if (configured.length === 0) return <p className={s.quiet}>{m('prices.noRoutes')}</p>;
  return (
    <>
      <ul className={s.list}>
        {configured.map((x) => (
          <li key={x.id} className={s.item} data-priced-route={x.id}>
            <span className={s.itemHead}><span className={s.name}>{x.label}</span><span className={s.mono}>{x.model}</span></span>
            <span className={s.quiet}>{x.costModel}</span>
            {admin && (
              <span className={s.line}>
                <Button variant="quiet" disabled={apply.sent.kind === 'sending'} onClick={() => { setApplying(x.id); void apply.send('modelsx.applyPricing', { routeId: x.id }); }}>
                  {m('prices.apply')}
                </Button>
              </span>
            )}
            {applying === x.id && <ModelsOutcome sent={apply.sent} language={p.language} done={() => m('prices.applied')} />}
          </li>
        ))}
      </ul>
      <CostCheck p={p} routes={configured} />
    </>
  );
}

function CostCheck({ p, routes }: { p: P; routes: readonly { id: string; label: string; model: string }[] }) {
  const m = modelWords(p.language);
  const [routeId, setRouteId] = useState<string | null>(routes[0]?.id ?? null);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validateCost);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const inputTokens = wholeNumber(input, 10_000_000), outputTokens = wholeNumber(output, 10_000_000);
    if (routeId === null || inputTokens === null || outputTokens === null) { setProblem(m('prices.badTokens')); return; }
    setProblem(undefined);
    await send('modelsx.cost', { routeId, inputTokens, outputTokens });
  };
  return (
    <form className={s.form} onSubmit={(e) => void submit(e)} data-cost-check="">
      <p className={s.label}>{m('prices.costTitle')}</p>
      <Choice label={m('prices.routeField')} options={routes.map((r) => ({ value: r.id, label: `${r.label} · ${r.model}` }))} value={routeId} onChange={setRouteId} />
      <Field label={m('prices.inputTokens')} value={input} onChange={(e) => setInput(e.currentTarget.value)} inputMode="numeric" />
      <Field label={m('prices.outputTokens')} value={output} onChange={(e) => setOutput(e.currentTarget.value)} inputMode="numeric" problem={problem} />
      <Button submit disabled={sent.kind === 'sending'}>{m('prices.costCheck')}</Button>
      <ModelsOutcome sent={sent} language={p.language} done={(v) => {
        const basis = v.basis === 'configured-route-rates' ? m('prices.basisRoute') : v.basis === 'dated-price-table' ? m('prices.basisTable') : v.basis;
        return v.costMinor === null ? m('prices.costNotCounted', { basis }) : m('prices.costIs', { cost: money(v.costMinor), basis });
      }} />
    </form>
  );
}
