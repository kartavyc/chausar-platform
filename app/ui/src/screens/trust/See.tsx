/**
 * TR-02 See: which sources Chausar may read (core `sources.list`, `trust.get`,
 * `trust.update` with `allowedSources`), and the markings personal, financial and
 * confidential: where each is set, the marks, and what each seat may see.
 */
import { useState, type FormEvent } from 'react';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice, YesNo } from '../../parts/Choice';
import { State } from '../../patterns/States';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note } from './kit/Screen';
import { screenState } from './kit/Screen';
import { Frame, Outcome, Pending, countText, dayText, powers, type P } from './common';
import { MARK_KINDS, validateMarkingChange, validateMarkings, validatePolicy, validateRules, validateSources, type Mark, type MarkKind, type Markings, type Source } from './validate.ts';
import { COMMON, KIND_WORDS, RULES, SEAT_WORDS, SEE, fill } from './words.ts';
import s from './Trust.module.css';

export function SeeView({ p, mode, onChanged }: { p: P; mode: 'page' | 'sheet'; onChanged?: () => void }) {
  const c = words(COMMON, p.language), w = words(SEE, p.language);
  const markings = useEngine(p.rpc, 'trustx.markings', {}, validateMarkings);
  const title = mode === 'page' ? c.markings : c.see;
  return (
    <Frame p={p} mode={mode} where={c.whereMarkings} title={title} loaded={{ kind: 'ready', value: null }}>
      {() => (
        <>
          <Sources p={p} onChanged={onChanged} />
          <Group title={w.markingsTitle} note={w.markingsNote}>
            {markings.state.kind === 'ready'
              ? <MarkingsBody p={p} m={markings.state.value} reload={() => { markings.reload(); onChanged?.(); }} />
              : <State state={screenState(markings.state)} />}
          </Group>
        </>
      )}
    </Frame>
  );
}

function Sources({ p, onChanged }: { p: P; onChanged?: (() => void) | undefined }) {
  const w = words(SEE, p.language);
  const sources = useEngine(p.rpc, 'sources.list', {}, validateSources);
  const policy = useEngine(p.rpc, 'trust.get', {}, validatePolicy);
  if (sources.state.kind === 'not-built') return <Group title={w.sourcesTitle}><Counts p={p} /></Group>;
  if (sources.state.kind !== 'ready') return <Group title={w.sourcesTitle}><State state={screenState(sources.state)} /></Group>;
  if (policy.state.kind !== 'ready') return <Group title={w.sourcesTitle}><State state={screenState(policy.state)} /></Group>;
  return (
    <Group title={w.sourcesTitle} note={w.sourcesNote}>
      <SourceList p={p} list={sources.state.value} allowed={policy.state.value.allowedSources}
        reload={() => { sources.reload(); policy.reload(); onChanged?.(); }} />
    </Group>
  );
}

/** When the source list is not built: the counts from the rules. */
function Counts({ p }: { p: P }) {
  const w = words(SEE, p.language), rw = words(RULES, p.language);
  const { state } = useEngine(p.rpc, 'trustx.rules', {}, validateRules);
  if (state.kind !== 'ready') return <State state={screenState(state)} />;
  const see = state.value.see;
  return <p className={s.text}>{w.sourcesCounts} {see.allSources ? rw.seeAll : fill(rw.seeSome, { allowed: countText(see.allowed), refused: countText(see.refused) })}</p>;
}

