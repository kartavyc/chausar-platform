/** Social channel cards use engine-computed formats and source inventory. */
import { useId, useState } from 'react';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError } from '../../../engine/types';
import { useT } from '../../../text';
import { Tile, TileHead } from '../../../parts/Tile';
import { Button } from '../../../parts/Button';
import { Figure } from '../../../parts/Figure';
import { Field } from '../../../parts/Field';
import type { SocialCanvasView, CanvasPost } from '../../../../../../platform/runtime/venture/playbooks/social/canvas';
import type { RevisionQuote } from '../../../../../../platform/runtime/venture/playbooks/social/revision-types';
import s from './SocialCanvas.module.css';
const base = { playbook: 'social-agency' as const, kind: 'canvas' };
export function SocialCanvas() {
    const t = useT(), engine = useEngine(), id = useId();
    const orders = useResource('venture.order.list', {}), view = useResource('venture.desk.list', base, { refreshOn: event => event.type === 'desk.changed' || event.type === 'run.step' });
    const [orderId, setOrder] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('socialOrder') ?? ''), [edit, setEdit] = useState<{
        post: CanvasPost;
        digest: string;
    } | null>(null), [words, setWords] = useState(''), [quote, setQuote] = useState<RevisionQuote | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [said, setSaid] = useState('');
    const rows = (view.data?.rows ?? []) as SocialCanvasView[], chosen = orderId || rows[0]?.orderId || '', item = rows.find(row => row.orderId === chosen);
    function failed(cause: unknown) {
        const code = cause instanceof EngineError ? cause.code : '';
        setError(t(['OFFER_EXTRA_ROUND', 'SOCIAL_POST_REQUIRED', 'SOCIAL_REVISION_SHAPE'].includes(code) ? 'pb-social.error.' + code : 'pb-social.changed'));
    }
    async function select(post: CanvasPost) { setBusy(true); setError(''); setSaid(''); try {
        const shown = await engine.request('venture.desk.get', { playbook: 'social-agency', kind: 'revision', id: post.id });
        setEdit({ post, digest: shown.digest });
        setWords('');
        setQuote(null);
    }
    catch (cause) {
        failed(cause);
    }
    finally {
        setBusy(false);
    } }
    async function revise(approved?: RevisionQuote) {
        if (!edit || busy || !words.trim())
            return;
        setBusy(true);
        setError('');
        try {
            const payload = { runId: edit.post.runId, postId: edit.post.id, words };
            if (!approved) {
                const preview = await engine.request('venture.desk.act', { playbook: 'social-agency', kind: 'revision', id: edit.post.id, action: 'quote', digest: edit.digest, payload });
                const priced = preview.result as RevisionQuote | null;
                if (priced?.digest) {
                    setQuote(priced);
                    return;
                }
            }
            await engine.request('venture.desk.act', { playbook: 'social-agency', kind: 'revision', id: edit.post.id, action: 'revise', digest: edit.digest, payload: { ...payload, ...(approved ? { quoteDigest: approved.digest } : {}) } });
            setEdit(null);
            setQuote(null);
            setSaid(t('pb-social.waiting'));
            view.reload();
        }
        catch (cause) {
            setQuote(null);
            failed(cause);
        }
        finally {
            setBusy(false);
        }
    }
    return <section className={s.stack} aria-label={t('pb-social.title')}>
  <div className={s.intro}><h2>{t('pb-social.title')}</h2><p>{t('pb-social.boundary')}</p>
   <label htmlFor={`${id}-order`}>{t('pb-social.order')}</label><select id={`${id}-order`} className={s.select} value={chosen} onChange={event => { setOrder(event.target.value); setEdit(null); setQuote(null); }}><option value="">{t('pb-social.choose')}</option>{rows.map(row => <option key={row.orderId} value={row.orderId}>{orders.data?.find(order => order.id === row.orderId)?.request ?? row.request}</option>)}</select>
  </div>
  {(error || view.error) && <p role="alert">{error || t('pb-social.failed')}</p>}{said && <p role="status">{said}</p>}
  {!item && <p>{t('pb-social.empty')}</p>}
  {item?.sourceProblem && <p role="alert">{t('pb-social.sourceProblem')}</p>}
  {item?.inventory && <Tile as="section" label={t('pb-social.inventory')}><TileHead title={t('pb-social.inventory')}/><dl className={s.counts}>{Object.entries(item.inventory.counts).map(([kind, count]) => <div key={kind}><dt>{t(`pb-social.count.${kind}`)}</dt><dd>{String(count)}</dd></div>)}</dl></Tile>}
  {item?.cards.map(card => <Tile key={card.channel} as="section" label={t(`pb-social.channel.${card.channel}`)}><TileHead title={t(`pb-social.channel.${card.channel}`)} meta={t(`pb-social.format.${card.format}`)}/><ul className={s.trace}>{card.trace.map(trace => <li key={trace}>{t(`pb-social.trace.${trace}`)}</li>)}</ul>
   {!card.posts.length && <p>{t('pb-social.noDraft')}</p>}
   {card.posts.map(post => <div key={post.id} className={s.post}><p data-content>{post.text}</p>{post.plan && <dl className={s.counts}><div><dt>{t('pb-social.kind')}</dt><dd>{t('pb-social.kind.' + post.plan.kind)}</dd></div><div><dt>{t('pb-social.goal')}</dt><dd data-content>{post.plan.goals.join('; ')}</dd></div><div><dt>{t('pb-social.action')}</dt><dd data-content>{post.plan.actions.join('; ')}</dd></div><div><dt>{t('pb-social.hook')}</dt><dd data-content>{post.plan.hookFormula}</dd></div></dl>}{edit?.post.id !== post.id && <Button disabled={busy} onClick={() => void select(post)}>{t('pb-social.refine')}</Button>}
    {edit?.post.id === post.id && <div className={s.edit}><Field label={t('pb-social.change')} value={words} maxLength={300} onChange={event => { setWords(event.target.value); setQuote(null); }}/>{quote && <p>{t('pb-social.extraLabel')} <Figure value={quote.display} receiptId={quote.receiptId} /></p>}<div className={s.actions}><Button variant="primary" locked={!words.trim()} disabled={busy} onClick={() => void revise(quote ?? undefined)}>{quote ? t('pb-social.approveExtra') : t('pb-social.preview')}</Button><Button disabled={busy} onClick={() => { setEdit(null); setQuote(null); }}>{t('common.cancel')}</Button></div></div>}
   </div>)}
  </Tile>)}
 </section>;
}
