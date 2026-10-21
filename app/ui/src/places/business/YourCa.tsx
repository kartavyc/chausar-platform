import { useId, useState, type FormEvent } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { CaOfRecord, CaPendingRate, CaSignoffRequest } from '../../engine/types';
import { dayOf, messageOf } from './shared';
import s from './Business.module.css';

/**
 * Your CA (venture.ca.*), for a business on the CA firm playbook: the CA of record, the rate tables waiting for that
 * CA to confirm, and the papers sent to the CA for sign-off. The CA signs and confirms with their own ICAI membership
 * number, typed here; agents never file or sign. Each write is followed by a fresh read, so the page shows the
 * engine's own state, never a guess.
 */
export function YourCa() {
  const t = useT();
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const ca = useResource('venture.ca.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });

  if (venture.data !== undefined && venture.data?.playbook?.id !== 'ca-firm') return <p className={s.note}>{t('business.ca.notFirm')}</p>;
  if (ca.error) return <p className={s.problem} role="alert">{t('business.failed', { message: ca.error.message })}</p>;
  if (!ca.data) return <p className={s.note}>{t('business.loading')}</p>;
  const { ca: of, pendingRates, requests } = ca.data;
  return (
    <>
      <p className={s.lead}>{t('business.ca.lead')}</p>
      <OfRecord ca={of} onSaved={ca.reload} />
      {of && <RateTables rates={pendingRates} onConfirmed={ca.reload} />}
      <Requests requests={requests} onRecorded={ca.reload} />
    </>
  );
}

function OfRecord({ ca, onSaved }: { ca: CaOfRecord | null; onSaved: () => void }) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
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
    <section className={s.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={s.heading}>{t('business.ca.ofRecord')}</h2>
      {!ca ? (
        <>
          <p className={s.line}>{t('business.ca.none')}</p>
          {form}
        </>
      ) : changing ? form : (
        <>
          <p className={s.strong}>{ca.name}</p>
          <p className={s.line}>{t('business.ca.membership')} <span className="mono">{ca.membershipNo}</span></p>
          <div className={s.buttons}>
            <Button variant="quiet" onClick={() => { setName(ca.name); setNumber(ca.membershipNo); setChanging(true); }}>{t('business.ca.change')}</Button>
          </div>
        </>
      )}
    </section>
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
  const headingId = useId();
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
    <section className={s.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={s.heading}>{t('business.ca.rates')}</h2>
      {rates.length === 0 ? (
        <p className={s.line}>{t('business.ca.ratesNone')}</p>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <ul className={s.steps}>
            {rates.map((rate) => (
              <li key={rate.tableId} className={s.step} data-rate={rate.tableId}>
                <label className={s.agree}>
                  <input type="checkbox" checked={chosen.has(rate.tableId)} onChange={(event) => toggle(rate.tableId, event.currentTarget.checked)} />
                  <span>{rate.title}</span>
                </label>
                <span className={s.stepWho}>{t('business.ca.version', { version: rate.version })} · {validity(rate, t, language)}</span>
                {rate.citations.map((citation) => <span key={citation} className={s.stepWho}>{citation}</span>)}
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
    </section>
  );
}

function Requests({ requests, onRecorded }: { requests: CaSignoffRequest[]; onRecorded: () => void }) {
  const t = useT();
  const headingId = useId();
  return (
    <section className={s.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={s.heading}>{t('business.ca.requests')}</h2>
      {requests.length === 0 ? (
        <p className={s.line}>{t('business.ca.requestsNone')}</p>
      ) : (
        <ul className={s.steps}>
          {requests.map((request) => <RequestLine key={request.id} request={request} onRecorded={onRecorded} />)}
        </ul>
      )}
    </section>
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
