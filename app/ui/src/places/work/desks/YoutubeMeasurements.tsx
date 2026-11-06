// Chausar 5B2 measured style and finishing. Original Ink controls over completed local scans; no simulated measurements.
import { useRef, useState } from 'react';
import { useEngine, useResource } from '../../../engine/context';
import { useT } from '../../../text';
import { Field } from '../../../parts/Field';
import { Button } from '../../../parts/Button';
import { Count } from '../../../parts/Figure';
import { boardError, type BoardAct } from './YoutubeBoard';
import type { YoutubeBoardBody } from '../../../../../../platform/runtime/venture/playbooks/youtube/board-core';
import type { TextBox } from '../../../../../../platform/runtime/venture/playbooks/youtube/finishing-extra';
import s from './YoutubeDesk.module.css';

/** Owner positions describe the text layout; only ffmpeg supplies footage and sound measurements. */
export function YoutubeFinishing({ board, act, busy, onFinishingDirty }: { board: YoutubeBoardBody; act: BoardAct; busy: boolean; onFinishingDirty(value: boolean): void }) {
  const t = useT(), [file, setFile] = useState(''), [platform, setPlatform] = useState('youtube'), [commentary, setCommentary] = useState('');
  const [boxes, setBoxes] = useState<TextBox[]>([]), [box, setBox] = useState({ x: '', y: '', width: '', height: '', text: '', start: '', end: '' });
  const version = useRef(0), [dirty, setDirty] = useState(false);
  function changed() { version.current++; setDirty(true); onFinishingDirty(true); }
  async function measure() {
    const measuredVersion = version.current;
    const result = await act('finishing', { file, platform, boxes, ...(commentary.trim() ? { commentaryMs: Number(commentary) * 1000 } : {}) });
    if (measuredVersion === version.current && result && typeof result === 'object' && 'board' in result) { setDirty(false); onFinishingDirty(false); }
  }
  return <details onChangeCapture={changed}><summary>{t('pb-youtube-board.finishing')}</summary>
    <p>{t('pb-youtube-board.finishingHelp')}</p>
    <Field label={t('pb-youtube-board.deliveryFile')} value={file} onChange={e => setFile(e.target.value)} />
    <label className={s.label}>{t('pb-youtube-board.platform')}<select className={s.select} value={platform} onChange={e => setPlatform(e.target.value)}>{['youtube', 'reels', 'stories', 'tiktok'].map(platform => <option value={platform} key={platform}>{t(`pb-youtube-board.platform.${platform}`)}</option>)}</select></label>
    <Field label={t('pb-youtube-board.commentary')} inputMode="decimal" value={commentary} onChange={e => setCommentary(e.target.value)} />
    <details><summary>{t('pb-youtube-board.textBoxes')}</summary>
      {(['x', 'y', 'width', 'height', 'start', 'end', 'text'] as const).map(key => <Field key={key} label={t(`pb-youtube-board.box.${key}`)} value={box[key]} onChange={e => setBox(previous => ({ ...previous, [key]: e.target.value }))} maxLength={key === 'text' ? 5000 : 10} />)}
      <Button locked={Object.values(box).some(value => !value.trim())} onClick={() => { changed(); setBoxes(rows => [...rows, { x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height), text: box.text, startMs: Number(box.start) * 1000, endMs: Number(box.end) * 1000 }]); setBox({ x: '', y: '', width: '', height: '', text: '', start: '', end: '' }); }}>{t('pb-youtube-board.addBox')}</Button>
      <ul>{boxes.map((box, index) => <li key={index}><span data-content="">{box.text}</span> <Button onClick={() => { changed(); setBoxes(rows => rows.filter((_, i) => i !== index)); }}>{t('pb-youtube-board.remove')}</Button></li>)}</ul>
    </details>
    <Button disabled={busy} locked={!file.trim()} onClick={() => void measure()}>{t('pb-youtube-board.measureFinishing')}</Button>
    {dirty && <p role="status">{t('pb-youtube-board.finishingChanged')}</p>}
    {!dirty && board.finishing && <ul>{board.finishing.map(finding => <li key={finding.id}>{t(`pb-youtube-board.check.${finding.id}`)}: {t(`pb-youtube-board.outcome.${finding.outcome}`)}</li>)}</ul>}
  </details>;
}
type StyleView = { id: string; digest: string; card: { count: number; metrics: Record<string, number | null> } };
/** The owner selects distinct measured edit records. A failed or absent local tool produces no style card. */
export function YoutubeStyle({ editId }: { editId: string }) {
  const t = useT(), client = useEngine();
  const edits = useResource('venture.desk.list', { playbook: 'youtube', kind: 'edit' });
  const styles = useResource('venture.desk.list', { playbook: 'youtube', kind: 'style' });
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [compared, setCompared] = useState<{ metrics: Record<string, number | null>; findings: { metric: string }[] } | null>(null);
  const rows = (edits.data?.rows ?? []) as { id: string; source: { label: string } }[];
  const cards = (styles.data?.rows ?? []) as StyleView[];
  async function measure() {
    if (busy) return; setBusy(true); setError(null);
    try { await client.request('venture.desk.act', { playbook: 'youtube', kind: 'style', id: 'new', action: 'measure', payload: { editIds: selected } }); styles.reload(); }
    catch (error) { setError(boardError(error, t)); }
    finally { setBusy(false); }
  }
  async function compare(card: StyleView) {
    if (busy) return; setBusy(true); setError(null);
    try { const answer = await client.request('venture.desk.act', { playbook: 'youtube', kind: 'style', id: card.id, action: 'compare', payload: { editId }, digest: card.digest }); setCompared(answer.result as typeof compared); }
    catch (error) { setError(boardError(error, t)); }
    finally { setBusy(false); }
  }
  return <details><summary>{t('pb-youtube-board.style')}</summary><p>{t('pb-youtube-board.styleHelp')}</p>
    {rows.map(row => <label className={s.row} key={row.id}><input type="checkbox" checked={selected.includes(row.id)} onChange={e => setSelected(values => e.target.checked ? [...values, row.id] : values.filter(id => id !== row.id))} /><span data-content="">{row.source.label}</span></label>)}
    <Button disabled={busy} locked={selected.length < 2 || selected.length > 3} onClick={() => void measure()}>{t('pb-youtube-board.measureStyle')}</Button>
    {error && <p role="alert">{error}</p>}
    {cards.map(card => <div className={s.notice} key={card.id}><p>{t('pb-youtube-board.measuredFrom', { count: card.card.count })}</p><Metrics metrics={card.card.metrics} /><Button disabled={busy} onClick={() => void compare(card)}>{t('pb-youtube-board.compareStyle')}</Button></div>)}
    {compared && <><Metrics metrics={compared.metrics} /><ul>{compared.findings.map(finding => <li key={finding.metric}>{t(`pb-youtube-board.metric.${finding.metric}`)}: {t('pb-youtube-board.styleDifference')}</li>)}</ul></>}
  </details>;
}
function Metrics({ metrics }: { metrics: Record<string, number | null> }) {
  const t = useT();
  return <dl>{Object.entries(metrics).map(([key, value]) => <div key={key}><dt>{t(`pb-youtube-board.metric.${key}`)}</dt><dd>{value === null ? t('pb-youtube-board.notMeasured') : <Count value={value} />}</dd></div>)}</dl>;
}
