/**
 * TL-02 A small app (tools/smallapps?sheet=<id>), over `smallapps.get` and `smallapps.open`.
 * The app is drawn from its typed description inside the locked frame (SmallAppFrame.tsx: a
 * sandboxed iframe on a unique opaque origin, talking only through checked messages). Nothing from
 * the description is ever run or injected: labels are text nodes, every value is a figure from a
 * calculation receipt (missing is words) and opens that receipt, tables and comparisons are drawn
 * as bars, and an action card's form sends the exact payload its action declares, which only
 * prepares the action for the normal approval card (`smallapps.pressAction`). A stale
 * app is blocked until rebuilt and says what changed. Under it: when it was made from your one
 * line, what it uses, that it runs with your permissions; Books adds its id, version and digest.
 */
import { useState } from 'react';
import { withoutSheet } from '../../app/routes.ts';
import { count } from '../../format/index.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { screenState } from '../trust/kit/Screen';
import { SMALLAPPS, app, opened, rebuilt, removedApp, type App } from './adapters/smallapps.ts';
import { LockedFrame } from './SmallAppFrame';
import { Names, Quoted, SentLine, UsesList, day, isAdmin, toolsWords, type Words } from './shared';
import { fill } from './words.ts';
import s from './SmallApp.module.css';

/** The opened app, in the locked frame. Opened only when it is current. */
function Frame({ value, props, w }: { value: App; props: PlaceRenderProps; w: Words }) {
  const { state } = useEngine(props.rpc, SMALLAPPS.open, { id: value.id }, opened, `${value.id}:${value.version}`);
  return (
    <div className={s.sandbox} data-sandbox="locked" role="group" aria-label={w.sandbox}>
      <p className={s.frameLabel} aria-hidden="true">{w.sandbox}</p>
      {state.kind !== 'ready' ? <State state={screenState(state)} /> : <LockedFrame app={value} value={state.value} props={props} w={w} />}
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
