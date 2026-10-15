/**
 * AS-13 The best plan under limits (experimental). The person states limits on the figure
 * with a price change, or on the difference it makes, and a range of price changes to try.
 * The page shows the limits as rows, the recommended plan and which limit is tight, or,
 * when the limits cannot all be met, which ones clash. Rupees and percents typed here are
 * turned into whole paise and basis points by string arithmetic; the engine does the rest.
 */
import { useState } from 'react';
import type { RowItem } from '../../../app/presentation.ts';
import { Button } from '../../../parts/Button';
import { Choice } from '../../../parts/Choice';
import { Field } from '../../../parts/Field';
import { Figure } from '../../../parts/Figure';
import { Label } from '../../../parts/Label';
import { RowList } from '../../../parts/RowList';
import { bool, fail, id, int, list, minor, obj, oneOf } from './client.ts';
import { AskPage, bpsFigure, countWords, fill, moneyFigure, moneyText, useAsk, useWords, type AskView } from './kit';
import { catalogue, hundredths, Part, PERIOD_IDS, PERIOD_WORDS, Problem, StopButton, useSend, type PeriodId } from './analysis';
import s from './analysis.module.css';

type Fig = 'scenario' | 'change';
type Op = 'atLeast' | 'atMost';
export interface PlanValue {
  readonly feasible: boolean;
  readonly limits: readonly { index: number; figure: Fig; op: Op; minor: string; tight: boolean; alone: boolean }[];
  readonly recommended: { bps: string; scenarioMinor: string; changeMinor: string; receiptId: string } | null;
  readonly clash: readonly number[];
  readonly tried: number;
}
export function planReply(value: unknown): PlanValue {
  const v = obj(value);
  oneOf(v.label, ['experimental'] as const);
  const r = v.recommended === null ? null : obj(v.recommended);
  const plan: PlanValue = {
    feasible: bool(v.feasible),
    limits: list(v.limits, l => { const x = obj(l); return { index: int(x.index), figure: oneOf(x.figure, ['scenario', 'change'] as const), op: oneOf(x.op, ['atLeast', 'atMost'] as const), minor: minor(x.minor), tight: bool(x.tight), alone: bool(x.alone) }; }, 50),
    recommended: r === null ? null : { bps: minor(r.bps), scenarioMinor: minor(r.scenarioMinor), changeMinor: minor(r.changeMinor), receiptId: id(r.receiptId) },
    clash: list(v.clash, int, 50), tried: int(v.tried),
  };
  if (plan.feasible !== (plan.recommended !== null)) fail();
  return plan;
}

