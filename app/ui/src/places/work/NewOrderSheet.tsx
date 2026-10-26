import { useEffect, useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import type { SheetComponentProps } from '../../shell/sheets';
import { EngineError } from '../../engine/types';
import { FILE_ACCEPT, fileProblem, readBase64 } from './files';
import { EMPTY_INTAKE, intakeParams, intakeReady, type IntakeDraft } from './intake';
import { IntakeFields } from './IntakeFields';
import { messageOf } from './PreviousRuns';
import { clearPrefill, peekPrefill } from './prefill';
import { workChanged } from './refresh';
import s from './Work.module.css';

/** The client choice that opens a name field and adds the client with the order. Not a valid client id. */
export const NEW_CLIENT = '+new';
const never = () => false;

/**
 * New order, in the sheet beside Work: client (or a new one), service from the plan, what they asked for, and the
 * client's files. Opened as `new-order:new`, or `new-order:<clientId>` with that client chosen. A service from a
 * flagship playbook asks what the plan says it needs at intake: whose footage it is for one that cuts footage, and
 * what its checks read. The order is created first, then each file is added to it; the files are checked against
 * the engine's rules before anything is sent, so a refused file never leaves half an order behind.
 */
export function NewOrderSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const ids = useId();
  const clients = useResource('venture.client.list', {}, { refreshOn: never });
  const plan = useResource('venture.blueprint.get', {}, { refreshOn: never });
  const [clientId, setClientId] = useState(id === 'new' ? '' : id);
  const [name, setName] = useState('');
  // W4 4B3: an agent's chat may open this sheet with the service and request filled in (prefill.ts).
  const [prefill] = useState(peekPrefill);
  useEffect(clearPrefill, []);
  const [offerId, setOfferId] = useState(prefill?.offerId ?? '');
  const [request, setRequest] = useState(prefill?.request ?? '');
  const [intake, setIntake] = useState<IntakeDraft>(EMPTY_INTAKE);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [failures, setFailures] = useState<{ name: string; message: string }[] | null>(null);

  const offers = plan.data?.blueprint.offers ?? [];
  const priced = offers.filter((o) => o.pricing.unitPriceMinor !== null);
  const who = clientId === NEW_CLIENT || (clients.data ?? []).some((c) => c.id === clientId) ? clientId : '';
  const what = offerId || (priced.length === 1 ? priced[0]!.id : '');
  // What the engine says this service asks at intake; null for a service that asks nothing.
  const ask = (what && plan.data?.intake?.[what]) || null;
  const filesOk = files.every((f) => fileProblem(f) === null);
  const ready = !sending && (who === NEW_CLIENT ? name.trim() !== '' : who !== '') && what !== '' && request.trim() !== '' && intakeReady(ask, intake) && filesOk;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSending(true);
    setError(undefined);
    try {
      let forClient = who;
      if (who === NEW_CLIENT) {
        const added = await engine.request('venture.client.add', { name: name.trim() });
        forClient = added.id;
        // A retry after a refused order uses this client, never a second copy of it.
        setClientId(added.id);
        clients.reload();
      }
      const told = intakeParams(ask, intake);
      const order = await engine.request('venture.order.create', { clientId: forClient, offerId: what, request: request.trim(), ...(told ? { intake: told } : {}) });
      const refused: { name: string; message: string }[] = [];
      for (const file of files) {
        try {
          await engine.request('venture.files.add', { orderId: order.id, name: file.name, contentBase64: await readBase64(file) });
        } catch (failure) {
          refused.push({ name: file.name, message: messageOf(failure) });
        }
      }
      workChanged();
      if (refused.length > 0) setFailures(refused);
      else onClose();
    } catch (failure) {
      // A refusal over the rights says so plainly; the engine's own sentence says what is missing.
      const rights = failure instanceof EngineError && failure.code === 'RIGHTS_REQUIRED';
      setError(t(rights ? 'work.form.rightsRefused' : 'work.form.failed', { message: messageOf(failure) }));
    } finally {
      setSending(false);
    }
  }

  let body;
  if (failures) {
    body = (
      <div className={s.form}>
        <p className={s.note}>{t('work.form.partial')}</p>
        <ul className={s.files}>
          {failures.map((f, i) => <li key={`${f.name}-${i}`} className={s.problem}>{t('work.form.fileFailed', f)}</li>)}
        </ul>
      </div>
    );
  } else if (plan.error || clients.error) {
    body = <p className={s.problem}>{t('work.loadFailed', { message: (plan.error ?? clients.error)!.message })}</p>;
  } else if (plan.data === null || (plan.data && offers.length === 0)) {
    body = <p className={s.note}>{t('work.form.noServices')}</p>;
  } else if (!plan.data || !clients.data) {
    body = <p className={s.quiet}>{t('sheet.loading')}</p>;
  } else {
    body = (
      <form className={s.form} onSubmit={(event) => void submit(event)} noValidate>
        <div className={s.field}>
          <label htmlFor={`${ids}-client`} className={s.label}>{t('work.form.client')}</label>
          <select id={`${ids}-client`} className={s.select} value={who} onChange={(event) => setClientId(event.currentTarget.value)}>
            <option value="" disabled>{t('work.form.choose')}</option>
            {clients.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NEW_CLIENT}>{t('work.form.newClient')}</option>
          </select>
        </div>
        {who === NEW_CLIENT && <Field label={t('work.form.clientName')} value={name} autoComplete="off" onChange={(event) => setName(event.currentTarget.value)} />}
        <div className={s.field}>
          <label htmlFor={`${ids}-service`} className={s.label}>{t('work.form.service')}</label>
          <select id={`${ids}-service`} className={s.select} value={what} onChange={(event) => setOfferId(event.currentTarget.value)}>
            <option value="" disabled>{t('work.form.choose')}</option>
            {offers.map((offer) => {
              const unpriced = offer.pricing.unitPriceMinor === null;
              return <option key={offer.id} value={offer.id} disabled={unpriced}>{unpriced ? t('work.form.noPrice', { name: offer.name.value }) : offer.name.value}</option>;
            })}
          </select>
        </div>
        <IntakeFields ask={ask} draft={intake} onChange={setIntake} />
        <Field multiline label={t('work.form.request')} value={request} onChange={(event) => setRequest(event.currentTarget.value)} />
        <div className={s.field}>
          <label htmlFor={`${ids}-files`} className={s.label}>{t('work.form.files')}</label>
          <input
            id={`${ids}-files`} type="file" multiple accept={FILE_ACCEPT} className={s.file} aria-describedby={`${ids}-files-hint`}
            onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))}
          />
          <p id={`${ids}-files-hint`} className={s.hint}>{t('work.form.filesHint')}</p>
          {files.length > 0 && (
            <ul className={s.files}>
              {files.map((file, i) => {
                const problem = fileProblem(file);
                return (
                  <li key={`${file.name}-${i}`} className={problem ? s.problem : undefined}>
                    {problem ? t(problem === 'type' ? 'work.form.fileType' : 'work.form.fileSize', { name: file.name }) : file.name}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {error && <p className={s.problem} role="status">{error}</p>}
        <div className={s.submit}>
          <Button variant="primary" type="submit" disabled={!ready}>{sending ? t('work.form.sending') : t('work.form.submit')}</Button>
        </div>
      </form>
    );
  }

  return (
    <Sheet label={t('work.sheet.label')} title={t('work.sheet.title')} onClose={onClose} returnFocus={returnFocus}>
      {body}
    </Sheet>
  );
}
