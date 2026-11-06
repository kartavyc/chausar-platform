import { useEffect, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { AmountsText } from '../../parts/AmountsText';
import { Button } from '../../parts/Button';
import { refusalWords } from '../../parts/custody';
import { ownerLineOf, toPlainMessage } from '../../parts/draft-text';
import { useLocalToday } from '../../parts/when';
import { Sheet } from '../../parts/Sheet';
import type { SheetComponentProps } from '../../shell/sheets';
import type { QueueAction, QueueActionId, QueueRow } from '../../engine/types';
import { copyText, performHandoff } from '../clients/handoff';
import { reserveTab } from '../connections/external';
import { draftEditable, draftRunOf, failedChecks, UndoButton } from '../today/SendBack';
import { decide, undoOf, useTodaySession } from '../today/session';
import { practiceDraft } from './practice-drafts';
import { workChanged } from './refresh';
import s from './Work.module.css';

/** The longest link a phone or a mail app takes whole; a longer message is copied for the owner to paste. */
const LINK_MAX = 1800;
const everyEvent = () => true;

/**
 * One-shot C4 task 13: a draft on Work, sheet `draft:<run id>`: the draft as the message the client gets, its checks, and
 * what can be done with it by its state. Waiting: Approve and Reject (through Today's session, so Today shows the same
 * line) and Edit. Failed a check: Edit in Work opens the editor here, since Today's card holds no Approve. Approved: Copy
 * text, Share on WhatsApp and Email, and Mark delivered. Nothing goes out from Chausar: WhatsApp and Email open the
 * owner's own app with the text, Copy puts it on the clipboard, and Mark delivered records what the owner says they did.
 * A practice draft reads the same and offers none of it.
 */
export function DraftSheet(props: SheetComponentProps) {
  return props.id.startsWith('practice:') ? <RehearsalDraft {...props} /> : <RunDraft {...props} />;
}

/** C4 task 17: a practice client's draft from a rehearsal: it reads the same, with what failed, and nothing to do with it. */
function RehearsalDraft({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const draft = practiceDraft(useEngine(), id);
  if (!draft) return <Sheet label={t('work.draft.label')} title={t('work.draft.gone')} onClose={onClose} returnFocus={returnFocus} />;
  const failed = draft.checks.filter((check) => !check.passed && !check.notChecked);
  return (
    <Sheet label={t('work.draft.label')} eyebrow={draft.client} title={t('today.edit.title')} onClose={onClose} returnFocus={returnFocus}>
      <p className={s.draftLine} data-draft-practice="">{t('work.draft.practice')}</p>
      <div className={s.draftMessage} data-content="" data-draft-message="">{toPlainMessage(draft.text)}</div>
      {failed.length > 0 && (
        <ul className={s.draftChecks} data-draft-checks="">
          {failed.map((check) => <li key={check.check} className={s.failure} data-check="failed">{check.detail}</li>)}
        </ul>
      )}
    </Sheet>
  );
}

function RunDraft({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const client = useEngine();
  const session = useTodaySession();
  const today = useLocalToday();
  const drafts = useResource('venture.delivery.list', {}, { refreshOn: everyEvent });
  const queue = useResource('venture.queue.list', { scope: 'all' }, { refreshOn: everyEvent });
  const orders = useResource('venture.order.list', {}, { refreshOn: everyEvent });
  const clients = useResource('venture.client.list', {});
  // The sheet is the owner opening it, so the engine keeps its view mark, as on Today.
  const view = useResource('venture.queue.view', { kind: 'draft', id, opened: true }, { skip: !id });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ line: string; problem?: boolean } | null>(null);
  const [asking, setAsking] = useState<{ label: string; run: () => void } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) cancelRef.current?.focus(); }, [asking]);

  const run = drafts.data?.find((item) => item.id === id);
  const row: QueueRow | undefined = queue.data?.rows.find((item) => draftRunOf(item) === id);
  const decided = session.lines().filter((line) => line.row.viewRef?.kind === 'draft' && line.row.viewRef.id === id).at(-1);
  const undo = decided ? undoOf(decided, queue.data?.rows ?? []) : undefined;
  if (!run) {
    return <Sheet label={t('work.draft.label')} title={drafts.data ? t('work.draft.gone') : t('sheet.loading')} onClose={onClose} returnFocus={returnFocus} />;
  }

  const order = orders.data?.find((item) => item.id === run.orderId);
  const who = clients.data?.find((item) => item.id === order?.clientId);
  const text = run.editedText ?? run.renderedText ?? null;
  const message = text === null ? null : toPlainMessage(text);
  const practice = run.practiceNow === true || run.practice === true;
  const approved = !practice && (run.status === 'accepted' || run.status === 'edited');
  const delivered = order?.status === 'delivered' || (order?.deliveredOn ?? null) !== null;
  const failed = failedChecks(run);
  const passed = (run.checks ?? []).filter((check) => check.passed && !check.notChecked).length;
  const notChecked = (run.checks ?? []).filter((check) => check.notChecked).length;
  const action = (kind: QueueActionId): QueueAction | undefined => row?.actions.find((item) => item.id === kind);
  const approve = action('approve');
  // The engine takes a Reject on any draft waiting for review, also when its row lists Read and Approve only (views/queue.ts).
  const deny = action('deny') ?? (approve && draftRunOf(row!) ? { id: 'deny' as const, label: t('work.draft.reject'), primary: false } : undefined);
  const editable = !!row && !practice && text !== null && draftEditable(row, run);

  const reload = () => { drafts.reload(); queue.reload(); orders.reload(); workChanged(); };

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setSaid(null);
    setAsking(null);
    try { await work(); } catch (error) { setSaid({ line: refusalWords(error, t), problem: true }); }
    setBusy(false);
  }

  const choose = (kind: QueueActionId) => act(async () => {
    const decision = await decide(client, row!, kind, { viewed: true }, t);
    if (decision.outcome !== 'done') setSaid({ line: decision.outcome === 'stale' ? t('approval.staleClick') : decision.line, problem: decision.outcome !== 'stale' });
    reload();
  });

  /** Asks once more when the engine says this action does, as Today's card and the order card do. */
  const press = (item: QueueAction) => { if (item.secondAsk) setAsking({ label: item.label, run: () => void choose(item.id) }); else void choose(item.id); };

  const copy = () => act(async () => {
    setSaid(await copyText(message ?? '') ? { line: t('work.draft.copied') } : { line: t('work.draft.cantCopy'), problem: true });
  });

  /** Opens the owner's own app with the text. A message too long for one link is copied for them to paste there. */
  const open = (handoff: Parameters<typeof performHandoff>[0], tab: Window | null) => act(async () => {
    try {
      const url = 'url' in handoff ? handoff.url : '';
      if (url.length > LINK_MAX) {
        tab?.close();
        setSaid(await copyText(message ?? '') ? { line: t('work.draft.tooLong') } : { line: t('work.draft.cantCopy'), problem: true });
        return;
      }
      await performHandoff(handoff, tab);
      setSaid({ line: t('work.draft.opened') });
    } catch (error) { tab?.close(); throw error; }
  });

  const whatsapp = () => {
    // A web tab is reserved inside the click. C6 task 3 adds the client's phone to this link.
    let tab: Window | null = null;
    try { tab = reserveTab(); } catch (error) { setSaid({ line: refusalWords(error, t), problem: true }); return; }
    void open({ action: 'whatsapp', url: `https://wa.me/?text=${encodeURIComponent(message ?? '')}`, line: '' }, tab);
  };
  const email = () => {
    const to = who?.email ? encodeURIComponent(who.email).replace(/%40/g, '@') : '';
    void open({ action: 'mailto', url: `mailto:${to}?subject=${encodeURIComponent(run.deliverable?.title ?? t('today.edit.title'))}&body=${encodeURIComponent(message ?? '')}`, line: '' }, null);
  };
  const deliver = () => act(async () => {
    await client.request('venture.order.deliver', { orderId: run.orderId, deliveredOn: today() });
    reload();
  });

  const ownerLine = text === null ? null : ownerLineOf(text);
  return (
    <Sheet
      label={t('work.draft.label')}
      eyebrow={who?.name}
      title={run.deliverable?.title ?? t('today.edit.title')}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {decided && <p className={s.draftLine} role="status" data-sheet-decided="">{decided.line}{undo && <UndoButton row={decided.row} undo={undo} />}</p>}
      {practice && <p className={s.draftLine} data-draft-practice="">{t('work.draft.practice')}</p>}
      {ownerLine && <p className={s.draftNote} data-engine-line="">{ownerLine}</p>}
      {message === null
        ? <p className={s.draftNote}>{t('work.draft.noText')}</p>
        : <div className={s.draftMessage} data-content="" data-draft-message=""><AmountsText text={message} amounts={view.data?.amounts ?? []} /></div>}
      {(failed.length > 0 || passed > 0 || notChecked > 0) && (
        <div data-draft-checks="">
          {failed.length > 0 && (
            <ul className={s.draftChecks}>
              {failed.map((check) => <li key={check.id} className={s.failure} data-check="failed">{check.detail}</li>)}
            </ul>
          )}
          {passed > 0 && <p className={s.draftNote} data-check="passed">{t('work.draft.passed', { count: passed })}</p>}
          {notChecked > 0 && <p className={s.draftNote} data-check="not-checked">{t('work.draft.notChecked', { count: notChecked })}</p>}
        </div>
      )}
      {said && <p className={said.problem ? s.problem : s.draftLine} role="status">{said.line}</p>}
      {asking ? (
        <div className={s.confirm}>
          <p className={s.ask}>{t('approval.secondAsk', { action: asking.label })}</p>
          <Button ref={cancelRef} onClick={() => setAsking(null)}>{t('approval.cancel')}</Button>
          <Button variant="primary" data-confirm="" disabled={busy} onClick={asking.run}>{asking.label}</Button>
        </div>
      ) : (
        <div className={s.draftActs}>
          {editable && (
            <Button variant="quiet" disabled={busy} onClick={(event) => openSheet('edit-draft', row!.id, event.currentTarget)}>
              {t(approve ? 'today.edit.open' : 'work.draft.editHere')}
            </Button>
          )}
          {!practice && deny && <Button disabled={busy} onClick={() => press(deny)}>{deny.label}</Button>}
          {!practice && approve && <Button variant="primary" disabled={busy} onClick={() => press(approve)}>{approve.label}</Button>}
          {approved && message !== null && (
            <>
              <Button disabled={busy} onClick={() => void copy()}>{t('work.draft.copy')}</Button>
              <Button disabled={busy} onClick={whatsapp}>{t('work.draft.whatsapp')}</Button>
              <Button disabled={busy} onClick={email}>{t('work.draft.email')}</Button>
            </>
          )}
          {approved && !delivered && (
            <Button variant="primary" disabled={busy} onClick={() => setAsking({ label: t('work.deliver'), run: () => void deliver() })}>{t('work.deliver')}</Button>
          )}
        </div>
      )}
    </Sheet>
  );
}
