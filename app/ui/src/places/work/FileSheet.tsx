import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { Sheet } from '../../parts/Sheet';
import { formatFileSize, useDay } from '../../parts/when';
import type { SheetComponentProps } from '../../shell/sheets';
import s from './Work.module.css';

/**
 * A file a run read, sheet `file:<upload id>`: what a run's evidence link opens (parts/evidence.ts). The engine keeps a
 * client's file in the vault and gives its facts, never its bytes, to the app (venture.files.list), so the sheet says
 * what the file is: its name, kind, size, the day it was added, where it came from, and the order it belongs to.
 * A file that was forgotten or deleted says so.
 */
export function FileSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const day = useDay();
  const files = useResource('venture.files.list', {});
  const label = t('work.file.label');
  if (!files.data) {
    return (
      <Sheet label={label} loading={!files.error} title={files.error ? t('work.file.gone') : t('sheet.loading')} onClose={onClose} returnFocus={returnFocus}>
        {files.error && <p className={s.problem}>{t('sheet.failed', { message: files.error.message })}</p>}
      </Sheet>
    );
  }
  const file = files.data.find((item) => item.id === id);
  if (!file) return <Sheet label={label} title={t('work.file.gone')} onClose={onClose} returnFocus={returnFocus} />;
  const from = file.scope.kind === 'practice' ? 'work.file.practice' : file.origin === 'local-transcription' ? 'work.file.transcript' : 'work.file.fromClient';
  const orderId = file.scope.kind === 'practice' ? null : file.scope.orderId;
  return (
    <Sheet
      label={label} name={file.name} onClose={onClose} returnFocus={returnFocus}
      title={<span data-code="" className="mono">{file.name}</span>}
      line={t('work.file.facts', { format: file.format.toUpperCase(), size: formatFileSize(file.bytes), date: day(file.at) })}
    >
      <div className={s.fileFacts} data-file="">
        <p>{t(from)}</p>
        {orderId && <p><a className={s.back} href={`#/work?order=${encodeURIComponent(orderId)}`}>{t('work.file.openOrder')}</a></p>}
      </div>
    </Sheet>
  );
}
