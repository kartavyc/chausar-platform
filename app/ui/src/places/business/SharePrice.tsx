/**
 * The price editor's advanced option (Ink v2 wave 5, package 5A2; founder decision of 23 Oct): an offer priced as a
 * share of an amount the client confirms later, such as a recruiting fee on the hired person's yearly pay. Simple
 * first: each price card shows a fixed price, and the share waits in one fold under the cards. The owner picks the
 * offer and types a percent; the engine checks it and keeps it in a new plan version, and like any price change it waits
 * on Today and asks twice (venture.blueprint.update with the offer's share). Nothing is worked out or formatted here:
 * the share shows in the engine's own words, and its amount comes from the calculator with a receipt once the base is
 * recorded.
 */

import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Segmented } from '../../parts/Segmented';
import { Tile } from '../../parts/Tile';
import type { OfferLite } from '../../engine/types';
import { salesWords } from '../clients/Proposal';
import s from './Business.module.css';
import own from './SharePrice.module.css';

/** An offer's share as its price card shows it at rest: the engine's own words. */
export function ShareAtRest({ offer }: { offer: OfferLite }) {
  if (!offer.pricing.share) return null;
  return <span className={s.line}>{offer.pricing.share.words}</span>;
}

/** One fold under the price cards: pick the offer, type the share; or stop charging one. */
export function ShareFold({ offers, onChanged }: { offers: readonly OfferLite[]; onChanged: () => void }) {
  const t = useT();
  const engine = useEngine();
  const [offerId, setOfferId] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const offer = offers.find((item) => item.id === offerId) ?? offers[0];
  if (!offer) return null;

  async function change(share: { percent: string } | null) {
    setBusy(true);
    setProblem(null);
    try {
      await engine.request('venture.blueprint.update', { patch: { offers: [{ id: offer!.id, share }] } });
      setTyped('');
      onChanged();
    } catch (error) {
      setProblem(salesWords(error, t));
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!typed.trim()) { setProblem(t('kit-sales.share.type')); return; }
    void change({ percent: typed.trim() });
  }

  return (
    <Tile className={own.tile}>
      <details className={s.fold} data-share-fold="">
        <summary>{t('kit-sales.share.fold')}</summary>
        <div className={s.foldBody}>
          <p className={s.note}>{t('kit-sales.share.line')}</p>
          {offers.length > 1 && (
            <Segmented mode="buttons" label={t('kit-sales.share.offer')} value={offer.id} options={offers.map((item) => ({ id: item.id, label: item.name.value }))} onChange={setOfferId} />
          )}
          <form className={s.priceForm} onSubmit={save}>
            <Field
              label={t('kit-sales.share.field', { offer: offer.name.value })} hint={t('kit-sales.share.hint')} inputMode="decimal" autoComplete="off"
              value={typed} onChange={(event) => setTyped(event.currentTarget.value)}
            />
            <div className={s.formEnd}>
              {offer.pricing.share && <Button disabled={busy} onClick={() => void change(null)}>{t('kit-sales.share.remove')}</Button>}
              <Button type="submit" disabled={busy}>{t('kit-sales.share.save')}</Button>
            </div>
          </form>
          {problem && <p className={s.problem} role="alert">{problem}</p>}
        </div>
      </details>
    </Tile>
  );
}
