// Chausar S12 schedule approval: exact post, destination and time, then one explicit owner decision.
import { useState } from 'react';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError } from '../../../engine/types';
import { useT } from '../../../text';
import { Tile, TileHead } from '../../../parts/Tile';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import { SCHEDULED_WORDS, type SocialScheduledItem } from '../../../../../../platform/runtime/venture/playbooks/social/scheduled-core';
import s from './SocialSchedule.module.css';
const base = { playbook: 'social-agency' as const, kind: 'scheduled' };
const stamp = (iso: string) => iso.replace('T', ' ').replace('.000Z', ' UTC');
export function SocialSchedule() {
    const t = useT(), engine = useEngine();
    const list = useResource('venture.desk.list', base, { refreshOn: event => event.type === 'desk.changed' }), queue = useResource('venture.queue.list', { scope: 'current' }, { refreshOn: event => event.type === 'queue.changed' || event.type === 'desk.changed' });
    const [adding, setAdding] = useState(false), [postId, setPostId] = useState(''), [channel, setChannel] = useState('x'), [time, setTime] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const rows = (list.data?.rows ?? []) as SocialScheduledItem[];
    const waiting = (queue.data?.rows ?? []).filter(row => row.kind === 'connector');
    const words = (key: string) => t('pb-social-scheduled.' + key);
    async function act(action: string, id = 'new') {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            const detail = id === 'new' ? null : await engine.request('venture.desk.get', { ...base, id });
            if (detail && JSON.stringify(detail.item) !== JSON.stringify(rows.find(row => row.id === id))) {
                list.reload();
                throw new EngineError('SLOT_STALE', 'This slot changed. Review it again.');
            }
            const payload = action === 'create' ? { postId: postId || null, connectorId: channel, dueAt: new Date(time).toISOString() } : {};
            await engine.request('venture.desk.act', { ...base, id, action, payload, ...(detail ? { digest: detail.digest } : {}) });
            setAdding(false);
            list.reload();
            queue.reload();
        }
        catch (cause) {
            const key = 'error.' + (cause instanceof EngineError ? cause.code : 'REQUEST_FAILED');
            const line = words(key);
            setError(line === ('pb-social-scheduled.' + key) ? words('error.REQUEST_FAILED') : line);
        }
        finally {
            setBusy(false);
        }
    }
    function reason(row: SocialScheduledItem) { const key = Object.entries(SCHEDULED_WORDS).find(([, line]) => line === row.reason)?.[0]; return key ? words('reason.' + key) : row.reason; }
    return <section className={s.stack} aria-label={words('heading')}>
 <Tile><TileHead title={words('heading')} end={<Button variant="quiet" onClick={() => setAdding(value => !value)}>{words('new')}</Button>}/><p className={s.line}>{words('boundary')}</p>{error && <p role="alert" className={s.error}>{error}</p>}
 {adding && <form className={s.form} onSubmit={event => { event.preventDefault(); void act('create'); }}>
 <label className={s.label}>{words('post')}<select value={postId} onChange={event => setPostId(event.target.value)}><option value="">{words('empty')}</option>{waiting.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
 <label className={s.label}>{words('channel')}<select value={channel} onChange={event => setChannel(event.target.value)}><option value="x">X</option><option value="instagram">Instagram</option><option value="youtube">YouTube</option>{['bluesky','mastodon','telegram','discord'].map(id=><option key={id} value={id}>{t('pb-open-posting.'+id)}</option>)}</select></label>
 <Field label={words('time')} type="datetime-local" value={time} onChange={event => setTime(event.target.value)} required/>
 <Button variant="primary" type="submit" disabled={busy}>{words('review')}</Button>
 </form>}</Tile>
 {rows.map(row => <Tile key={row.id} as="article" label={words('slot')}>
 <TileHead title={words('state.' + row.state)}/><p className={s.line} data-content>{row.connectorId}</p><p className={s.line} data-content>{row.text || words('empty')}</p>
 {row.postId && <><p className={s.line} data-content>{row.account ?? words('signedIn')}</p><p className={s.line}>{row.mode === 'api' ? words('api') : words('browser')}</p>{row.mode === 'owner-browser-session' && <><p className={s.line}>{words('consent')}</p><p className={s.line}>{words('risk')}</p></>}</>}
 <p className={s.line}>{words('due') + ' ' + stamp(row.dueAt)}</p><p className={s.line}>{words('deadline') + ' ' + stamp(row.deadlineAt)}</p><p className={s.line} data-content>{reason(row)}</p>
 <div className={s.actions}>{['draft', 'scheduled', 'waiting'].includes(row.state) && <Button disabled={busy} onClick={() => void act('cancel', row.id)}>{words('cancel')}</Button>}{row.state === 'draft' && <Button variant="primary" disabled={busy} onClick={() => void act('approve', row.id)}>{words('approve')}</Button>}</div>
 </Tile>)}
 </section>;
}
