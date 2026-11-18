import { useEffect, useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Tile } from '../../parts/Tile';
import { PriceGuideList } from '../../parts/PriceSources';
import type { BlueprintLite, BlueprintPatchLite, OfferLite, OfferUnit, PriceGuideView, ReceiptLite } from '../../engine/types';
import { OFFER_UNITS } from '../../../../../platform/runtime/venture/core/offer-units';
import { Select } from '../../parts/Select';
import { PendingPlanRows, messageOf, quoteAgain, totalOf, usePlan } from './shared';
import { ShareAtRest, ShareFold } from './SharePrice';
import s from './Business.module.css';
import { Fold } from '../../parts/Fold';
import { LoadingPlace } from '../../parts/Skeleton';

/**
 * Prices in the D look: each offer a card with its price at rest as the calculator's total with its receipt
 * (venture.price.quote), and a field to set a new price, the card's one filled button. Simple first (founder, 23 Oct):
 * how the price is worked out (every figure of the receipt, tax lines included, as the calculator wrote them) waits
 * one fold away. The typed price goes to the engine as typed; the engine checks it and writes a new plan version. C4
 * task 33 (founder decision 1): the owner's own Save is the one press on that exact price, so it applies at once and
 * the engine's line comes back with Undo, until a quote, an order or an invoice uses it. A price from anywhere else waits
 * on Today (B4 task 7: one press, with an Undo). Nothing is added up or formatted here. A price that is a share of an amount
 * the client confirms later is the price editor's advanced option, one fold away (W5 5A2, SharePrice.tsx). The unit an
 * offer is priced in (per month, per piece, per visit) is the owner's to choose too: a change is the unit alone, never
 * an amount. It is the owner's own setting as the price is, so it applies at once with the engine's line and Undo
 * (seen on Windows, 15 Nov 2026: a unit changed and changed back made the owner accept the whole plan again).
 */
export function PricesView() {
  const t = useT();
  const headingId = useId();
  const plan = usePlan();
  if (plan.error) return <p className={s.problem} role="alert">{t('business.failed', { message: plan.error.message })}</p>;
  if (plan.data === undefined) return <LoadingPlace shape="settings" />;
  if (plan.data === null) {
    return <EmptyState title={t('business.noPlan')} line={t('business.noPlanLine')} actions={[{ label: t('business.week.onToday'), href: '#/today' }]} />;
  }
  const { blueprint, offerReceipts, priceGuide } = plan.data;
  return (
    <div className={s.page}>
      <PendingPlanRows onDecided={plan.reload} />
      <section aria-labelledby={headingId}>
        <div className={s.groupHead}>
          <h2 id={headingId} className={s.groupTitle}>{t('business.offers')}</h2>
          <span className={s.note}>{t('business.pricesLine')}</span>
        </div>
        <GstSwitch office={blueprint.backOffice} onChanged={plan.reload} />
        <ul className={s.cards}>
          {blueprint.offers.map((offer) => (
            <OfferPrice key={offer.id} offer={offer} receipt={offerReceipts[offer.id] ?? null} currency={blueprint.backOffice.currency} onChanged={plan.reload} />
          ))}
        </ul>
        {/* W5 5A2: a share of an amount the client confirms later, one step away (founder decision of 23 Oct). */}
        <ShareFold offers={blueprint.offers} onChanged={plan.reload} />
        {/* W6 6C3 (D17): what clients pay for this profession, from published sources with the date checked, or "No
            reliable data". Information beside the owner's own prices: it fills in and changes nothing. */}
        {priceGuide && <PriceGuideSection guide={priceGuide} />}
      </section>
    </div>
  );
}

/**
 * W6 6C3: the plan's profession guide under the offers, one fold away like the receipt's working (simple first): each
 * sourced range with its (i), or "No reliable data".
 */
function PriceGuideSection({ guide }: { guide: PriceGuideView }) {
  const t = useT();
  return (
    <Fold summary={t('price-sources.title')} className={s.priceGuide} data-price-guide-fold="" summaryClassName={s.priceGuideTitle}>
      <PriceGuideList guide={guide} />
    </Fold>
  );
}