function SourceList({ p, list, allowed, reload }: { p: P; list: Source[]; allowed: string[]; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(SEE, p.language);
  const { admin } = powers(p);
  const { sent, send } = useSend(p.rpc, validatePolicy);
  const [asking, setAsking] = useState<string | null>(null);
  if (list.length === 0) return <p className={s.quiet}>{w.sourcesNone}</p>;
  const all = allowed.includes('*');
  const reads = (id: string) => all || allowed.includes(id);
  const change = async (id: string, yes: boolean) => {
    const next = yes ? [...allowed, id] : (all ? list.map((x) => x.sourceId) : allowed).filter((x) => x !== id);
    setAsking(null);
    if (await send('trust.update', { allowedSources: next }) !== null && p.live(p.address)) reload();
  };
  return (
    <>
      <ul className={s.list}>
        {list.map((src) => (
          <li key={src.sourceId} className={s.item}>
            <div className={s.itemHead}>
              <span className={s.name}>{src.name}</span>
              {p.view === 'books' && <span className={s.mono}>{src.sourceId}</span>}
              {admin
                ? <YesNo label={src.name} value={reads(src.sourceId)} onChange={(yes) => (yes ? void change(src.sourceId, true) : setAsking(src.sourceId))} disabled={sent.kind === 'sending'} />
                : <span className={s.quiet}>{reads(src.sourceId) ? c.on : c.off}</span>}
            </div>
            {asking === src.sourceId && (
              <div className={s.ask}>
                <p>{fill(w.stopAsk, { name: src.name })}</p>
                <Button variant="quiet" danger onClick={() => void change(src.sourceId, false)}>{w.stopConfirm}</Button>
                <Button variant="link" onClick={() => setAsking(null)}>{c.cancel}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!admin && <Note>{c.adminOnly}</Note>}
      <Outcome sent={sent} language={p.language} />
    </>
  );
}

function markText(m: Mark, kind: string, w: Readonly<Record<keyof typeof SEE.en, string>>): string {
  const t = m.target;
  if (t.type === 'field' && t.field !== undefined) return fill(w.markField, { kind, field: t.field, source: t.sourceId });
  if (t.type === 'record' && t.recordId !== undefined) return fill(w.markRecord, { kind, record: t.recordId, source: t.sourceId });
  return fill(w.markSource, { kind, source: t.sourceId });
}

/** Pending marking changes carry `what` "see" or "markings" (the engine names them when widening a seat's view waits for the second person). */
const MARKING_CHANGES = ['see', 'markings'] as const;

function MarkingsBody({ p, m, reload }: { p: P; m: Markings; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(SEE, p.language), k = words(KIND_WORDS, p.language), seatW = words(SEAT_WORDS, p.language);
  const { admin } = powers(p);
  const { sent, send } = useSend(p.rpc, validateMarkingChange);
  const [round, setRound] = useState(0);
  const change = async (method: string, payload: Record<string, unknown>) => {
    const done = await send(method, payload);
    if (done === null || !p.live(p.address)) return;
    if ('state' in done && done.state === 'waiting-for-second') setRound((n) => n + 1); else reload();
  };
  const seatName = (seat: string) => (seat in seatW ? seatW[seat as keyof typeof seatW] : seat);
  const whereRows = [
    { id: 'source', label: w.whereSource, link: w.linkSource, to: m.where.source },
    { id: 'record', label: w.whereRecord, link: w.linkRecord, to: m.where.record },
    { id: 'field', label: w.whereField, link: w.linkField, to: m.where.field },
  ];
  return (
    <div className={s.stack}>
      <h3 className={s.label}>{w.whereTitle}</h3>
      <ul className={s.list}>
        {whereRows.map((x) => (
          <li key={x.id} className={s.item}>
            <span className={s.line}>{x.label}<Button variant="link" onClick={() => p.navigate({ place: x.to.place, sub: x.to.sub })}>{x.link}</Button></span>
          </li>
        ))}
      </ul>
      <h3 className={s.label}>{w.marksTitle}</h3>
      {m.marks.length === 0 ? <p className={s.quiet}>{w.marksNone}</p> : (
        <ul className={s.list}>
          {m.marks.map((mark) => (
            <li key={mark.id} className={s.item}>
              <span>{markText(mark, k[mark.kind], w)}</span>
              <span className={s.quiet}>
                {mark.auto ? (mark.kind === 'financial' ? w.autoFinancial : w.autoOther) : fill(w.markBy, { by: mark.by, date: dayText(mark.at, p.language) })}
              </span>
              {admin && !mark.auto && (
                <span><Button variant="quiet" onClick={() => void change('trustx.setMarking', { kind: mark.kind, target: mark.target, on: false })}>{w.unmark}</Button></span>
              )}
            </li>
          ))}
        </ul>
      )}
      {admin && <AddMarking p={p} busy={sent.kind === 'sending'} onMark={(sourceId, kind) => void change('trustx.setMarking', { kind, target: { type: 'source', sourceId }, on: true })} />}
      <h3 className={s.label}>{w.seatsTitle}</h3>
      <table className={s.table}>
        <thead><tr><th scope="col">{w.seatCol}</th>{MARK_KINDS.map((kind) => <th key={kind} scope="col">{k[kind]}</th>)}</tr></thead>
        <tbody>
          {m.seats.map((seat) => (
            <tr key={seat.seat}>
              <th scope="row">{seatName(seat.seat)}</th>
              {MARK_KINDS.map((kind) => (
                <td key={kind}>
                  {admin
                    ? <YesNo label={fill(w.seesLabel, { seat: seatName(seat.seat), kind: k[kind] })} value={seat.sees[kind]}
                        onChange={(sees) => void change('trustx.setSeatMarking', { seat: seat.seat, kind, sees })} disabled={sent.kind === 'sending'} />
                    : seat.sees[kind] ? c.on : c.off}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Outcome sent={sent} language={p.language} />
      <Pending p={p} what={MARKING_CHANGES} round={round} onConfirmed={reload} />
    </div>
  );
}

/** Mark a whole source: choose it from the source list and choose the marking. */
function AddMarking({ p, busy, onMark }: { p: P; busy: boolean; onMark: (sourceId: string, kind: MarkKind) => void }) {
  const w = words(SEE, p.language), k = words(KIND_WORDS, p.language);
  const sources = useEngine(p.rpc, 'sources.list', {}, validateSources);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [kind, setKind] = useState<MarkKind | null>(null);
  const [problem, setProblem] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (sourceId === null || kind === null) { setProblem(true); return; }
    setProblem(false); onMark(sourceId, kind);
  };
  let body;
  if (sources.state.kind === 'not-built') body = <p className={s.quiet}>{w.addNotBuilt}</p>;
  else if (sources.state.kind !== 'ready') body = <State state={screenState(sources.state)} />;
  else if (sources.state.value.length === 0) body = <p className={s.quiet}>{w.addNoSources}</p>;
  else body = (
    <form className={s.stack} onSubmit={submit} aria-label={w.addTitle}>
      <Choice label={w.addSource} options={sources.state.value.map((x) => ({ value: x.sourceId, label: x.name }))} value={sourceId} onChange={setSourceId} />
      <Choice label={w.addKind} options={MARK_KINDS.map((value) => ({ value, label: k[value] }))} value={kind} onChange={setKind} />
      {problem && <p className={s.problem}>{w.pickBoth}</p>}
      <span><Button submit disabled={busy}>{w.mark}</Button></span>
    </form>
  );
  return (
    <div className={s.stack} data-add-marking="">
      <h3 className={s.label}>{w.addTitle}</h3>
      <p className={s.quiet}>{w.addNote}</p>
      {body}
    </div>
  );
}
