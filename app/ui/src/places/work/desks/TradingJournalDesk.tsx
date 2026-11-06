// The trading journal on Work (wave 6, package 6E7): import a broker tradebook, read every charge and the realised
// profit or loss from the engine's receipt, add opening holdings and prepare a tax pack for the owner's CA. Every amount
// is the engine's own text with its receipt; the screen computes nothing and never says what to trade.
import { useState } from 'react';
import { useT } from '../../../text';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError, type DeskActView } from '../../../engine/types';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import { Figure } from '../../../parts/Figure';
import { Tile, TileHead } from '../../../parts/Tile';
import { TAX_YEARS } from '../../../../../../platform/runtime/venture/playbooks/trading-journal/tax-rules';
import type { JournalItem } from '../../../../../../platform/runtime/venture/playbooks/trading-journal/desk-core';
import s from './TradingJournal.module.css';
import { Fold } from '../../../parts/Fold';

const desk = { playbook: 'trading-journal' as const, kind: 'journal' };
const BROKERS = ['zerodha', 'groww', 'upstox', 'dhan'] as const;
type Act = (action: string, payload: unknown) => Promise<DeskActView | null>;

export function TradingJournalDesk() {
  const t = useT(), w = (key: string, values?: Record<string, string>) => t('pb-trading.' + key, values);
  const engine = useEngine();
  const refreshOn = (event: { type: string }) => event.type === 'desk.changed';
  const detail = useResource('venture.desk.get', { ...desk, id: 'journal' }, { refreshOn });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [line, setLine] = useState('');
  const item = detail.data?.item as JournalItem | undefined;

  const act: Act = async (action, payload) => {
    if (busy) return null;
    setBusy(true); setError(''); setLine('');
    try {
      const result = await engine.request('venture.desk.act', { ...desk, id: 'new', action, payload: payload as never });
      setLine(String(result.line)); detail.reload();
      return result;
    } catch (e) {
      const key = 'pb-trading.error.' + (e instanceof EngineError ? e.code : 'REQUEST_FAILED'), known = t(key);
      setError(known !== key ? known : e instanceof EngineError ? e.message : w('error.REQUEST_FAILED'));
      return null;
    } finally { setBusy(false); }
  };

  return (
    <section className={s.stack} aria-label={w('title')}>
      <Tile as="section" label={w('title')}>
        <TileHead title={w('title')} />
        <p className={s.line}>{w('intro')}</p>
        <ImportForm busy={busy} act={act} />
        {error && <p role="alert" className={s.error}>{error}</p>}
        {line && <p role="status" className={s.line}>{line}</p>}
        {item && item.imports.length > 0 && (
          <ul className={s.list} aria-label={w('imports')}>
            {item.imports.map(row => <li key={row.id} className={s.row}><span data-content>{row.brokerName}: {row.name}</span>{!row.formatChecked && <span className={s.line}>{w('unchecked')}</span>}</li>)}
          </ul>
        )}
      </Tile>
      {item?.summary && (
        <Tile as="section" label={w('summary')}>
          <TileHead title={w('summary')} />
          <ul className={s.list}>
            {item.summary.figures.map(figure => <li key={figure.key} className={s.row}><span className={s.label}>{figure.label}</span><Figure value={figure.display} receiptId={item.summary!.receiptId} /></li>)}
          </ul>
          {item.journal && item.journal.unmatched.length > 0 && (
            <>
              <h3 className={s.head}>{w('unmatched')}</h3>
              <ul className={s.list}>{item.journal.unmatched.map(row => <li key={`${row.symbol}-${row.date}`} className={s.line}><span data-content>{row.symbol} {row.date}</span> {row.line}</li>)}</ul>
            </>
          )}
        </Tile>
      )}
      <Tile as="section" label={w('opening')}>
        <Fold summary={w('opening')}><OpeningForm busy={busy} act={act} /></Fold>
      </Tile>
      <Tile as="section" label={w('pack')}>
        <TileHead title={w('pack')} />
        <PackForm busy={busy} act={act} />
        {item?.packs.map(pack => (
          <article key={pack.id} className={s.pack} aria-label={pack.year}>
            <h3 className={s.head}>{pack.year}</h3>
            <p className={s.line}>{pack.line}</p>
            {pack.stale && <p className={s.line}>{w('stale')}</p>}
            <ul className={s.list}>
              {pack.figures.map(figure => <li key={figure.key} className={s.row}><span className={s.label}>{figure.label}</span><Figure value={figure.display} receiptId={pack.receiptId} /><span className={s.line}>{w('section', { section: figure.section })}</span></li>)}
            </ul>
          </article>
        ))}
      </Tile>
    </section>
  );
}

