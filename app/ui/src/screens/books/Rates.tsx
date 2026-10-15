/**
 * BK-19 exchange rates, under Meanings: the dated, sourced rates the owner entered, the rows
 * left "not counted" for want of a rate, and an entry form. A rate is shown and sent as two
 * whole numbers (rupees per units of the currency); the screen never works with a float.
 */
import { useState, type FormEvent } from 'react';
import { Field } from '../../parts/Field';
import { Section, Note, Refusal, Actions, Button } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { day } from '../work/kit/format.ts';
import { rateRow, ratesReply, removeRateReply, type RateRow } from './contract.ts';
import { BooksPage, ConfirmButton, Link, Table, approves, fill, styles as s, valueOf, type BooksProps } from './shared.tsx';
import { useMoreWords } from './words-more.ts';
import { useR4bWords } from './words-r4b.ts';
import { dayIn, useZone } from './r4b-parts.tsx';

/** "83.2150" → { units: '832150', per: '10000' }, by text only. */
export function rateOf(text: string): { units: string; per: string } | null {
  const match = /^(\d{1,12})(?:\.(\d{1,8}))?$/.exec(text.trim());
  if (!match) return null;
  const fraction = match[2] ?? ''; const units = `${match[1]}${fraction}`.replace(/^0+(?=\d)/, '');
  if (!/^[1-9]\d*$/.test(units)) return null;
  return { units, per: `1${'0'.repeat(fraction.length)}` };
}
/** A rate as written: a power-of-ten denominator is shown as a decimal, any other as the two numbers. */
function written(rate: RateRow['rate'], currency: string, w: ReturnType<typeof useMoreWords>): string {
  if (/^10*$/.test(rate.per)) {
    const places = rate.per.length - 1; const digits = rate.units.padStart(places + 1, '0');
    const value = places === 0 ? digits : `${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`;
    return fill(w['rates.rate'], { rate: value, currency });
  }
  return fill(w['rates.fraction'], { units: rate.units, per: rate.per, currency });
}

export function Rates(props: BooksProps) {
  const w = useMoreWords(props.language);
  const { loaded, reload } = useReply(props, 'books.rates', {}, ratesReply);
  const value = valueOf(loaded);
  const act = useAct(props.rpc);
  const admin = approves(props);
  const remove = async (row: RateRow) => { if ((await act.run('books.removeRate', { currency: row.currency, on: row.on }, removeRateReply)).ok) reload(); };
  return (
    <BooksPage props={props} sub="meanings" title={w['rates.title']} count={value ? String(value.rates.length) : undefined} loaded={loaded} reload={reload}
      aside={<Link onPress={() => props.navigate({ place: 'books', sub: 'meanings' })}>{w['rates.back']}</Link>}>
      <Note>{w['rates.note']}</Note>
      {value && (
        <>
          {value.notCounted.length === 0 ? <Note>{w['rates.allCounted']}</Note>
            : value.notCounted.map(n => <p key={n.currency} className={s.amber} data-not-counted={n.currency}>{fill(w['rates.notCounted'], { rows: n.rows, currency: n.currency })}</p>)}
          {value.fromReceipts && <FromReceipts props={props} value={value.fromReceipts} />}
          {value.rates.length === 0 ? <Note>{w['rates.empty']}</Note> : (
            <Table view={props.view} caption={w['rates.title']} columns={[
              { head: w['rates.col.currency'], simple: true }, { head: w['rates.col.on'], simple: true }, { head: w['rates.col.rate'], num: true, simple: true },
              { head: w['rates.col.source'] }, { head: w['rates.col.by'] }, ...(admin ? [{ head: '' }] : []),
            ]} rows={value.rates.map(r => ({ key: `${r.currency}-${r.on}`, cells: [
              r.currency, day(r.on, props.language), <span className="fig">{written(r.rate, r.currency, w)}</span>, r.source, r.enteredBy,
              ...(admin ? [<ConfirmButton label={w['rates.remove']} confirm={w['rates.removeConfirm']} keep={w['del.cancel']} disabled={act.busy} onConfirm={() => { void remove(r); }} />] : []),
            ] }))} />
          )}
        </>
      )}
      <Refusal code={act.refusal} language={props.language} />
      {admin && <RateForm props={props} onDone={reload} />}
    </BooksPage>
  );
}

/** BK-19, round 4: the not-counted count as receipts carry it, once core-data puts it there. Each line opens its receipt. */
function FromReceipts({ props, value }: { props: BooksProps; value: NonNullable<ReturnType<typeof ratesReply>['fromReceipts']> }) {
  const k = useR4bWords(props.language); const zone = useZone(props);
  return (
    <Section title={k['rates.fromReceipts']}>
      {!value.available ? <Note>{k['rates.receiptsWait']}</Note> : value.receipts.length === 0 ? <Note>{k['rates.receiptsNone']}</Note> : (
        <ul className={s.list}>{value.receipts.flatMap(r => r.notCounted.map(n => (
          <li key={`${r.receiptId}-${n.currency}`} data-receipt-not-counted={r.receiptId}>
            <Link onPress={() => props.openReceipt(r.receiptId)}>{fill(k['rates.receiptLine'], { operation: r.operation, when: dayIn(r.at, props.language, zone), rows: n.rows, currency: n.currency })}</Link>
          </li>)))}</ul>
      )}
    </Section>
  );
}

function RateForm({ props, onDone }: { props: BooksProps; onDone: () => void }) {
  const w = useMoreWords(props.language);
  const act = useAct(props.rpc);
  const [currency, setCurrency] = useState('');
  const [on, setOn] = useState('');
  const [rate, setRate] = useState('');
  const [source, setSource] = useState('');
  const parsed = rateOf(rate);
  const code = currency.trim().toUpperCase();
  const ready = /^[A-Z]{3}$/.test(code) && /^\d{4}-\d{2}-\d{2}$/.test(on) && parsed !== null && source.trim().length > 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!ready || !parsed) return;
    if ((await act.run('books.setRate', { currency: code, on, rate: parsed, source: source.trim() }, rateRow)).ok) { setRate(''); setSource(''); onDone(); }
  };
  return (
    <Section title={w['rates.add']}>
      <form className={s.form} aria-label={w['rates.add']} onSubmit={e => { void submit(e); }}>
        <Field label={w['rates.currency']} value={currency} maxLength={3} onChange={e => setCurrency(e.target.value)} />
        <Field label={w['rates.on']} type="date" value={on} onChange={e => setOn(e.target.value)} />
        <Field label={w['rates.value']} inputMode="decimal" prefix="₹" value={rate} onChange={e => setRate(e.target.value)} problem={rate && !parsed ? w['rates.problem'] : undefined} />
        <Field label={w['rates.source']} value={source} onChange={e => setSource(e.target.value)} />
        <Actions><Button submit disabled={!ready || act.busy}>{w['rates.save']}</Button></Actions>
        <Refusal code={act.refusal} language={props.language} />
      </form>
    </Section>
  );
}