const WORDS = catalogue({
  en: {
    title: 'The best plan under limits', limits: 'Limits', figure: 'Which figure', scenario: 'With the change', change: 'The difference',
    op: 'Limit', atLeast: 'At least', atMost: 'At most', amount: 'Amount in rupees', badAmount: 'Write rupees with at most two decimals.',
    remove: 'Remove', addLimit: 'Add a limit', range: 'Price changes to try, in percent', from: 'From', to: 'To', step: 'Step',
    badPercent: 'Write a percent with at most two decimals.', period: 'Period', find: 'Find the best plan', working: 'Trying each price…',
    'scenario-atLeast': 'With the change, at least {amount}', 'scenario-atMost': 'With the change, at most {amount}',
    'change-atLeast': 'The difference, at least {amount}', 'change-atMost': 'The difference, at most {amount}',
    tight: 'tight: this limit decides the plan', alone: 'cannot be met even on its own', clashes: 'clashes with another limit', met: 'met',
    recommended: 'Recommended: change prices by {percent}', withChange: 'With the change', difference: 'The difference',
    none: 'No price in the range meets every limit.', clash: 'These limits clash', tried: '{count} prices tried.', again: 'Change the limits',
    readOnly: 'A plan needs a seat that can work things out.', needLimit: 'Add at least one limit.',
  },
  hi: {
    title: 'सीमाओं के भीतर सबसे अच्छी योजना', limits: 'सीमाएँ', figure: 'कौन सा आँकड़ा', scenario: 'बदलाव के साथ', change: 'अंतर',
    op: 'सीमा', atLeast: 'कम से कम', atMost: 'अधिक से अधिक', amount: 'रुपयों में राशि', badAmount: 'अधिकतम दो दशमलव वाले रुपये लिखें।',
    remove: 'हटाएँ', addLimit: 'सीमा जोड़ें', range: 'आज़माने के लिए कीमतों के बदलाव, प्रतिशत में', from: 'से', to: 'तक', step: 'अंतराल',
    badPercent: 'अधिकतम दो दशमलव वाला प्रतिशत लिखें।', period: 'अवधि', find: 'सबसे अच्छी योजना खोजें', working: 'हर कीमत आज़माई जा रही है…',
    'scenario-atLeast': 'बदलाव के साथ, कम से कम {amount}', 'scenario-atMost': 'बदलाव के साथ, अधिक से अधिक {amount}',
    'change-atLeast': 'अंतर, कम से कम {amount}', 'change-atMost': 'अंतर, अधिक से अधिक {amount}',
    tight: 'कसी हुई: यही सीमा योजना तय करती है', alone: 'अकेले भी पूरी नहीं हो सकती', clashes: 'किसी दूसरी सीमा से टकराती है', met: 'पूरी हुई',
    recommended: 'सुझाव: कीमतें {percent} बदलें', withChange: 'बदलाव के साथ', difference: 'अंतर',
    none: 'दायरे की कोई भी कीमत हर सीमा पूरी नहीं करती।', clash: 'ये सीमाएँ टकराती हैं', tried: '{count} कीमतें आज़माई गईं।', again: 'सीमाएँ बदलें',
    readOnly: 'योजना के लिए ऐसी सीट चाहिए जो गणना चला सके।', needLimit: 'कम से कम एक सीमा जोड़ें।',
  },
});

interface Draft { readonly key: number; readonly figure: Fig; readonly op: Op; readonly rupees: string }

export function PlanScreen(_props: { view: Extract<AskView, { kind: 'plan' }> }) {
  const ask = useAsk(), w = useWords(WORDS), periods = useWords(PERIOD_WORDS);
  const [limits, setLimits] = useState<readonly Draft[]>([{ key: 1, figure: 'change', op: 'atLeast', rupees: '' }]);
  const [range, setRange] = useState({ from: '-5', to: '5', step: '1' });
  const [periodId, setPeriodId] = useState<PeriodId>('last-month');
  const [result, setResult] = useState<PlanValue | null>(null);
  const run = useSend();
  const aside = <Label kind="experimental" />;
  if (result !== null) return <AskPage title={w.title} aside={aside}>{() => <PlanResult plan={result} onAgain={() => setResult(null)} />}</AskPage>;
  const paise = limits.map(l => hundredths(l.rupees, true));
  const bps = { from: hundredths(range.from, true), to: hundredths(range.to, true), step: hundredths(range.step) };
  const ready = limits.length > 0 && paise.every(p => p !== null) && bps.from !== null && bps.to !== null && bps.step !== null && bps.step !== '0';
  const put = (key: number, change: Partial<Draft>) => setLimits(all => all.map(l => (l.key === key ? { ...l, ...change } : l)));
  return (
    <AskPage title={w.title} aside={aside}>
      {() => ask.viewer ? <p className={s.note}>{w.readOnly}</p> : (
        <form className={s.form} onSubmit={e => {
          e.preventDefault();
          if (!ready) return;
          void run.send('askx.plan', {
            periodId, fromBps: bps.from, toBps: bps.to, stepBps: bps.step,
            limits: limits.map((l, i) => ({ figure: l.figure, op: l.op, minor: paise[i] })),
          }, planReply, setResult);
        }}>
          <Part title={w.limits}>
            <ul className={s.list}>
              {limits.map((l, i) => (
                <li key={l.key} className={s.item} data-plan-limit="">
                  <Choice<Fig> label={w.figure} options={[{ value: 'scenario', label: w.scenario }, { value: 'change', label: w.change }]} value={l.figure} onChange={figure => put(l.key, { figure })} />
                  <Choice<Op> label={w.op} options={[{ value: 'atLeast', label: w.atLeast }, { value: 'atMost', label: w.atMost }]} value={l.op} onChange={op => put(l.key, { op })} />
                  <Field label={w.amount} prefix={'₹'} inputMode="decimal" value={l.rupees} onChange={e => put(l.key, { rupees: e.target.value })} problem={l.rupees !== '' && paise[i] === null ? w.badAmount : undefined} />
                  <Button variant="link" onClick={() => setLimits(all => all.filter(x => x.key !== l.key))}>{w.remove}</Button>
                </li>
              ))}
            </ul>
            {limits.length === 0 && <p className={s.note}>{w.needLimit}</p>}
            <Button variant="link" disabled={limits.length >= 20} onClick={() => setLimits(all => [...all, { key: Math.max(0, ...all.map(x => x.key)) + 1, figure: 'scenario', op: 'atLeast', rupees: '' }])}>{w.addLimit}</Button>
          </Part>
          <Part title={w.range}>
            <div className={s.formLine}>
              {(['from', 'to', 'step'] as const).map(k => (
                <Field key={k} label={w[k]} inputMode="decimal" value={range[k]} onChange={e => setRange(r => ({ ...r, [k]: e.target.value }))} problem={bps[k] === null ? w.badPercent : undefined} />
              ))}
            </div>
          </Part>
          <Choice<PeriodId> label={w.period} options={PERIOD_IDS.map(p => ({ value: p, label: periods[p] }))} value={periodId} onChange={setPeriodId} />
          <div className={s.actions}><Button variant="filled" submit disabled={run.busy || !ready}>{run.busy ? w.working : w.find}</Button>{run.busy && <StopButton />}</div>
          <Problem code={run.problem} />
        </form>
      )}
    </AskPage>
  );
}

