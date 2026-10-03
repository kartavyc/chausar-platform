/**
 * ApprovalSheet: one exact change, built only from the prepared request the engine sent.
 *   1. What it is, in plain words.            4. The five steps on a line.
 *   2. The target.                            5. One note: what changes, what does not, expiry.
 *   3. The exact change: the text as it will  6. Approve and Not now; Change and Drop as links.
 *      go, or before and after.
 * Rules kept here. Each is decided from the approval's own state and the engine's offers;
 * a callback being supplied never makes an action available.
 * - A button appears only when the engine offered it in `can`.
 * - Approve, Not now, Change and Drop exist only while the action is `prepared`. Once it
 *   is approved, running, finished or stopped, there is nothing here to change.
 * - Money asks again, always. An approval of kind `money`, or one that says it needs the
 *   second ask, marks its primary as `money`: Ctrl Enter never runs it and the press goes
 *   to `onSecondAsk`, never straight to approve. Either sign is enough on its own, so an
 *   approval that says `money` and also says the second ask is not needed still asks.
 * - Prepare only (a tax filing) has no Approve; it offers the file and the checklist.
 * - An unknown result cannot be sent again or changed. It offers the check, and only when
 *   the engine offered `reconcile` for an action whose state is `unknown`.
 * - Read only: no mutation control at all.
 */

import type { ReactNode } from 'react';
import type { Approval, ApprovalAction } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Sheet, type SheetPrimary } from '../parts/Sheet';
import { Button } from '../parts/Button';
import { KeyValue } from '../parts/KeyValue';
import { Steps } from '../parts/Steps';
import s from './ApprovalSheet.module.css';

export interface ApprovalSheetProps {
  approval: Approval;
  position?: { index: string; total: string } | undefined;
  origin: HTMLElement | null;
  onClose: () => void;
  onAdjacent?: ((delta: -1 | 1) => void) | undefined;
  /** Who holds the pen, when the adapter knows. Read only itself comes from the approval. */
  readOnly?: { holder: string } | undefined;
  onApprove: (approvalId: string) => void;
  /** Money: the ask the trusted host makes. Approve only after this succeeds. */
  onSecondAsk: (approvalId: string) => void;
  onNotNow: (approvalId: string) => void;
  onChange?: ((approvalId: string) => void) | undefined;
  onDrop?: ((approvalId: string) => void) | undefined;
  onDownloadPrepared?: ((approvalId: string) => void) | undefined;
  onCheckUnknown?: ((approvalId: string, result: 'check' | 'was-sent' | 'was-not-sent') => void) | undefined;
  /** Opens the receipt behind a figure; the sheet's content is replaced by the parent. */
  onReceipt: (receiptId: string) => void;
  /** Deeper content shown instead of the approval, with a way back. */
  deeper?: { label: string; onBack: () => void; content: ReactNode } | undefined;
}