function ImportForm({ busy, act }: { busy: boolean; act: Act }) {
  const t = useT(), w = (key: string) => t('pb-trading.' + key);
  const [broker, setBroker] = useState('');
  const [file, setFile] = useState<File | null>(null);
  return (
    <form className={s.form} onSubmit={e => { e.preventDefault(); if (busy || !file) return; void file.text().then(csv => act('import', { broker: broker || null, name: file.name, csv })); }}>
      <label className={s.field}>{w('broker')}
        <select value={broker} onChange={e => setBroker(e.target.value)}>
          <option value="">{w('broker.auto')}</option>
          {BROKERS.map(id => <option key={id} value={id}>{w('broker.' + id)}</option>)}
        </select>
      </label>
      <Field label={w('file')} type="file" accept=".csv,text/csv" onChange={e => setFile(e.currentTarget.files?.[0] ?? null)} />
      <Button type="submit" variant="primary" aria-disabled={busy || !file}>{w('import')}</Button>
    </form>
  );
}

function OpeningForm({ busy, act }: { busy: boolean; act: Act }) {
  const t = useT(), w = (key: string) => t('pb-trading.' + key);
  const [v, setV] = useState({ symbol: '', isin: '', boughtOn: '', quantity: '', cost: '', fmv: '' });
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });
  const ready = v.symbol && v.boughtOn && v.quantity && v.cost;
  return (
    <form className={s.form} onSubmit={e => { e.preventDefault(); if (busy || !ready) return; void act('add-opening', { symbol: v.symbol.trim(), isin: v.isin.trim() || null, boughtOn: v.boughtOn, quantity: v.quantity.trim(), cost: v.cost.trim(), fmv: v.fmv.trim() || null }); }}>
      <Field label={w('symbol')} value={v.symbol} onChange={set('symbol')} maxLength={40} />
      <Field label={w('isin')} value={v.isin} onChange={set('isin')} maxLength={12} />
      <Field label={w('boughtOn')} type="date" value={v.boughtOn} onChange={set('boughtOn')} />
      <Field label={w('quantity')} inputMode="numeric" value={v.quantity} onChange={set('quantity')} />
      <Field label={w('cost')} inputMode="decimal" value={v.cost} onChange={set('cost')} />
      <Field label={w('fmv')} hint={w('fmvHelp')} inputMode="decimal" value={v.fmv} onChange={set('fmv')} />
      <Button type="submit" aria-disabled={busy || !ready}>{w('saveOpening')}</Button>
    </form>
  );
}

function PackForm({ busy, act }: { busy: boolean; act: Act }) {
  const t = useT(), w = (key: string) => t('pb-trading.' + key);
  const [year, setYear] = useState<string>(TAX_YEARS[0]!.id);
  return (
    <form className={s.form} onSubmit={e => { e.preventDefault(); if (!busy) void act('tax-pack', { yearId: year }); }}>
      <label className={s.field}>{w('year')}
        <select value={year} onChange={e => setYear(e.target.value)}>{TAX_YEARS.map(y => <option key={y.id} value={y.id}>{y.label}</option>)}</select>
      </label>
      <Button type="submit" variant="primary" aria-disabled={busy}>{w('preparePack')}</Button>
    </form>
  );
}

TradingJournalDesk.ready = true;