function OfferPrice({ offer, receipt, currency, onChanged }: { offer: OfferLite; receipt: ReceiptLite | null; currency: string; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const titleId = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Save pressed with nothing typed. Said only while the box is empty and the offer is as it was: it leaves when the
  // owner types, and when the offer's price or unit changes (it used to stay under an offer whose price had saved).
  const [needPrice, setNeedPrice] = useState(false);
  useEffect(() => { setNeedPrice(false); }, [offer.pricing.unitPriceMinor, offer.pricing.quantityUnit]);
  // C4 task 33: the engine's decided line for the owner's own price, with the row its Undo takes; then the Undo's line.
  const [decided, setDecided] = useState<{ line: string; undoRowId: string | null } | null>(null);
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
    if (!typed.trim()) { setProblem(null); setNeedPrice(true); return; }
    setBusy(true);
    setProblem(null);
    setNeedPrice(false);
    setDecided(null);
    try {
      const view = await client.request('venture.blueprint.update', { patch: { offers: [{ id: offer.id, unitPrice: typed.trim() }] }, ownerSave: true });
      if (view.decided) setDecided(view.decided);
      setTyped('');
      await quoteAgain(client);
      onChanged();
    } catch (error) {
      setProblem(t('business.saveFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The unit the offer is priced in (the engine's core/offer-units.ts): sent alone; the engine keeps the price as typed.
   * The owner's own Save, as a price is: on an accepted plan it applies at once and the engine's line comes with Undo.
   */
  async function setUnit(unit: OfferUnit) {
    setBusy(true);
    setProblem(null);
    setNeedPrice(false);
    setDecided(null);
    try {
      const view = await client.request('venture.blueprint.update', { patch: { offers: [{ id: offer.id, unit }] }, ownerSave: true });
      if (view.decided) setDecided(view.decided);
      await quoteAgain(client);
      onChanged();
    } catch (error) {
      setProblem(t('business.saveFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }
  const unitChoice = (
    <Select aria-label={t('business.unitOf', { offer: offer.name.value })} value={offer.pricing.quantityUnit} disabled={busy} onChange={(event) => void setUnit(event.currentTarget.value as OfferUnit)}>
      {OFFER_UNITS.map((unit) => <option key={unit} value={unit}>{t(`business.unit.${unit}`)}</option>)}
    </Select>
  );

  async function undo(rowId: string) {
    setBusy(true);
    setProblem(null);
    try {
      const done = await client.request('venture.queue.undo', { rowId });
      setDecided({ line: done.line, undoRowId: null });
      onChanged();
    } catch (error) {
      setProblem(messageOf(error));
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
            {unitChoice}
          </div>
          <Fold summary={t('business.howWorkedOut')} className={s.fold}>
            <div className={s.foldBody}>
              <dl className={s.figures}>
                {receipt.figures.map((figure) => (
                  <div key={figure.key} className={s.pair}>
                    <dt>{figure.label}</dt>
                    <dd data-num="">{figure.display}</dd>
                  </div>
                ))}
              </dl>
              <p className={s.note}>{receipt.explanation}</p>
            </div>
          </Fold>
        </div>
      ) : (
        <div className={s.price}>
          {/* W5 5A2: an offer priced as a share reads as the owner set it (SharePrice.tsx). */}
          {offer.pricing.share ? <ShareAtRest offer={offer} /> : <span className={s.quiet}>{priced ? t('business.notPriced') : t('business.priceNotSet')}</span>}
          {priced && <Button size="sm" disabled={busy} onClick={() => void workOut()}>{t('business.workOut')}</Button>}
          {!offer.pricing.share && unitChoice}
        </div>
      )}
      <form className={s.priceForm} onSubmit={(event) => void save(event)}>
        <Field
          label={t('business.priceField', { offer: offer.name.value, currency })}
          hint={t('business.priceNote')} inputMode="decimal" autoComplete="off" value={typed}
          onChange={(event) => { setTyped(event.currentTarget.value); setNeedPrice(false); }}
        />
        <div className={s.formEnd}><Button variant="primary" type="submit" disabled={busy}>{t('business.savePrice')}</Button></div>
      </form>
      {/* Seam (C4 task 33): B4 task 7's result slot (ResultLine) takes this line and its Undo when B4 lands. */}
      {decided && (
        <p className={s.note} role="status" data-price-decided="">
          {decided.line}
          {decided.undoRowId && <> <Button size="sm" disabled={busy} onClick={() => void undo(decided.undoRowId!)}>{t('approval.undo')}</Button></>}
        </p>
      )}
      {needPrice && !typed.trim() && !problem && <p className={s.problem} role="alert">{t('business.typePrice')}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Tile>
  );
}

const GST_RATES = ['5', '12', '18', '28'] as const;
const bpsOf = (percent: string) => String(Math.round(Number(percent) * 100));

/**
 * C5 task 13: "I charge GST". The fields appear only after the switch; every change goes through venture.blueprint.update
 * as a price does, and the engine checks the GSTIN (core/tax-fields.ts). E-invoicing stays out of scope.
 *
 * Found on the real app, 16 November 2026: while the plan's answer is Chausar's own assumption (the owner never said),
 * Today asks the owner to confirm it, and a tick left off was no answer, so the card never left. Until the owner has
 * said, this asks, with No and Yes: No is one press, sent as the owner's own answer (ownerSave; core/owner-tax.ts), and
 * the engine's line comes back; Yes opens the rate, the GSTIN and Save. Once said, it is the tick, the owner's setting.
 */
function GstSwitch({ office, onChanged }: { office: BlueprintLite['backOffice']; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const headId = useId();
  const [on, setOn] = useState(office.taxRegistered.value);
  const [rate, setRate] = useState(() => { const held = GST_RATES.find((item) => bpsOf(item) === office.taxRateBps); return held ?? (office.taxRegistered.value ? String(Number(office.taxRateBps) / 100) : '18'); });
  const [gstin, setGstin] = useState(office.taxId ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The engine's line for the owner's own answer ("You said you do not charge GST."). */
  const [said, setSaid] = useState<string | null>(null);
  const unanswered = office.taxRegistered.label !== 'told-by-you';
  async function send(patch: BlueprintPatchLite, own = false) {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      const view = await client.request('venture.blueprint.update', own ? { patch, ownerSave: true } : { patch });
      if (view.decided) setSaid(view.decided.line);
      await quoteAgain(client);
      onChanged();
      return true;
    }
    catch (error) { setProblem(t('business.saveFailed', { message: messageOf(error) })); return false; }
    finally { setBusy(false); }
  }
  async function flip(next: boolean) {
    setOn(next);
    setSaid(null);
    // Off, where the owner had said yes: that answer is the owner's own too. Off over an assumption goes back to the question.
    if (!next && office.taxRegistered.value) await send({ taxRegistered: false }, true);
  }
  return (
    <section className={s.gst} aria-labelledby={headId}>
      {unanswered && !on ? (
        <>
          <p className={s.line} id={headId}>{t('business.gst.ask', { tax: office.taxLabel })}</p>
          <div className={s.buttons}>
            <Button disabled={busy} aria-busy={busy || undefined} onClick={() => void send({ taxRegistered: false }, true)}>{t('business.gst.no', { tax: office.taxLabel })}</Button>
            <Button disabled={busy} onClick={() => setOn(true)}>{t('business.gst.yes', { tax: office.taxLabel })}</Button>
          </div>
        </>
      ) : (
        <label className={s.agree} id={headId}>
          <input type="checkbox" checked={on} disabled={busy} onChange={(event) => void flip(event.currentTarget.checked)} />
          {t('business.gst.switch')}
        </label>
      )}
      {said && <p className={s.note} role="status">{said}</p>}
      {on && (
        <form className={s.form} onSubmit={(event: FormEvent) => { event.preventDefault(); const taxId = gstin.trim(); void send({ taxRegistered: true, taxRate: rate.trim(), ...(taxId ? { taxId } : {}) }); }}>
          <Field label={t('business.gst.rate')} hint={t('business.gst.rateHint')} inputMode="decimal" list="gst-rates" value={rate} disabled={busy} onChange={(event) => setRate(event.currentTarget.value)} />
          <datalist id="gst-rates">{GST_RATES.map((item) => <option key={item} value={item} />)}</datalist>
          <Field label={t('business.gst.gstin')} autoComplete="off" spellCheck={false} value={gstin} disabled={busy} onChange={(event) => setGstin(event.currentTarget.value)} />
          <div className={s.buttons}><Button type="submit" variant="secondary" disabled={busy || !rate.trim()}>{t('business.gst.save')}</Button></div>
        </form>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}
