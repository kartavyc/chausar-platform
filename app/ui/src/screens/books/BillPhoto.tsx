/**
 * WK-13 / BK-18 a photo of a bill to a booked entry (experimental). The page image is on the
 * left, drawn from the person's own file through an object URL, with the place each field was
 * read outlined; the proposed form is on the right with how sure each reading is. An unreadable
 * field is empty and amber. Confirm sends the corrected fields with the digest of the reading;
 * the engine refuses a total that lines plus tax do not make exactly. Nothing is kept before
 * confirm. `BillPhotoBody` is the screen without the Books frame, for the Work place (#/work/bill).
 */
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Field } from '../../parts/Field';
import { Choice } from '../../parts/Choice';
import { Section, Note, Actions, Button } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { day } from '../work/kit/format.ts';
import { billReadReply, billView, billsReply, type BillField, type BillRead, type BillView, type Certainty } from './contract.ts';
import { BooksPage, Recorded, Table, approves, styles as s, valueOf, type BooksProps } from './shared.tsx';
import { useMoreWords, type MoreKey } from './words-more.ts';
import b from './BillPhoto.module.css';

const MAX_BYTES = 4 * 1024 * 1024;
const MIMES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
type Mime = typeof MIMES[number];
type W = Readonly<Record<MoreKey, string>>;

/** Paise as rupees text ("73160" → "731.60"), by text only. */
export function rupeesOf(minor: string): string { const d = minor.padStart(3, '0'); return `${d.slice(0, -2).replace(/^0+(?=\d)/, '')}.${d.slice(-2)}`; }
/** Rupees text as whole paise ("731.6" → "73160"), or null when it is not an amount. */
export function paiseOf(text: string): string | null {
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text.trim().replace(/,/g, ''));
  return m ? `${m[1]}${(m[2] ?? '').padEnd(2, '0')}`.replace(/^0+(?=\d)/, '') : null;
}

type Line = { description: string; quantity: string; amount: string };
type Tax = { name: string; amount: string };
type Form = { supplier: string; billNumber: string; date: string; lines: Line[]; tax: Tax[]; total: string };
const amountText = (f: BillField) => f.value === null ? '' : rupeesOf(f.value);
function formOf(read: BillRead): Form {
  return { supplier: read.supplier.value ?? '', billNumber: read.billNumber.value ?? '', date: read.date.value ?? '', total: amountText(read.total),
    lines: read.lines.map(l => ({ description: l.description.value ?? '', quantity: l.quantity.value ?? '', amount: amountText(l.amount) })),
    tax: read.tax.map(t => ({ name: t.name.value ?? '', amount: amountText(t.amount) })) };
}

function Mark({ certainty, w }: { certainty: Certainty; w: W }) {
  return <span data-certainty={certainty} className={certainty === 'sure' ? b.mark : certainty === 'check-this' ? b.markCheck : b.markUnread}>{w[`cert.${certainty}`]}</span>;
}
/** One form field with how sure its reading is; an unreadable field is empty and amber. */
function Read({ label, value, onChange, read, w, active, type, problem }: {
  label: string; value: string; onChange: (v: string) => void; read: BillField | null; w: W; active: (on: boolean) => void; type?: string; problem?: string | undefined;
}) {
  const unread = read?.certainty === 'could-not-read' && value === '';
  return (
    <div className={[b.field, unread ? b.unread : ''].join(' ')} data-unread={unread || undefined} onFocus={() => active(true)} onBlur={() => active(false)}>
      <Field label={label} value={value} type={type} onChange={e => onChange(e.target.value)} problem={problem} />
      {read && <Mark certainty={read.certainty} w={w} />}
    </div>
  );
}

export function BillPhoto(props: BooksProps) {
  const w = useMoreWords(props.language);
  return <BooksPage props={props} sub="sources" title={w['bill.title']}><BillPhotoBody props={props} /></BooksPage>;
}

