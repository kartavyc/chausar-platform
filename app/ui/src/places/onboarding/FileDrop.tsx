import { useId, useState, type DragEvent } from 'react';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import s from './FileDrop.module.css';

/** The most text the engine reads from a dropped file (core/attachment.ts ATTACHMENT_MAX_BYTES, 4J8). */
export const FILE_MAX_BYTES = 200 * 1024;
/** Files whose words the page can read as text. A PDF or a picture is not text, so it is not offered. */
const ACCEPT = '.txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json';

export interface DroppedFile { name: string; text: string }

/**
 * The file drop beside the one-sentence box (W4 4J21, on this computer): the owner drops or picks one text file, at most
 * 200 KB, and its words go with the sentence to venture.blueprint.suggest as `attachment`, only as context. The engine
 * screens it first and may leave it out, saying why; nothing here judges the words. The page reads the file itself;
 * nothing is kept in browser storage.
 */
export function FileDrop({ file, onFile, disabled = false }: { file: DroppedFile | null; onFile: (file: DroppedFile | null) => void; disabled?: boolean }) {
  const t = useT();
  const inputId = useId();
  const noteId = useId();
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function take(picked: File | undefined) {
    setProblem(null);
    if (!picked) return;
    if (picked.size > FILE_MAX_BYTES) { setProblem(t('onboarding.ways.file.tooBig')); return; }
    try {
      const text = await picked.text();
      if (!text.trim()) { setProblem(t('onboarding.ways.file.empty')); return; }
      onFile({ name: picked.name, text });
    } catch {
      setProblem(t('onboarding.ways.file.unreadable'));
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    if (!disabled) void take(event.dataTransfer.files[0]);
  }

  return (
    <div
      className={s.drop} data-over={over ? '' : undefined} data-file-drop=""
      onDragOver={(event) => { event.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      {file ? (
        <p className={s.file}>
          <Icon name="paperclip" size={16} />
          <span className={s.name} data-content="">{file.name}</span>
          <Button variant="quiet" size="sm" disabled={disabled} onClick={() => onFile(null)}>
            <span aria-hidden="true">{t('onboarding.ways.file.remove')}</span>
            <span className="sr-only">{t('onboarding.ways.file.removeNamed', { name: file.name })}</span>
          </Button>
        </p>
      ) : (
        <p className={s.file}>
          <Icon name="upload" size={16} />
          <label htmlFor={inputId} className={s.pick}>{t('onboarding.ways.file.add')}</label>
          <input id={inputId} className="sr-only" type="file" accept={ACCEPT} disabled={disabled} aria-describedby={noteId} onChange={(event) => { void take(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
        </p>
      )}
      <p id={noteId} className={s.note}>{t('onboarding.ways.file.note')}</p>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}
