/**
 * PH-05, Documents from your phone (tools/phonedocs), experimental. Each document the owner sent
 * on WhatsApp or Telegram waits here as outside data, not imported. The person chooses how it is
 * read (a CSV as rows; a PDF as a statement or a bill; a photo as a bill), sees the reading with
 * its untrusted marking, and only a press of Confirm sends the reading's own confirm (the normal
 * import or bill check), then marks the document done. Discard deletes it from this computer.
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
import { Label } from '../../parts/Label';
import type { PlaceRenderProps } from '../../places/types.ts';
import {
  METHODS, anyObject, collected, discarded, documentList, documentPreview, partlyCollected, previewPayload, readLines, routesFor,
  type DocumentPreview, type MediaType, type PhoneDocument, type Route,
} from './contract.ts';
import { useRead, useSend } from './engine.ts';
import { Note, Page, PhoneLink, SentLine, canChange, day, type T } from './Frame';
import s from './hosted-link.module.css';

const TYPE_KEY: Readonly<Record<MediaType, string>> = {
  'application/pdf': 'HL.docs.type.pdf', 'image/jpeg': 'HL.docs.type.jpeg', 'image/png': 'HL.docs.type.png', 'text/csv': 'HL.docs.type.csv',
};
const SHOWN_LINES = { simple: 12, guided: 40, books: 200 } as const;

/** What was read, as plain lines under its untrusted marking, and the confirm it offers. */
function Reading({ value, props, t, onConfirmed }: { value: DocumentPreview; props: PlaceRenderProps; t: T; onConfirmed: (sentence: string) => void }) {
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
      {value.confirm !== null && value.confirm.needsFields ? (
        <>
          <Note>{t('HL.docs.billElsewhere')}</Note>
          <div><Button variant="link" onClick={() => props.navigate({ place: 'books', sub: 'bill' })}>{t('HL.docs.billLink')}</Button></div>
        </>
      ) : value.confirm === null ? <Note>{t('HL.docs.noConfirm')}</Note> : (
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
          {preview.sent.kind === 'done' && <Reading key={`${doc.documentId}-${preview.sent.value.route}`} value={preview.sent.value} props={props} t={t} onConfirmed={onGone} />}
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
