/**
 * Reminders to customers (WK-12), at #/work/reminders: today's limits in write-back's own time
 * zone, the reminders prepared so far, and "Prepare a reminder": pick a customer from the Books
 * records (records.search), one of their invoices (records.get) and the mail or WhatsApp
 * connection, then approvals.prepareReminder. Nothing is sent: the reminder waits in Approvals.
 */
import { useState, type FormEvent } from 'react';
import { RowList } from '../../parts/RowList';
import { useAct, useReply } from './kit/reply.ts';
import { dayTime } from './kit/format.ts';
import { Actions, Button, Note, Refusal, Section } from './kit/Page';
import { sheetOf } from './contract.ts';
import { customerRecord, customers, prepared, reminders, type CapsDay } from './contract-r4.ts';
import { MARK_OF } from './Approvals.tsx';
import { Frame, rowTitle, type WorkProps } from './shared.tsx';
import { LIVE, useLive } from './R4Parts.tsx';
import { r4Words, sayR4, type R4Words } from './text-r4.ts';
import s from './work.module.css';

function capsLine(c: CapsDay, r: R4Words): string | null {
  if (c.perDay === null || c.perCustomer === null) return null;
  if (c.timeZone !== null && c.today !== null && c.preparedToday !== null)
    return sayR4(r, 'rem.today', { today: c.today, zone: c.timeZone, prepared: c.preparedToday, perDay: c.perDay, sent: c.sentToday ?? 0, perCustomer: c.perCustomer });
  return sayR4(r, 'rem.limits', { perDay: c.perDay, perCustomer: c.perCustomer });
}

function PrepareForm({ p, connections, onPrepared }: { p: WorkProps; connections: readonly { id: string; label: string; system: 'mail' | 'whatsapp' }[]; onPrepared: () => void }) {
  const r = r4Words(p.language);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<readonly { id: string; name: string | null }[] | null>(null);
  const [customer, setCustomer] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<readonly string[] | null>(null);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [connection, setConnection] = useState<string | null>(connections[0]?.id ?? null);
  const [lang, setLang] = useState<'en' | 'hi'>(p.language);
  const [result, setResult] = useState<{ id: string | null; reason: string | null } | null>(null);
  const act = useAct(p.rpc);
  const search = async (event: FormEvent) => {
    event.preventDefault();
    const out = await act.run('records.search', { kind: 'customer', ...(query.trim() ? { text: query.trim() } : {}) }, customers);
    if (out.ok) { setFound(out.value.records.slice(0, 50)); setCustomer(null); setInvoices(null); setInvoice(null); }
  };
  const pick = async (id: string) => {
    setCustomer(id); setInvoice(null); setResult(null);
    const out = await act.run('records.get', { id }, customerRecord);
    if (out.ok) setInvoices([...new Set(out.value.timeline.filter(t => t.kind === 'invoice' && t.ref !== null).map(t => t.ref as string))]);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (customer === null || invoice === null || connection === null) return;
    const out = await act.run('approvals.prepareReminder', { connectionId: connection, customerId: customer, invoiceId: invoice, language: lang }, prepared);
    if (out.ok) { setResult({ id: out.value.id, reason: out.value.blocked?.reason ?? null }); onPrepared(); }
  };
  if (connections.length === 0) return <Note>{r['rem.noConnections']}</Note>;
  return (
    <div className={s.form} data-part="prepare-reminder">
      <form className={s.form} onSubmit={e => void search(e)}>
        <label>{r['rem.search']}<input value={query} maxLength={100} onChange={e => setQuery(e.currentTarget.value)} /></label>
        <Actions><Button submit variant="quiet" disabled={act.busy}>{r['rem.searchGo']}</Button></Actions>
      </form>
      {found !== null && (found.length === 0 ? <Note>{r['rem.noCustomers']}</Note> : (
        <fieldset className={s.form}>
          <legend>{r['rem.customer']}</legend>
          {found.map(c => <label key={c.id}><span><input type="radio" name="rem-customer" checked={customer === c.id} onChange={() => void pick(c.id)} /> {c.name ?? c.id}</span></label>)}
        </fieldset>
      ))}
      {customer !== null && invoices !== null && (invoices.length === 0 ? <Note>{r['rem.noInvoices']}</Note> : (
        <form className={s.form} onSubmit={e => void submit(e)}>
          <fieldset className={s.form}>
            <legend>{r['rem.invoice']}</legend>
            {invoices.map(ref => <label key={ref}><span><input type="radio" name="rem-invoice" checked={invoice === ref} onChange={() => setInvoice(ref)} /> {ref}</span></label>)}
          </fieldset>
          <fieldset className={s.form}>
            <legend>{r['rem.connection']}</legend>
            {connections.map(c => <label key={c.id}><span><input type="radio" name="rem-connection" checked={connection === c.id} onChange={() => setConnection(c.id)} /> {c.label}</span></label>)}
          </fieldset>
          <fieldset className={s.form}>
            <legend>{r['rem.language']}</legend>
            {(['en', 'hi'] as const).map(l => <label key={l}><span><input type="radio" name="rem-language" checked={lang === l} onChange={() => setLang(l)} /> {r[`rem.lang.${l}`]}</span></label>)}
          </fieldset>
          <Actions><Button submit variant="filled" disabled={act.busy || invoice === null || connection === null}>{r['rem.go']}</Button></Actions>
        </form>
      ))}
      {result !== null && result.id !== null && (
        <div role="status"><Note>{r['rem.prepared']}</Note><Actions><Button variant="link" onClick={() => p.navigate({ place: 'work', sub: 'approvals', sheet: sheetOf(result.id!) })}>{r['rem.open']}</Button></Actions></div>
      )}
      {result !== null && result.id === null && result.reason !== null && <p role="alert">{sayR4(r, 'rem.blocked', { reason: result.reason })}</p>}
      <Refusal code={act.refusal} language={p.language} />
    </div>
  );
}

export function RemindersPage({ p }: { p: WorkProps }) {
  const { w, language } = p;
  const r = r4Words(language);
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(p.host, 'approvals.reminders', {}, reminders, String(tick));
  useLive(p, LIVE.approvals, reload);
  const canPrepare = !p.viewer && p.member.role !== 'accountant';
  return (
    <Frame p={p} title={r['rem.title']} loaded={loaded} reload={reload} count={v => (v.available ? String(v.items.length) : '')}>
      {v => !v.available ? <Note>{r['rem.notBuilt']}</Note> : (
        <div className={s.pane}>
          <Note>{r['rem.note']}</Note>
          {v.caps !== null && capsLine(v.caps, r) !== null && <p className={s.meta} data-caps="">{capsLine(v.caps, r)}</p>}
          {canPrepare && <Section title={r['rem.prepare']}><PrepareForm p={p} connections={v.connections} onPrepared={() => setTick(n => n + 1)} /></Section>}
          <Section title={r['rem.list']}>
            {v.items.length === 0 ? <Note>{r['rem.none']}</Note> : (
              <RowList rows={v.items.map(item => ({ id: item.id, mark: MARK_OF[item.state], what: rowTitle(item, w), note: [w[`state.${item.state}`], item.touches, dayTime(item.createdAt, language)].filter((x): x is string => typeof x === 'string').join(' · ') }))}
                onOpen={id => p.navigate({ place: 'work', sub: 'approvals', sheet: sheetOf(id) })} onReceipt={p.openReceipt} />
            )}
          </Section>
        </div>
      )}
    </Frame>
  );
}
