/**
 * TR-03 Send: the three levels drawn as tiny tables of the person's own data with
 * stand-ins, the level in use under an ink line; voice; Local only; the routes approved
 * for data marked financial. A change by one admin may wait for the other to confirm.
 */
import { useState, type FormEvent } from 'react';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice, YesNo } from '../../parts/Choice';
import { State } from '../../patterns/States';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, screenState } from './kit/Screen';
import { Frame, Outcome, Pending, Tag, powers, type P } from './common';
import { validateChange, validateModels, validateSendLevels, type Models, type SendLevelRow, type SendLevels } from './validate.ts';
import { COMMON, SEND, fill } from './words.ts';
import s from './Trust.module.css';

export function SendView({ p, mode, onChanged }: { p: P; mode: 'page' | 'sheet'; onChanged?: () => void }) {
  const c = words(COMMON, p.language);
  const { state, reload } = useEngine(p.rpc, 'trustx.sendLevels', {}, validateSendLevels);
  return (
    <Frame p={p} mode={mode} where={c.whereRules} title={c.send} loaded={state}>
      {(levels) => <SendBody p={p} levels={levels} reload={() => { reload(); onChanged?.(); }} />}
    </Frame>
  );
}

function SendBody({ p, levels, reload }: { p: P; levels: SendLevels; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(SEND, p.language);
  const { admin } = powers(p);
  const { sent, send } = useSend(p.rpc, validateChange);
  const [round, setRound] = useState(0);
  const change = async (payload: Record<string, unknown>) => {
    const done = await send('trustx.setSend', payload);
    if (done === null || !p.live(p.address)) return;
    if (done.state === 'applied') reload(); else setRound((n) => n + 1);
  };
  const busy = sent.kind === 'sending';
  // The routes and the speech provider come from Models; without it, routes show by id and voice by the engine's note.
  const models = useEngine(p.rpc, 'trustx.models', {}, validateModels);
  const ready = models.state.kind === 'ready' ? models.state.value : null;
  const routeName = (id: string) => ready?.routes.find((r) => r.id === id)?.label ?? id;
  return (
    <>
      {!admin && <Note>{c.ownerOnly}</Note>}
      {levels.levels.map((level) => (
        <Level key={level.id} p={p} level={level} current={level.id === levels.current} synthetic={levels.synthetic}
          onUse={admin && level.id !== levels.current && !busy ? () => void change({ level: level.id }) : undefined} />
      ))}
      <Outcome sent={sent} language={p.language} />
      <Pending p={p} what={['send']} round={round} onConfirmed={reload} />
      <Note>{w.standIns}</Note>
      <Group title={w.voiceTitle}>
        <p className={s.text}>{w.voiceOff}</p>
        {ready !== null && <p className={s.text} data-voice="">{ready.voice.provider === null ? w.voiceNone : fill(w.voiceProvider, { provider: ready.voice.provider })}</p>}
        <p className={s.quiet}>{w.voiceNote}</p>
      </Group>
      <Group title={w.localTitle} note={w.localNote}>
        {admin
          ? <YesNo label={w.localTitle} value={levels.localOnly} onChange={(localOnly) => void change({ localOnly })} disabled={busy} />
          : <p className={s.text}>{levels.localOnly ? c.on : c.off}</p>}
      </Group>
      <Group title={w.financialTitle}>
        {levels.financialRoutes.length === 0 ? <p className={s.quiet}>{w.financialNone}</p> : (
          <ul className={s.list}>
            {levels.financialRoutes.map((route) => (
              <li key={route} className={s.item}>
                <span className={s.itemHead}>
                  <span>{routeName(route)}</span>
                  {p.view === 'books' && <span className={s.mono}>{route}</span>}
                  {admin && <Button variant="quiet" disabled={busy} onClick={() => void change({ financialRoutes: levels.financialRoutes.filter((x) => x !== route) })}>{fill(w.removeRoute, { route: routeName(route) })}</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {admin && (models.state.kind === 'ready' ? <AddRoute p={p} models={models.state.value} approved={levels.financialRoutes} busy={busy}
          onAdd={(id) => void change({ financialRoutes: [...levels.financialRoutes, id] })} />
          : models.state.kind === 'not-built' ? <p className={s.quiet}>{w.routesNotBuilt}</p> : <State state={screenState(models.state)} />)}
      </Group>
    </>
  );
}

/** Approve one more route, chosen from the routes in Models; the whole new list is sent. */
function AddRoute({ p, models, approved, busy, onAdd }: { p: P; models: Models; approved: readonly string[]; busy: boolean; onAdd: (id: string) => void }) {
  const w = words(SEND, p.language);
  const [route, setRoute] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const left = models.routes.filter((r) => !approved.includes(r.id));
  if (left.length === 0) return <p className={s.quiet}>{w.allApproved}</p>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (route === null || !left.some((r) => r.id === route)) { setProblem(true); return; }
    setProblem(false); setRoute(null); onAdd(route);
  };
  return (
    <form className={s.stack} onSubmit={submit} aria-label={w.addRoute}>
      <Choice label={w.addRoute} options={left.map((r) => ({ value: r.id, label: r.label }))} value={route} onChange={setRoute} />
      {problem && <p className={s.problem}>{w.pickRoute}</p>}
      <span><Button submit disabled={busy}>{w.addRouteButton}</Button></span>
    </form>
  );
}

function Level({ p, level, current, synthetic, onUse }: { p: P; level: SendLevelRow; current: boolean; synthetic: boolean; onUse: (() => void) | undefined }) {
  const w = words(SEND, p.language);
  const name = w[`level.${level.id}`];
  return (
    <section className={[s.level, current ? s.inUse : ''].join(' ')} aria-label={name} data-level={level.id} aria-current={current ? 'true' : undefined}>
      <div className={s.itemHead}>
        <h3 className={s.name}>{name}</h3>
        {current && <Tag>{w.inUse}</Tag>}
      </div>
      {level.headings.length > 0 && (
        <table className={s.table}>
          {synthetic && <caption className={s.tableCaption}>{w.example}</caption>}
          <thead><tr>{level.headings.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
          <tbody>{level.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className={s.mono}>{cell}</td>)}</tr>)}</tbody>
        </table>
      )}
      <p className={s.quiet}><span className={s.label}>{w.memory}</span>: {level.memory}</p>
      <p className={s.quiet}><span className={s.label}>{w.question}</span>: {level.question}</p>
      {onUse && <span><Button variant="quiet" onClick={onUse}>{w.use}</Button></span>}
    </section>
  );
}
