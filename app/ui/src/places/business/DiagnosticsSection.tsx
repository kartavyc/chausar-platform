import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { DiagnosticsPreview } from '../../engine/types';
import { Button } from '../../parts/Button';
import { formatFileSize } from '../../parts/when';
import { TileSection } from './shared';
import s from './Business.module.css';
import { Fold } from '../../parts/Fold';
import r from './Reports.module.css';

/**
 * Business > Reports (C5 task 27): what Chausar noted on this computer. Export diagnostics reads every file first; Save
 * writes exactly what the page shows, through the system dialog, by the preview's id. Crash files go in only when ticked.
 * The desktop does the gathering, so the browser rehearsal has no button.
 */
export function DiagnosticsSection() {
  const t = useT();
  const client = useEngine();
  const [preview, setPreview] = useState<DiagnosticsPreview | null>(null);
  const [dumps, setDumps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // C5 task 28: where today's time went, as the engine summed and worded it. The sums' receipts open from the fold.
  const today = useResource('venture.diagnostics.today', {}).data ?? null;
  const canExport = !!client.previewDiagnostics && !!client.saveDiagnostics;
  if (!canExport && !today) return null;

  async function work(call: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try { await call(); } catch (error) { setProblem(messageOf(error)); } finally { setBusy(false); }
  }
  const look = (withDumps: boolean) => work(async () => {
    const next = await client.previewDiagnostics!(withDumps);
    setPreview(next);
    setDumps(withDumps);
  });
  const save = (id: string) => work(async () => {
    const saved = await client.saveDiagnostics!(id);
    if (!saved) return;
    setSaid(saved.line);
    setPreview(null);
    setDumps(false);
  });

  return (
    <TileSection title={t('diagnostics.title')}>
      {today && <p className={s.line} data-engine-line="">{today.line}</p>}
      {today && today.rows.length > 0 && (
        <Fold summary={t('diagnostics.counted')} className={r.counted}>
          <ul className={r.files}>
            {today.rows.map((row) => (
              <li key={row.key} data-engine-line="">{t('diagnostics.row', { label: row.label, time: row.display, count: row.receipt.items.length })}</li>
            ))}
          </ul>
        </Fold>
      )}
      {canExport && <p className={s.line}>{t('diagnostics.line')}</p>}
      {said && <p className={s.note} role="status" data-engine-line="">{said}</p>}
      {problem && <p className={s.problem} role="alert" data-engine-line="">{problem}</p>}
      {preview ? (
        <>
          <ul className={r.files}>
            {[...preview.files, ...preview.dumps].map((file) => <li key={file.name} data-content="">{t('diagnostics.file', { name: file.name, size: formatFileSize(file.bytes) })}</li>)}
          </ul>
          {preview.dumpsThere > 0 && (
            <label className={r.choice}>
              <input type="checkbox" checked={dumps} disabled={busy} onChange={(event) => void look(event.target.checked)} />
              <span>{t('diagnostics.dumps')} <span className={r.hint}>{t('diagnostics.dumpsHint')}</span></span>
            </label>
          )}
          {preview.leftOut > 0 && <p className={s.note}>{t('diagnostics.leftOut', { count: preview.leftOut })}</p>}
          <pre className={r.json} data-content="">{preview.text}</pre>
          <div className={s.buttons}>
            <Button variant="primary" disabled={busy} onClick={() => void save(preview.id)}>{t('diagnostics.save')}</Button>
            <Button variant="quiet" disabled={busy} onClick={() => { setPreview(null); setDumps(false); }}>{t('diagnostics.notNow')}</Button>
          </div>
        </>
      ) : canExport && (
        <div className={s.buttons}>
          <Button disabled={busy} onClick={() => void look(false)}>{t('diagnostics.export')}</Button>
        </div>
      )}
    </TileSection>
  );
}
