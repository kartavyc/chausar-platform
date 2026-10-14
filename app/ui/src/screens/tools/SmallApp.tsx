/**
 * TL-02 A small app (tools/smallapps?sheet=<id>): the app drawn from its typed description
 * inside the locked frame, with Chausar's own parts. Nothing from the description is ever
 * run or injected: card titles are text nodes, a metric is a figure that opens its receipt,
 * a table is rows of figures, and an action only navigates to Work · Approvals.
 * A stale app is blocked until rebuilt and says what changed.
 */
import { withoutSheet } from '../../app/routes.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Figure } from '../../parts/Figure';
import { KeyValue } from '../../parts/KeyValue';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { screenState } from '../trust/kit/Screen';
import { SMALLAPPS, app, type App, type Card } from './adapters/smallapps.ts';
import { Names, Quoted, SentLine, UsesList, day, toolsWords, type Words } from './shared';
import { fill } from './words.ts';
import { anyObject } from './validate.ts';
import s from './SmallApp.module.css';

function CardView({ card, props, w }: { card: Card; props: PlaceRenderProps; w: Words }) {
  if (card.kind === 'metric') {
    return <div className={s.card}><h3 className={s.cardTitle}>{card.title}</h3><Figure value={card.figure} size="tile" onReceipt={props.openReceipt} /></div>;
  }
  if (card.kind === 'table') {
    return <div className={s.card}><h3 className={s.cardTitle}>{card.title}</h3>
      <KeyValue align="right" onReceipt={props.openReceipt} pairs={card.rows.map((r) => ({ name: r.label, figure: r.figure }))} /></div>;
  }
  return (
    <div className={s.card}>
      <Button onClick={() => props.navigate({ place: 'work', sub: 'approvals' })}>{card.title}</Button>
      <p className={s.note}>{w.actionNote}</p>
    </div>
  );
}

function AppBody({ value, props, w, onRebuilt }: { value: App; props: PlaceRenderProps; w: Words; onRebuilt: () => void }) {
  const rebuild = useSend(props.rpc, anyObject);
  const blocked = value.state === 'stale' || value.state === 'blocked';
  return (
    <div className={s.body}>
      {blocked ? (
        <div className={s.blocked}>
          <p className={s.p}>{value.state === 'stale' ? w.staleNote : w.blockedApp}</p>
          {value.changed.length > 0 && <><h3 className={s.small}>{w.changed}</h3><Names names={value.changed} w={w} /></>}
          {value.state === 'stale' && !props.viewer && (
            <div><Button disabled={rebuild.sent.kind === 'sending'} onClick={async () => {
              if (await rebuild.send(SMALLAPPS.rebuild, { id: value.id }) !== null) onRebuilt();
            }}>{w.rebuild}</Button></div>
          )}
          <SentLine sent={rebuild.sent} done={w.rebuilt} w={w} />
        </div>
      ) : (
        <div className={s.sandbox} data-sandbox="locked" role="group" aria-label={w.sandbox}>
          <p className={s.frameLabel} aria-hidden="true">{w.sandbox}</p>
          {value.cards.length === 0 ? <p className={s.note}>{w.noCards}</p> : value.cards.map((c, i) => <CardView key={i} card={c} props={props} w={w} />)}
        </div>
      )}
      {value.textRemoved && <p className={s.p} role="note">{w.textRemoved}</p>}
      <div className={s.under}>
        <p className={s.note}>{fill(w.madeFromOn, { date: day(value.madeOn, props.language) })}</p>
        <Quoted>{value.madeFrom}</Quoted>
        <h3 className={s.small}>{w.uses}</h3>
        <UsesList uses={value.uses} w={w} />
        <p className={s.note}>{w.runsWith}</p>
        {props.view === 'books' && <p className={[s.note, 'fig'].join(' ')}>{value.id}</p>}
      </div>
    </div>
  );
}

export function SmallAppSheet({ id, props, onChanged }: { id: string; props: PlaceRenderProps; onChanged: () => void }) {
  const w = toolsWords(props.language);
  const { state, reload } = useEngine(props.rpc, SMALLAPPS.get, { id }, app, id);
  return (
    <Sheet kind={w.appKind} title={state.kind === 'ready' ? state.value.title : w.appKind} origin={null}
      onClose={() => props.navigate(withoutSheet(props.address))}>
      {state.kind === 'ready'
        ? <AppBody value={state.value} props={props} w={w} onRebuilt={() => { reload(); onChanged(); }} />
        : <State state={screenState(state)} />}
    </Sheet>
  );
}
