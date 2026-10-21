import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Receipt } from '../../parts/Receipt';
import { Row } from '../../parts/Row';
import type { OfferLite, ReceiptLite } from '../../engine/types';
import { PendingPlanRows, messageOf, quoteAgain, usePlan } from './shared';
import s from './Business.module.css';

/**
 * Prices: each offer with every figure of its receipt exactly as the calculator wrote it (venture.price.quote), and a
 * field to set a new price. The typed price goes to the engine as typed; the engine checks it, writes a new plan
 * version, and the change waits on Today (it asks twice). Nothing is added up or formatted here.
 */
export function PricesView() {
  const t = useT();
  const plan = usePlan();
  if (plan.error) return <p className={s.problem} role="alert">{t('business.failed', { message: plan.error.message })}</p>;
  if (plan.data === undefined) return <p className={s.note}>{t('business.loading')}</p>;
  if (plan.data === null) {
    return <EmptyState title={t('business.noPlan')} line={t('business.noPlanLine')} action={<a className={s.link} href="#/onboarding">{t('business.start')}</a>} />;
  }
  const { blueprint, offerReceipts } = plan.data;
  return (
    <>
      <PendingPlanRows onDecided={plan.reload} />
      <section className={s.section} aria-label={t('business.offers')}>
        <p className={s.note}>{t('business.pricesLine')}</p>
        <ul className={s.list}>
          {blueprint.offers.map((offer) => (
            <OfferPrice key={offer.id} offer={offer} receipt={offerReceipts[offer.id] ?? null} currency={blueprint.backOffice.currency} onChanged={plan.reload} />
          ))}
        </ul>
      </section>
    </>
  );
}

function OfferPrice({ offer, receipt, currency, onChanged }: { offer: OfferLite; receipt: ReceiptLite | null; currency: string; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const priced = offer.pricing.unitPriceMinor !== null;

  async function workOut() {
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.price.quote', { offerId: offer.id });
      onChanged();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!typed.trim()) { setProblem(t('business.typePrice')); return; }
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.blueprint.update', { patch: { offers: [{ id: offer.id, unitPrice: typed.trim() }] } });
      setTyped('');
      await quoteAgain(client);
      onChanged();
    } catch (error) {
      setProblem(t('business.saveFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Row
      id={`price-${offer.id}`}
      title={<span data-offer-name="">{offer.name.value}</span>}
      line={`${offer.description.value} ${t(`business.unit.${offer.pricing.quantityUnit}`)}.`}
      actions={priced && !receipt ? <Button disabled={busy} onClick={() => void workOut()}>{t('business.workOut')}</Button> : undefined}
    >
      {receipt ? (
        <>
          <dl className={s.figures}>
            {receipt.figures.map((figure) => (
              <div key={figure.key} className={s.pair}>
                <dt>{figure.label}</dt>
                <dd className="mono">{figure.display}</dd>
              </div>
            ))}
          </dl>
          <p className={s.note}>{receipt.explanation} <Receipt id={receipt.id} /></p>
        </>
      ) : (
        !priced && <p className={s.note}>{t('business.priceNotSet')}</p>
      )}
      <form className={s.inlineForm} onSubmit={(event) => void save(event)}>
        <Field
          label={t('business.priceField', { offer: offer.name.value, currency })}
          hint={t('business.priceNote')} inputMode="decimal" autoComplete="off" value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
        />
        <Button variant="primary" type="submit" disabled={busy}>{t('business.savePrice')}</Button>
      </form>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Row>
  );
}
