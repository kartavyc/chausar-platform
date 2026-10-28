import { useState, type FormEvent } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { CaRules, StoredCaSignoff } from './CaRules';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Receipt } from '../../parts/Receipt';
import type { CaLatestPapers, CaOfRecord, CaPendingRate, CaReceiptView, CaSignoffRequest } from '../../engine/types';
import { TileSection, dayOf, messageOf } from './shared';
import s from './Business.module.css';

/**
 * Your CA (venture.ca.*), for a business on the CA firm playbook, as tiles: the CA of record (initials drawn here,
 * nothing fetched), the rate tables waiting for that CA to confirm with their sources one fold away, the papers sent to
 * the CA for sign-off, and the newest regulated papers' receipts worked again by the engine. The CA signs and confirms
 * with their own ICAI membership number, typed here; agents never file or sign. Each write is followed by a fresh
 * read, so the page shows the engine's own state, never a guess.
 */
export function YourCa() {
  const t = useT();
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const ca = useResource('venture.ca.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });

  if (venture.data !== undefined && venture.data?.playbook?.id !== 'ca-firm') return <p className={s.note}>{t('business.ca.notFirm')}</p>;
  if (ca.error) return <p className={s.problem} role="alert">{t('business.failed', { message: ca.error.message })}</p>;
  if (!ca.data) return <p className={s.note}>{t('business.loading')}</p>;
  const { ca: of, pendingRates, requests, latestPapers } = ca.data;
  return (
    <div className={s.page}>
      <p className={s.lead}>{t('business.ca.lead')}</p>
      <div className={s.split} data-ratio={of ? '5-7' : '8-4'}>
        <OfRecord ca={of} onSaved={ca.reload} />
        {of && <RateTables rates={pendingRates} onConfirmed={ca.reload} />}
      </div>
      {of && ca.data.citations && <CaRules rules={ca.data.citations} onConfirmed={ca.reload} />}
      <Requests requests={requests} onRecorded={ca.reload} />
      <Receipts papers={latestPapers ?? null} />
    </div>
  );
}

/**
 * The receipts of the newest regulated papers (Ink v2 2A2), each worked again by the engine from its stored inputs on
 * the rate tables it stamped (venture.ca.receipt): "same", or the engine's line for what came out otherwise. Each line
 * sits with its paper's receipt chip, which opens that calculator receipt in the receipt sheet (Receipt source="ca").
 */
function Receipts({ papers }: { papers: CaLatestPapers | null }) {
  const t = useT();
  return (
    <TileSection title={t('business.ca.receipts')}>
      {!papers ? (
        <p className={s.line}>{t('business.ca.receiptsNone')}</p>
      ) : (
        <>
          <p className={s.strong}>{papers.title}</p>
          <ul className={s.steps}>
            {papers.receiptIds.map((id) => <ReceiptLine key={id} id={id} />)}
          </ul>
        </>
      )}
    </TileSection>
  );
}

function ReceiptLine({ id }: { id: string }) {
  const t = useT();
  const receipt = useResource('venture.ca.receipt', { id });
  if (receipt.error) return <li className={s.step}><span className={s.problem} role="alert">{t('business.failed', { message: receipt.error.message })}</span></li>;
  if (!receipt.data) return <li className={s.step}><span className={s.stepWho}>{t('business.loading')}</span></li>;
  const { engine, rederived, differs, portalDifferences } = receipt.data;
  return (
    <li className={s.step} data-ca-receipt={id}>
      <span>{t(`business.ca.engine.${engine}`)}</span>
      {/* What came out when the engine worked the paper again, with the paper's own receipt beside it. */}
      <span className={s.stepWho} data-figure-group="">
        <span>{rederived === 'same' ? t('business.ca.recomputed.same') : t(`business.ca.recomputed.${rederived}`, { line: differs?.line ?? '' })}</span>
        {' '}<Receipt id={id} source="ca" />
      </span>
      {portalDifferences && portalDifferences.length > 0 && (
        <ul className={s.steps}>
          {portalDifferences.map((row) => <DiffLine key={row.key} receiptId={id} row={row} onExplained={receipt.reload} />)}
        </ul>
      )}
    </li>
  );
}

type PortalDifference = NonNullable<CaReceiptView['portalDifferences']>[number];

/**
 * One difference between the portal's figures and the receipts (Ink v2 2A2). Until the CA of record explains it, the
 * papers can't be accepted: Explain asks for the CA's words and their ICAI number, and the engine records it once
 * (venture.ca.explainDiff), or refuses in its own words.
 */
function DiffLine({ receiptId, row, onExplained }: { receiptId: string; row: PortalDifference; onExplained: () => void }) {
  const t = useT();
  const client = useEngine();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.ca.explainDiff', { receiptId, key: row.key, note: note.trim(), membershipNo: number.trim() });
      setOpen(false);
      onExplained();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={s.step} data-difference={row.key}>
      {/* Ours against the portal's, proved by the paper's receipt. */}
      <span data-figure-group="">
        <span>{t(`business.ca.diff.${row.state}`, { label: row.label, ours: row.ours ?? '', portal: row.portal ?? '' })}</span>
        {' '}<Receipt id={receiptId} source="ca" />
      </span>
      {row.explanation !== null ? (
        // The CA's own words, quoted as they wrote them.
        <span className={s.stepWho} data-content="">{t('business.ca.diff.explained', { note: row.explanation })}</span>
      ) : open ? (
        <form className={s.form} onSubmit={(event) => void submit(event)}>
          <Field label={t('business.ca.diff.note')} value={note} maxLength={400} onChange={(event) => setNote(event.currentTarget.value)} />
          <Field label={t('business.ca.caNumber')} value={number} inputMode="numeric" maxLength={6} autoComplete="off" spellCheck={false} onChange={(event) => setNumber(event.currentTarget.value)} />
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}>
            <Button variant="quiet" onClick={() => { setOpen(false); setProblem(null); }}>{t('approval.cancel')}</Button>
            <Button variant="primary" type="submit" disabled={busy}>{t('business.ca.diff.record')}</Button>
          </div>
        </form>
      ) : (
        <div className={s.buttons}><Button onClick={() => setOpen(true)}>{t('business.ca.diff.explain')}</Button></div>
      )}
    </li>
  );
}