export function ApprovalSheet(p: ApprovalSheetProps) {
  const t = useT();
  const a = p.approval;

  const readOnly = a.readOnly || p.readOnly !== undefined;
  const prepareOnly = a.prepareOnly || a.kind === 'prepare-only';
  const money = a.kind === 'money' || a.needsSecondAsk;
  /* Not sure what happened: the state says so, or a step does. Either stops every change. */
  const unsure = a.state === 'unknown' || a.steps.some((st) => st.state === 'unsure');
  const writable = !readOnly && !a.blocked;
  const offered = (action: ApprovalAction) => writable && a.can.includes(action);
  /* The ordinary actions belong to a prepared action with a certain outcome. */
  const open = a.state === 'prepared' && !unsure;
  const onChange = p.onChange;
  const onDrop = p.onDrop;
  const onDownloadPrepared = p.onDownloadPrepared;
  /* The check exists only for an unknown state the engine offered to reconcile. */
  const reconcile = a.state === 'unknown' && offered('reconcile') ? p.onCheckUnknown : undefined;

  let primary: SheetPrimary | undefined;
  if (open && !prepareOnly && offered('approve')) {
    primary = money
      ? { label: t('BTN.approve'), onPress: () => p.onSecondAsk(a.approvalId), money: true }
      : { label: t('BTN.approve'), onPress: () => p.onApprove(a.approvalId) };
  }

  const actions = (
    <>
      {writable && prepareOnly && onDownloadPrepared && (
        <Button variant="quiet" onClick={() => onDownloadPrepared(a.approvalId)}>
          {t('BTN.download')}
        </Button>
      )}
      {open && offered('notNow') && (
        <Button variant="quiet" onClick={() => p.onNotNow(a.approvalId)}>
          {t('BTN.notNow')}
        </Button>
      )}
      {open && offered('change') && onChange && (
        <Button variant="link" onClick={() => onChange(a.approvalId)}>
          {t('BTN.change')}
        </Button>
      )}
      {open && offered('drop') && onDrop && (
        <Button variant="link" danger onClick={() => onDrop(a.approvalId)}>
          {t('BTN.drop')}
        </Button>
      )}
    </>
  );

  if (p.deeper) {
    return (
      <Sheet kind={t('SHEET.kind.receipt')} title={a.what} back={{ label: t('SHEET.kind.approval'), onBack: p.deeper.onBack }} onClose={p.onClose} onAdjacent={p.onAdjacent} origin={p.origin}>
        {p.deeper.content}
      </Sheet>
    );
  }

  return (
    <Sheet kind={t('SHEET.kind.approval')} position={p.position} title={a.what} onClose={p.onClose} onAdjacent={p.onAdjacent} origin={p.origin} primary={primary} actions={actions}>
      <KeyValue pairs={a.target.map((tg) => ({ name: tg.name, value: tg.value, figure: tg.figure }))} onReceipt={p.onReceipt} />

      {a.change.asWritten !== undefined && (
        <pre className={[s.asWritten, 'fig'].join(' ')}>{a.change.asWritten}</pre>
      )}
      {a.change.fields !== undefined && (
        <table className={s.fields}>
          <thead>
            <tr>
              <th scope="col" className="sr">
                {t('WK-02.field')}
              </th>
              <th scope="col">{t('WK-02.before')}</th>
              <th scope="col">{t('WK-02.after')}</th>
            </tr>
          </thead>
          <tbody>
            {a.change.fields.map((f) => (
              <tr key={f.name}>
                <th scope="row">{f.name}</th>
                <td>
                  <s>{f.before}</s>
                </td>
                <td>{f.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Steps steps={a.steps} />

      <p className={s.note}>{a.note}</p>
      {a.preparedBy !== undefined && <p className={s.note}>{t('WK-02.preparedBy', { name: a.preparedBy })}</p>}
      {money && primary !== undefined && <p className={s.note}>{t('WK-02.secondAsk')}</p>}
      {prepareOnly && <p className={s.note}>{t('WK-02.prepareOnly')}</p>}
      {a.blocked && <p className={s.note}>{a.blocked.text}</p>}
      {readOnly && <p className={s.note}>{p.readOnly ? t('WK-02.readOnly', { holder: p.readOnly.holder }) : t('WK-02.readOnly.plain')}</p>}

      {unsure && (
        <div className={s.unsure}>
          <p className={s.note}>{t('WK-02.unsure')}</p>
          {reconcile && (
            <div className={s.unsureActions}>
              <Button variant="quiet" onClick={() => reconcile(a.approvalId, 'check')}>
                {t('BTN.check')}
              </Button>
              <Button variant="link" onClick={() => reconcile(a.approvalId, 'was-sent')}>
                {t('BTN.wasSent')}
              </Button>
              <Button variant="link" onClick={() => reconcile(a.approvalId, 'was-not-sent')}>
                {t('BTN.wasNotSent')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
