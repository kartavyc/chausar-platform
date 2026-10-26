/**
 * Money across businesses (W4 4J6, D-Money's business chips `.bchips`): "All businesses", then one chip per business on
 * this computer, the open one first, a locked one with its lock, on Money's own Businesses page (#/money/businesses,
 * offered only when there is more than one business: simple first, 4J20). The choice is held in the address (?biz=, a
 * business's id); All businesses is the default.
 *
 * "All businesses" and another business's chip show what venture.money.across sends: the open business live, every
 * other one from the summary Chausar saved when it was last open, "as of" that time, and nothing at all for one locked
 * with a passphrase. Every figure carries the receipt the engine made for it in the open business (for another
 * business, a receipt of what its summary saved and when); its own receipts open only after switching to it. The
 * total across businesses is the engine's, only when they bill in one currency. Each line is worded here from the
 * engine's key, so it reads in Hindi too.
 */

import { useId } from 'react';
import { useT, type T } from '../../text';
import { useResource } from '../../engine/context';
import { goTo, setQuery, useRoute } from '../../shell/navigation';
import { FilterChips } from '../../parts/FilterChips';
import { Figure } from '../../parts/Figure';
import { Bento, Tile, TileHead } from '../../parts/Tile';
import type { AcrossLeftOut, AcrossMoneyView, EngineError } from '../../engine/types';
import { Counted, Failed, ProvedFigure, spendShown } from './parts';
import { onMoney, useMoment, useMonthWords } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';

type Business = AcrossMoneyView['businesses'][number];

/** The chosen chip: 'all' or a business's id from the address, or null when none is asked (All businesses). */
export function useAcrossChoice(): { across: AcrossMoneyView | undefined; chosen: string | null; error: EngineError | undefined } {
  const route = useRoute();
  const across = useResource('venture.money.across', {}, { refreshOn: onMoney });
  const asked = route.query.biz;
  const known = asked === 'all' || across.data?.businesses.some((business) => business.businessId === asked);
  return { across: across.data, chosen: asked && known ? asked : null, error: across.error };
}

/**
 * The chips row: shown only when there is more than one business on this computer. `overview`: the compact row over
 * Money's overview, the open business pressed; another chip opens the Businesses page on it.
 */
export function AcrossChips({ across, chosen, overview = false }: { across: AcrossMoneyView | undefined; chosen: string | null; overview?: boolean }) {
  const t = useT();
  const route = useRoute();
  if (!across || across.businesses.length < 2) return null;
  const open = across.businesses.find((business) => business.open)?.businessId;
  return (
    <FilterChips
      label={t('money.across.chips')}
      value={overview ? open ?? '' : chosen ?? 'all'}
      scroll={overview}
      onChange={(id) => {
        if (overview) {
          if (id !== open) goTo('money', 'businesses', { biz: id });
          return;
        }
        const { biz: _old, ...query } = route.query;
        setQuery(id === 'all' ? query : { ...query, biz: id });
      }}
      // Compact over the overview: the names only, no initials and no "All businesses" (the Businesses link has that).
      options={[
        ...(overview ? [] : [{ id: 'all', label: t('money.across.all') }]),
        ...across.businesses.map((business) => ({ id: business.businessId, label: business.name, business: !overview && !business.locked, locked: business.locked })),
      ]}
    />
  );
}

/** "All businesses" (every business) or one other business, in place of the overview. */
export function AcrossView({ across, chosen, error }: { across: AcrossMoneyView | undefined; chosen: string; error?: EngineError | undefined }) {
  const t = useT();
  const id = useId();
  const monthWords = useMonthWords();
  if (error) return <Failed error={error} />;
  if (!across) return null;
  const shown = chosen === 'all' ? across.businesses : across.businesses.filter((business) => business.businessId === chosen);
  return (
    <section className={s.overview} aria-label={t('money.across.title')}>
      {chosen === 'all' && (
        <Tile as="section" labelledBy={id} className={v.acrossTotal}>
          <TileHead id={id} title={t('money.across.invoiced', { month: monthWords(across.month) })} />
          {across.total && (
            <div className={s.tileValue}>
              <Figure value={across.total.display} receiptId={across.total.receiptId} size="stat" />
            </div>
          )}
          <p className={s.tileSub}>{totalWords(t, across)}</p>
          {across.notCounted.length > 0 && (
            <ul className={v.leftOut}>
              {across.notCounted.map((item) => <li key={item.businessId}>{leftOutWords(t, item, monthWords)}</li>)}
            </ul>
          )}
        </Tile>
      )}
      <Bento>
        {shown.map((business) => <BusinessCard key={business.businessId} business={business} />)}
      </Bento>
      {chosen !== 'all' && !shown[0]?.open && <p className={s.quietLine}>{t('money.across.switch')}</p>}
    </section>
  );
}