function OfRecord({ ca, onSaved }: { ca: CaOfRecord | null; onSaved: () => void }) {
  const t = useT();
  const client = useEngine();
  const [changing, setChanging] = useState(false);
  const [name, setName] = useState(ca?.name ?? '');
  const [number, setNumber] = useState(ca?.membershipNo ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.ca.setOfRecord', { name: name.trim(), membershipNo: number.trim() });
      setChanging(false);
      onSaved();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      <Field label={t('business.ca.name')} value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.currentTarget.value)} />
      <Field label={t('business.ca.number')} hint={t('business.ca.numberHint')} value={number} inputMode="numeric" maxLength={6} autoComplete="off" spellCheck={false} onChange={(event) => setNumber(event.currentTarget.value)} />
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <div className={s.buttons}>
        {ca && <Button variant="quiet" onClick={() => { setChanging(false); setProblem(null); }}>{t('approval.cancel')}</Button>}
        <Button variant="primary" type="submit" disabled={busy}>{t('business.ca.save')}</Button>
      </div>
    </form>
  );

  return (
    <TileSection title={t('business.ca.ofRecord')}>
      {!ca ? (
        <>
          <p className={s.line}>{t('business.ca.none')}</p>
          {form}
        </>
      ) : changing ? form : (
        <>
          <div className={s.who}>
            <Avatar name={ca.name} size={40} />
            <div>
              <p className={s.strong}>{ca.name}</p>
              <p className={s.line}>{t('business.ca.membership')} <span className="mono">{ca.membershipNo}</span></p>
            </div>
          </div>
          <div className={s.buttons}>
            <Button size="sm" variant="quiet" onClick={() => { setName(ca.name); setNumber(ca.membershipNo); setChanging(true); }}>{t('business.ca.change')}</Button>
          </div>
        </>
      )}
    </TileSection>
  );
}

/** A rate table's dates in words: from a day, to a day or with no end date yet. */
function validity(rate: CaPendingRate, t: ReturnType<typeof useT>, language: string): string {
  return rate.validTo
    ? t('business.ca.validFromTo', { from: dayOf(rate.validFrom, language), to: dayOf(rate.validTo, language) })
    : t('business.ca.validFrom', { from: dayOf(rate.validFrom, language) });
}