export function BillPhotoBody({ props }: { props: BooksProps }) {
  const w = useMoreWords(props.language);
  const act = useAct(props.rpc);
  const [url, setUrl] = useState<string | null>(null);
  const [mime, setMime] = useState<Mime | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [read, setRead] = useState<BillRead | null>(null);
  const [done, setDone] = useState<BillView | null>(null);
  const can = !props.viewer && props.member.role !== 'viewer';
  useEffect(() => () => { if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url); }, [url]);
  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; setProblem(null); setRead(null); setDone(null); act.clear();
    if (!file) return;
    if (!(MIMES as readonly string[]).includes(file.type)) { setProblem(w['bill.wrongType']); return; }
    if (file.size > MAX_BYTES) { setProblem(w['bill.tooLarge']); return; }
    setMime(file.type as Mime);
    setUrl(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, '')); reader.readAsDataURL(file);
    });
    const outcome = await act.run('books.billRead', { bytesBase64: base64, mime: file.type }, billReadReply);
    if (outcome.ok) setRead(outcome.value);
  };
  return (
    <div className={s.stack}>
      <Note>{w['bill.experimental']}</Note>
      {!can && <Note>{w['bill.readOnly']}</Note>}
      {can && !done && (
        <label className={s.selectLabel}>{w['bill.choose']}
          <input type="file" accept={MIMES.join(',')} onChange={e => { void choose(e); }} disabled={act.busy} />
        </label>
      )}
      {problem && <p className={s.amber} role="alert">{problem}</p>}
      {act.busy && !read && <Note>{w['bill.reading']}</Note>}
      {act.refusal && <Refused code={act.refusal} w={w} />}
      {read && !done && <BillForm props={props} read={read} url={url} mime={mime} onDone={setDone} />}
      {done && <Prepared props={props} bill={done} onAgain={() => { setDone(null); setRead(null); }} />}
      <Recent props={props} key={done?.id ?? 'none'} />
    </div>
  );
}

function Refused({ code, w }: { code: string; w: W }) {
  const known = `code.${code}` as MoreKey;
  return <p className={s.amber} role="alert" data-code={code}>{Object.hasOwn(w, known) ? w[known] : code}</p>;
}

