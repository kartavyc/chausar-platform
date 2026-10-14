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
import { validateInvite, validatePending, type ChangeResult, type InviteResult } from './validate.ts';
import { COMMON, PEOPLE, fill } from './words.ts';
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

type CommonWord = keyof typeof COMMON.en;
/** Codes this lane and the lanes it draws over refuse with, each with its plain sentence. */
const REFUSAL_WORDS: Readonly<Record<string, CommonWord>> = {
  FORBIDDEN: 'notAllowed', ACCESS_DENIED: 'notAllowed', PERMISSION_DENIED: 'notAllowed', NOT_ALLOWED: 'notAllowed', OWNER_ONLY: 'notAllowed',
  ROLE_FORBIDDEN: 'notAllowed', ACCESS_REVOKED: 'notAllowed', VAULT_LOCKED: 'lockedChange', WORKSPACE_LOCKED: 'lockedChange', LOCKED: 'lockedChange',
  INVALID_REPLY: 'invalidReply', OWNER_REQUIRED: 'ownerRequired', SECOND_PERSON_REQUIRED: 'secondPerson', TAINTED_APPROVAL: 'taintedApproval',
  APP_CONSENT_REQUIRED: 'appOnly', APP_APPROVAL_REQUIRED: 'appOnly', OPEN_DESKTOP: 'appOnly', PREVIEW_NOT_FOUND: 'previewGone', MODEL_RECEIPT_EXPIRED: 'previewGone',
  PREVIEW_STALE: 'previewStale', SHARING_DISABLED: 'sharingOff', BOX_NOT_OPEN: 'boxClosed', NOTHING_TO_SHARE: 'nothingToShare', PREVIEW_CHANGED: 'previewChanged',
  SHARING_BLOCKED: 'sharingBlocked', CONSENT_REQUIRED: 'consentRequired', INTAKE_NOT_OPEN: 'intakeClosed', DELETE_UNKNOWN: 'deleteUnknown',
  SESSION_SCOPE_FORBIDDEN: 'sessionScope', COOLING_OFF: 'coolingOff', SELF_CONFIRM: 'selfConfirm', CHANGE_NEEDS_OTHER: 'needsOther',
  INVALID_PUBLIC_NAME: 'badPublicName', BATCH_NOT_SENT: 'batchNotSent', EMPTY_FILE: 'emptySample', DEMO_EXTERNAL_DISABLED: 'demoOff',
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
  if (isChange(v) && v.state === 'declined') return <p className={s.status} role="status">{c.declined}</p>;
  return <p className={s.quiet} role="status">{c.applied}</p>;
}

/** Changes to Send, Sharing or seats waiting for the other admin. Never a Confirm on your own change. */
export function Pending({ p, what, round, onConfirmed }: { p: P; what: readonly string[]; round: number; onConfirmed?: () => void }) {
  const c = words(COMMON, p.language);
  const { state, reload } = useEngine(p.rpc, 'trustx.pendingChanges', {}, validatePending, String(round));
  // A confirmed invite carries its one-time code: validate it as an invite so the code is shown once.
  const { sent, send } = useSend(p.rpc, validateInvite);
  const [shown, setShown] = useState<InviteResult | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const { admin } = powers(p);
  if (state.kind === 'loading' || state.kind === 'not-built') return shown === null ? null : <Group title={c.pendingTitle}><InviteShown p={p} shown={shown} /></Group>;
  if (state.kind !== 'ready') return <Group title={c.pendingTitle}><State state={screenState(state)} /></Group>;
  const items = state.value.filter((x) => what.includes(x.what));
  if (items.length === 0 && shown === null) return null;
  const confirm = async (id: string) => {
    setSaid(null);
    const done = await send('trustx.confirmChange', { id });
    if (done !== null && p.live(p.address)) { if (done.invite !== null || done.guide !== null) setShown(done); reload(); onConfirmed?.(); }
  };
  // The needed person declines, or the author withdraws: the same request with `decline: true`.
  const decline = async (id: string, mine: boolean) => {
    setSaid(null);
    const done = await send('trustx.confirmChange', { id, decline: true });
    if (done !== null && p.live(p.address)) { setSaid(mine ? c.withdrawnChange : c.declined); reload(); }
  };
  if (items.length === 0 && shown !== null) return <Group title={c.pendingTitle}><InviteShown p={p} shown={shown} /></Group>;
  return (
    <Group title={c.pendingTitle}>
      <ul className={s.list}>
        {items.map((x) => {
          const mine = x.by === p.member.id;
          const busy = sent.kind === 'sending';
          // Removing the only cofounder waits 72 hours for them; after that the owner who asked may confirm it alone.
          const ownLate = mine && admin && p.member.role === 'owner' && x.coolsOffAt !== null;
          return (
            <li key={x.id} className={s.item}>
              <span>{x.summary}</span>
              <span className={s.quiet}>{fill(c.pendingBy, { by: x.by, date: dayText(x.at, p.language) })} {x.needs === 'owner' ? c.needsOwner : c.needsCofounder}</span>
              {mine && <span className={s.quiet}>{c.yourChange}</span>}
              {mine && admin && (
                <span className={s.line}>
                  <Button variant="quiet" disabled={busy} onClick={() => void decline(x.id, true)}>{c.withdrawChange}</Button>
                  {ownLate && <Button variant="quiet" disabled={busy} onClick={() => void confirm(x.id)}>{c.confirmOwn}</Button>}
                </span>
              )}
              {!mine && admin && p.member.role === x.needs && (
                <span className={s.line}>
                  <Button variant="quiet" disabled={busy} onClick={() => void confirm(x.id)}>{c.confirm}</Button>
                  <Button variant="quiet" danger disabled={busy} onClick={() => void decline(x.id, false)}>{c.decline}</Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {said !== null ? <p className={s.status} role="status">{said}</p> : <Outcome sent={sent} language={p.language} />}
      {shown !== null && <InviteShown p={p} shown={shown} />}
    </Group>
  );
}

/** The one-time invite code and, for an accountant, the guide: shown as text, never as markup. */
export function InviteShown({ p, shown }: { p: P; shown: InviteResult }) {
  const w = words(PEOPLE, p.language);
  const saveGuide = (html: string) => {
    if (typeof URL.createObjectURL !== 'function') return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    link.download = 'chausar-accountant-guide.html';
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <>
      {shown.invite !== null && (
        <div className={s.stack} data-invite-code="">
          <span className={s.label}>{w.code}</span>
          <span className={s.code}>{shown.invite.token}</span>
          <p className={s.status}>{w.codeOnce} {fill(w.expires, { date: dayText(shown.invite.expiresAt, p.language) })}</p>
        </div>
      )}
      {shown.guide !== null && (
        <div className={s.stack}>
          <span className={s.label}>{w.guideTitle}</span>
          <p className={s.quiet}>{w.guideNote}</p>
          <pre className={s.pre} data-guide="">{shown.guide.html}</pre>
          <span><Button variant="quiet" onClick={() => shown.guide !== null && saveGuide(shown.guide.html)}>{w.guideSave}</Button></span>
        </div>
      )}
    </>
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
