import { useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { refusalWords } from '../../parts/custody';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { ApprovalToolsApi } from '../../parts/ApprovalRow';
import type { DeliveryLite, QueueDecision, QueueRow } from '../../engine/types';
import { useTodaySession } from './session';
import { useTodayDrafts } from './drafts';
import s from './TodayActions.module.css';

/** The most characters the owner's words may have (delivery/revise.ts SEND_BACK_MAX). */
export const SEND_BACK_MAX = 300;

/** A draft waiting for the owner's review on Today: its run id, or null for any other row. */
export function draftRunOf(row: QueueRow): string | null {
  return row.kind === 'draft' && row.viewRef?.kind === 'draft' && row.actions.some((action) => action.id === 'approve') ? row.viewRef.id : null;
}

/** The checks that failed on a draft, each by the id venture.delivery.fix takes, with the engine's words. */
export function failedChecks(run: DeliveryLite | undefined): { id: string; detail: string }[] {
  if (!run) return [];
  return [
    ...(run.checks ?? []).filter((check) => !check.passed && !check.notChecked).map((check) => ({ id: check.check, detail: check.detail })),
    ...(run.playbookChecks ?? []).filter((check) => check.outcome === 'fail').map((check) => ({ id: `${check.playbook}:${check.check}`, detail: check.detail })),
  ];
}

/** Take back a send back or an edit made on this row (venture.queue.undo): the engine's line, or its refusal. */
export function undoFor(client: ReturnType<typeof useEngine>, rowId: string): () => Promise<string> {
  return async () => (await client.request('venture.queue.undo', { rowId })).line;
}

/**
 * W4 4J19 (O5, O6): a draft card's own tools under its buttons. "Send back" opens a box prefilled "Revise this to "
 * whose words go to the agent as a revision (venture.queue.sendBack); after failed checks it asks "Fix all, or tell me
 * which?" and a pick calls venture.delivery.fix. "Edit" opens the draft's own text in the edit sheet. When the agent
 * revised a draft the owner had edited, the card says so in the engine's words and opens the changes. The owner's words
 * are sent as typed; nothing is added to them.
 */
export function DraftTools({ api }: { api: ApprovalToolsApi }) {
  const t = useT();
  const client = useEngine();
  const session = useTodaySession();
  const { row } = api;
  const runId = draftRunOf(row);
  // Today reads the drafts and their changes once for every card (drafts.tsx).
  const drafts = useTodayDrafts(Boolean(runId));
  const run = drafts.runs?.find((item) => item.id === runId);
  const changes = runId ? drafts.changes.get(runId) : undefined;
  // The words a send back starts with, in the owner's language ("Revise this to "); the engine's revision turn then
  // begins "Revise this to: ..." with them (delivery/revise.ts). Only those words is nothing to send yet.
  const prefill = t('today.sendBack.prefill');
  const [text, setText] = useState(prefill);
  const [problem, setProblem] = useState<string>();
  const [picked, setPicked] = useState<readonly string[]>([]);
  if (!runId) return null;
  const failed = failedChecks(run);
  const editable = typeof (run?.editedText ?? run?.renderedText) === 'string';
  const open = api.open;

  function close() {
    api.setOpen(false);
    setProblem(undefined);
    setText(prefill);
    setPicked([]);
  }

  /** A decision taken here: kept on Today as the card's line, with Undo while its revision has not started. */
  function settle(decision: QueueDecision, undo?: () => Promise<string>) {
    if (decision.outcome === 'done') session.keep(row, decision.line, decision.receiptId, true, undo);
    api.finish(decision, undo);
  }

  async function sendBack() {
    setProblem(undefined);
    session.begin(row.id);
    try {
      const decision = await client.request('venture.queue.sendBack', { rowId: row.id, digest: row.digest, text });
      settle(decision, decision.outcome === 'done' ? undoFor(client, row.id) : undefined);
      if (decision.outcome !== 'done') api.setOpen(false);
    } catch (error) {
      setProblem(refusalWords(error, t));
    } finally {
      session.end(row.id);
    }
  }

  async function fix(checks: 'all' | string[]) {
    setProblem(undefined);
    session.begin(row.id);
    try {
      await client.request('venture.delivery.fix', { runId: runId!, checks });
      settle({ outcome: 'done', line: t('today.sendBack.fixing') });
    } catch (error) {
      setProblem(refusalWords(error, t));
    } finally {
      session.end(row.id);
    }
  }

  const merged = changes?.line;
  if (!open) {
    return (
      <div className={s.tools} data-draft-tools="">
        {merged && (
          <p className={s.merged} data-merged="">
            {merged}{' '}
            <Button variant="quiet" size={api.size} onClick={(event) => openSheet('edit-draft', row.id, event.currentTarget)}>{t('today.edit.review')}</Button>
          </p>
        )}
        <div className={s.toolButtons}>
          <Button variant="quiet" size={api.size} disabled={api.busy} onClick={() => api.setOpen(true)}>{t('today.sendBack.open')}</Button>
          {editable && <Button variant="quiet" size={api.size} disabled={api.busy} onClick={(event) => openSheet('edit-draft', row.id, event.currentTarget)}>{t('today.edit.open')}</Button>}
        </div>
      </div>
    );
  }

  return (
    <div className={s.box} data-send-back="" data-no-swipe="">
      <form onSubmit={(event) => { event.preventDefault(); void sendBack(); }} className={s.boxForm}>
        <Field
          multiline
          label={t('today.sendBack.label')}
          hint={t('today.sendBack.hint', { max: String(SEND_BACK_MAX) })}
          value={text}
          maxLength={SEND_BACK_MAX}
          onChange={(event) => setText(event.currentTarget.value)}
          autoFocus
        />
        {problem && <p className={s.problem} role="status">{problem}</p>}
        <div className={s.boxButtons}>
          <Button size={api.size === 'xl' ? 'xl' : undefined} onClick={close}>{t('approval.cancel')}</Button>
          <Button size={api.size === 'xl' ? 'xl' : undefined} variant="primary" type="submit" disabled={api.busy || !text.trim() || text.trim() === prefill.trim()}>{t('today.sendBack.send')}</Button>
        </div>
      </form>
      {failed.length > 0 && (
        <fieldset className={s.fix} data-fix="">
          <legend className={s.fixHead}>{t('today.sendBack.fixAsk')}</legend>
          {failed.map((check) => (
            <label key={check.id} className={s.fixCheck}>
              <input
                type="checkbox"
                checked={picked.includes(check.id)}
                onChange={(event) => { const on = event.currentTarget.checked; setPicked((now) => (on ? [...now, check.id] : now.filter((id) => id !== check.id))); }}
              />
              <span>{check.detail}</span>
            </label>
          ))}
          <div className={s.boxButtons}>
            <Button size={api.size === 'xl' ? 'xl' : undefined} disabled={api.busy} onClick={() => void fix('all')}>{t('today.sendBack.fixAll')}</Button>
            <Button size={api.size === 'xl' ? 'xl' : undefined} disabled={api.busy || picked.length === 0} onClick={() => void fix([...picked])}>{t('today.sendBack.fixPicked', { count: String(picked.length) })}</Button>
          </div>
        </fieldset>
      )}
    </div>
  );
}

/** The tools a Today card offers, or none: only a draft waiting for review is sent back or edited from Today. */
export function draftToolsFor(row: QueueRow): ((api: ApprovalToolsApi) => ReactNode) | undefined {
  return draftRunOf(row) ? (api) => <DraftTools api={api} /> : undefined;
}

/**
 * Undo on a decided card's line (Today's Decided): takes back a send back or an edit made here (venture.queue.undo);
 * the line then says what the engine promises, "Restored until you edit this again.", or why it could not.
 */
export function UndoButton({ row, undo, phone = false }: { row: QueueRow; undo: () => Promise<string>; phone?: boolean }) {
  const t = useT();
  const session = useTodaySession();
  const [busy, setBusy] = useState(false);
  async function press() {
    setBusy(true);
    try {
      session.keep(row, await undo());
    } catch (error) {
      session.keep(row, refusalWords(error, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {' '}
      {/* On a phone as large as every other button there (a full touch target). */}
      <Button variant="quiet" size={phone ? 'xl' : 'sm'} data-undo="" disabled={busy} onClick={() => void press()}>{t('approval.undo')}</Button>
    </>
  );
}

/**
 * A needs-you probe's notice (W4 4G2): its Open goes to the screen the engine names (row.notice.link, an address such as
 * #/connections). It is not a decision and never opens a locked business. Returns true when it handled the press.
 */
export function openNotice(row: QueueRow, action: { id: string }): boolean {
  if (!row.notice || action.id !== 'open') return false;
  const link = row.notice.link;
  window.location.hash = link.startsWith('#') ? link : `#${link.startsWith('/') ? link : `/${link}`}`;
  return true;
}