function BillForm({ props, read, url, mime, onDone }: { props: BooksProps; read: BillRead; url: string | null; mime: Mime | null; onDone: (bill: BillView) => void }) {
  const w = useMoreWords(props.language);
  const act = useAct(props.rpc);
  const [form, setForm] = useState<Form>(() => formOf(read));
  const [active, setActive] = useState<string | null>(null);
  const zoho = read.routes.zohoBooks.connections;
  const [route, setRoute] = useState<'tally' | 'zoho'>('tally');
  const [connection, setConnection] = useState(zoho[0]?.id ?? '');
  const [vendor, setVendor] = useState('');
  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }));
  const focus = (key: string) => (on: boolean) => setActive(on ? key : null);
  const amounts = [...form.lines.map(l => l.amount), ...form.tax.map(t => t.amount), form.total];
  const badAmount = (text: string) => text !== '' && paiseOf(text) === null;
  const ready = form.supplier.trim() !== '' && form.billNumber.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(form.date) && form.lines.length > 0
    && form.lines.every(l => l.description.trim() !== '' && /^[1-9]\d*$/.test(l.quantity)) && form.tax.every(t => t.name.trim() !== '')
    && amounts.every(a => paiseOf(a) !== null) && (route === 'tally' || (connection !== '' && vendor.trim() !== ''));
  const regions: { key: string; field: BillField }[] = [
    { key: 'supplier', field: read.supplier }, { key: 'billNumber', field: read.billNumber }, { key: 'date', field: read.date }, { key: 'total', field: read.total },
    ...read.lines.flatMap((l, i) => [{ key: `line-${i}`, field: l.amount }]), ...read.tax.map((t, i) => ({ key: `tax-${i}`, field: t.amount })),
  ];
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!ready) return;
    const fields = { supplier: form.supplier.trim(), billNumber: form.billNumber.trim(), date: form.date, totalMinor: paiseOf(form.total)!,
      lines: form.lines.map(l => ({ description: l.description.trim(), quantity: l.quantity, amountMinor: paiseOf(l.amount)! })),
      tax: form.tax.map(t => ({ name: t.name.trim(), amountMinor: paiseOf(t.amount)! })) };
    const outcome = await act.run('books.billConfirm', { readId: read.readId, digest: read.digest, fields, ...(route === 'zoho' ? { zoho: { connectionId: connection, vendorId: vendor.trim() } } : {}) }, billView);
    if (outcome.ok) onDone(outcome.value);
  };
  const sums = read.sums.equal === true ? w['bill.sumsEqual'] : read.sums.equal === false ? w['bill.sumsDiffer'] : w['bill.sumsUnknown'];
  return (
    <div className={b.split}>
      <figure className={b.page} aria-label={w['bill.page']}>
        {url && mime === 'application/pdf' && <object data={url} type="application/pdf" aria-label={w['bill.page']} />}
        {url && mime !== 'application/pdf' && <img src={url} alt={w['bill.page']} />}
        <svg className={b.regions} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={w['bill.regions']}>
          {regions.filter(r => r.field.region && r.field.region.page === 1 && r.field.region.of > 0).map(r => {
            const g = r.field.region!; const h = 100 / g.of;
            return <rect key={r.key} data-region={r.key} x={1} y={(g.line - 1) * h} width={98} height={h}
              className={active === r.key ? b.regionActive : r.field.certainty === 'sure' ? b.region : b.regionAmber} />;
          })}
        </svg>
      </figure>
      <form className={s.form} aria-label={w['bill.form']} onSubmit={e => { void submit(e); }}>
        <Note>{w['bill.untrusted']}</Note>
        <Read label={w['bill.supplier']} value={form.supplier} onChange={v => set({ supplier: v })} read={read.supplier} w={w} active={focus('supplier')} />
        <Read label={w['bill.number']} value={form.billNumber} onChange={v => set({ billNumber: v })} read={read.billNumber} w={w} active={focus('billNumber')} />
        <Read label={w['bill.date']} type="date" value={form.date} onChange={v => set({ date: v })} read={read.date} w={w} active={focus('date')} />
        <Section title={w['bill.lines']}>
          {form.lines.map((l, i) => {
            const r = read.lines[i];
            const change = (patch: Partial<Line>) => set({ lines: form.lines.map((x, j) => j === i ? { ...x, ...patch } : x) });
            return (
              <div key={i} className={b.row} data-line={i}>
                <Read label={w['bill.description']} value={l.description} onChange={v => change({ description: v })} read={r?.description ?? null} w={w} active={focus(`line-${i}`)} />
                <Read label={w['bill.quantity']} value={l.quantity} onChange={v => change({ quantity: v })} read={r?.quantity ?? null} w={w} active={focus(`line-${i}`)} />
                <Read label={w['bill.amount']} value={l.amount} onChange={v => change({ amount: v })} read={r?.amount ?? null} w={w} active={focus(`line-${i}`)} problem={badAmount(l.amount) ? w['bill.amountProblem'] : undefined} />
                {form.lines.length > 1 && <Button variant="link" onClick={() => set({ lines: form.lines.filter((_, j) => j !== i) })}>{w['bill.removeRow']}</Button>}
              </div>
            );
          })}
          <Button variant="link" onClick={() => set({ lines: [...form.lines, { description: '', quantity: '1', amount: '' }] })}>{w['bill.addLine']}</Button>
        </Section>
        <Section title={w['bill.tax']}>
          {form.tax.map((t, i) => {
            const r = read.tax[i];
            const change = (patch: Partial<Tax>) => set({ tax: form.tax.map((x, j) => j === i ? { ...x, ...patch } : x) });
            return (
              <div key={i} className={b.taxRow} data-tax={i}>
                <Read label={w['bill.taxName']} value={t.name} onChange={v => change({ name: v })} read={r?.name ?? null} w={w} active={focus(`tax-${i}`)} />
                <Read label={w['bill.amount']} value={t.amount} onChange={v => change({ amount: v })} read={r?.amount ?? null} w={w} active={focus(`tax-${i}`)} problem={badAmount(t.amount) ? w['bill.amountProblem'] : undefined} />
                <Button variant="link" onClick={() => set({ tax: form.tax.filter((_, j) => j !== i) })}>{w['bill.removeRow']}</Button>
              </div>
            );
          })}
          <Button variant="link" onClick={() => set({ tax: [...form.tax, { name: '', amount: '' }] })}>{w['bill.addTax']}</Button>
        </Section>
        <Read label={w['bill.total']} value={form.total} onChange={v => set({ total: v })} read={read.total} w={w} active={focus('total')} problem={badAmount(form.total) ? w['bill.amountProblem'] : undefined} />
        <p className={read.sums.equal === true ? s.note : s.amber} data-sums={String(read.sums.equal)}>{sums}</p>
        {zoho.length > 0 && <Choice<'tally' | 'zoho'> label={w['bill.route']} options={[{ value: 'tally', label: w['bill.route.tally'] }, { value: 'zoho', label: w['bill.route.zoho'] }]} value={route} onChange={setRoute} />}
        {route === 'zoho' && (
          <>
            {zoho.length > 1 && <Choice<string> label={w['bill.connection']} options={zoho.map(c => ({ value: c.id, label: c.label }))} value={connection} onChange={setConnection} />}
            <Field label={w['bill.vendor']} value={vendor} onChange={e => setVendor(e.target.value)} />
          </>
        )}
        <Note>{w['bill.notStored']}</Note>
        <Actions><Button submit disabled={!ready || act.busy}>{w['bill.confirm']}</Button></Actions>
        {act.refusal && <Refused code={act.refusal} w={w} />}
      </form>
    </div>
  );
}

