/**
 * TR-08 Models · the order routes are tried in. An owner or cofounder moves routes up and down
 * and saves the whole order once with `models.setLadder { order: routeId[] }` (core-gateway-auth,
 * built this round). Until the engine has it, the screen says the change is not built yet and
 * keeps the order shown; nothing else changes.
 */
import { useState } from 'react';
import { Button } from '../../parts/Button';
import { NOT_BUILT_CODES, useSend } from './kit/engine.ts';
import { ModelsOutcome, modelWords } from './models-kit';
import { validateLadder } from './models-replies.ts';
import type { P } from './common';
import type { Route } from './validate.ts';
import s from './Trust.module.css';

export function LadderForm({ p, routes, reload }: { p: P; routes: readonly Route[]; reload: () => void }) {
  const m = modelWords(p.language);
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState<readonly Route[]>(routes);
  const { sent, send, clear } = useSend(p.rpc, validateLadder);
  if (routes.length < 2) return null;
  const notBuilt = sent.kind === 'refused' && NOT_BUILT_CODES.has(sent.code);
  if (!editing) {
    return <span><Button variant="quiet" onClick={() => { setOrder(routes); clear(); setEditing(true); }}>{m('ladder.change')}</Button></span>;
  }
  const move = (from: number, to: number) => setOrder((now) => {
    const next = [...now];
    const [item] = next.splice(from, 1);
    if (item !== undefined) next.splice(to, 0, item);
    return next;
  });
  const save = async () => {
    const done = await send('models.setLadder', { order: order.map((r) => r.id) });
    if (done !== null && p.live(p.address)) { setEditing(false); reload(); }
  };
  const busy = sent.kind === 'sending';
  return (
    <div className={s.stack} data-ladder="">
      <ol className={s.ordered}>
        {order.map((r, i) => (
          <li key={r.id} data-ladder-route={r.id}>
            <span className={s.line}>
              <span>{r.label}</span>
              <Button variant="link" disabled={busy || i === 0} onClick={() => move(i, i - 1)} aria-label={m('ladder.upNamed', { route: r.label })}>{m('ladder.up')}</Button>
              <Button variant="link" disabled={busy || i === order.length - 1} onClick={() => move(i, i + 1)} aria-label={m('ladder.downNamed', { route: r.label })}>{m('ladder.down')}</Button>
            </span>
          </li>
        ))}
      </ol>
      <p className={s.quiet}>{m('ladder.note')}</p>
      <span className={s.line}>
        <Button disabled={busy} onClick={() => void save()}>{m('ladder.save')}</Button>
        <Button variant="link" disabled={busy} onClick={() => { setEditing(false); clear(); }}>{m('cancel')}</Button>
      </span>
      {notBuilt
        ? <p className={s.status} role="status" data-ladder-not-built="">{m('ladder.notBuilt')}</p>
        : <ModelsOutcome sent={sent} language={p.language} done={() => m('ladder.saved')} />}
    </div>
  );
}
