/** Chausar 5B1 word editor. Tomada (AGPL), request/undo concepts only; original Ink UI. */
import { useId, useState } from 'react';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError } from '../../../engine/types';
import { useT, type T } from '../../../text';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import { Tile, TileHead } from '../../../parts/Tile';
import { Count } from '../../../parts/Figure';
import s from './YoutubeDesk.module.css';

type EditView = {
  id: string; digest: string; orderId: string; source: { label: string }; document: { words: { id: string; text: string }[] };
  history: unknown[]; request: string | null;
  last: { summary: string; applied: { index: number; op: { kind: string } }[]; refused: { index: number; code: string }[] } | null;
  pending: { preview: { summary: string; removedMs: number; removedShare: number; removedPercent: number; addedPercent: number } } | null;
  captions: { cues: { id: string; words: { text: string }[] | null }[] } | null;
  captionFiles: { srt: string; vtt: string; findings: { code: string; cueId: string }[]; notRun: { check: string }[] } | null;
  transcripts: { tier: string; whisperVersion: string; modelSha256: string; revision: string; srt: string; dropped: number }[];
  cleanup?: { removedMs: number; summary: string; cuts: { from: string; to: string }[]; suggestions: { wordIds: string[] }[] };
  coverage?: { coveredPercent: number; missing: { words: string[]; nearestWordIds: string[] }[]; retakes: { wordIds: string[] }[] };
  corrections?: { applied: { index: number; before: string; after: string }[]; refused: { index: number; code: string }[] };
};
const WORDED = new Set(['WORD_SOURCE_REQUIRED', 'EDIT_STALE', 'EDIT_AI_UNAVAILABLE', 'EDIT_ASK_AGAIN', 'EDIT_TOO_MANY', 'EDIT_INVALID', 'EDIT_NOT_FOUND', 'WORD_TIMES_REQUIRED', 'RIGHTS_REQUIRED', 'DERIVED_STALE', 'CHAT_CONSENT_REQUIRED', 'CHAT_CONSENT_STALE', 'MODEL_OUTPUT_INVALID', 'CONTENT_HELD', 'MODEL_HASH_MISMATCH', 'EDIT_NOTHING_TO_UNDO', 'EDIT_NOT_PENDING', 'APP_APPROVAL_REQUIRED', 'TIER_UNAVAILABLE', 'UPLOAD_LIMIT', 'ORDER_NOT_FOUND', 'INVALID_VENTURE_REQUEST', 'TRANSCRIPT_MEASUREMENTS_REQUIRED', 'TRANSCRIBE_NOT_AVAILABLE']);
const errorWords = (error: unknown, t: T) => error instanceof EngineError && WORDED.has(error.code) ? t(`pb-youtube.error.${error.code}`) : t('pb-youtube.error.general');
function summaryWords(value: string, t: T) {
  const match = /^Cut (\d+) passages?, ([\d.]+) s shorter\.$/.exec(value);
  return match ? t('pb-youtube.summary', { count: match[1]!, seconds: match[2]! }) : value;
}
function saveCaption(text: string, format: 'srt' | 'vtt') {
  const url = URL.createObjectURL(new Blob([text], { type: format === 'vtt' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `captions.${format}`; link.click(); URL.revokeObjectURL(url);
}
/** Import actual word measurements. Chausar never invents word times from an SRT cue. */
export function YoutubeDesk() {
  const t = useT(), client = useEngine(), id = useId();
  const orders = useResource('venture.order.list', {}), edits = useResource('venture.desk.list', { playbook: 'youtube', kind: 'edit' });
  const [orderId, setOrder] = useState(''), [source, setSource] = useState<unknown>(null), [selected, setSelected] = useState<string | null>(null), [sourceChoice, setSourceChoice] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const chosen = orderId || orders.data?.find(order => order.status === 'open')?.id || '';
  const sourceFiles = useResource('venture.files.list', chosen ? { orderId: chosen } : {});
  const sourceAssets = useResource('venture.assets.list', chosen ? { orderId: chosen } : {});
  const choices = [
    ...(sourceFiles.data?.some(file => file.format === 'transcript' && file.scope.kind === 'order' && file.scope.orderId === chosen) ? [{ key: 'transcript', name: t('pb-youtube.latestTranscript'), ref: { kind: 'transcript', orderId: chosen } }] : []),
    ...(sourceFiles.data ?? []).filter(file => file.format === 'audio' && 'orderId' in file.scope && file.scope.orderId === chosen).map(file => ({ key: 'upload:' + file.id, name: file.name, ref: { kind: 'upload', id: file.id } })),
    ...(sourceAssets.data?.assets ?? []).filter(asset => asset.orderId === chosen && asset.fileDigest && !asset.supersededBy).map(asset => ({ key: 'asset:' + asset.id, name: asset.name, ref: { kind: 'asset', id: asset.id } })),
  ];
  const sourceRef = choices.find(choice => choice.key === sourceChoice)?.ref;
  const rows = (edits.data?.rows ?? []) as EditView[];
  async function importWords() {
    if (!chosen || !source || !sourceRef || busy) return;
    setBusy(true); setError(null);
    try { const made = await client.request('venture.desk.act', { playbook: 'youtube', kind: 'edit', id: 'new', action: 'create', payload: { orderId: chosen, source, sourceRef } }); setSelected(made.id); edits.reload(); }
    catch (error) { setError(errorWords(error, t)); }
    finally { setBusy(false); }
  }
  return <div className={s.body}>
    <Tile as="section" label={t('pb-youtube.title')}>
      <TileHead title={t('pb-youtube.title')} />
      <p className={s.line}>{t('pb-youtube.honesty')}</p>
      <div className={s.import}>
        <label htmlFor={`${id}-order`}>{t('pb-youtube.order')}</label>
        <select id={`${id}-order`} value={chosen} onChange={event => { setOrder(event.target.value); setSourceChoice(''); }} className={s.select}>
          <option value="">{t('pb-youtube.chooseOrder')}</option>
          {orders.data?.filter(order => order.status === 'open').map(order => <option key={order.id} value={order.id}>{order.request}</option>)}
        </select>
        <label htmlFor={`${id}-source`}>{t('pb-youtube.source')}</label>
        <select id={`${id}-source`} value={sourceChoice} className={s.select} onChange={event => setSourceChoice(event.target.value)}>
          <option value="">{t('pb-youtube.chooseSource')}</option>
          {choices.map(choice => <option key={choice.key} value={choice.key} data-content="">{choice.name}</option>)}
        </select>
        {!choices.length && <p className={s.line}>{t('pb-youtube.sourceHelp')}</p>}
        <label htmlFor={`${id}-file`}>{t('pb-youtube.file')}</label>
        <input id={`${id}-file`} type="file" accept=".json,application/json" onChange={event => {
          const file = event.target.files?.[0]; setSource(null); setError(null); if (!file) return;
          if (file.size > 1000000) { setError(t('pb-youtube.error.UPLOAD_LIMIT')); return; }
          void file.text().then(text => { const parsed: unknown = JSON.parse(text); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); setSource({ ...parsed, label: file.name }); }).catch(() => setError(t('pb-youtube.error.WORD_TIMES_REQUIRED')));
        }} />
        <Button variant="primary" locked={!chosen || !source || !sourceRef} disabled={busy} onClick={() => void importWords()}>{t('pb-youtube.import')}</Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {edits.error && <p role="alert">{errorWords(edits.error, t)}</p>}
      <ul className={s.list}>{rows.map(row => <li key={row.id} className={s.row}><span data-content="">{row.source.label}</span><Button onClick={() => setSelected(row.id)}>{t('pb-youtube.open')}</Button></li>)}</ul>
      {!rows.length && !edits.loading && <p className={s.line}>{t('pb-youtube.empty')}</p>}
    </Tile>
    {selected && <EditPanel key={selected} id={selected} onChanged={edits.reload} />}
  </div>;
}
YoutubeDesk.ready = true;

function EditPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const t = useT(), client = useEngine();
  const resource = useResource('venture.desk.get', { playbook: 'youtube', kind: 'edit', id });
  const [current, setCurrent] = useState<EditView | null>(null), [request, setRequest] = useState(''), [ops, setOps] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [largeCleanup, setLargeCleanup] = useState(false);
  const [script, setScript] = useState(''), [names, setNames] = useState(''), [fixes, setFixes] = useState('');
  const [profile, setProfile] = useState('web'), [cueId, setCue] = useState(''), [wordIndex, setWordIndex] = useState(''), [wordText, setWordText] = useState('');
  const item = current ?? resource.data?.item as EditView | undefined;
  async function act(action: string, payload: unknown = {}) {
    if (!item || busy) return;
    setBusy(true); setError(null);
    try { const result = await client.request('venture.desk.act', { playbook: 'youtube', kind: 'edit', id, action, payload, digest: item.digest }); setCurrent(result.result as EditView); setLargeCleanup(false); onChanged(); }
    catch (error) { setError(errorWords(error, t)); if (error instanceof EngineError && error.code === 'EDIT_ASK_AGAIN' && action === 'cleanup') setLargeCleanup(true); if (error instanceof EngineError && error.code === 'EDIT_STALE') { setCurrent(null); resource.reload(); } }
    finally { setBusy(false); }
  }
  async function exportCaptions(format: 'srt' | 'vtt') {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const fresh = await client.request('venture.desk.get', { playbook: 'youtube', kind: 'edit', id });
      const checked = fresh.item as EditView;
      if (!checked.captionFiles) throw new EngineError('DERIVED_STALE', 'Make the captions again.');
      setCurrent(checked); saveCaption(checked.captionFiles[format], format);
    } catch (error) { setError(errorWords(error, t)); }
    finally { setBusy(false); }
  }
  if (!item) return <p role="status">{resource.error ? errorWords(resource.error, t) : t('pb-youtube.loading')}</p>;
  return <Tile as="section" label={t('pb-youtube.review')}>
    <TileHead title={t('pb-youtube.review')} />
    <p className={s.line} data-content="">{item.source.label}</p>
    <details><summary>{t('pb-youtube.words')}</summary><p className={s.transcript} data-content="">{item.document.words.map(word => <span key={word.id}><Count value={word.id} /> {word.text} </span>)}</p></details>
    <Field multiline label={t('pb-youtube.request')} value={request} onChange={event => setRequest(event.target.value)} maxLength={1000} />
    <details><summary>{t('pb-youtube.typed')}</summary><Field multiline label={t('pb-youtube.ops')} value={ops} onChange={event => setOps(event.target.value)} maxLength={12000} /></details>
    <div className={s.actions}>
      <Button onClick={() => void act('suggest')} disabled={busy}>{t('pb-youtube.suggest')}</Button>
      <Button onClick={() => void act('undo')} locked={!item.history.length} disabled={busy}>{t('pb-youtube.undo')}</Button>
      <Button variant="primary" locked={!request.trim()} disabled={busy} onClick={() => { if (!ops.trim()) { void act('request', { request }); return; } try { const parsed: unknown = JSON.parse(ops); void act('apply', { request, ops: parsed }); } catch { setError(t('pb-youtube.error.EDIT_INVALID')); } }}>{t('pb-youtube.apply')}</Button>
    </div>
    {error && <p role="alert">{error}</p>}
    {item.pending && <div className={s.notice}>
      <p>{t('pb-youtube.large', { percent: item.pending.preview.addedPercent })}</p><p className={s.summary} data-engine-line="">{summaryWords(item.pending.preview.summary, t)}</p>
      <Button onClick={() => void act('confirm')} disabled={busy}>{t('pb-youtube.confirm')}</Button>
    </div>}
    {item.last && <><p className={s.summary} data-engine-line="">{summaryWords(item.last.summary, t)}</p><ul className={s.list}>
      {item.last.applied.map(op => <li key={`a${op.index}`} className={s.row}><Count value={String(op.index + 1)} /><span>{t(`pb-youtube.op.${op.op.kind}`)}</span><span>{t('pb-youtube.applied')}</span></li>)}
      {item.last.refused.map(op => <li key={`r${op.index}`} className={s.row}><Count value={String(op.index + 1)} /><span>{t('pb-youtube.refused')}</span><span>{t(`pb-youtube.code.${op.code}`)}</span></li>)}
    </ul></>}
    {item.cleanup && <div className={s.notice}><p className={s.summary} data-engine-line="">{summaryWords(item.cleanup.summary, t)}</p>
      <p>{t('pb-youtube.measuredOnly')}</p><Button onClick={() => void act('cleanup', { confirmed: largeCleanup })} disabled={busy}>{t(largeCleanup ? 'pb-youtube.confirmCleanup' : 'pb-youtube.useCleanup')}</Button>
      <ul className={s.list}>{item.cleanup.suggestions.map((suggestion, index) => <li key={index}>{t('pb-youtube.filler')} <Count value={suggestion.wordIds.join(', ')} /></li>)}</ul>
    </div>}
    <details><summary>{t('pb-youtube.captionTitle')}</summary>
      <label className={s.label}>{t('pb-youtube.profile')}<select value={profile} onChange={event => setProfile(event.target.value)} className={s.select}>{['web', 'broadcast', 'vertical'].map(profile => <option key={profile} value={profile}>{t(`pb-youtube.profile.${profile}`)}</option>)}</select></label>
      <Button onClick={() => void act('captions', { profile })} disabled={busy}>{t('pb-youtube.makeCaptions')}</Button>
      {item.captionFiles && <><div className={s.actions}><Button disabled={busy} onClick={() => void exportCaptions('srt')}>{t('pb-youtube.saveSrt')}</Button><Button disabled={busy} onClick={() => void exportCaptions('vtt')}>{t('pb-youtube.saveVtt')}</Button></div>
        <ul className={s.list}>{item.captionFiles.findings.map((finding, index) => <li key={index}><Count value={finding.cueId} /> {t(`pb-youtube.caption.${finding.code}`)}</li>)}</ul>
        <ul className={s.list}>{item.captionFiles.notRun.map((finding, index) => <li key={index}>{t(`pb-youtube.caption.notRun.${finding.check}`)}</li>)}</ul>
        <Field label={t('pb-youtube.cue')} value={cueId} onChange={event => setCue(event.target.value)} /><Field label={t('pb-youtube.wordIndex')} value={wordIndex} onChange={event => setWordIndex(event.target.value)} inputMode="numeric" /><Field label={t('pb-youtube.wordText')} value={wordText} onChange={event => setWordText(event.target.value)} />
        <Button onClick={() => void act('caption-word', { cueId, index: /^\d+$/.test(wordIndex) ? Number(wordIndex) : -1, text: wordText })} disabled={busy}>{t('pb-youtube.saveWord')}</Button>
      </>}
    </details>
    <details><summary>{t('pb-youtube.coverageTitle')}</summary><Field multiline label={t('pb-youtube.script')} value={script} onChange={event => setScript(event.target.value)} maxLength={100000} /><Button onClick={() => void act('coverage', { script })} disabled={busy}>{t('pb-youtube.checkCoverage')}</Button>
      {item.coverage && <><p><Count value={item.coverage.coveredPercent} /> {t('pb-youtube.covered')}</p><ul>{item.coverage.missing.map((passage, index) => <li key={index}><span data-content="">{passage.words.join(' ')}</span> <Count value={passage.nearestWordIds.join(', ')} /></li>)}</ul></>}
    </details>
    <ModelsPanel editId={id} run={(tier) => void act('transcribe-tier', { tier })} busy={busy} />
    <details><summary>{t('pb-youtube.dictionaryTitle')}</summary><Field multiline label={t('pb-youtube.names')} value={names} onChange={event => setNames(event.target.value)} maxLength={100000} />
      <Button disabled={busy} onClick={() => { setBusy(true); void client.request('venture.desk.act', { playbook: 'youtube', kind: 'dictionary', id: 'new', action: 'set', payload: { terms: names.split(/\r?\n/).map(name => name.trim()).filter(Boolean) } }).catch(error => setError(errorWords(error, t))).finally(() => setBusy(false)); }}>{t('pb-youtube.saveNames')}</Button>
      <Field multiline label={t('pb-youtube.fixes')} value={fixes} onChange={event => setFixes(event.target.value)} maxLength={12000} /><Button disabled={busy} onClick={() => { try { void act('dictionary', { fixes: JSON.parse(fixes) as unknown }); } catch { setError(t('pb-youtube.error.EDIT_INVALID')); } }}>{t('pb-youtube.checkFixes')}</Button>
      {item.corrections && <ul className={s.list}>{item.corrections.applied.map((fix, index) => <li key={index} data-content="">{fix.before} → {fix.after}</li>)}{item.corrections.refused.map((fix, index) => <li key={`r${index}`}><Count value={fix.index} /> {t(`pb-youtube.code.${fix.code}`)}</li>)}</ul>}
    </details>
  </Tile>;
}

