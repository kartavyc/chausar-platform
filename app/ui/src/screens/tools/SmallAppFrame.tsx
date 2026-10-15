/**
 * TL-02 the locked frame: an `<iframe sandbox="allow-scripts">` with a `srcdoc` and no
 * `allow-same-origin`, so the app is drawn on a unique opaque origin by Chausar's fixed renderer
 * (frame/bridge.ts says what crosses). The host posts the view in and acts only on a message from
 * that frame's window, from the opaque origin, on its random channel, naming a receipt, records card
 * or action card it sent. A press turns the form's plain values into the exact payload the action
 * declares, checks it against that declaration, and only then asks `smallapps.pressAction`, which
 * prepares the action for the normal approval card and does nothing else.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withSheet } from '../../app/routes.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { errorCode } from '../trust/kit/engine.ts';
import { FOLLOW_UP_BOOK, SMALLAPPS, pressed, type App, type Opened } from './adapters/smallapps.ts';
import { buildView, frameDocument, newChannel, readInbound, type Inbound } from './frame/bridge.ts';
import { payloadFrom } from './frame/schema.ts';
import { laneRefusal, laneSay } from './lane';
import { day, type Words } from './shared';
import { fill } from './words.ts';
import s from './SmallApp.module.css';

const MIN_HEIGHT = 120, MAX_HEIGHT = 4000, START_WAIT_MS = 5000;
type Press = { readonly kind: 'sending' } | { readonly kind: 'prepared'; readonly cardId: string } | { readonly kind: 'refused'; readonly sentence: string } | null;

export function LockedFrame({ app, value, props, w }: { app: App; value: Opened; props: PlaceRenderProps; w: Words }) {
  const say = useMemo(() => laneSay(props.language), [props.language]);
  const frame = useRef<HTMLIFrameElement>(null);
  const channel = useMemo(newChannel, []);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const srcDoc = useMemo(() => {
    try { return frameDocument(channel, props.language, app.title, origin); } catch { return null; }
  }, [channel, props.language, app.title, origin]);
  const { view, known } = useMemo(() => buildView(value, {
    title: app.title, language: props.language, viewer: props.viewer, say, partial: w.partial,
    recordLine: (who, when) => fill(w.followUpLine, { who, date: day(when, props.language) }),
  }), [value, app.title, props.language, props.viewer, say, w]);
  const [ready, setReady] = useState(false);
  const [late, setLate] = useState(false);
  const [height, setHeight] = useState(240);
  const [press, setPress] = useState<Press>(null);
  const busy = useRef(false);

  const post = useCallback((message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ ...message, channel }, '*');
  }, [channel]);

  useEffect(() => { if (ready) post({ type: 'render', view }); }, [ready, view, post]);
  useEffect(() => {
    if (ready) return undefined;
    const timer = setTimeout(() => setLate(true), START_WAIT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  const act = useCallback(async (m: Extract<Inbound, { type: 'press' }>) => {
    const action = known.actions.get(m.cardId);
    if (action === undefined || busy.current) return;
    let payload: Record<string, unknown> = {};
    if (action.schema !== null) {
      const built = payloadFrom(action.schema, action.form, m.fields);
      if (!built.ok) {
        const sentence = built.field === '' ? say('frame.detailsDoNotFit') : say('frame.fieldDoesNotFit', { name: built.field });
        setPress({ kind: 'refused', sentence }); post({ type: 'pressed', cardId: m.cardId, words: sentence });
        return;
      }
      payload = built.payload;
    }
    busy.current = true; setPress({ kind: 'sending' }); post({ type: 'pressed', cardId: m.cardId, words: w.sending });
    try {
      pressed(await props.rpc.request(SMALLAPPS.press, { id: app.id, cardId: m.cardId, payload }));
      if (!props.live(props.address)) return;
      setPress({ kind: 'prepared', cardId: m.cardId }); post({ type: 'pressed', cardId: m.cardId, words: w.prepared });
    } catch (error) {
      const sentence = laneRefusal(errorCode(error), say, w);
      setPress({ kind: 'refused', sentence }); post({ type: 'pressed', cardId: m.cardId, words: sentence });
    } finally { busy.current = false; }
  }, [known, app.id, props, say, w, post]);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (win === null || win === undefined || event.source !== win || event.origin !== 'null') return;
      const m = readInbound(event.data, channel, known);
      if (m === null) return;
      if (m.type === 'ready') { setReady(true); setLate(false); }
      else if (m.type === 'size') setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, m.height)));
      else if (m.type === 'receipt') props.openReceipt(m.receiptId);
      else if (m.type === 'book') props.navigate(withSheet(props.address, FOLLOW_UP_BOOK));
      else void act(m);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [channel, known, props, act]);

  if (srcDoc === null) return <p className={s.note}>{say('frame.notStarted')}</p>;
  return (
    <>
      <iframe ref={frame} className={s.frame} title={fill(say('frame.title'), { name: app.title })} sandbox="allow-scripts" srcDoc={srcDoc}
        referrerPolicy="no-referrer" loading="eager" style={{ height: `${height}px` }} />
      {!ready && <p className={s.note} role="status">{late ? say('frame.notStarted') : say('frame.starting')}</p>}
      {press?.kind === 'sending' && <p className={s.note} role="status">{w.sending}</p>}
      {press?.kind === 'refused' && <p className={s.note} role="status">{press.sentence}</p>}
      {press?.kind === 'prepared' && (
        <p className={s.note} role="status">{w.prepared} <Button variant="link" onClick={() => props.navigate({ place: 'work', sub: 'approvals' })}>{w.toApprovals}</Button></p>
      )}
    </>
  );
}
