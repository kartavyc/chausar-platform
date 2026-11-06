/**
 * The books for a period: billed, received and earned as tiles, each from the calculator with its receipt; the
 * engine's own notes on what the figures include; and the invoices still open, each a step from its own figures. The
 * period is a row of chips held in the address.
 *
 * Simple first: the tax working (venture.tax.working) sits one step away, behind "Tax details", each figure with its
 * receipt and a plain line when the CA must confirm it before anything is filed. A business not registered for GST
 * (its plan says so, venture.blueprint.get) never sees GST: there is no "Tax details" at all, whatever the working
 * holds (the engine's plain working for such a business is one section about GST).
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { setQuery, useRoute } from '../../shell/navigation';
import { Bento } from '../../parts/Tile';
import { Button } from '../../parts/Button';
import { FilterChips } from '../../parts/FilterChips';
import { Figure } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import type { IconName } from '../../parts/icons';
import type { BooksFigureLite, BooksPeriodKey } from '../../engine/types';
import { OpenList } from './OwedTile';
import { Amount, EngineWords, Failed, MoneyTile, Section } from './parts';
import { byDue, onMoney, useDay } from './words';
import s from './Money.module.css';

const PERIODS: readonly BooksPeriodKey[] = ['all', 'this-month', 'last-month', 'this-year'];
const isPeriod = (value: string | undefined): value is BooksPeriodKey => PERIODS.includes(value as BooksPeriodKey);
const ICONS: Readonly<Record<BooksFigureLite['operation'], IconName>> = { billed: 'file-text', received: 'wallet', earned: 'trending-up' };

export function Books() {
  const t = useT();
  const day = useDay();
  const route = useRoute();
  const chosen: BooksPeriodKey = isPeriod(route.query.period) ? route.query.period : 'this-month';
  const books = useResource('venture.books.summary', { period: chosen }, { refreshOn: onMoney });
  const data = books.data;
  const periods = data?.periods ?? PERIODS.map((key) => ({ key, label: t(`money.books.period.${key}`) }));
  const [first, ...more] = data?.notes ?? [];

  return (
    <>
      <div className={s.periodRow}>
        <FilterChips
          label={t('money.books.period')}
          options={periods.map((period) => ({ id: period.key, label: period.label }))}
          value={chosen}
          onChange={(id) => setQuery({ ...route.query, period: id })}
        />
        {data && <p className={s.range}>{t('money.books.range', { from: day(data.period.from), to: day(data.period.to) })}</p>}
      </div>
      {books.error && <Failed error={books.error} />}
      {data && (
        <>
          <Bento className={s.glance}>
            {data.figures.map((figure) => (
              <MoneyTile key={figure.operation} label={figure.label} icon={ICONS[figure.operation] ?? 'file-text'} span={4}>
                <div className={s.tileValue}>
                  <Figure value={figure.display} receiptId={figure.receiptId} size="stat" />
                </div>
                {figure.stale && <p className={s.tileSub}><span className={s.stale}>{t('money.changed')}</span></p>}
              </MoneyTile>
            ))}
          </Bento>
          {first && <p className={s.notes}>{first}</p>}
          {more.length > 0 && (
            <details className={s.fold}>
              <summary>{t('money.books.about')}</summary>
              {more.map((note) => <p key={note}>{note}</p>)}
            </details>
          )}
          <Section title={t('money.books.open')}>
            {data.openInvoices.length === 0 ? <p className={s.quietLine}>{t('money.books.openNone')}</p> : <OpenList items={byDue(data.openInvoices)} balances={false} />}
          </Section>
        </>
      )}
      <TaxDetails />
    </>
  );
}

/**
 * The tax working, one step away: a "Tax details" button that opens it in place and closes it again. Only a business
 * registered for GST has it; for any other the working is GST it does not charge, so nothing is drawn.
 */
function TaxDetails() {
  const t = useT();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const working = useResource('venture.tax.working', {}, { refreshOn: onMoney });
  const plan = useResource('venture.blueprint.get', {}, { refreshOn: onMoney });
  const blueprint = plan.data?.blueprint;
  if (!blueprint) return null;
  if (blueprint.backOffice.taxRegistered.value !== true) return null;
  const data = working.data;
  const sections = data?.sections ?? [];
  if (sections.length === 0 && !working.error) return null;

  return (
    <div className={s.details}>
      <Button aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((was) => !was)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
        {t('money.tax.details')}
      </Button>
      <div id={panelId} hidden={!open}>
        {open && (
          <Section title={data ? t('money.tax.title', { period: data.period }) : t('money.tax.titlePlain')}>
            {working.error && <Failed error={working.error} />}
            {data?.needsCaConfirmation && <p className={s.caLine}>{t('money.tax.needsCa')}</p>}
            {sections.map((section) => (
              <div key={section.id} className={s.taxPart}>
                <h3 className={s.blockTitle}>{section.title}</h3>
                {section.lines.length > 0 && (
                  <ul className={s.lines}>
                    {section.lines.map((line, index) => (
                      <li key={`${index}:${line.label}`} className={s.line} data-row="" data-row-id={`tax-${section.id}-${index}`} tabIndex={-1}>
                        <span className={s.label}>{line.label}</span>
                        <span className={s.value}>
                          {line.receiptId ? <Figure value={line.value} receiptId={line.receiptId} /> : <EngineWords><Amount text={line.value} /></EngineWords>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {section.note && <p className={s.quietLine} data-engine-line="">{section.note}</p>}
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
