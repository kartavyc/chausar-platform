import { useId, useState } from 'react';
import { useT } from '../text';
import type { DeliveredFile, DeliveredView } from '../engine/types';
import { refusalWords } from './custody';
import { Button } from './Button';
import { Icon } from './Icon';
import s from './DeliveredCard.module.css';

/** Short enough to read, long enough to tell two files apart: the first characters of a digest. */
const SHORT_DIGEST = 12;

function FileLine({ file }: { file: DeliveredFile }) {
  const t = useT();
  return (
    <li className={s.file} data-delivered-file={file.source}>
      <Icon name="file-text" size={14} />
      <span className={s.fileWords}>
        <span className={s.name} data-content="">{file.name}</span>
        <span className={s.how}>{t(`delivered.source.${file.source}`)}</span>
      </span>
      <span className={s.digest} title={file.digest}>
        <span className="sr-only">{t('delivered.digest')} </span>
        <span className="mono">{file.digest.slice(0, SHORT_DIGEST)}</span>
      </span>
    </li>
  );
}

/**
 * W4 4J19 (A17): the Delivered card on an accepted run's sheet (the engine's delivery/delivered.ts): what the run handed
 * over, the files its own tools made with their digests, and apart, under the engine's own words, the files on the
 * order that changed while it ran, which nothing proves were the agent's. A draft that went out opens read-only here;
 * Make a copy (venture.delivery.copy, through onCopy) starts a new draft of the owner's with its text; without onCopy
 * there is no button.
 */
export function DeliveredCard({ delivered, onCopy }: { delivered: DeliveredView; onCopy?: (() => Promise<void>) | undefined }) {
  const t = useT();
  const headingId = useId();
  const [said, setSaid] = useState<{ line: string; problem?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function copy() {
    if (!onCopy) return;
    setBusy(true);
    try {
      await onCopy();
      setSaid({ line: t('delivered.copied') });
    } catch (error) {
      setSaid({ line: refusalWords(error, t), problem: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.card} aria-labelledby={headingId} data-delivered="">
      <h3 id={headingId} className={s.head}>
        <Icon name="check" size={14} />
        {t('delivered.title')}
      </h3>
      <p className={s.line}>{delivered.line}</p>
      {delivered.files.length > 0 && <ul className={s.files}>{delivered.files.map((file) => <FileLine key={file.id} file={file} />)}</ul>}
      {delivered.changed.length > 0 && (
        <div className={s.changed} data-delivered-changed="">
          <p className={s.changedLine}>
            <Icon name="triangle-alert" size={14} />
            {delivered.changedLine ?? t('delivered.changed')}
          </p>
          <ul className={s.files}>{delivered.changed.map((file) => <FileLine key={file.id} file={file} />)}</ul>
        </div>
      )}
      <div className={s.copy}>
        <p className={s.readOnly}>{t('delivered.readOnly')}</p>
        {onCopy && <Button size="sm" disabled={busy} onClick={() => void copy()}>{t('delivered.copy')}</Button>}
      </div>
      {said && <p className={said.problem ? s.problem : s.said} role="status">{said.line}</p>}
    </section>
  );
}
