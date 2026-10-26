import { useEffect, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { refusalWords } from '../../parts/custody';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import type { SheetComponentProps } from '../../shell/sheets';
import type { DraftChangeView, DraftChangesView, QueueRow } from '../../engine/types';
import { useTodaySession } from './session';
import { draftRunOf, undoFor } from './SendBack';
import s from './TodayActions.module.css';

/**
 * W4 4J19 (O6): a draft's own text, open for the owner to edit (sheet `edit-draft:<row id>`). Save is venture.queue.edit:
 * No and reopen, with the owner's text kept as their edit, so the draft waits for their review again with their words
 * and a later revision never overwrites them (Undo puts it back until it moves on). When the agent revised a draft, its
 * paragraph changes are listed to take or drop (venture.delivery.changes and decideChange); when the owner had their
 * own version, the agent's new one sits beside it: "Review replacement", then "Confirm replacement" (which does not
 * merge the entries) or "Keep current, reject change". The text is the owner's or the agent's own words, quoted.
 */
export function EditSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const client = useEngine();
  const session = useTodaySession();
  const queue = useResource('venture.queue.list', { scope: 'all' });
  // The version the owner edits: the row the sheet opened, then the engine's latest after a stale save (it may come back
  // under a new version id), kept here so a refresh of the list never loses it.
  const [target, setTarget] = useState<QueueRow | null>(null);
  const listed = queue.data?.rows.find((item) => item.id === id);
  const [held, setHeld] = useState<QueueRow | null>(null);
  useEffect(() => { if (listed && !held) setHeld(listed); }, [listed, held]);
  const row = target ?? held ?? listed;
  const runId = row ? draftRunOf(row) : null;
  const drafts = useResource('venture.delivery.list', {}, { skip: !runId });
  const run = drafts.data?.find((item) => item.id === runId);
  const changes = useResource('venture.delivery.changes', { runId: runId ?? '' }, { skip: !run });
  const [shown, setShown] = useState<DraftChangesView | undefined>();
  const original = run?.editedText ?? run?.renderedText ?? null;
  const [text, setText] = useState<string | null>(null);
  const [said, setSaid] = useState<{ line: string; problem?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  // W4 4J19 review: the draft changed under the owner's edit. The newer version is read again and shown; Save waits
  // until the owner has looked at it, so their words never land blindly on text they have not seen.
  // A failed read leaves `text` null: Save stays locked and Try again reads it once more.
  const [newer, setNewer] = useState<{ text: string | null; seen: boolean } | null>(null);

  useEffect(() => { if (original !== null && text === null) setText(original); }, [original, text]);
  useEffect(() => { if (changes.data) setShown(changes.data); }, [changes.data]);

  const title = row?.title ?? t('today.edit.title');
  if (!row || !runId) {
    const missing = queue.data !== undefined;
    return (
      <Sheet label={t('today.edit.label')} title={missing ? t('today.edit.gone') : t('sheet.loading')} onClose={onClose} returnFocus={returnFocus} />
    );
  }

  async function save() {
    if (!row || text === null || (newer && !newer.seen)) return;
    setBusy(true);
    setSaid(null);
    session.begin(row.id);
    try {
      const decision = await client.request('venture.queue.edit', { rowId: row.id, digest: row.digest, text });
      if (decision.outcome === 'done') {
        session.keep(row, decision.line, decision.receiptId, true, undoFor(client, row.id));
        onClose();
        return;
      }
      setSaid({ line: decision.outcome === 'stale' ? t('approval.staleClick') : decision.line, problem: decision.outcome !== 'stale' });
      if (decision.outcome === 'stale') {
        // Save against the engine's latest version from now on, and read its text again before the owner may save:
        // "I've read it" shows only with the reloaded text, never the text the owner was editing over.
        if (decision.latest) setTarget(decision.latest);
        await readNewer();
        drafts.reload();
      }
      queue.reload();
    } catch (error) {
      setSaid({ line: refusalWords(error, t), problem: true });
    } finally {
      session.end(row.id);
      setBusy(false);
    }
  }

  async function readNewer() {
    setNewer(null);
    try {
      const fresh = await client.request('venture.delivery.list', {});
      const latestRun = fresh.find((item) => item.id === runId);
      setNewer({ text: latestRun?.editedText ?? latestRun?.renderedText ?? null, seen: false });
    } catch {
      setNewer({ text: null, seen: false });
    }
  }

  async function decide(changeId: string, accept: boolean) {
    if (!runId) return;
    setBusy(true);
    setSaid(null);
    try {
      setShown(await client.request('venture.delivery.decideChange', { runId, changeId, accept }));
      setReviewing(false);
      drafts.reload();
      queue.reload();
    } catch (error) {
      setSaid({ line: refusalWords(error, t), problem: true });
    } finally {
      setBusy(false);
    }
  }

  const open = (shown?.changes ?? []).filter((change) => change.status === 'open');
  const replacement = shown?.replacement;
  return (
    <Sheet
      label={t('today.edit.label')}
      eyebrow={row.agent ? `${row.businessName} · ${row.agent}` : row.businessName}
      title={title}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {shown?.line && (
        <section className={s.merge} data-merge="">
          <p className={s.mergeLine}>{shown.line}</p>
          {replacement && replacement.status === 'open' && !reviewing && (
            <Button size="sm" onClick={() => setReviewing(true)}>{t('today.edit.reviewReplacement')}</Button>
          )}
          {replacement && reviewing && (
            <div className={s.replace} data-replacement="">
              <ChangeList changes={shown.changes} />
              <p className={s.confirmLine}>{t('today.edit.confirmLine')}</p>
              <div className={s.boxButtons}>
                <Button disabled={busy} onClick={() => void decide(replacement.id, false)}>{t('today.edit.keep')}</Button>
                <Button disabled={busy} onClick={() => void decide(replacement.id, true)}>{t('today.edit.confirm')}</Button>
              </div>
            </div>
          )}
          {!reviewing && open.length > 0 && (
            <ChangeList changes={open} onDecide={busy ? undefined : (change, accept) => void decide(change.id, accept)} />
          )}
        </section>
      )}
      {original === null && drafts.data && <p className={s.problem}>{t('today.edit.noText')}</p>}
      {newer !== null && (
        <section className={s.merge} data-new-version="">
          {newer.text === null ? (
            <>
              <p className={s.problem}>{t('today.edit.newerMissing')}</p>
              <div className={s.boxButtons}>
                <Button size="sm" disabled={busy} onClick={() => void readNewer()}>{t('today.edit.readAgain')}</Button>
              </div>
            </>
          ) : (
            <>
              <p className={s.mergeLine}>{t('today.edit.newer')}</p>
              <div className={s.newerText} data-content="">{newer.text}</div>
              {!newer.seen && (
                <div className={s.boxButtons}>
                  <Button size="sm" onClick={() => { setNewer({ ...newer, seen: true }); setSaid(null); }}>{t('today.edit.seen')}</Button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      {text !== null && (
        <form className={s.boxForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <Field multiline rows={10} label={t('today.edit.text')} value={text} onChange={(event) => setText(event.currentTarget.value)} />
          <p className={s.hint}>{t('today.edit.hint')}</p>
          <div className={s.boxButtons}>
            <Button onClick={onClose}>{t('approval.cancel')}</Button>
            <Button
              variant="primary" type="submit" disabled={busy || !text.trim() || text === original}
              locked={newer !== null && !newer.seen} lockedReason={t('today.edit.readNewer')}
            >
              {t('today.edit.save')}
            </Button>
          </div>
        </form>
      )}
      {said && <p className={said.problem ? s.problem : s.said} role="status">{said.line}</p>}
    </Sheet>
  );
}

/** Paragraph changes, before and after, each quoted; open ones can be taken or dropped. */
function ChangeList({ changes, onDecide }: { changes: readonly DraftChangeView[]; onDecide?: ((change: DraftChangeView, accept: boolean) => void) | undefined }) {
  const t = useT();
  return (
    <ul className={s.changes}>
      {changes.map((change) => (
        <li key={change.id} className={s.changeItem} data-change-status={change.status}>
          <p className={s.changeBy}>{t(change.by === 'owner' ? 'today.edit.byYou' : 'today.edit.byAgent', { n: String(change.paragraph + 1) })}</p>
          {change.before && <del className={s.before} data-content="">{change.before}</del>}
          {change.after && <ins className={s.after} data-content="">{change.after}</ins>}
          {onDecide && change.status === 'open' && (
            <div className={s.boxButtons}>
              <Button size="sm" onClick={() => onDecide(change, false)}>{t('today.edit.drop')}</Button>
              <Button size="sm" onClick={() => onDecide(change, true)}>{t('today.edit.take')}</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
