import { useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import type { OrderLite } from '../../engine/types';
import s from './Work.module.css';

const never = () => false;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** The cut's file name, from a Windows or a Unix path, so the owner knows which footage it will read. */
const cutName = (path: string | null) => (path ?? '').split(/[\\/]/).pop() ?? '';

/**
 * A transcript made on this computer (Ink v2 wave 2, 2E2), for an order whose intake names the finished cut. While the
 * order has no transcript, "Make a transcript on this computer" asks the engine (venture.files.transcribe), which
 * uses the ffmpeg and whisper.cpp already here and says plainly when either is missing. The order's transcript is
 * then listed as an order file, marked when it was made here. Never on the hosted server, which reads no file of yours.
 */
export function TranscribeButton({ order }: { order: OrderLite }) {
  const t = useT();
  const client = useEngine();
  const cut = order.intake?.cutFile ?? null;
  const offered = cut !== null && cut !== '' && client.transport !== 'hosted';
  const files = useResource('venture.files.list', { orderId: order.id }, { refreshOn: never, skip: !offered });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!offered) return null;

  async function make() {
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.files.transcribe', { orderId: order.id });
      files.reload();
    } catch (error) {
      setProblem(t('work.transcribe.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  // The order's files as the engine lists them, origin included; the button waits while they load again.
  const transcripts = (files.data ?? []).filter((f) => f.format === 'transcript');
  const canMake = files.data !== undefined && !files.loading && transcripts.length === 0;

  return (
    <div>
      {transcripts.length > 0 && (
        <ul className={s.files} aria-label={t('work.transcribe.files')}>
          {transcripts.map((f) => (
            <li key={f.id}>
              {t('work.transcribe.file', { name: f.name })}{' '}
              {f.origin === 'local-transcription' && <span className={s.quiet}>{t('work.transcribe.local')}</span>}
            </li>
          ))}
        </ul>
      )}
      {canMake && (
        <p className={s.note}>
          <Button variant="quiet" disabled={busy} onClick={() => void make()}>{busy ? t('work.transcribe.making') : t('work.transcribe.make')}</Button>{' '}
          <span>{t('work.transcribe.hint')}</span>
        </p>
      )}
      {canMake && <p className={s.quiet}>{t('work.transcribe.cut', { name: cutName(cut) })}</p>}
      {files.error && <p className={s.problem} role="status">{t('work.loadFailed', { message: files.error.message })}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}
