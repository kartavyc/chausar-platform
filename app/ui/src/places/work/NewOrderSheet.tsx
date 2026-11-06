import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useEffect, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Sheet } from '../../parts/Sheet';
import type { SheetComponentProps } from '../../shell/sheets';
import { goTo } from '../../shell/navigation';
import { totalOf } from '../business/shared';
import { EngineError } from '../../engine/types';
import { FILE_ACCEPT, fileProblem, readBase64 } from './files';
import { EMPTY_INTAKE, intakeParams, intakeReady, type IntakeDraft } from './intake';
import { IntakeFields } from './IntakeFields';
import { KitIntakeFields } from './KitIntakeFields';
import { kitIntakeFiles, kitIntakeParams, kitIntakeReady, type KitAnswers } from './kit-intake';

import { clearPrefill, peekPrefill, prefillOrder } from './prefill';
import { workChanged } from './refresh';
import s from './Work.module.css';
import { Select } from '../../parts/Select';
import { FilePick } from '../../parts/FilePick';
import { Reveal } from '../../parts/RevealBlock';
import { LoadingPlace } from '../../parts/Skeleton';

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
  const clients = useResource('venture.client.list', {}, { refreshOn: never });
  const plan = useResource('venture.blueprint.get', {}, { refreshOn: never });
  const business = useResource('venture.get', {}, { refreshOn: never });
  const [newPhone, setNewPhone] = useState(''); // C6: the new client's phone or WhatsApp number, as typed
  // W4 4B3: an agent's chat may open this sheet with the service and request filled in (prefill.ts); C4 task 11: so
  // does the owner's own form, kept while they set a price, with its client too.
  const [prefill] = useState(peekPrefill);
  useEffect(clearPrefill, []);
  const [clientId, setClientId] = useState(id === 'new' ? prefill?.clientId ?? '' : id);
  const [name, setName] = useState(prefill?.clientName ?? '');
  const [offerId, setOfferId] = useState(prefill?.offerId ?? '');
  const [request, setRequest] = useState(prefill?.request ?? '');
  const [intake, setIntake] = useState<IntakeDraft>(EMPTY_INTAKE);
  const [files, setFiles] = useState<File[]>([]);
  const [kitAnswers, setKitAnswers] = useState<KitAnswers>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [failures, setFailures] = useState<{ name: string; message: string }[] | null>(null);

  const offers = plan.data?.blueprint.offers ?? [];
  const priced = offers.filter((o) => o.pricing.unitPriceMinor !== null);
  const who = clientId === NEW_CLIENT || (clients.data ?? []).some((c) => c.id === clientId) ? clientId : '';
  const what = offerId || (priced.length === 1 ? priced[0]!.id : '');
  // C4 task 11: the picked service as the plan has it; an unpriced one can be picked so the form can say how to fix it.
  const picked = offers.find((o) => o.id === what);
  const unpriced = !!picked && picked.pricing.unitPriceMinor === null;
  const pickedReceipt = picked && !unpriced ? plan.data?.offerReceipts[picked.id] ?? null : null;
  const pickedTotal = totalOf(pickedReceipt);
  // What the engine says this service asks at intake; null for a service that asks nothing.
  const ask = (what && plan.data?.intake?.[what]) || null;
  const filesOk = files.every((f) => fileProblem(f) === null);
  const ready = !sending && !!business.data?.venture.country && (who === NEW_CLIENT ? name.trim() !== '' : who !== '') && what !== '' && !unpriced && request.trim() !== '' && intakeReady(ask, intake) && kitIntakeReady(ask, kitAnswers) && filesOk;

  /** C4 task 11: keep what was typed, go to Prices for that service, and the next New order opens with it. */
  function setPrice() {
    prefillOrder({ offerId: what, request, ...(who ? { clientId: who } : {}), ...(who === NEW_CLIENT && name.trim() ? { clientName: name } : {}) });
    goTo('business', 'prices', { offer: what });
  }

  /** The first thing still missing, said under Add order (B4). */
  const typesName = who === NEW_CLIENT || (clients.data ?? []).length === 0;
  const noClient = who === NEW_CLIENT ? name.trim() === '' : who === '';
  const missing = ready || sending ? undefined
    : !business.data?.venture.country ? t('work.form.needCountry')
      : noClient && what === '' ? t(typesName ? 'work.form.needNameAndService' : 'work.form.needClientAndService')
        : noClient ? t(typesName ? 'work.form.needName' : 'work.form.needClient')
          : what === '' ? t('work.form.needService')
            : request.trim() === '' ? t('work.form.needRequest')
              : !filesOk ? t('work.form.needFiles')
                : t('work.form.needIntake');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSending(true);
    setError(undefined);
    try {
      const intakeFiles = await kitIntakeFiles(ask, kitAnswers);
      const told = ask?.kit ? { ...intakeParams(ask, intake), ...kitIntakeParams(ask, kitAnswers) } : intakeParams(ask, intake);
      // One-shot A1 (row 10): a new client goes with the order in one request, so a refused order adds no client.
      const forClient = who === NEW_CLIENT ? { newClient: { name: name.trim(), ...(newPhone.trim() ? { phone: newPhone.trim() } : {}) } } : { clientId: who };
      const order = await engine.request('venture.order.create', { ...forClient, offerId: what, request: request.trim(), ...(told ? { intake: told } : {}), ...(Object.keys(intakeFiles).length ? { intakeFiles } : {}) });
      if (who === NEW_CLIENT) { setClientId(order.clientId); clients.reload(); }
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
  } else if (plan.error || clients.error || business.error) {
    body = <p className={s.problem}>{t('work.loadFailed', { message: (plan.error ?? clients.error ?? business.error)!.message })}</p>;
  } else if (plan.data === null || (plan.data && offers.length === 0)) {
    body = <p className={s.note}>{t('work.form.noServices')}</p>;
  } else if (!plan.data || !clients.data || !business.data) {
    body = <LoadingPlace shape="sheet" />;
  } else {
    body = (
      <form className={s.form} onSubmit={(event) => void submit(event)} noValidate>
        <Select label={t('work.form.client')} value={who} onChange={(event) => setClientId(event.currentTarget.value)}>
            <option value="" disabled>{t('work.form.choose')}</option>
            {clients.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NEW_CLIENT}>{t('work.form.newClient')}</option>
          </Select>
        <Reveal open={who === NEW_CLIENT}><Field label={t('work.form.clientName')} value={name} autoComplete="off" onChange={(event) => setName(event.currentTarget.value)} /><Field label={t('work.form.clientPhone')} type="tel" inputMode="tel" value={newPhone} autoComplete="off" maxLength={40} onChange={(event) => setNewPhone(event.currentTarget.value)} /></Reveal>
        <Select label={t('work.form.service')} value={what} onChange={(event) => setOfferId(event.currentTarget.value)}>
            <option value="" disabled>{t('work.form.choose')}</option>
            {offers.map((offer) => {
              const noPrice = offer.pricing.unitPriceMinor === null;
              return <option key={offer.id} value={offer.id}>{noPrice ? t('work.form.noPrice', { name: offer.name.value }) : offer.name.value}</option>;
            })}
          </Select>
          {/* C4 task 11: the picked service's price as its receipt says it, or how to set one. */}
          {pickedReceipt && pickedTotal && picked && (
            <p className={s.hint} data-testid="picked-price">
              <Figure value={pickedTotal} receiptId={pickedReceipt.id} /> {t(`business.unit.${picked.pricing.quantityUnit}`)}
            </p>
          )}
          {unpriced && picked && (
            <p className={s.hint} role="status">
              {t('work.form.setPriceFirst', { name: picked.name.value })}{' '}
              <Button size="sm" onClick={setPrice}>{t('work.form.setPrice')}</Button>
            </p>
          )}
        <IntakeFields ask={ask} draft={intake} onChange={setIntake} />
        <KitIntakeFields currency={business.data?.venture.country?.currency} ask={ask} answers={kitAnswers} onChange={setKitAnswers} />
        <Field multiline label={t('work.form.request')} value={request} onChange={(event) => setRequest(event.currentTarget.value)} />
        <div className={s.field}>
          <FilePick label={t('work.form.files')} hint={t('work.form.filesHint')} multiple accept={FILE_ACCEPT} files={files} onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))} onRemove={(index) => setFiles(files.filter((_, at) => at !== index))} />
          {!filesOk && (
            <ul className={s.files}>
              {files.map((file, i) => {
                const problem = fileProblem(file);
                return problem && <li key={`${file.name}-${i}`} className={s.problem}>{t(problem === 'type' ? 'work.form.fileType' : 'work.form.fileSize', { name: file.name })}</li>;
              })}
            </ul>
          )}
        </div>
        {error && <p className={s.problem} role="status">{error}</p>}
        <div className={s.submit}>
          <Button variant="primary" type="submit" disabled={!ready} disabledReason={missing}>{sending ? t('work.form.sending') : t('work.form.submit')}</Button>
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
