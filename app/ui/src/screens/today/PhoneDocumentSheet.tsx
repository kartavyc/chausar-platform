/**
 * A document sent from the phone, to confirm (PH-05). The row under "Awaiting your review" opens
 * this sheet. It is outside data: nothing in it is followed and nothing is stored until the person
 * confirms.
 *
 * "Check it" asks hosted-link's `phone.documents.preview` { documentId }, which runs the normal
 * import preview, exactly as for a file brought on this computer, marked as outside data. Its reply
 * is checked (`isPhoneDocumentPreviewReply`, then first run's `validatePreview`). Only an accepted
 * preview offers "Confirm and bring in", which is the normal `sources.import` with the input the
 * preview returned; its reply is checked with `validateImport`. "Discard" is
 * `phone.documents.discard` { documentId }. A PDF or a photo cannot be previewed yet
 * (`DOCUMENT_PREVIEW_UNAVAILABLE`) and says so; it can be kept or discarded.
 */
import { useState } from 'react';
import type { PlaceRpc } from '../../places/types.ts';
import { useT } from '../../app/text';
import { Sheet } from '../../parts/Sheet';
import { Button } from '../../parts/Button';
import { State } from '../../patterns/States';
import { count } from '../../format/counts.ts';
import { isPhoneDocumentPreviewReply, type PhoneDocumentPreviewReply } from '../../bridge/todayx-contract.ts';
import { validateImport, validatePreview, type ImportResult, type SheetPreview } from '../first-run/journey-contracts.ts';
import s from './Today.module.css';

export interface PhoneDocumentSheetProps {
  readonly documentId: string;
  readonly channel: 'whatsapp' | 'telegram';
  readonly rpc: PlaceRpc;
  readonly origin: HTMLElement | null;
  readonly onClose: () => void;
  /** The list changed (imported or discarded): Today reads its rows again. */
  readonly onChanged: () => void;
}

type Phase =
  | { readonly kind: 'start' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'checked'; readonly reply: PhoneDocumentPreviewReply; readonly preview: SheetPreview }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'done'; readonly result: ImportResult }
  | { readonly kind: 'discarded' }
  | { readonly kind: 'failed'; readonly code: string };
const codeOf = (error: unknown) => {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : error instanceof Error && error.name === 'InvalidReply' ? 'INVALID_REPLY' : 'REQUEST_FAILED';
};

export function PhoneDocumentSheet(p: PhoneDocumentSheetProps) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  const busy = phase.kind === 'busy';

  const check = async () => {
    setPhase({ kind: 'busy' });
    try {
      const reply = await p.rpc.request('phone.documents.preview', { documentId: p.documentId });
      if (!isPhoneDocumentPreviewReply(reply) || reply.documentId !== p.documentId) { setPhase({ kind: 'failed', code: 'INVALID_REPLY' }); return; }
      setPhase({ kind: 'checked', reply, preview: validatePreview(reply.preview) });
    } catch (error) {
      const code = codeOf(error);
      setPhase(code === 'DOCUMENT_PREVIEW_UNAVAILABLE' ? { kind: 'unavailable' } : { kind: 'failed', code });
    }
  };
  const confirm = async (reply: PhoneDocumentPreviewReply) => {
    setPhase({ kind: 'busy' });
    try {
      const result = validateImport(await p.rpc.request(reply.confirm.method, { ...reply.confirm.input }));
      setPhase({ kind: 'done', result }); p.onChanged();
    } catch (error) { setPhase({ kind: 'failed', code: codeOf(error) }); }
  };
  const discard = async () => {
    setPhase({ kind: 'busy' });
    try { await p.rpc.request('phone.documents.discard', { documentId: p.documentId }); setPhase({ kind: 'discarded' }); p.onChanged(); }
    catch (error) { setPhase({ kind: 'failed', code: codeOf(error) }); }
  };

  const open = phase.kind === 'start' || phase.kind === 'checked' || phase.kind === 'unavailable' || phase.kind === 'failed';
  const accepted = phase.kind === 'checked' && phase.preview.accepted;
  const primary = phase.kind === 'start' ? { label: t('FT4.doc.check'), onPress: () => void check() }
    : accepted ? { label: t('FT4.doc.confirm'), onPress: () => void confirm(phase.reply) } : undefined;
  return (
    <Sheet kind={t('FT4.doc.title')} title={t(`FT4.review.document.${p.channel}`)} onClose={p.onClose} origin={p.origin} primary={busy ? undefined : primary}
      actions={open && !busy ? <Button variant="link" danger onClick={() => void discard()}>{t('FT4.doc.discard')}</Button> : undefined}>
      <p className={s.quiet} data-outside="">{t('FT4.review.document.detail')}</p>
      {busy && <State state={{ kind: 'loading' }} />}
      {phase.kind === 'checked' && (
        <div data-doc-preview={phase.preview.accepted ? 'accepted' : 'refused'}>
          <p>{t('FT4.doc.rows', { read: count(String(phase.preview.coverage.sourceRows)), left: count(String(phase.preview.coverage.rejectedRows)) })}</p>
          {!phase.preview.accepted && <p role="status">{t('FT4.doc.refused')}</p>}
        </div>
      )}
      {phase.kind === 'unavailable' && <p role="status" data-doc-unavailable="">{t('FT4.doc.unavailable')}</p>}
      {phase.kind === 'done' && <p role="status" data-doc-done="">{phase.result.duplicate ? t('FT4.doc.before') : t('FT4.doc.done', { rows: count(String(phase.result.coverage.importedRows)) })}</p>}
      {phase.kind === 'discarded' && <p role="status" data-doc-discarded="">{t('FT4.doc.discarded')}</p>}
      {phase.kind === 'failed' && <State state={{ kind: 'failed', code: phase.code }} />}
    </Sheet>
  );
}