function ModelsPanel({ editId, run, busy }: { editId: string; run: (tier: string) => void; busy: boolean }) {
  const t = useT(), client = useEngine();
  const models = useResource('venture.desk.list', { playbook: 'youtube', kind: 'model' });
  const [links, setLinks] = useState<Record<string, string>>({}), [error, setError] = useState<string | null>(null);
  const rows = (models.data?.rows ?? []) as { tier: string; id: string; revision: string; sha256: string; bytes: number; licence: string }[];
  return <details><summary>{t('pb-youtube.models')}</summary><p className={s.line}>{t('pb-youtube.modelsHelp')}</p>
    {rows.map(model => <div key={model.tier} className={s.notice}>
      <h3>{t(`pb-youtube.tier.${model.tier}`)}</h3><p><span data-content="">{model.id}</span> <Count value={model.bytes} /> {t('pb-youtube.bytes')} <span data-content="">{model.licence}</span></p>
      <details><summary>{t('pb-youtube.modelProof')}</summary><p className={s.summary} data-content="">{model.revision}<br />{model.sha256}</p></details>
      <div className={s.actions}><Button disabled={busy} onClick={() => {
        setError(null); void client.request('venture.desk.act', { playbook: 'youtube', kind: 'edit', id: editId, action: 'model-download', payload: { tier: model.tier, confirmed: true } }).then(result => {
          const value = result.result as { url: string }; setLinks(previous => ({ ...previous, [model.tier]: value.url }));
        }).catch(error => setError(errorWords(error, t)));
      }}>{t('pb-youtube.confirmDownload')}</Button><Button disabled={busy} onClick={() => run(model.tier)}>{t('pb-youtube.runTier')}</Button></div>
      {links[model.tier] && <a href={links[model.tier]} target="_blank" rel="noreferrer">{t('pb-youtube.openDownload')}</a>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </details>;
}
