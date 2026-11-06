import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Tile } from '../../parts/Tile';
import { PriceGuideList } from '../../parts/PriceSources';
import type { BlueprintLite, BlueprintPatchLite, OfferLite, PriceGuideView, ReceiptLite } from '../../engine/types';
import { PendingPlanRows, quoteAgain, totalOf, usePlan } from './shared';
import { ShareAtRest, ShareFold } from './SharePrice';
import s from './Business.module.css';
import { Fold } from '../../parts/Fold';
import { LoadingPlace } from '../../parts/Skeleton';
import { useChanged } from '../../parts/useChanged';
import { currencySign } from '../../../../../platform/shared/owner-format.ts';

/**
 * Prices in the D look: each offer a card with its price at rest as the calculator's total with its receipt
 * (venture.price.quote), and a field to set a new price, the card's one filled button. Simple first (founder, 23 Oct):
 * how the price is worked out (every figure of the receipt, tax lines included, as the calculator wrote them) waits
 * one fold away. The typed price goes to the engine as typed; the engine checks it and writes a new plan version. C4
 * task 33 (founder decision 1): the owner's own Save is the one press on that exact price, so it applies at once and
 * the engine's line comes back with Undo, until a quote, an order or an invoice uses it. A price from anywhere else waits
 * on Today (B4 task 7: one press, with an Undo). Nothing is added up or formatted here. A price that is a share of an amount
 * the client confirms later is the price editor's advanced option, one fold away (W5 5A2, SharePrice.tsx).
 */
export function PricesView() {
  const t = useT();
  const headingId = useId();
  const plan = usePlan();
  if (plan.error) return <p className={s.problem} role="alert">{t('business.failed', { message: plan.error.message })}</p>;
  if (plan.data === undefined) return <LoadingPlace shape="settings" />;
  if (plan.data === null) {
    return <EmptyState title={t('business.noPlan')} line={t('business.noPlanLine')} actions={[{ label: t('business.start'), href: '#/onboarding' }]} />;
  }
  const { blueprint, offerReceipts, priceGuide } = plan.data;
  return (
    <div className={s.page}>
      <section aria-labelledby={headingId}>
        <div className={s.groupHead}>
          <h2 id={headingId} className={s.groupTitle}>{t('business.offers')}</h2>
          <span className={s.note}>{t('business.pricesLine')}</span>
        </div>
        <GstSwitch office={blueprint.backOffice} onChanged={plan.reload} />
        <ul className={s.cards}>
          {blueprint.offers.map((offer, index) => (
            <OfferPrice key={offer.id} offer={offer} receipt={offerReceipts[offer.id] ?? null} currency={blueprint.backOffice.currency} onChanged={plan.reload} leading={index === 0} offers={blueprint.offers} />
          ))}
        </ul>
        <p className={s.note}>{t('business.priceNote')}</p>
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

function OfferPrice({ offer, receipt, currency, onChanged, leading, offers }: { offer: OfferLite; receipt: ReceiptLite | null; currency: string; onChanged: () => void; leading: boolean; offers: OfferLite[] }) {
  const changed = useChanged(offer.pricing.unitPriceMinor);
  const t = useT();
  const client = useEngine();
  const titleId = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
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
    if (!typed.trim()) { setProblem(t('business.typePrice')); return; }
    setBusy(true);
    setProblem(null);
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
    <Tile as="li" card labelledBy={titleId} className={s.offer} data-changed={changed}>
      <h3 id={titleId} className={s.offerTitle}><span data-offer-name="">{offer.name.value}</span></h3>
      <p className={s.line}>{offer.description.value}</p>
      {receipt && total ? (
        // One receipt proves the total and its working: the figures in the fold are the same receipt's.
        <div className={s.priceBlock} data-figure-group="">
          <div className={s.price}>
            <Figure value={total} receiptId={receipt.id} size="tile" />
            <span className={s.unit}>{t(`business.unit.${offer.pricing.quantityUnit}`)}</span>
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
        </div>
      )}
      <form className={s.priceForm} onSubmit={(event) => void save(event)}>
        <Field
          label={t('business.priceField')}
          adornment={currencySign(currency) ?? currency} inputMode="decimal" autoComplete="off" value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
        />
        <div className={s.formEnd}><Button variant="secondary" type="submit" disabled={busy}>{t('business.savePrice')}</Button></div>
      </form>
      <PendingPlanRows onDecided={onChanged} quietPrimary={!leading} accepts={row => row.kind === 'price' && (offers.find(item => item.name.value === row.change?.label)?.id ?? offers[0]?.id) === offer.id} />
      {/* Seam (C4 task 33): B4 task 7's result slot (ResultLine) takes this line and its Undo when B4 lands. */}
      {decided && (
        <p className={s.note} role="status" data-price-decided="">
          {decided.line}
          {decided.undoRowId && <> <Button size="sm" disabled={busy} onClick={() => void undo(decided.undoRowId!)}>{t('approval.undo')}</Button></>}
        </p>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Tile>
  );
}

const GST_RATES = ['5', '12', '18', '28'] as const;
const bpsOf = (percent: string) => String(Math.round(Number(percent) * 100));

/**
 * C5 task 13: "I charge GST". The fields appear only after the switch; every change goes through venture.blueprint.update
 * as a price does, and the engine checks the GSTIN (core/tax-fields.ts). E-invoicing stays out of scope.
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
  async function send(patch: BlueprintPatchLite) {
    setBusy(true);
    setProblem(null);
    try { await client.request('venture.blueprint.update', { patch }); await quoteAgain(client); onChanged(); return true; }
    catch (error) { setProblem(t('business.saveFailed', { message: messageOf(error) })); return false; }
    finally { setBusy(false); }
  }
  async function flip(next: boolean) {
    setOn(next);
    if (!next && office.taxRegistered.value) await send({ taxRegistered: false });
  }
  return (
    <section className={s.gst} aria-labelledby={headId}>
      <label className={s.agree} id={headId}>
        <input type="checkbox" checked={on} disabled={busy} onChange={(event) => void flip(event.currentTarget.checked)} />
        {t('business.gst.switch')}
      </label>
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