function Voucher({ props, bill }: { props: BooksProps; bill: BillView }) {
  const w = useMoreWords(props.language);
  if (!bill.voucher) return null;
  return (
    <Table view={props.view} caption={w['bill.voucher']} columns={[{ head: w['bill.ledger'], simple: true }, { head: w['bill.debit'], num: true, simple: true }, { head: w['bill.credit'], num: true, simple: true }]}
      rows={bill.voucher.lines.map((l, i) => ({ key: String(i), cells: [l.ledger, l.debit ? <Recorded value={l.debit} language={props.language} /> : '', l.credit ? <Recorded value={l.credit} language={props.language} /> : ''] }))} />
  );
}

function Prepared({ props, bill, onAgain }: { props: BooksProps; bill: BillView; onAgain: () => void }) {
  const w = useMoreWords(props.language);
  return (
    <Section title={`${bill.supplier} · ${bill.billNumber}`}>
      <p role="status">{bill.route === 'tally-preview' ? w['bill.preparedTally'] : w['bill.prepared']}</p>
      <Voucher props={props} bill={bill} />
      <Actions>
        <Button onClick={() => props.navigate({ place: 'work', sub: 'approvals' })}>{w['bill.openApprovals']}</Button>
        <Button variant="link" onClick={onAgain}>{w['bill.another']}</Button>
      </Actions>
    </Section>
  );
}

function Recent({ props }: { props: BooksProps }) {
  const w = useMoreWords(props.language);
  const { loaded, reload } = useReply(props, 'books.bills', {}, billsReply);
  const value = valueOf(loaded);
  const act = useAct(props.rpc);
  const book = async (id: string) => { if ((await act.run('books.billBook', { id }, billView)).ok) reload(); };
  if (loaded.phase === 'refused') return loaded.state.kind === 'not-built' ? null : <Refused code={loaded.code} w={w} />;
  if (!value) return null;
  return (
    <Section title={w['bill.recent']}>
      {value.bills.length === 0 ? <Note>{w['bill.empty']}</Note> : (
        <Table view={props.view} caption={w['bill.recent']} columns={[
          { head: w['bill.supplier'], simple: true }, { head: w['bill.number'] }, { head: w['bill.date'] }, { head: w['bill.total'], num: true, simple: true }, { head: w['bill.route'] }, { head: '', simple: true },
        ]} rows={value.bills.map(bill => ({ key: bill.id, cells: [
          bill.supplier, bill.billNumber, day(bill.date, props.language), <Recorded value={bill.total} language={props.language} />,
          bill.route === 'tally-preview' ? w['bill.route.tally'] : w['bill.route.zoho'],
          <span className={s.inline}><span data-state={bill.state}>{w[`state.${bill.state}`]}</span>
            {approves(props) && bill.route === 'zoho-books' && (bill.state === 'approved' || bill.state === 'unknown') && <Button onClick={() => { void book(bill.id); }} disabled={act.busy}>{w['bill.book']}</Button>}</span>,
        ] }))} />
      )}
      {act.refusal && <Refused code={act.refusal} w={w} />}
    </Section>
  );
}
