/** The owner imports and approves the checker report; monthly re-checks execute through the guarded installed checker. Original Chausar. */
import { useId, useState, type FormEvent } from 'react';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError } from '../../../engine/types';
import { useT } from '../../../text';
import { Tile, TileHead } from '../../../parts/Tile';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import type { SeoWebsiteItem } from '../../../../../../platform/runtime/venture/playbooks/seo-visibility/records';
import s from './SeoVisibilityDesk.module.css';
const base = { playbook: 'seo-visibility' as const, kind: 'website' };
const readFile = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('FILE_UNREADABLE')); reader.readAsText(file); });
/** Store summaries and hashes, never the checker's large raw JSON bundle. */
export function SeoWebsiteChecks() {
    const t = useT(), engine = useEngine(), heading = useId(), fileId = useId();
    const list = useResource('venture.desk.list', base, { refreshOn: event => event.type === 'desk.changed' });
    const [adding, setAdding] = useState(false), [url, setUrl] = useState(''), [file, setFile] = useState<File | null>(null), [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const detail = useResource('venture.desk.get', { ...base, id: selected }, { skip: !selected, refreshOn: event => event.type === 'desk.changed' });
    const item = detail.data?.item as SeoWebsiteItem | undefined, rows = (list.data?.rows ?? []) as SeoWebsiteItem[];
    function words(cause: unknown) { const key = 'pb-seo-visibility.error.' + (cause instanceof EngineError ? cause.code : 'SITE_CHECK_INVALID'); const value = t(key); return value === key ? t('pb-seo-visibility.error.REQUEST_FAILED') : value; }
    async function act(action: string, payload: unknown, id = selected) {
        setBusy(true);
        setError('');
        try {
            const value = await engine.request('venture.desk.act', { ...base, id, action, payload, ...(id === 'new' ? {} : { digest: detail.data?.digest }) });
            setSelected(value.id);
            setAdding(false);
            list.reload();
            detail.reload();
        }
        catch (cause) {
            setError(words(cause));
        }
        finally {
            setBusy(false);
        }
    }
    async function importReport(event: FormEvent) {
        event.preventDefault();
        if (!file || file.size > 1000000) {
            setError(t('pb-seo-visibility.error.SITE_CHECK_INVALID'));
            return;
        }
        setBusy(true);
        setError('');
        try {
            const report: unknown = JSON.parse(await readFile(file));
            await act('import', { url, report }, 'new');
        }
        catch (cause) {
            setError(words(cause));
        }
        finally {
            setBusy(false);
        }
    }
    return <Tile as="section" labelledBy={heading}>
  <TileHead id={heading} title={t('pb-seo-visibility.website.heading')} end={<Button variant="quiet" onClick={() => setAdding(value => !value)}>{t('pb-seo-visibility.website.import')}</Button>}/>
  <p className={s.line}>{t('pb-seo-visibility.website.manual')}</p>
  {error && <p className={s.error} role="alert">{error}</p>}
  {adding && <form className={s.form} aria-label={t('pb-seo-visibility.website.import')} onSubmit={importReport}>
   <Field label={t('pb-seo-visibility.website.url')} type="url" value={url} onChange={event => setUrl(event.target.value)} required/>
   <label className={s.label} htmlFor={fileId}>{t('pb-seo-visibility.website.file')}</label><input id={fileId} type="file" accept=".json,.txt,application/json" onChange={event => setFile(event.target.files?.[0] ?? null)} required/>
   <Button type="submit" variant="primary" disabled={busy}>{t('pb-seo-visibility.website.keep')}</Button>
  </form>}
  {rows.length > 0 && <ul className={s.list}>{rows.map(row => <li key={row.id}><Button variant="quiet" onClick={() => { setSelected(row.id); setAdding(false); }}>{row.report.url}</Button></li>)}</ul>}
  {item && <div className={s.form}>
   <p className={s.line} data-content>{item.report.url}</p>
   <p className={s.line}>{t('pb-seo-visibility.website.coverage')}</p>
   {item.report.previousReceipt && <p className={s.line}>{t(item.report.previousReceipt === item.report.receipt ? 'pb-seo-visibility.website.same' : 'pb-seo-visibility.website.changed')}</p>}
   <details><summary>{t('pb-seo-visibility.website.evidence')}</summary><code className={s.line}>{item.report.receipt}</code><ul className={s.list}>{item.report.findings.map((finding, index) => <li key={index} data-content><span>{finding.what}</span><span>{finding.measured} / {finding.expected}</span><span>{finding.fix}</span></li>)}</ul></details>
   {!item.report.approved ? <Button variant="primary" disabled={busy} onClick={() => void act('approve', {})}>{t('pb-seo-visibility.website.approve')}</Button> : item.recheck && item.recheck.state !== 'stopped' ? <><p className={s.line}>{t(item.recheck.state === 'held' ? 'pb-seo-visibility.website.held' : 'pb-seo-visibility.website.scheduled')}</p><Button disabled={busy} onClick={()=>void act('stop-recheck',{})}>{t('pb-seo-visibility.website.stop')}</Button></> : <>
    {item.recheck?.state === 'stopped' && <p className={s.line}>{t('pb-seo-visibility.website.stopped')}</p>}
    <p className={s.line}>{t('pb-seo-visibility.website.scheduleHint')}</p>
    <Button variant="primary" disabled={busy} onClick={() => void act('schedule', {})}>{t('pb-seo-visibility.website.schedule')}</Button>
   </>}
  </div>}
 </Tile>;
}
