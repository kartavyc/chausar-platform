/** Original Chausar SEO4-SEO8 work view. Catalogue MIT/Apache ideas only, no source copied. */
import { useState, type FormEvent } from 'react';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError } from '../../../engine/types';
import { useT } from '../../../text';
import { Button } from '../../../parts/Button';
import { Tile, TileHead } from '../../../parts/Tile';
import type { SeoWorkItem, SeoWorkOperation } from '../../../../../../platform/runtime/venture/playbooks/seo-visibility/work-core';
import type { RefreshRow } from '../../../../../../platform/runtime/venture/playbooks/seo-visibility/refresh';
import s from './SeoVisibilityDesk.module.css';
const base = { playbook: 'seo-visibility' as const, kind: 'work' };
const operations: SeoWorkOperation[] = ['refresh', 'content', 'meta', 'impact', 'local'];
/** Review the stored result and its current digest before any owner decision. */
export function SeoMonthlyWork() {
 const t = useT(), engine = useEngine();
 const [open, setOpen] = useState(false), [orderId, setOrder] = useState(''), [uploadId, setUpload] = useState(''), [operation, setOperation] = useState<SeoWorkOperation>('refresh');
 const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [said, setSaid] = useState('');
 const orders = useResource('venture.order.list', {}), files = useResource('venture.files.list', { orderId }, { skip: !orderId });
 const list = useResource('venture.desk.list', base, { refreshOn: e => e.type === 'desk.changed' });
 const detail = useResource('venture.desk.get', { ...base, id: selected }, { skip: !selected, refreshOn: e => e.type === 'desk.changed' });
 const rows = (list.data?.rows ?? []) as SeoWorkItem[], item = detail.data?.item as SeoWorkItem | undefined;
 function failed(cause: unknown) { const key = 'pb-seo-work.error.' + (cause instanceof EngineError ? cause.code : 'REQUEST_FAILED'); const words = t(key); setError(words === key ? t('pb-seo-work.error.REQUEST_FAILED') : words); }
 async function act(action: 'create' | 'approve' | 'dismiss' | 'rescan') {
  setBusy(true); setError(''); setSaid('');
  try {
   const rescan = action === 'rescan';
   const response = await engine.request('venture.desk.act', { ...base, id: action === 'create' ? 'new' : selected, action,
    ...(action === 'create' ? {} : { digest: detail.data?.digest }), payload: action === 'create' || rescan ? { orderId: rescan ? item!.orderId : orderId, operation: rescan ? item!.operation : operation, uploadId: rescan ? item!.uploadId : uploadId } : {} });
   setSelected(response.id); setOpen(false); list.reload(); detail.reload();
   if (action === 'approve' || action === 'dismiss') setSaid(t('pb-seo-work.' + (action === 'approve' ? 'approved' : 'dismissed')));
  } catch (cause) { failed(cause); } finally { setBusy(false); }
 }
 function submit(event: FormEvent) { event.preventDefault(); if (orderId && uploadId && !busy) void act('create'); }
 return <section className={s.stack} aria-label={t('pb-seo-work.title')}>
  <Tile as="section" label={t('pb-seo-work.title')}><TileHead title={t('pb-seo-work.title')} end={<Button onClick={() => setOpen(!open)}>{t('pb-seo-work.new')}</Button>}/>
   <p className={s.line}>{t('pb-seo-work.boundary')}</p>
   {(error || list.error || detail.error) && <p role="alert">{error || t('pb-seo-work.error.REQUEST_FAILED')}</p>}{said && <p role="status">{said}</p>}
   {open && <form className={s.form} aria-label={t('pb-seo-work.new')} onSubmit={submit}>
    <label className={s.label}>{t('pb-seo-work.order')}<select value={orderId} onChange={e => { setOrder(e.target.value); setUpload(''); }}><option value="">{t('pb-seo-work.chooseOrder')}</option>{orders.data?.map(o => <option key={o.id} value={o.id}>{o.request}</option>)}</select></label>
    <label className={s.label}>{t('pb-seo-work.operation')}<select value={operation} onChange={e => setOperation(e.target.value as SeoWorkOperation)}>{operations.map(op => <option key={op} value={op}>{t('pb-seo-work.operation.' + op)}</option>)}</select></label>
    <label className={s.label}>{t('pb-seo-work.file')}<select value={uploadId} onChange={e => setUpload(e.target.value)}><option value="">{t('pb-seo-work.chooseFile')}</option>{files.data?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    <p className={s.line}>{t('pb-seo-work.sourceHint.' + operation)}</p><Button variant="primary" type="submit" locked={!orderId || !uploadId} disabled={busy}>{t('pb-seo-work.check')}</Button>
   </form>}
   {!!rows.length && <ul className={s.list}>{rows.map(row => <li key={row.id}><Button variant="quiet" onClick={() => { setSelected(row.id); setOpen(false); setSaid(''); }}>{t('pb-seo-work.operation.' + row.operation)}</Button><span>{t('pb-seo-work.state.' + row.state)}</span></li>)}</ul>}
  </Tile>
  {item && <Tile as="section" label={t('pb-seo-work.result')} card><TileHead title={t('pb-seo-work.result')}/>{item.stale && <p role="alert">{t('pb-seo-work.error.SEO_SOURCE_CHANGED')}</p>}
   <WorkResult item={item}/>
   <details><summary>{t('pb-seo-work.evidence')}</summary><p data-content>{files.data?.find(f => f.id === item.uploadId)?.name ?? item.uploadId}</p><p>{item.checkedAt}</p><p data-content>{item.receipt}</p></details>
   {item.state !== 'approved' && <Button variant="primary" locked={item.stale || item.result.pass === false} disabled={busy || !detail.data?.digest} onClick={() => void act('approve')}>{t('pb-seo-work.approve')}</Button>}
   <Button disabled={busy} onClick={() => void act('rescan')}>{t('pb-seo-work.rescan')}</Button><Button variant="quiet" disabled={busy || item.stale} onClick={() => void act('dismiss')}>{t('pb-seo-work.dismiss')}</Button>
  </Tile>}
 </section>;
}
function WorkResult({ item }: { item: SeoWorkItem }) {
 const t = useT(), result = item.result;
 if (item.operation === 'refresh') return <>{!(result.rows as RefreshRow[]).length && <p>{t('pb-seo-work.noWork')}</p>}<ul className={s.list}>{(result.rows as RefreshRow[]).map((row, i) => <li key={i}><strong>{t('pb-seo-work.action.' + row.action)}</strong><span data-content>{row.query}</span><span data-content>{row.pages.join(', ')}</span></li>)}</ul></>;
 if (item.operation === 'impact') return <p>{t('pb-seo-work.impact.' + result.verdict)}</p>;
 if (item.operation === 'meta') return <ul className={s.list}>{(result.checks as { id: string; pass: boolean }[]).map(check => <li key={check.id}>{t('pb-seo-work.meta.' + check.id)}: {t('pb-seo-work.' + (check.pass ? 'passes' : 'needsWork'))}</li>)}</ul>;
 if (item.operation === 'content') return <><p>{t('pb-seo-work.' + (result.pass ? 'passes' : 'needsWork'))}</p><p data-content>{result.text}</p>{!!result.corroboration?.sourceGaps?.length && <p>{t('pb-seo-work.sourceGaps')}</p>}</>;
 if (item.operation === 'local') return <><p>{t('pb-seo-work.localHandoff')}</p><ul className={s.list}>{(result.citations as { url: string; matches: unknown }[]).map((citation, i) => <li key={i}><span data-content>{citation.url}</span><span>{t('pb-seo-work.' + (citation.matches === null ? 'unknown' : 'checked'))}</span></li>)}</ul><p data-content>{result.review?.text}</p></>;
 return <p>{t('pb-seo-work.checked')}</p>;
}