/** One business: its name, where its figures come from, and each figure with its receipt; a locked one shows nothing. */
function BusinessCard({ business }: { business: Business }) {
  const t = useT();
  const id = useId();
  const moment = useMoment();
  const figures = (['invoiced', 'received', 'owed', 'spend'] as const).flatMap((key) => {
    const value = business[key];
    const receiptId = business.receipts?.[key];
    return value && receiptId ? [{ key, value, receiptId }] : [];
  });
  // 4J20: the spend in rupees at the owner's rate, beside the dollars under the same receipt (the rate is the engine's words).
  const rupees = business.spendRupees && business.spendRate ? t('money.across.rupees', { amount: business.spendRupees, rate: business.spendRate }) : undefined;
  // 4Z3: the spend as the engine says it leads (rupees or dollars first), the other currency beneath it.
  const spend = spendShown(business.spendLead, business.spend ?? '', rupees);
  return (
    <Tile as="section" labelledBy={id} span={6} className={v.business} data-business={business.businessId}>
      <TileHead id={id} title={business.name} />
      <p className={s.tileSub} data-line-key={business.lineKey}>{lineWords(t, business, moment)}</p>
      {figures.length > 0 && (
        <dl className={v.stats}>
          {figures.map((figure) => (
            <div key={figure.key} className={v.stat}>
              <dt className={v.statLabel}>{t(`money.across.figure.${figure.key}`)}</dt>
              <dd className={v.statValue}><ProvedFigure value={figure.key === 'spend' ? spend.value : figure.value} proof={{ receiptId: figure.receiptId }} size="tile" rupees={figure.key === 'spend' ? spend.rupees : undefined} /></dd>
            </div>
          ))}
        </dl>
      )}
      {business.late !== null && business.late > 0 && (
        <p className={s.tileSub}><Counted text={t('money.owed.late', { count: String(business.late) })} count={business.late} /></p>
      )}
    </Tile>
  );
}

/** A business's line, worded here from the engine's key (engine views/across.ts and money/across.ts). */
function lineWords(t: T, business: Business, moment: (iso: string) => string): string {
  const name = business.name;
  switch (business.lineKey) {
    case 'open': return t('money.across.line.open');
    case 'no-country': return t('money.across.line.noCountry');
    case 'as-of': return business.asOf ? t('money.across.line.asOf', { when: moment(business.asOf) }) : business.line;
    case 'as-of-setting-up': return business.asOf ? `${t('money.across.line.asOf', { when: moment(business.asOf) })} ${t('money.across.line.settingUp')}` : business.line;
    case 'locked': return t('money.across.line.locked', { name });
    case 'key-missing': return t('money.across.line.keyMissing', { name });
    case 'unreadable': return t('money.across.line.unreadable', { name });
    case 'none': return t('money.across.line.none', { name });
    default: return business.line;
  }
}

/** What the total counted, from the engine's key and parts. */
function totalWords(t: T, across: AcrossMoneyView): string {
  if (across.lineKey === 'nothing') return t('money.across.total.nothing');
  if (across.lineKey === 'currencies') return t('money.across.total.currencies', { currencies: across.currencies.join(', ') });
  return t('money.across.total.counted', { count: String(across.counted) });
}

/** One business the total left out, and why. */
function leftOutWords(t: T, item: AcrossLeftOut, monthWords: (month: string) => string): string {
  if (item.why === 'other-month' && item.month) return t('money.across.left.otherMonth', { name: item.name, month: monthWords(item.month) });
  return t(`money.across.left.${item.why === 'key-missing' ? 'keyMissing' : item.why === 'setting-up' ? 'settingUp' : item.why}`, { name: item.name });
}