function PlanResult({ plan, onAgain }: { plan: PlanValue; onAgain: () => void }) {
  const ask = useAsk(), w = useWords(WORDS);
  const open = (receiptId: string) => ask.go({ kind: 'receipt', receiptId });
  const clash = new Set(plan.clash);
  const row = (l: PlanValue['limits'][number]): RowItem => ({
    id: `limit-${l.index}`, mark: l.tight ? 'you' : clash.has(l.index) || l.alone ? 'unsure' : 'off',
    what: fill(w[`${l.figure}-${l.op}`], { amount: moneyText(l.minor) }),
    note: l.alone ? w.alone : clash.has(l.index) ? w.clashes : l.tight ? w.tight : plan.feasible ? w.met : '',
  });
  const r = plan.recommended;
  return (
    <>
      {r !== null ? (
        <div data-plan="recommended">
          <p className={s.lead}>{fill(w.recommended, { percent: bpsFigure(r.bps, r.receiptId).display })}</p>
          <div className={s.pair}>
            <div className={s.tile}><span className={s.tileLabel}>{w.withChange}</span><Figure size="tile" value={moneyFigure(r.scenarioMinor, r.receiptId, ['what-if'])} onReceipt={open} /></div>
            <div className={s.tile}><span className={s.tileLabel}>{w.difference}</span><Figure size="tile" value={moneyFigure(r.changeMinor, r.receiptId, ['what-if'])} onReceipt={open} /></div>
          </div>
        </div>
      ) : <p className={s.lead} data-plan="none">{w.none}</p>}
      {plan.clash.length > 0 && (
        <Part title={w.clash}>
          <div data-plan="clash"><RowList rows={plan.limits.filter(l => clash.has(l.index)).map(row)} onReceipt={open} /></div>
        </Part>
      )}
      <Part title={w.limits}><RowList rows={plan.limits.map(row)} onReceipt={open} /></Part>
      <p className={s.note}>{fill(w.tried, { count: countWords(String(plan.tried)) })}</p>
      <div className={s.actions}><Button onClick={onAgain}>{w.again}</Button></div>
    </>
  );
}
