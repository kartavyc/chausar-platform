/** Lead research on Work. Sources, bounded drafts and due follow-ups; every message remains an owner handoff. */
import { useId, useState, type FormEvent } from 'react';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError } from '../../../engine/types';
import type { LeadDeskRow } from '../../../engine/fake-lead-generation';
import { useT } from '../../../text';
import { Tile, TileHead } from '../../../parts/Tile';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import { ExternalLink } from '../../connections/external';
import s from './LeadGenerationDesk.module.css';
import { CommunityLeadPanel } from './CommunityLeadPanel';
const base = { playbook: 'lead-generation' as const, kind: 'source' };
type SearchQuote = { query: string; credits: string; checkedOn: string; digest: string };
/** A quiet desk: today's prospects first, optional manual entries and paid network search one step away. */
export function LeadGenerationDesk() {
  const t = useT(), engine = useEngine(), heading = useId();
  const view = useResource('venture.desk.list', base, { refreshOn: event => event.type === 'desk.changed' || event.type === 'pipeline.changed' || event.type === 'queue.changed' });
  const [city, setCity] = useState(''), [vertical, setVertical] = useState('shop=bakery'), [count, setCount] = useState('10');
  const [ownOffer, setOwnOffer] = useState(''), [postalAddress, setPostalAddress] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [said, setSaid] = useState('');
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [company, setCompany] = useState(''), [source, setSource] = useState('referral');
  const [query, setQuery] = useState(''), [key, setKey] = useState(''), [quote, setQuote] = useState<SearchQuote | null>(null), [searchUrl, setSearchUrl] = useState('');
  const rows = (view.data?.rows ?? []) as LeadDeskRow[], prospects = rows.filter(row => row.type === 'lead'), followups = rows.filter(row => row.type === 'followup');
  const rate = view.data?.line.match(/\d+/g) ?? [];
  const errorOf = (cause: unknown) => { const code = cause instanceof EngineError ? cause.code : 'REQUEST_FAILED'; const path = `pb-lead-generation.error.${code}`, words = t(path); return words === path ? t('pb-lead-generation.error.REQUEST_FAILED') : words; };
  async function act(action: string, payload: Record<string, unknown>, digest?: string) {
    setBusy(true); setError(''); setSaid('');
    try { const result = await engine.request('venture.desk.act', { ...base, id: 'new', action, payload, ...(digest ? { digest } : {}) }); view.reload(); return result; }
    catch (cause) { setError(errorOf(cause)); return null; } finally { setBusy(false); }
  }
  async function research(event: FormEvent) { event.preventDefault(); if (await act('run', { city, vertical, count, ownOffer, postalAddress })) setSaid(t('pb-lead-generation.ready')); }
  async function manual(event: FormEvent) { event.preventDefault(); if (await act('manual', { name, email, company, source })) { setName(''); setEmail(''); setCompany(''); setSaid(t('pb-lead-generation.manualReady')); } }
  async function preview(event: FormEvent) { event.preventDefault(); const answer = await act('quote', { query }); if (answer) setQuote(answer.result as SearchQuote); }
  async function paidSearch(event: FormEvent) { event.preventDefault(); if (!quote || !key.trim()) return; const answer = await act('search', { query: quote.query, key, approvedDigest: quote.digest }, quote.digest); setKey(''); if (answer) { const result = answer.result as { state: string; value?: { url?: string } }; if (result.state === 'applied' && result.value?.url) { setSearchUrl(result.value.url); setSaid(t('pb-lead-generation.fromHappenstance')); } else setError(t('pb-lead-generation.error.HAPPENSTANCE_SEARCH_UNCONFIRMED')); setQuote(null); } }
  return <div className={s.stack}>
    <Tile as="section" labelledBy={heading}>
      <TileHead id={heading} title={t('pb-lead-generation.heading')} />
      <p className={s.line}>{t('pb-lead-generation.boundary')}</p>
      {(error || view.error) && <p className={s.error} role="alert">{error || errorOf(view.error)}</p>}
      {said && <p className={s.line} role="status">{said}</p>}
      <form className={s.form} aria-label={t('pb-lead-generation.researchForm')} onSubmit={research}>
        <div className={s.pair}>
          <Field label={t('pb-lead-generation.city')} value={city} onChange={event => setCity(event.target.value)} required />
          <label className={s.label}>{t('pb-lead-generation.vertical')}<select value={vertical} onChange={event => setVertical(event.target.value)}><option value="shop=bakery">{t('pb-lead-generation.bakery')}</option><option value="amenity=cafe">{t('pb-lead-generation.cafe')}</option><option value="amenity=clinic">{t('pb-lead-generation.clinic')}</option><option value="shop=hairdresser">{t('pb-lead-generation.salon')}</option></select></label>
        </div>
        <Field label={t('pb-lead-generation.offer')} value={ownOffer} onChange={event => setOwnOffer(event.target.value)} required />
        <Field label={t('pb-lead-generation.address')} hint={t('pb-lead-generation.addressHint')} value={postalAddress} onChange={event => setPostalAddress(event.target.value)} required />
        <details><summary>{t('pb-lead-generation.limit')}</summary><Field label={t('pb-lead-generation.count')} inputMode="numeric" value={count} onChange={event => setCount(event.target.value)} /></details>
        <Button type="submit" variant="primary" disabled={busy}>{t('pb-lead-generation.research')}</Button>
      </form>
      <p className={s.line}>{t('pb-lead-generation.osmNotice')}</p>
      {rate.length === 2 && <p className={s.line}>{t('pb-lead-generation.found', { found: rate[0] ?? '', total: rate[1] ?? '' })}</p>}
      {prospects.length === 0 && <p className={s.line}>{t('pb-lead-generation.empty')}</p>}
      {prospects.length > 0 && <ul className={s.list}>{prospects.map(row => <li key={row.id}>
        <div className={s.row}><strong data-content>{row.name}</strong><span>{t(`pb-lead-generation.status.${row.status}`)}</span></div>
        {row.email && <p className={s.line} data-content>{row.email}</p>}
        <p className={s.line}>{row.sourceUrl ? <><ExternalLink href={row.sourceUrl}>{t('pb-lead-generation.source')}</ExternalLink><span> {row.licence}</span></> : t('pb-lead-generation.ownerSource')}</p>
        {row.draft && <details><summary>{t('pb-lead-generation.readDraft')}</summary><p className={s.draft} data-content>{row.draft}</p><p className={s.line}>{t('pb-lead-generation.sendYourself')}</p></details>}
      </li>)}</ul>}
      <p><a href="#/clients/pipeline">{t('pb-lead-generation.pipeline')}</a></p>
    </Tile>
    <Tile as="section" label={t('pb-lead-generation.followups')}>
      <TileHead title={t('pb-lead-generation.followups')} />
      {followups.length ? <ul className={s.list}>{followups.map(row => <li key={row.id}><span data-content>{row.name}</span><p className={s.line}>{t('pb-lead-generation.due', { day: row.due ?? '' })}</p><a href="#/clients/pipeline">{t('pb-lead-generation.reviewFollowup')}</a></li>)}</ul> : <p className={s.line}>{t('pb-lead-generation.noFollowups')}</p>}
    </Tile>
    <Tile as="section" label={t('pb-lead-generation.manual')}>
      <details><summary>{t('pb-lead-generation.manual')}</summary><form className={s.form} aria-label={t('pb-lead-generation.manual')} onSubmit={manual}>
        <Field label={t('pb-lead-generation.name')} value={name} onChange={event => setName(event.target.value)} required />
        <Field label={t('pb-lead-generation.email')} type="email" value={email} onChange={event => setEmail(event.target.value)} required />
        <Field label={t('pb-lead-generation.company')} value={company} onChange={event => setCompany(event.target.value)} />
        <label className={s.label}>{t('pb-lead-generation.cameFrom')}<select value={source} onChange={event => setSource(event.target.value)}><option value="referral">{t('pb-lead-generation.referral')}</option><option value="walk-in">{t('pb-lead-generation.walkin')}</option></select></label>
        <Button type="submit" disabled={busy}>{t('pb-lead-generation.addManual')}</Button>
      </form></details>
    </Tile>
    <Tile as="section" label={t('pb-lead-generation.happenstance')}>
      <details><summary>{t('pb-lead-generation.happenstance')}</summary>
        <p className={s.line}>{t('pb-lead-generation.happenstanceBoundary')}</p>
        <form className={s.form} onSubmit={preview} aria-label={t('pb-lead-generation.happenstance')}><Field label={t('pb-lead-generation.query')} value={query} onChange={event => { setQuery(event.target.value); setQuote(null); }} required /><Button type="submit" disabled={busy}>{t('pb-lead-generation.showCost')}</Button></form>
        {quote && <form className={s.form} onSubmit={paidSearch} aria-label={t('pb-lead-generation.paidApproval')}><p className={s.line}>{t('pb-lead-generation.credits', { credits: quote.credits, on: quote.checkedOn })}</p><p data-content>{quote.query}</p><Field label={t('pb-lead-generation.key')} hint={t('pb-lead-generation.keyHint')} type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} /><Button type="submit" disabled={busy} locked={!key.trim()} lockedReason={t('pb-lead-generation.keyRequired')}>{t('pb-lead-generation.approveSearch')}</Button></form>}
        {searchUrl && <p><ExternalLink href={searchUrl}>{t('pb-lead-generation.openSearch')}</ExternalLink></p>}
      </details>
    </Tile>
    <CommunityLeadPanel />
  </div>;
}
LeadGenerationDesk.ready = true;
