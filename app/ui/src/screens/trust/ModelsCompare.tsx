/**
 * TR-08 Models · the route comparison: the same open bench for every route, as a table
 * (`bench.results`, `bench.result`). Every number is the engine's own, formatted only; a
 * route that was not scored, a share that was not counted and a cost that was not counted are
 * said in words. The offline replay can be run again here (`bench.compare` with the stated
 * pass bars' digest); it reads recorded answers on this computer and sends nothing.
 */
import { useState } from 'react';
import { count, money, percent } from '../../format/index.ts';
import { Button } from '../../parts/Button';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, Screen } from './kit/Screen';
import { Loads, Tag, dayText, type P } from './common';
import { ModelsOutcome, modelWords, type MK } from './models-kit';
import { validateBenchResult, validateBenchResults, validatePassBars, type BenchResult, type BenchRow, type BenchSummary } from './models-replies.ts';
import s from './Trust.module.css';

const RECORDED: Readonly<Record<string, MK>> = { synthetic: 'compare.recorded.synthetic', live: 'compare.recorded.live', mixed: 'compare.recorded.mixed', none: 'compare.recorded.none' };

export function ModelsCompareScreen(p: P) {
  const m = modelWords(p.language);
  const [round, setRound] = useState(0);
  const { state } = useEngine(p.rpc, 'bench.results', {}, validateBenchResults, String(round));
  return (
    <Screen where={m('compare.where')} title={m('compare.title')} loaded={state}>
      {(list) => <CompareBody p={p} list={list} onRan={() => setRound((n) => n + 1)} />}
    </Screen>
  );
}

function CompareBody({ p, list, onRan }: { p: P; list: BenchSummary[]; onRan: () => void }) {
  const m = modelWords(p.language);
  const [chosen, setChosen] = useState<string | null>(null);
  const id = chosen !== null && list.some((r) => r.id === chosen) ? chosen : list[0]?.id ?? null;
  return (
    <>
      <Note>{m('compare.note')}</Note>
      {id === null ? <p className={s.quiet}>{m('compare.none')}</p> : <ResultTable key={id} p={p} id={id} />}
      {list.length > 1 && (
        <Group title={m('compare.earlier')}>
            <ul className={s.list}>
              {list.map((r) => (
                <li key={r.id} className={s.item}>
                  <Button variant="link" disabled={r.id === id} onClick={() => setChosen(r.id)}>
                    {m('compare.resultAt', { date: dayText(r.finishedAt, p.language), mode: m(r.mode === 'live' ? 'compare.mode.live' : 'compare.mode.offline') })}
                  </Button>
                </li>
              ))}
            </ul>
        </Group>
      )}
      {!p.viewer && <RunOffline p={p} onRan={() => { setChosen(null); onRan(); }} />}
    </>
  );
}

function ResultTable({ p, id }: { p: P; id: string }) {
  const m = modelWords(p.language);
  const { state } = useEngine(p.rpc, 'bench.result', { id }, validateBenchResult, id);
  return (
    <Loads title={m('compare.resultTitle')} loaded={state}>
      {(r) => (
        <div className={s.stack} data-bench-result={r.id}>
          <p className={s.quiet}>{caption(r, p)}</p>
          <table className={s.table}>
            <thead>
              <tr>
                {(['col.route', 'col.right', 'col.wrong', 'col.refused', 'col.share', 'col.person', 'col.invented', 'col.attacks', 'col.cost', 'col.bars'] as const)
                  .map((k) => <th key={k} scope="col">{m(`compare.${k}`)}</th>)}
              </tr>
            </thead>
            <tbody>{r.rows.map((row, i) => <Row key={`${row.route}-${i}`} p={p} row={row} />)}</tbody>
          </table>
        </div>
      )}
    </Loads>
  );
}

function caption(r: BenchResult, p: P): string {
  const m = modelWords(p.language);
  return m('compare.caption', {
    mode: m(r.mode === 'live' ? 'compare.mode.live' : 'compare.mode.offline'), recorded: m(RECORDED[r.recorded] ?? 'compare.recorded.none'),
    date: dayText(r.finishedAt, p.language), cases: count(String(r.benchCases)), runs: count(String(r.runs)),
  });
}

function Row({ p, row }: { p: P; row: BenchRow }) {
  const m = modelWords(p.language);
  const name = (
    <th scope="row">
      {row.route}
      {p.view === 'books' && (row.routeId !== null || row.model !== null) && <span className={s.mono}> {[row.routeId, row.model].filter((x) => x !== null).join(' · ')}</span>}
    </th>
  );
  if (row.status !== 'scored') {
    return (
      <tr data-bench-route={row.route}>
        {name}
        <td colSpan={9}>{m(row.status === 'skipped' ? 'compare.skipped' : 'compare.notRun')}{row.skipReason !== null && <span className={s.quiet}> {row.skipReason}</span>}</td>
      </tr>
    );
  }
  const share = (bps: number | null) => (bps === null ? m('notCounted') : percent(String(bps)));
  const verdict = row.verdict === null ? m('compare.notJudged') : row.verdict.passed ? m('compare.passed') : m('compare.failedOn', { bars: row.verdict.failed.join(', ') });
  return (
    <tr data-bench-route={row.route}>
      {name}
      <td className={s.mono}>{count(String(row.right))}</td>
      <td className={s.mono}>{count(String(row.wrong))}</td>
      <td className={s.mono}>{count(String(row.refused))}</td>
      <td className={s.mono}>{share(row.rightOrRefusedBps)}</td>
      <td className={s.mono}>{share(row.interventionBps)}</td>
      <td className={s.mono}>{count(String(row.inventedNumbers))}</td>
      <td className={s.mono}>{count(String(row.attacksObeyed))}</td>
      <td>{row.costPerJobMinor === null ? m('notCounted') : <><span className={s.mono}>{money(row.costPerJobMinor)}</span> <Tag>{m('costTag')}</Tag></>}</td>
      <td>{verdict}</td>
    </tr>
  );
}

function RunOffline({ p, onRan }: { p: P; onRan: () => void }) {
  const m = modelWords(p.language);
  const bars = useEngine(p.rpc, 'bench.passBars', {}, validatePassBars);
  const { sent, send } = useSend(p.rpc, validateBenchResult);
  if (bars.state.kind !== 'ready') return null;
  const digest = bars.state.value.digest;
  if (digest === null) return <Note>{m('compare.noBars')}</Note>;
  const run = async () => { if (await send('bench.compare', { barsDigest: digest }) !== null && p.live(p.address)) onRan(); };
  return (
    <div className={s.stack}>
      <p className={s.quiet}>{m('compare.runNote')}</p>
      <span><Button disabled={sent.kind === 'sending'} onClick={() => void run()}>{m('compare.run')}</Button></span>
      <ModelsOutcome sent={sent} language={p.language} done={() => m('compare.ran')} />
    </div>
  );
}
