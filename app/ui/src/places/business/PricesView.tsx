import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Tile } from '../../parts/Tile';
import type { OfferLite, ReceiptLite } from '../../engine/types';
import { PendingPlanRows, messageOf, quoteAgain, totalOf, usePlan } from './shared';
import s from './Business.module.css';

/**
 * Prices in the D look: each offer a card with its price at rest as the calculator's total with its receipt
 * (venture.price.quote), and a field to set a new price, the card's one filled button. Simple first (founder, 23 Oct):
 * how the price is worked out (every figure of the receipt, tax lines included, as the calculator wrote them) waits
 * one fold away. The typed price goes to the engine as typed; the engine checks it, writes a new plan version, and the
 * change waits on Today (it asks twice). Nothing is added up or formatted here. A price that is a share of an amount
 * the client confirms later joins the price editor as an advanced option when the engine offers it (W4/W5).
 */
export function PricesView() {
  const t = useT();
  const headingId = useId();
  const plan = usePlan();
  if (plan.error) return <p className={s.problem} role="alert">{t('business.failed', { message: plan.error.message })}</p>;
  if (plan.data === undefined) return <p className={s.note}>{t('business.loading')}</p>;
  if (plan.data === null) {
    return <EmptyState title={t('business.noPlan')} line={t('business.noPlanLine')} actions={[{ label: t('business.start'), href: '#/onboarding' }]} />;
  }
  const { blueprint, offerReceipts } = plan.data;
  return (
    <div className={s.page}>
      <PendingPlanRows onDecided={plan.reload} />
      <section aria-labelledby={headingId}>
        <div className={s.groupHead}>
          <h2 id={headingId} className={s.groupTitle}>{t('business.offers')}</h2>
          <span className={s.note}>{t('business.pricesLine')}</span>
        </div>
        <ul className={s.cards}>
          {blueprint.offers.map((offer) => (
            <OfferPrice key={offer.id} offer={offer} receipt={offerReceipts[offer.id] ?? null} currency={blueprint.backOffice.currency} onChanged={plan.reload} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function OfferPrice({ offer, receipt, currency, onChanged }: { offer: OfferLite; receipt: ReceiptLite | null; currency: string; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const titleId = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const priced = offer.pricing.unitPriceMinor !== null;
  const total = totalOf(receipt);

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
    <Tile as="li" card labelledBy={titleId} className={s.offer}>
      <h3 id={titleId} className={s.offerTitle}><span data-offer-name="">{offer.name.value}</span></h3>
      <p className={s.line}>{offer.description.value}</p>
      {receipt && total ? (
        // One receipt proves the total and its working: the figures in the fold are the same receipt's.
        <div className={s.priceBlock} data-figure-group="">
          <div className={s.price}>
            <Figure value={total} receiptId={receipt.id} size="tile" />
            <span className={s.unit}>{t(`business.unit.${offer.pricing.quantityUnit}`)}</span>
          </div>
          <details className={s.fold}>
            <summary>{t('business.howWorkedOut')}</summary>
            <div className={s.foldBody}>
              <dl className={s.figures}>
                {receipt.figures.map((figure) => (
                  <div key={figure.key} className={s.pair}>
                    <dt>{figure.label}</dt>
                    <dd className="mono">{figure.display}</dd>
                  </div>
                ))}
              </dl>
              <p className={s.note}>{receipt.explanation}</p>
            </div>
          </details>
        </div>
      ) : (
        <div className={s.price}>
          <span className={s.quiet}>{priced ? t('business.notPriced') : t('business.priceNotSet')}</span>
          {priced && <Button size="sm" disabled={busy} onClick={() => void workOut()}>{t('business.workOut')}</Button>}
        </div>
      )}
      <form className={s.priceForm} onSubmit={(event) => void save(event)}>
        <Field
          label={t('business.priceField', { offer: offer.name.value, currency })}
          hint={t('business.priceNote')} inputMode="decimal" autoComplete="off" value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
        />
        <div className={s.formEnd}><Button variant="primary" type="submit" disabled={busy}>{t('business.savePrice')}</Button></div>
      </form>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Tile>
  );
}
