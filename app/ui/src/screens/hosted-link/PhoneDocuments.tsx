/**
 * PH-05, Documents from your phone (tools/phonedocs), experimental. Each document the owner sent
 * on WhatsApp or Telegram waits here as outside data, not imported. The person chooses how it is
 * read (a CSV as rows; a PDF as a statement or a bill; a photo as a bill), sees the reading with
 * its untrusted marking, and only a press of Confirm sends the reading's own confirm (the normal
 * import or bill check), then marks the document done. A bill's confirm needs checked fields: they
 * are drawn here as a form prefilled from the reading, which the person checks and corrects before
 * Confirm. Discard deletes it from this computer.
 * Simple: the rows, Read it and Discard, and the first lines of a reading. Guided adds the kind,
 * the dates and the notes. Books adds the document id, the media type, its size in bytes, the
 * confirm method and every line read. Nothing is added up or worked out here.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../app/text';
import { money } from '../../format/index.ts';
import { count } from '../../format/index.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { Label } from '../../parts/Label';
import type { PlaceRenderProps } from '../../places/types.ts';
import {
  METHODS, anyObject, billConfirmPayload, billFormOf, collected, discarded, documentList, documentPreview, isoDayText, paiseText, partlyCollected,
  previewPayload, readLines, routesFor, wholeQuantity,
  type BillCheck, type BillField, type BillForm, type DocumentPreview, type MediaType, type PhoneDocument, type Route,
} from './contract.ts';
import { useRead, useSend } from './engine.ts';
import { Note, Page, PhoneLink, SentLine, canChange, day, type T } from './Frame';
import s from './hosted-link.module.css';

const TYPE_KEY: Readonly<Record<MediaType, string>> = {
  'application/pdf': 'HL.docs.type.pdf', 'image/jpeg': 'HL.docs.type.jpeg', 'image/png': 'HL.docs.type.png', 'text/csv': 'HL.docs.type.csv',
};
const SHOWN_LINES = { simple: 12, guided: 40, books: 200 } as const;

/** What was read, as plain lines under its untrusted marking, and the confirm it offers. */
/** How sure one field's reading is, in words; an unread field is marked amber. */
function Certain({ field, t }: { field: BillField | undefined; t: T }) {
  if (field === undefined) return null;
  return <span className={field.certainty === 'sure' ? s.lineNote : s.warn} data-certainty={field.certainty}>{t(`HL.bill.cert.${field.certainty}`)}</span>;
}

/**
 * A bill's fields, prefilled from the reading, for the person to check and correct one by one.
 * Confirm sends exactly { readId, digest, fields } to `books.billConfirm` (amounts as whole paise
 * text, converted by hand), then marks the document done. Nothing is added up here: the engine
 * checks that lines plus tax make the total and its refusals are drawn in words.
 */
