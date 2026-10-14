/**
 * TR-03 Send: the three levels drawn as tiny tables of the person's own data with
 * stand-ins, the level in use under an ink line; voice; Local only; the routes approved
 * for data marked financial. A change by one admin may wait for the other to confirm.
 */
import { useState } from 'react';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { YesNo } from '../../parts/Choice';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note } from './kit/Screen';
import { Frame, Outcome, Pending, Tag, powers, type P } from './common';
import { validateChange, validateSendLevels, type SendLevelRow, type SendLevels } from './validate.ts';
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
                  <span>{route}</span>
                  {admin && <Button variant="quiet" disabled={busy} onClick={() => void change({ financialRoutes: levels.financialRoutes.filter((x) => x !== route) })}>{fill(w.removeRoute, { route })}</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
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
