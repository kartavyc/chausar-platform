/**
 * Small pieces every Trust screen shares: who may change things, the page or sheet frame,
 * the outcome of a change (including the second person's confirmation), changes waiting
 * for a second person, and a destructive press that asks once more.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { Address, Language } from '../../app/presentation.ts';
import { withoutSheet } from '../../app/routes.ts';
import { count, date } from '../../format/index.ts';
import { words, type PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import { NOT_BUILT_CODES, useEngine, useSend, type Loaded, type Sent } from './kit/engine.ts';
import { Group, Screen, screenState } from './kit/Screen';
import { validateChange, validatePending, type ChangeResult, type ChangeWhat } from './validate.ts';
import { COMMON, fill } from './words.ts';
import s from './Trust.module.css';

export type P = PlaceRenderProps;

/** Owner and cofounder change rules; the owner alone deletes, withdraws and sets Send. */
export function powers(p: P): { admin: boolean; owner: boolean } {
  const role = p.member.role;
  return { admin: !p.viewer && (role === 'owner' || role === 'cofounder'), owner: !p.viewer && role === 'owner' };
}

export function bytesText(n: number | null, language: Language): string {
  const c = words(COMMON, language);
  return n === null ? c.sizeUnknown : fill(c.bytes, { n: count(String(n)) });
}
export function dayText(iso: string, language: Language): string { return date(iso.slice(0, 10), 'short', language); }
export function countText(n: number): string { return count(String(n)); }

/** Closing a sheet keeps the place and drops the sheet. Stable across renders. */
export function useClose(p: P): () => void {
  const ref = useRef<{ navigate: P['navigate']; address: Address }>({ navigate: p.navigate, address: p.address });
  ref.current = { navigate: p.navigate, address: p.address };
  return useCallback(() => ref.current.navigate(withoutSheet(ref.current.address)), []);
}

/** A rule's screen drawn as a page (enterprise sub-place) or as a sheet over Rules. */
export function Frame<T>({ p, mode, where, title, loaded, children }: { p: P; mode: 'page' | 'sheet'; where: string; title: string; loaded: Loaded<T>; children: (value: T) => ReactNode }) {
  const close = useClose(p);
  const c = words(COMMON, p.language);
  if (mode === 'page') return <Screen where={where} title={title} loaded={loaded}>{children}</Screen>;
  return (
    <Sheet kind={c.sheetRule} title={title} onClose={close} origin={null}>
      {loaded.kind === 'ready' ? <div className={s.stack}>{children(loaded.value)}</div> : <State state={screenState(loaded)} />}
    </Sheet>
  );
}

const REFUSAL_WORDS: Readonly<Record<string, 'notAllowed' | 'lockedChange' | 'invalidReply'>> = {
  FORBIDDEN: 'notAllowed', ACCESS_DENIED: 'notAllowed', PERMISSION_DENIED: 'notAllowed', NOT_ALLOWED: 'notAllowed', OWNER_ONLY: 'notAllowed',
  ROLE_FORBIDDEN: 'notAllowed', ACCESS_REVOKED: 'notAllowed', VAULT_LOCKED: 'lockedChange', WORKSPACE_LOCKED: 'lockedChange', LOCKED: 'lockedChange',
  INVALID_REPLY: 'invalidReply',
};

/** A refusal in a plain sentence for a known code, and the short code otherwise. */
export function Refusal({ code, language }: { code: string; language: Language }) {
  const c = words(COMMON, language);
  const known = NOT_BUILT_CODES.has(code) ? c.notBuiltChange : REFUSAL_WORDS[code] !== undefined ? c[REFUSAL_WORDS[code]] : null;
  return (
    <p className={s.problem} role="status">
      {known ?? c.refused} {known === null && <span className={s.mono}>{fill(c.refusedCode, { code })}</span>}
    </p>
  );
}

function isChange(value: unknown): value is ChangeResult {
  return value !== null && typeof value === 'object' && 'state' in value && 'change' in value;
}

/** What happened to the last change: saving, saved, waiting for the second person, or refused. */
export function Outcome({ sent, language }: { sent: Sent<unknown>; language: Language }) {
  const c = words(COMMON, language);
  if (sent.kind === 'idle') return null;
  if (sent.kind === 'sending') return <p className={s.quiet} role="status">{c.sending}</p>;
  if (sent.kind === 'refused') return <Refusal code={sent.code} language={language} />;
  const v = sent.value;
  if (isChange(v) && v.state === 'waiting-for-second') {
    return <p className={s.status} role="status">{v.change?.needs === 'owner' ? c.waitOwner : c.waitCofounder}</p>;
  }
  return <p className={s.quiet} role="status">{c.applied}</p>;
}

/** Changes to Send, Sharing or seats waiting for the other admin. Never a Confirm on your own change. */
export function Pending({ p, what, round, onConfirmed }: { p: P; what: readonly ChangeWhat[]; round: number; onConfirmed?: () => void }) {
  const c = words(COMMON, p.language);
  const { state, reload } = useEngine(p.rpc, 'trustx.pendingChanges', {}, validatePending, String(round));
  const { sent, send } = useSend(p.rpc, validateChange);
  const { admin } = powers(p);
  if (state.kind === 'loading' || state.kind === 'not-built') return null;
  if (state.kind !== 'ready') return <Group title={c.pendingTitle}><State state={screenState(state)} /></Group>;
  const items = state.value.filter((x) => what.includes(x.what));
  if (items.length === 0) return null;
  const confirm = async (id: string) => {
    const done = await send('trustx.confirmChange', { id });
    if (done !== null && p.live(p.address)) { reload(); onConfirmed?.(); }
  };
  return (
    <Group title={c.pendingTitle}>
      <ul className={s.list}>
        {items.map((x) => {
          const mine = x.by === p.member.id;
          return (
            <li key={x.id} className={s.item}>
              <span>{x.summary}</span>
              <span className={s.quiet}>{fill(c.pendingBy, { by: x.by, date: dayText(x.at, p.language) })} {x.needs === 'owner' ? c.needsOwner : c.needsCofounder}</span>
              {mine ? <span className={s.quiet}>{c.yourChange}</span>
                : admin && p.member.role === x.needs && <span><Button variant="quiet" onClick={() => void confirm(x.id)}>{c.confirm}</Button></span>}
            </li>
          );
        })}
      </ul>
      <Outcome sent={sent} language={p.language} />
    </Group>
  );
}

/** A press that removes or withdraws something: it asks once more, by name. */
export function AskTwice({ label, ask, confirmLabel, onConfirm, language, disabled = false }: { label: string; ask: string; confirmLabel: string; onConfirm: () => void; language: Language; disabled?: boolean }) {
  const c = words(COMMON, language);
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button variant="quiet" danger onClick={() => setAsking(true)} disabled={disabled}>{label}</Button>;
  return (
    <div className={s.ask} role="group" aria-label={ask}>
      <p>{ask}</p>
      <Button variant="quiet" danger onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</Button>
      <Button variant="link" onClick={() => setAsking(false)}>{c.cancel}</Button>
    </div>
  );
}

/** A group that loads on its own: its state is drawn inside it, the rest of the page stays. */
export function Loads<T>({ title, note, loaded, children }: { title: string; note?: string; loaded: Loaded<T>; children: (value: T) => ReactNode }) {
  return <Group title={title} note={note}>{loaded.kind === 'ready' ? children(loaded.value) : <State state={screenState(loaded)} />}</Group>;
}

/** A small text tag in the number face, such as "cost" or "example". */
export function Tag({ children }: { children: ReactNode }) { return <span className={s.tag}>{children}</span>; }