function RateTables({ rates, onConfirmed }: { rates: CaPendingRate[]; onConfirmed: () => void }) {
  const t = useT();
  const language = useLanguage();
  const client = useEngine();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const picked = rates.filter((rate) => chosen.has(rate.tableId)).map((rate) => rate.tableId);

  function toggle(tableId: string, on: boolean) {
    setChosen((now) => {
      const next = new Set(now);
      if (on) next.add(tableId); else next.delete(tableId);
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (picked.length === 0) { setProblem(t('business.ca.chooseFirst')); return; }
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      await client.request('venture.ca.confirmRates', { tableIds: picked, membershipNo: number.trim() });
      setSaid(t('business.ca.confirmed', { count: String(picked.length) }));
      setChosen(new Set());
      setNumber('');
      onConfirmed();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TileSection title={t('business.ca.rates')}>
      {rates.length === 0 ? (
        <p className={s.line}>{t('business.ca.ratesNone')}</p>
      ) : (
        <form className={s.foldBody} onSubmit={(event) => void submit(event)}>
          <ul className={s.steps}>
            {rates.map((rate) => (
              <li key={rate.tableId} className={s.step} data-rate={rate.tableId}>
                <label className={s.agree}>
                  <input type="checkbox" checked={chosen.has(rate.tableId)} onChange={(event) => toggle(rate.tableId, event.currentTarget.checked)} />
                  <span>{rate.title}</span>
                </label>
                <span className={s.stepWho}>{t('business.ca.version', { version: rate.version })} · {validity(rate, t, language)}</span>
                {/* Where each table comes from, one fold away (simple first: rate tables' detail is for the CA). */}
                {rate.citations.length > 0 && (
                  <details className={s.fold}>
                    <summary>{t('business.ca.sources')}</summary>
                    <ul className={s.plain}>
                      {rate.citations.map((citation) => <li key={citation}>{citation}</li>)}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <div className={s.inlineForm}>
            <Field label={t('business.ca.caNumber')} value={number} inputMode="numeric" maxLength={6} autoComplete="off" spellCheck={false} onChange={(event) => setNumber(event.currentTarget.value)} />
            <Button type="submit" disabled={busy}>{t('business.ca.confirm')}</Button>
          </div>
          {problem && <p className={s.problem} role="alert">{problem}</p>}
        </form>
      )}
      {said && <p className={s.said} role="status">{said}</p>}
    </TileSection>
  );
}

function Requests({ requests, onRecorded }: { requests: CaSignoffRequest[]; onRecorded: () => void }) {
  const t = useT();
  return (
    <TileSection title={t('business.ca.requests')}>
      {requests.length === 0 ? (
        <p className={s.line}>{t('business.ca.requestsNone')}</p>
      ) : (
        <ul className={s.steps}>
          {requests.map((request) => <RequestLine key={request.id} request={request} onRecorded={onRecorded} />)}
        </ul>
      )}
    </TileSection>
  );
}

function RequestLine({ request, onRecorded }: { request: CaSignoffRequest; onRecorded: () => void }) {
  const t = useT();
  const language = useLanguage();
  const client = useEngine();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const typedNote = note.trim();
      await client.request('venture.ca.recordSignoff', typedNote ? { requestId: request.id, membershipNo: number.trim(), note: typedNote } : { requestId: request.id, membershipNo: number.trim() });
      setOpen(false);
      onRecorded();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={s.step} data-request={request.id}>
      <span>{request.title}</span>
      <span className={s.stepWho}>{t(`business.ca.state.${request.state}`)} · {dayOf(request.at, language)}</span>
      {request.signoffId && <StoredCaSignoff id={request.signoffId} />}
      {request.state === 'sent' && !open && (
        <div className={s.buttons}><Button onClick={() => setOpen(true)}>{t('business.ca.record')}</Button></div>
      )}
      {request.state === 'sent' && open && (
        <form className={s.form} onSubmit={(event) => void submit(event)}>
          <Field label={t('business.ca.caNumber')} value={number} inputMode="numeric" maxLength={6} autoComplete="off" spellCheck={false} onChange={(event) => setNumber(event.currentTarget.value)} />
          <Field label={t('business.ca.note')} value={note} maxLength={500} onChange={(event) => setNote(event.currentTarget.value)} />
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}>
            <Button variant="quiet" onClick={() => { setOpen(false); setProblem(null); }}>{t('approval.cancel')}</Button>
            <Button variant="primary" type="submit" disabled={busy}>{t('business.ca.recordIt')}</Button>
          </div>
        </form>
      )}
    </li>
  );
}
