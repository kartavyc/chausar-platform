/** Chausar bounded SEO monitor controls. beyondseo (MIT), original Ink interface. */
import { useState } from 'react';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError } from '../../../engine/types';
import { useT } from '../../../text';
import { Tile, TileHead } from '../../../parts/Tile';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import type { SeoMonitorItem } from '../../../../../../platform/runtime/venture/playbooks/seo-visibility/monitor-core';
import s from './SeoVisibilityDesk.module.css';
const base = { playbook: 'seo-visibility' as const, kind: 'monitor' };
/** Configure first, then approve the exact site, count, interval and evidence destination. */
export function SeoMonitors() {
    const t = useT(), engine = useEngine();
    const list = useResource('venture.desk.list', base, { refreshOn: event => event.type === 'desk.changed' });
    const [adding, setAdding] = useState(false), [url, setUrl] = useState(''), [root, setRoot] = useState(''), [cycles, setCycles] = useState('10'), [interval, setInterval] = useState('60');
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const rows = (list.data?.rows ?? []) as SeoMonitorItem[];
    async function act(action: string, id = 'new') {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            const detail = id === 'new' ? null : await engine.request('venture.desk.get', { ...base, id });
            if (detail && JSON.stringify(detail.item) !== JSON.stringify(rows.find(row => row.id === id))) {
                list.reload();
                throw new EngineError('MONITOR_STALE', 'The displayed monitor changed.');
            }
            await engine.request('venture.desk.act', { ...base, id, action, payload: action === 'create' ? { url, root, cycles: Number(cycles), intervalSeconds: Number(interval) } : {}, ...(detail ? { digest: detail.digest } : {}) });
            setAdding(false);
            list.reload();
        }
        catch (cause) {
            const key = 'pb-seo-visibility.error.' + (cause instanceof EngineError ? cause.code : 'REQUEST_FAILED');
            const words = t(key);
            setError(words === key ? t('pb-seo-visibility.error.REQUEST_FAILED') : words);
        }
        finally {
            setBusy(false);
        }
    }
    return <Tile as="section" label={t('pb-seo-visibility.monitor.title')}>
 <TileHead title={t('pb-seo-visibility.monitor.title')} end={<Button variant="quiet" onClick={() => setAdding(value => !value)}>{t('pb-seo-visibility.monitor.new')}</Button>}/>
 <p className={s.line}>{t('pb-seo-visibility.monitor.boundary')}</p>
 {error && <p role="alert" className={s.error}>{error}</p>}
 {adding && <form className={s.form} onSubmit={event => { event.preventDefault(); void act('create'); }}>
 <Field label={t('pb-seo-visibility.monitor.url')} value={url} onChange={event => setUrl(event.target.value)} required/>
 <Field label={t('pb-seo-visibility.monitor.folder')} value={root} onChange={event => setRoot(event.target.value)} required/>
 <div className={s.pair}><Field label={t('pb-seo-visibility.monitor.cycles')} type="number" min="1" max="10000" value={cycles} onChange={event => setCycles(event.target.value)} required/><Field label={t('pb-seo-visibility.monitor.interval')} type="number" min="60" value={interval} onChange={event => setInterval(event.target.value)} required/></div>
 <Button variant="primary" type="submit" disabled={busy}>{t('pb-seo-visibility.monitor.review')}</Button>
 </form>}
 <ul className={s.list}>{rows.map(row => <li key={row.id}><div>
 <p className={s.line} data-content>{row.url}</p><p className={s.line}>{t('pb-seo-visibility.monitor.plan', { cycles: row.cycles, seconds: row.intervalSeconds })}</p><p className={s.line} data-content>{row.root}</p>
 <p className={s.line}>{t('pb-seo-visibility.monitor.state.' + row.state)}</p><p className={s.line}>{t('pb-seo-visibility.monitor.completed', { count: row.completed })}</p>
 {row.error && <p role="status">{t('pb-seo-visibility.monitor.held')}</p>}
 {row.state === 'draft' ? <Button disabled={busy} onClick={() => void act('approve', row.id)}>{t('pb-seo-visibility.monitor.approve')}</Button> : ['active', 'collecting'].includes(row.state) && <Button disabled={busy} onClick={() => void act('stop', row.id)}>{t('pb-seo-visibility.monitor.stop')}</Button>}
 {!!row.evidence.length && <details><summary>{t('pb-seo-visibility.monitor.evidence')}</summary><ul>{row.evidence.map(evidence => <li key={evidence.index} data-content>{evidence.folder}<br />{evidence.receipt}</li>)}</ul></details>}
 </div></li>)}</ul>
 </Tile>;
}
