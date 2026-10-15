/**
 * Opening a client (CA-03 entry) and showing a client's one-time code with its guide (CA-09).
 *
 * Opening asks `clients.open` for the seat the client gave, then asks the frame to step into
 * that workspace. Stepping in is the frame's job; while `workspaces.switch` does not exist the
 * page says where to open the client from instead. The console holds no client data.
 */
import { useCallback, useRef, useState } from 'react';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import type { ClientCode, Opened } from './contract.ts';
import { validateOpened, validateSwitched } from './contract.ts';
import { NOT_BUILT, Refusal, copyText, errorCode, saveFile, seatText, type P } from './kit';
import s from './Firm.module.css';

type OpenState =
  | { kind: 'idle' }
  | { kind: 'opening'; name: string }
  | { kind: 'switched'; name: string }
  | { kind: 'notice'; name: string; opened: Opened }
  | { kind: 'refused'; name: string; code: string };

export function useOpenClient(p: P): { state: OpenState; open: (clientId: string, name: string) => void; clear: () => void } {
  const [state, setState] = useState<OpenState>({ kind: 'idle' });
  const ref = useRef(p);
  ref.current = p;
  const busy = useRef(false);
  const open = useCallback((clientId: string, name: string) => {
    if (busy.current) return;
    busy.current = true;
    const { rpc, live, address } = ref.current;
    setState({ kind: 'opening', name });
    void (async () => {
      try {
        let opened: Opened;
        try {
          opened = validateOpened(await rpc.request('clients.open', { clientId }));
        } catch (error) {
          if (live(address)) setState({ kind: 'refused', name, code: errorCode(error) });
          return;
        }
        if (!live(address)) return;
        try {
          validateSwitched(await rpc.request('workspaces.switch', { id: opened.workspaceId }));
          if (live(address)) setState({ kind: 'switched', name });
        } catch (error) {
          const code = errorCode(error);
          if (!live(address)) return;
          setState(NOT_BUILT.has(code) ? { kind: 'notice', name, opened } : { kind: 'refused', name, code });
        }
      } finally { busy.current = false; }
    })();
  }, []);
  const clear = useCallback(() => setState({ kind: 'idle' }), []);
  return { state, open, clear };
}

export function OpenNotice({ p, state, onClose }: { p: P; state: OpenState; onClose: () => void }) {
  const t = useT();
  if (state.kind === 'idle') return null;
  return (
    <div className={s.notice} role="status" data-open-notice={state.kind}>
      {state.kind === 'opening' && <p className={s.text}>{t('CAX-open.opening', { name: state.name })}</p>}
      {state.kind === 'switched' && <p className={s.text}>{t('CAX-open.switched', { name: state.name })}</p>}
      {state.kind === 'notice' && (
        <>
          <p className={s.text}>{t('CAX-open.fromMenu', { name: state.name, seat: seatText(state.opened.seat, p.language, t) })}</p>
          <p className={s.quiet}>{t('CAX-open.why')}</p>
        </>
      )}
      {state.kind === 'refused' && <><p className={s.text}>{t('CAX-open.refused', { name: state.name })}</p><Refusal code={state.code} /></>}
      {state.kind !== 'opening' && <span><Button variant="link" onClick={onClose}>{t('CAX-close')}</Button></span>}
    </div>
  );
}

/** "Opens inside the client": the button every per-client row carries. */
export function OpenInside({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  return <Button variant="link" onClick={onOpen}>{t('CAX-open.inside')}</Button>;
}

/** The one-time code (shown once: it is gone after Done) and the guide to forward. */
export function GuideShown({ shown, name, onDone }: { shown: ClientCode; name: string; onDone: () => void }) {
  const t = useT();
  const fileName = 'chausar-guide.html';
  return (
    <div className={s.shown} data-guide-shown="">
      <p className={s.text}>{t('CAX-guide.codeFor', { name })}</p>
      <p className={s.code} data-one-time-code="">{shown.code}</p>
      <p className={s.quiet}>{t('CAX-guide.once')}</p>
      <div className={s.actions}>
        <Button onClick={() => copyText(shown.code)}>{t('CAX-guide.copy')}</Button>
        <Button onClick={() => saveFile(fileName, shown.guide.html, 'text/html')}>{t('CAX-guide.download')}</Button>
        <Button onClick={() => window.print()}>{t('CAX-guide.print')}</Button>
      </div>
      <p className={s.quiet}>{t('CAX-guide.forward')}</p>
      {/* The guide is the engine's page, drawn in a frame that may run nothing and reach nothing. */}
      <iframe className={s.guide} title={t('CAX-guide.title', { name })} sandbox="" srcDoc={shown.guide.html} />
      <span><Button variant="filled" onClick={onDone}>{t('CAX-guide.done')}</Button></span>
    </div>
  );
}
