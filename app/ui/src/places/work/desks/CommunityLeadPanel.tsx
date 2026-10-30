/** Owner-pasted community evidence, explicit permission and quoted scores. No external action. */
import { useState, type FormEvent } from 'react';
import { useEngine, useResource } from '../../../engine/context';
import { useT } from '../../../text';
import { Tile } from '../../../parts/Tile';
import { Field } from '../../../parts/Field';
import { Button } from '../../../parts/Button';
import { ExternalLink } from '../../connections/external';
import type { CommunityInput, CommunityPost } from '../../../../../../platform/runtime/venture/playbooks/lead-generation/community-core';
import s from './LeadGenerationDesk.module.css';
const base = { playbook: 'lead-generation' as const, kind: 'source' };
type Report = { sourceId: string; posts: CommunityPost[]; coverage: string };
const fresh = () => ({ community: '', url: '', rulesUrl: '', rulesCheckedOn: '', on: '', text: '', painQuote: '', fitQuote: '', intentQuote: '', painScore: '1', fitScore: '1', intentScore: '1' });
export function CommunityLeadPanel() {
  const t = useT(), engine = useEngine();
  const saved = useResource('venture.desk.list', base, { refreshOn: event => event.type === 'desk.changed' });
  const [product, setProduct] = useState(''), [problem, setProblem] = useState(''), [categories, setCategories] = useState(''), [painWords, setPainWords] = useState(''), [days, setDays] = useState('7');
  const [posts, setPosts] = useState([fresh()]), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [report, setReport] = useState<Report | null>(null);
  const change = (index: number, key: keyof ReturnType<typeof fresh>, value: string) => { setPosts(old => old.map((post, i) => i === index ? { ...post, [key]: value } : post)); setConfirmed(false); };
  const list = (value: string) => value.split(',').map(word => word.trim()).filter(Boolean);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const payload: CommunityInput = { product, confirmed, problem, categories: list(categories), painWords: list(painWords), days: Number(days), posts: posts.map((post, index) => ({ id: 'post-' + index, community: post.community, url: post.url, rulesUrl: post.rulesUrl, rulesCheckedOn: post.rulesCheckedOn, readingAllowed: confirmed, on: post.on, text: post.text, removed: /^\[(removed|deleted)\]$/i.test(post.text.trim()), votes: (['pain', 'fit', 'intent'] as const).map(dimension => ({ dimension, score: Number(post[(dimension + 'Score') as keyof typeof post]), quote: post[(dimension + 'Quote') as keyof typeof post] })) })) };
    try { const answer = await engine.request('venture.desk.act', { ...base, id: 'new', action: 'community', payload }); setReport(answer.result as Report); saved.reload(); }
    catch { setError(t('pb-lead-generation.error.REQUEST_FAILED')); } finally { setBusy(false); }
  }
  async function forget() {
    if (!report) return; setBusy(true); setError('');
    try { await engine.request('venture.desk.act', { ...base, id: report.sourceId, action: 'forget-community', payload: {} }); setReport(null); setPosts([fresh()]); setProduct(''); setProblem(''); setConfirmed(false); saved.reload(); }
    catch { setError(t('pb-lead-generation.error.REQUEST_FAILED')); } finally { setBusy(false); }
  }
  async function read(id: string) { try { const answer = await engine.request('venture.desk.get', { ...base, id }); setReport(answer.item as Report); } catch { setError(t('pb-lead-generation.error.REQUEST_FAILED')); } }
  const coverage = report?.coverage.match(/\d+/g) ?? [];
  const rows = (saved.data?.rows ?? []) as { id: string; type: string; name: string }[];
  return <Tile as="section" label={t('pb-lead-generation.community')}><details><summary>{t('pb-lead-generation.community')}</summary>
    <p className={s.line}>{t('pb-lead-generation.communityBoundary')}</p>
    {error && <p className={s.error} role="alert">{error}</p>}
    <form className={s.form} aria-label={t('pb-lead-generation.community')} onSubmit={create}>
      <Field label={t('pb-lead-generation.product')} value={product} onChange={event => { setProduct(event.target.value); setConfirmed(false); }} required />
      <Field label={t('pb-lead-generation.problem')} value={problem} onChange={event => { setProblem(event.target.value); setConfirmed(false); }} required />
      <Field label={t('pb-lead-generation.categories')} value={categories} onChange={event => { setCategories(event.target.value); setConfirmed(false); }} required />
      <Field label={t('pb-lead-generation.painWords')} value={painWords} onChange={event => { setPainWords(event.target.value); setConfirmed(false); }} />
      <Field label={t('pb-lead-generation.days')} value={days} type="number" min="1" max="90" onChange={event => { setDays(event.target.value); setConfirmed(false); }} required />
      {posts.map((post, index) => <div key={index} className={s.form}>
        {([['community', 'communityName'], ['url', 'postUrl'], ['rulesUrl', 'rulesUrl'], ['rulesCheckedOn', 'rulesOn'], ['on', 'postOn']] as const).map(([key, label]) => <Field key={key} label={t('pb-lead-generation.' + label)} value={post[key]} type={key === 'on' || key === 'rulesCheckedOn' ? 'date' : key === 'url' || key === 'rulesUrl' ? 'url' : 'text'} onChange={event => change(index, key, event.target.value)} required />)}
        <label className={s.label}>{t('pb-lead-generation.postText')}<textarea value={post.text} onChange={event => change(index, 'text', event.target.value)} required /></label>
        {(['pain', 'fit', 'intent'] as const).map(dimension => <div key={dimension} className={s.pair}>
          <Field label={t('pb-lead-generation.' + dimension + 'Quote')} value={post[(dimension + 'Quote') as keyof typeof post]} onChange={event => change(index, (dimension + 'Quote') as keyof typeof post, event.target.value)} required />
          <label className={s.label}>{t('pb-lead-generation.' + dimension + 'Score')}<select value={post[(dimension + 'Score') as keyof typeof post]} onChange={event => change(index, (dimension + 'Score') as keyof typeof post, event.target.value)}>{[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score}</option>)}</select></label>
        </div>)}
      </div>)}
      <Button type="button" disabled={busy || posts.length >= 100} onClick={() => { setPosts(old => [...old, fresh()]); setConfirmed(false); }}>{t('pb-lead-generation.addPost')}</Button>
      <label className={s.line}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t('pb-lead-generation.confirmCommunity')}</label>
      <Button type="submit" disabled={busy} locked={!confirmed} lockedReason={t('pb-lead-generation.confirmCommunity')}>{t('pb-lead-generation.makeCommunity')}</Button>
    </form>
    {report && <div className={s.form}>
      <p className={s.line}>{t('pb-lead-generation.covered', { covered: coverage[0] ?? '0', days: coverage[1] ?? days })}</p>
      {!report.posts.length && <p className={s.line}>{t('pb-lead-generation.noMatch')}</p>}
      {report.posts.map(post => <div key={post.id}><ExternalLink href={post.url}>{t('pb-lead-generation.source')}</ExternalLink>{post.votes.map(vote => <div key={vote.dimension}><p className={s.line}>{t('pb-lead-generation.' + vote.dimension + 'Score')}: {vote.score}</p><blockquote className={s.draft} data-content>{vote.quote}</blockquote></div>)}</div>)}
      <Button disabled={busy} onClick={() => void forget()}>{t('pb-lead-generation.forgetCommunity')}</Button>
    </div>}
    {rows.filter(row => row.type === 'community').map(row => <p className={s.line} key={row.id}><span data-content>{row.name}</span> <Button onClick={() => void read(row.id)}>{t('pb-lead-generation.readCommunity')}</Button></p>)}
  </details></Tile>;
}