function BillFields({ documentId, check, props, t, onConfirmed, onReadAgain }: {
  documentId: string; check: BillCheck; props: PlaceRenderProps; t: T; onConfirmed: (sentence: string) => void; onReadAgain: () => void;
}) {
  const reading = check.reading;
  const [form, setForm] = useState<BillForm>(() => billFormOf(reading));
  const confirm = useSend(props.rpc, anyObject);
  const done = useSend(props.rpc, anyObject);
  const busy = confirm.sent.kind === 'sending' || done.sent.kind === 'sending';
  const payload = billConfirmPayload(check, form);
  const set = (patch: Partial<BillForm>) => { setForm((f) => ({ ...f, ...patch })); if (confirm.sent.kind === 'refused') confirm.clear(); };
  const badAmount = (text: string) => (paiseText(text) === null ? t('HL.bill.amountProblem') : undefined);
  const press = async () => {
    if (payload === null) return;
    if (await confirm.send('books.billConfirm', payload) === null || !props.live(props.address)) return;
    if (await done.send(METHODS.done, { documentId }) !== null && props.live(props.address)) onConfirmed(t('HL.bill.confirmed'));
  };
  const confirmed = confirm.sent.kind === 'done';
  const stale = confirm.sent.kind === 'refused' && (confirm.sent.code === 'BILL_READ_EXPIRED' || confirm.sent.code === 'PREVIEW_CHANGED');
  return (
    <form className={s.group} aria-label={t('HL.bill.form')} onSubmit={(e) => { e.preventDefault(); void press(); }}>
      <h4 className={s.heading}>{t('HL.bill.title')}</h4>
      <Note>{t('HL.bill.intro')}</Note>
      <fieldset className={s.fields} disabled={confirmed || busy}>
        <div className={s.fieldRow}>
          <Field label={t('HL.bill.supplier')} value={form.supplier} onChange={(e) => set({ supplier: e.target.value })} />
          <Certain field={reading.supplier} t={t} />
        </div>
        <div className={s.fieldRow}>
          <Field label={t('HL.bill.number')} value={form.billNumber} onChange={(e) => set({ billNumber: e.target.value })} />
          <Certain field={reading.billNumber} t={t} />
        </div>
        <div className={s.fieldRow}>
          <Field label={t('HL.bill.date')} type="date" value={form.date} onChange={(e) => set({ date: e.target.value })}
            problem={isoDayText(form.date) ? undefined : t('HL.bill.dateProblem')} />
          <Certain field={reading.date} t={t} />
        </div>
        <h5 className={s.heading}>{t('HL.bill.lines')}</h5>
        {form.lines.map((line, i) => {
          const read = reading.lines[i];
          const change = (patch: Partial<BillForm['lines'][number]>) => set({ lines: form.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className={s.fieldRow} role="group" aria-label={`${t('HL.bill.lines')} ${i + 1}`} data-line={i}>
              <Field label={t('HL.bill.description')} value={line.description} onChange={(e) => change({ description: e.target.value })} />
              <Certain field={read?.description} t={t} />
              <Field label={t('HL.bill.quantity')} inputMode="numeric" value={line.quantity} onChange={(e) => change({ quantity: e.target.value })}
                problem={wholeQuantity(line.quantity) === null ? t('HL.bill.quantityProblem') : undefined} />
              <Certain field={read?.quantity} t={t} />
              <Field label={t('HL.bill.amount')} inputMode="decimal" value={line.amount} onChange={(e) => change({ amount: e.target.value })} problem={badAmount(line.amount)} />
              <Certain field={read?.amount} t={t} />
              {form.lines.length > 1 && <Button variant="link" onClick={() => set({ lines: form.lines.filter((_, j) => j !== i) })}>{t('HL.bill.remove')}</Button>}
            </div>
          );
        })}
        <div><Button variant="link" onClick={() => set({ lines: [...form.lines, { description: '', quantity: '1', amount: '' }] })}>{t('HL.bill.addLine')}</Button></div>
        <h5 className={s.heading}>{t('HL.bill.tax')}</h5>
        {form.tax.map((tax, i) => {
          const read = reading.tax[i];
          const change = (patch: Partial<BillForm['tax'][number]>) => set({ tax: form.tax.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className={s.fieldRow} role="group" aria-label={`${t('HL.bill.tax')} ${i + 1}`} data-tax={i}>
              <Field label={t('HL.bill.taxName')} value={tax.name} onChange={(e) => change({ name: e.target.value })} />
              <Certain field={read?.name} t={t} />
              <Field label={t('HL.bill.amount')} inputMode="decimal" value={tax.amount} onChange={(e) => change({ amount: e.target.value })} problem={badAmount(tax.amount)} />
              <Certain field={read?.amount} t={t} />
              <Button variant="link" onClick={() => set({ tax: form.tax.filter((_, j) => j !== i) })}>{t('HL.bill.remove')}</Button>
            </div>
          );
        })}
        <div><Button variant="link" onClick={() => set({ tax: [...form.tax, { name: '', amount: '' }] })}>{t('HL.bill.addTax')}</Button></div>
        <div className={s.fieldRow}>
          <Field label={t('HL.bill.total')} inputMode="decimal" value={form.total} onChange={(e) => set({ total: e.target.value })} problem={badAmount(form.total)} />
          <Certain field={reading.total} t={t} />
        </div>
      </fieldset>
      <Note>{t('HL.bill.confirmNote')}</Note>
      {!confirmed && payload === null && <p className={s.warn} role="note">{t('HL.bill.notReady')}</p>}
      {!confirmed && <div><Button variant="filled" submit disabled={payload === null || busy}>{t('HL.docs.confirm')}</Button></div>}
      <SentLine sent={confirm.sent} />
      {stale && <div><Button variant="link" onClick={onReadAgain}>{t('HL.bill.readAgain')}</Button></div>}
      {confirmed && done.sent.kind === 'not-built' ? <p className={s.status} role="status">{t('HL.docs.doneNotBuilt')}</p> : <SentLine sent={done.sent} />}
    </form>
  );
}

function Reading({ value, props, t, onConfirmed, onReadAgain }: {
  value: DocumentPreview; props: PlaceRenderProps; t: T; onConfirmed: (sentence: string) => void; onReadAgain: () => void;
}) {
  const books = props.view === 'books';
  const [all, setAll] = useState(false);
  const { lines, more } = useMemo(() => readLines(value.preview, all ? 200 : SHOWN_LINES[props.view]), [value.preview, all, props.view]);
  const confirm = useSend(props.rpc, anyObject);
  const done = useSend(props.rpc, anyObject);
  const busy = confirm.sent.kind === 'sending' || done.sent.kind === 'sending';
  const press = async () => {
    if (value.confirm === null || value.confirm.needsFields) return;
    if (await confirm.send(value.confirm.method, { ...value.confirm.input }) === null || !props.live(props.address)) return;
    if (await done.send(METHODS.done, { documentId: value.documentId }) !== null && props.live(props.address)) onConfirmed(t('HL.docs.confirmed'));
  };
  const confirmedOnly = confirm.sent.kind === 'done';
  return (
    <section className={s.group} aria-label={t('HL.docs.reading')}>
      <h3 className={s.heading}>{t('HL.docs.reading')}</h3>
      <p className={s.warn}><Label kind="from-outside" /> <Label kind="experimental" /> {t('HL.docs.untrusted')}</p>
      <Note>{t('HL.docs.readAs', { route: t(`HL.route.${value.route}`) })}</Note>
      {lines.length === 0 ? <Note>{t('HL.docs.nothingRead')}</Note> : (
        <dl className={s.reading}>
          {lines.map((line, i) => (
            <div key={`${i}-${line.path.join('.')}`} className={s.pair}>
              <dt>{line.path.join(' · ')}</dt>
              <dd className={line.kind === 'money' ? 'fig' : undefined}>
                {line.kind === 'money' ? money(line.value) : line.kind === 'yes' ? t('HL.yes') : line.kind === 'no' ? t('HL.no') : line.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {(more || all) && (
        <div className={s.bar}>
          {more && <Note>{t('HL.docs.more')}</Note>}
          <Button variant="link" aria-expanded={all} onClick={() => setAll((a) => !a)}>{all ? t('HL.docs.showLess') : t('HL.docs.showAll')}</Button>
        </div>
      )}
      {value.bill !== null ? (
        <BillFields documentId={value.documentId} check={value.bill} props={props} t={t} onConfirmed={onConfirmed} onReadAgain={onReadAgain} />
      ) : value.confirm === null ? <Note>{t(value.confirmReason === null ? 'HL.docs.noConfirm' : `HL.docs.noConfirm.${value.confirmReason}`)}</Note> : (
        <>
          <Note>{t('HL.docs.confirmNote')}</Note>
          {books && <Note><span className="fig">{t('HL.docs.confirmMethod', { method: value.confirm.method })}</span></Note>}
          {!confirmedOnly && <div><Button variant="filled" disabled={busy} onClick={() => void press()}>{t('HL.docs.confirm')}</Button></div>}
        </>
      )}
      <SentLine sent={confirm.sent} />
      {confirmedOnly && done.sent.kind === 'not-built' ? <p className={s.status} role="status">{t('HL.docs.doneNotBuilt')}</p> : <SentLine sent={done.sent} />}
    </section>
  );
}

/** One document awaiting review, with its own reading panel and discard. */
function DocumentRow({ doc, props, t, onGone }: { doc: PhoneDocument; props: PlaceRenderProps; t: T; onGone: (sentence: string) => void }) {
  const simple = props.view === 'simple', books = props.view === 'books';
  const admin = canChange(props);
  const routes = routesFor(doc.mediaType);
  const [open, setOpen] = useState(false);
  const [route, setRoute] = useState<Route | null>(routes.length === 1 ? routes[0]! : null);
  const [asking, setAsking] = useState(false);
  const check = useMemo(() => (reply: unknown) => documentPreview(reply, { documentId: doc.documentId, route: route ?? 'csv' }), [doc.documentId, route]);
  const preview = useSend(props.rpc, check);
  const discard = useSend(props.rpc, discarded);
  const choose = (next: Route) => { setRoute(next); preview.clear(); };
  const read = () => { if (route !== null) void preview.send(METHODS.preview, previewPayload(doc.documentId, route)); };
  const drop = async () => {
    if (await discard.send(METHODS.discard, { documentId: doc.documentId }) !== null && props.live(props.address)) onGone(t('HL.docs.discarded'));
  };
  const notes = [
    t('HL.docs.from', { channel: t(`HL.channel.${doc.channel}`) }),
    t('HL.docs.received', { date: day(doc.receivedAt, props.language) }),
    simple ? null : t(TYPE_KEY[doc.mediaType]),
    simple ? null : t('HL.docs.collected', { date: day(doc.collectedAt, props.language) }),
  ];
  return (
    <li className={s.line}>
      <div className={s.lineTop}>
        <div className={s.lineMain}>
          <span className={s.lineTitle}>{doc.name}</span>
          <span className={s.lineNote}><Label kind="from-outside" /> {t('HL.docs.outside')}</span>
          {notes.map((n, i) => n === null ? null : <span key={i} className={s.lineNote}>{n}</span>)}
          {books && (
            <>
              <span className={[s.lineNote, 'fig'].join(' ')}>{t('HL.docs.id', { id: doc.documentId })}</span>
              <span className={[s.lineNote, 'fig'].join(' ')}>{t('HL.docs.mediaType', { mediaType: doc.mediaType })}</span>
              <span className={[s.lineNote, 'fig'].join(' ')}>{t('HL.docs.size', { size: count(doc.sizeBytes) })}</span>
            </>
          )}
        </div>
        {admin && (
          <div className={s.lineAfter}>
            <Button aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? t('HL.docs.close') : t('HL.docs.read')}</Button>
            {!asking && <Button variant="link" danger onClick={() => setAsking(true)}>{t('HL.docs.discard')}</Button>}
          </div>
        )}
      </div>
      {admin && asking && (
        <div className={s.bar} role="group" aria-label={t('HL.docs.discardSure')}>
          <p className={s.p}>{t('HL.docs.discardSure')}</p>
          <Button danger disabled={discard.sent.kind === 'sending'} onClick={() => void drop()}>{t('HL.docs.discardYes')}</Button>
          <Button variant="link" onClick={() => { setAsking(false); discard.clear(); }}>{t('HL.docs.keep')}</Button>
        </div>
      )}
      <SentLine sent={discard.sent} />
      {admin && open && (
        <div className={s.panel}>
          {routes.length > 1 ? (
            <Choice<Route> label={t('HL.docs.howToRead')} value={route} onChange={choose} disabled={preview.sent.kind === 'sending'}
              options={routes.map((r) => ({ value: r, label: t(`HL.route.${r}`) }))} />
          ) : <Note>{doc.mediaType === 'text/csv' ? t('HL.docs.csvOnly') : t('HL.docs.photoOnly')}</Note>}
          {route === null && <Note>{t('HL.docs.chooseFirst')}</Note>}
          {preview.sent.kind !== 'done' && (
            <div><Button variant="filled" disabled={route === null || preview.sent.kind === 'sending'} onClick={read}>{t('HL.docs.readNow')}</Button></div>
          )}
          <SentLine sent={preview.sent} />
          {preview.sent.kind === 'done' && (
            <Reading key={`${doc.documentId}-${preview.sent.value.route}-${preview.sent.value.bill?.readId ?? ''}`} value={preview.sent.value} props={props} t={t}
              onConfirmed={onGone} onReadAgain={read} />
          )}
        </div>
      )}
    </li>
  );
}

export function PhoneDocumentsPlace(props: PlaceRenderProps) {
  const t = useT();
  const simple = props.view === 'simple';
  const admin = canChange(props);
  const { read, reload } = useRead(props.rpc, METHODS.list, {}, documentList);
  const collect = useSend(props.rpc, collected);
  const [gone, setGone] = useState<string | null>(null);
  const title = t('SH-01.sub.tools.phonedocs');
  const check = async () => {
    setGone(null);
    if (await collect.send(METHODS.collect, {}) !== null && props.live(props.address)) reload();
  };
  const onGone = (sentence: string) => { setGone(sentence); reload(); };
  const ready = read.kind === 'ready' ? read.value : null;
  const top = read.kind === 'ready' ? (
    <>
      {!simple && <Note>{t('HL.docs.intro')}</Note>}
      {props.viewer ? <Note>{t('HL.readOnly')}</Note> : !admin ? <Note>{t('HL.ownerOnly')}</Note> : null}
      {ready !== null && !ready.keyRegistered && <p className={s.warn} role="note">{t('HL.docs.keyMissing')}</p>}
      <SentLine sent={collect.sent} done={t('HL.docs.collectDone')} />
      {collect.sent.kind === 'done' && partlyCollected(collect.sent.value) && <p className={s.warn} role="note">{t('HL.docs.partial')}</p>}
      {gone !== null && <p className={s.status} role="status">{gone}</p>}
      <div className={s.bar}><PhoneLink navigate={props.navigate} /></div>
    </>
  ) : null;
  const aside = admin && read.kind === 'ready'
    ? <Button disabled={collect.sent.kind === 'sending'} onClick={() => void check()}>{t('HL.docs.collect')}</Button>
    : undefined;
  return (
    <Page where={`${t('SH-01.place.tools')} · ${title}`} title={title} read={read} aside={aside} top={top} emptyKey="HL.docs.empty"
      isEmpty={(v) => v.documents.length === 0}>
      {(value) => (
        <ul className={s.lines} aria-label={t('HL.docs.list')}>
          {value.documents.map((doc) => <DocumentRow key={doc.documentId} doc={doc} props={props} t={t} onGone={onGone} />)}
        </ul>
      )}
    </Page>
  );
}
