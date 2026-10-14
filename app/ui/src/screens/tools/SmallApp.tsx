/**
 * TL-02 A small app (tools/smallapps?sheet=<id>), over `smallapps.get` and `smallapps.open`.
 * The app is drawn from its typed description inside the locked frame with Chausar's own parts.
 * Nothing from the description is ever run or injected: labels are text nodes, every value is
 * a figure from a calculation receipt (missing is words) and opens that receipt, and an action
 * card only prepares the action for the normal approval card (`smallapps.pressAction`). A stale
 * app is blocked until rebuilt and says what changed. Under it: when it was made from your one
 * line, what it uses, that it runs with your permissions; Books adds its id, version and digest.
 */
import { useState } from 'react';
import { withSheet, withoutSheet } from '../../app/routes.ts';
import { count } from '../../format/index.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Figure } from '../../parts/Figure';
import { KeyValue } from '../../parts/KeyValue';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { screenState } from '../trust/kit/Screen';
import { FOLLOW_UP_BOOK, SMALLAPPS, app, opened, pressed, rebuilt, removedApp, type App, type OpenCard, type Value } from './adapters/smallapps.ts';
import { Names, Quoted, SentLine, UsesList, day, isAdmin, toolsWords, type Words } from './shared';
import { fill } from './words.ts';
import s from './SmallApp.module.css';

/** One value: its figures (each opens the receipt), or the words for what is missing. */
function ValueView({ value, props, w }: { value: Value; props: PlaceRenderProps; w: Words }) {
  const books = props.view === 'books';
  if (value.kind === 'missing') {
    return (
      <div className={s.value}>
        <Figure value={value.figure} size="tile" onReceipt={props.openReceipt} />
        {books && value.receiptId !== null && <Button variant="link" className="fig" onClick={() => props.openReceipt(value.receiptId as string)}>{value.receiptId}</Button>}
      </div>
    );
  }
  return (
    <div className={s.value}>
      {value.items.length === 1
        ? <Figure value={value.items[0]!.figure} size="tile" onReceipt={props.openReceipt} />
        : <KeyValue align="right" onReceipt={props.openReceipt} pairs={value.items.map((i) => ({ name: i.label, figure: i.figure }))} />}
      {value.partial && <p className={s.note}>{w.partial}</p>}
      {books && value.gaps.length > 0 && <Names names={value.gaps} w={w} />}
    </div>
  );
}

function ActionCard({ card, appId, props, w }: { card: Extract<OpenCard, { kind: 'action' }>; appId: string; props: PlaceRenderProps; w: Words }) {
  const press = useSend(props.rpc, pressed);
  const can = card.press === 'prepares-for-approval' && !props.viewer;
  return (
    <div className={s.card}>
      {can && press.sent.kind !== 'done'
        ? <Button disabled={press.sent.kind === 'sending'} onClick={() => { void press.send(SMALLAPPS.press, { id: appId, cardId: card.id, payload: {} }); }}>{card.label}</Button>
        : <h3 className={s.cardTitle}>{card.label}</h3>}
      <p className={s.note}>{card.press === 'unavailable' ? w.actionUnavailable : card.alwaysWaits ? w.actionAlwaysWaits : w.actionNote}</p>
      {press.sent.kind === 'done'
        ? <p className={s.note} role="status">{w.prepared} <Button variant="link" onClick={() => props.navigate({ place: 'work', sub: 'approvals' })}>{w.toApprovals}</Button></p>
        : <SentLine sent={press.sent} w={w} />}
    </div>
  );
}

function CardView({ card, appId, props, w }: { card: OpenCard; appId: string; props: PlaceRenderProps; w: Words }) {
  switch (card.kind) {
    case 'metric': return <div className={s.card}><h3 className={s.cardTitle}>{card.label}</h3><ValueView value={card.value} props={props} w={w} /></div>;
    case 'comparison': return (
      <div className={s.card}>
        <h3 className={s.cardTitle}>{card.label}</h3>
        <p className={s.small}>{w.current}</p><ValueView value={card.current} props={props} w={w} />
        <p className={s.small}>{w.previous}</p><ValueView value={card.previous} props={props} w={w} />
      </div>
    );
    case 'table': return (
      <div className={s.card}>
        <h3 className={s.cardTitle}>{card.label}</h3>
        {card.rows.map((r, i) => <div key={i} className={s.row}><span className={s.small}>{r.label}</span><ValueView value={r.value} props={props} w={w} /></div>)}
      </div>
    );
    case 'action': return <ActionCard card={card} appId={appId} props={props} w={w} />;
    case 'records': return (
      <div className={s.card}>
        <h3 className={s.cardTitle}>{card.label}</h3>
        {card.entries.length === 0 ? <p className={s.note}>{w.bookEmpty}</p>
          : <Names names={card.entries.map((e) => fill(w.followUpLine, { who: e.who, date: day(e.when, props.language) }))} w={w} />}
        <Button variant="link" onClick={() => props.navigate(withSheet(props.address, FOLLOW_UP_BOOK))}>{w.openBook}</Button>
      </div>
    );
  }
}

/** The opened app, in the locked frame. Opened only when it is current. */
function Frame({ value, props, w }: { value: App; props: PlaceRenderProps; w: Words }) {
  const { state } = useEngine(props.rpc, SMALLAPPS.open, { id: value.id }, opened, `${value.id}:${value.version}`);
  return (
    <div className={s.sandbox} data-sandbox="locked" role="group" aria-label={w.sandbox}>
      <p className={s.frameLabel} aria-hidden="true">{w.sandbox}</p>
      {state.kind !== 'ready' ? <State state={screenState(state)} />
        : state.value.cards.length === 0 ? <p className={s.note}>{w.noCards}</p>
        : state.value.cards.map((c) => <CardView key={c.id} card={c} appId={value.id} props={props} w={w} />)}
    </div>
  );
}

function AppBody({ value, props, w, onChanged }: { value: App; props: PlaceRenderProps; w: Words; onChanged: (gone: boolean) => void }) {
  const rebuild = useSend(props.rpc, rebuilt);
  const remove = useSend(props.rpc, removedApp);
  const [asking, setAsking] = useState(false);
  const books = props.view === 'books';
  const mayRemove = !props.viewer && (isAdmin(props) || value.createdBy === props.member.id);
  return (
    <div className={s.body}>
      {value.state === 'stale' ? (
        <div className={s.blocked}>
          <p className={s.p}>{w.staleNote}</p>
          {value.reasons.length > 0 && <><h3 className={s.small}>{w.changed}</h3><Names names={value.reasons} w={w} /></>}
          {!props.viewer && (
            <div><Button disabled={rebuild.sent.kind === 'sending'} onClick={async () => {
              if (await rebuild.send(SMALLAPPS.rebuild, { id: value.id }) !== null && props.live(props.address)) onChanged(false);
            }}>{w.rebuild}</Button></div>
          )}
          <SentLine sent={rebuild.sent} done={w.rebuilt} w={w} />
        </div>
      ) : <Frame value={value} props={props} w={w} />}
      <div className={s.under}>
        <p className={s.note}>{fill(w.madeFromOn, { date: day(value.createdAt, props.language) })}</p>
        {value.request === null ? <p className={s.note}>{w.noLine}</p> : <Quoted>{value.request}</Quoted>}
        <h3 className={s.small}>{w.uses}</h3>
        <UsesList calculations={value.calculationNames} actions={value.actions.map((a) => a.alwaysWaits ? fill(w.alwaysWaitsName, { name: a.label }) : a.label)} book={value.uses.books.length > 0} w={w} />
        <p className={s.note}>{w.runsWith}</p>
        {books && <p className={[s.note, 'fig'].join(' ')}>{fill(w.appTech, { id: value.id, version: count(String(value.version)), digest: value.digest })}</p>}
        {mayRemove && (asking ? (
          <div className={s.buttons} role="group" aria-label={fill(w.removeAppAsk, { name: value.title })}>
            <p className={s.note}>{fill(w.removeAppAsk, { name: value.title })}</p>
            <Button danger disabled={remove.sent.kind === 'sending'} onClick={async () => {
              setAsking(false);
              if (await remove.send(SMALLAPPS.remove, { id: value.id }) !== null && props.live(props.address)) onChanged(true);
            }}>{fill(w.removeYes, { name: value.title })}</Button>
            <Button variant="link" onClick={() => setAsking(false)}>{w.keepIt}</Button>
          </div>
        ) : <div><Button onClick={() => setAsking(true)}>{w.remove}</Button></div>)}
        <SentLine sent={remove.sent} w={w} />
      </div>
    </div>
  );
}

export function SmallAppSheet({ id, props, onChanged }: { id: string; props: PlaceRenderProps; onChanged: () => void }) {
  const w = toolsWords(props.language);
  const { state, reload } = useEngine(props.rpc, SMALLAPPS.get, { id }, app, id);
  const close = () => props.navigate(withoutSheet(props.address));
  return (
    <Sheet kind={w.appKind} title={state.kind === 'ready' ? state.value.title : w.appKind} origin={null} onClose={close}>
      {state.kind === 'ready'
        ? <AppBody value={state.value} props={props} w={w} onChanged={(gone) => { onChanged(); if (gone) close(); else reload(); }} />
        : <State state={screenState(state)} />}
    </Sheet>
  );
}
