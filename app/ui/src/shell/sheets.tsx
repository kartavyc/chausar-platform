/**
 * Sheet kinds. The shell shows one sheet at a time from the address (?sheet=<kind>:<id>). The foundation provides
 * `run`, `receipt` (a price or sum receipt), `ca-receipt` (a CA firm's calculator receipt, in the same receipt
 * sheet), `more` (the phone's More tab) and `notifications` (the bell's centre, W4 4G4); a place adds its own by exporting `sheets` from its index.tsx (see
 * places.ts).
 */

import { useId, type ReactNode } from 'react';
import { useT } from '../text';
import { useResource } from '../engine/context';
import { Icon } from '../parts/Icon';
import type { IconName } from '../parts/icons';
import { RunSheet } from '../parts/RunSheet';
import { Sheet } from '../parts/Sheet';
import { useRoute } from './navigation';
import { NotificationCentre } from './NotificationCentre';
import type { PlaceId } from './routes';
import s from './sheets.module.css';

export interface SheetComponentProps {
  id: string;
  onClose: () => void;
  /** Pass to <Sheet returnFocus>: puts focus back on the row that opened the sheet. */
  returnFocus: () => void;
}
export type SheetComponent = (props: SheetComponentProps) => ReactNode;

function RunSheetKind({ id, onClose, returnFocus }: SheetComponentProps) {
  return <RunSheet runId={id} onClose={onClose} returnFocus={returnFocus} />;
}

function ReceiptSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const receipt = useResource('venture.receipt.get', { id });
  return (
    <Sheet label={t('sheet.receipt')} title={<span className="mono">{id}</span>} onClose={onClose} returnFocus={returnFocus} receipt>
      {receipt.error && <p className={s.failed}>{t('sheet.failed', { message: receipt.error.message })}</p>}
      {!receipt.data && !receipt.error && <p className={s.quiet}>{t('sheet.loading')}</p>}
      {receipt.data && (
        <>
          {receipt.data.stale && <p className={s.stale}>{t('receipt.stale')}</p>}
          {receipt.data.figures.length > 0 ? (
            <dl className={s.figures}>
              {receipt.data.figures.map((figure) => (
                <div key={figure.key} className={s.figure}>
                  <dt>{figure.label}</dt>
                  <dd className="mono">{figure.display}</dd>
                </div>
              ))}
            </dl>
          ) : <p className={s.quiet}>{t('receipt.none')}</p>}
          <p className={s.explanation}>{receipt.data.explanation}</p>
        </>
      )}
    </Sheet>
  );
}

/**
 * A CA firm's calculator receipt (venture.ca.receipt), opened from a working paper's receipt chip: the receipt sheet
 * again, with the receipt's figures, the steps it was worked out by (with the section of the law each rests on), and
 * what came out when the engine worked it again from its stored inputs on the rate tables it stamped. Every figure and
 * line is the engine's own.
 */
function CaReceiptSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const stepsId = useId();
  const receipt = useResource('venture.ca.receipt', { id });
  const view = receipt.data;
  return (
    <Sheet
      label={t('sheet.receipt')} title={<span className="mono">{id}</span>}
      line={view ? t(`business.ca.engine.${view.engine}`) : undefined}
      onClose={onClose} returnFocus={returnFocus} receipt
    >
      {receipt.error && <p className={s.failed}>{t('sheet.failed', { message: receipt.error.message })}</p>}
      {!view && !receipt.error && <p className={s.quiet}>{t('sheet.loading')}</p>}
      {view && (
        <>
          {view.figures.length > 0 ? (
            <dl className={s.figures}>
              {view.figures.map((figure) => (
                <div key={figure.key} className={s.figure}>
                  <dt>{figure.label}</dt>
                  <dd className="mono">{figure.display}</dd>
                </div>
              ))}
            </dl>
          ) : <p className={s.quiet}>{t('receipt.none')}</p>}
          {view.steps.length > 0 && (
            <section className={s.part} aria-labelledby={stepsId}>
              <h3 id={stepsId} className={s.heading}>{t('receipt.ca.steps')}</h3>
              <ol className={s.steps} data-receipt-steps="">
                {view.steps.map((step) => (
                  <li key={step.key} className={s.figure}>
                    <span>
                      {step.label}
                      {step.section && <span className={s.section}> · {t('receipt.ca.section', { section: step.section })}</span>}
                    </span>
                    <span className="mono">{step.display}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <p className={view.rederived === 'same' ? s.explanation : s.stale} data-rederived={view.rederived}>
            {view.rederived === 'same' ? t('receipt.ca.rederived.same') : t(`receipt.ca.rederived.${view.rederived}`, { line: view.differs?.line ?? '' })}
          </p>
        </>
      )}
    </Sheet>
  );
}

/** The places under the phone's More tab, in the rail's order, then a new business (Start). W4 4C2 moved Clients here,
 *  since Chats took its tab. */
const MORE_LINKS: readonly { place: PlaceId; href: string; icon: IconName; key: string }[] = [
  { place: 'clients', href: '#/clients', icon: 'contact', key: 'place.clients' },
  { place: 'money', href: '#/money', icon: 'wallet', key: 'place.money' },
  { place: 'connections', href: '#/connections', icon: 'plug', key: 'place.connections' },
  { place: 'business', href: '#/business/plan', icon: 'sliders-horizontal', key: 'place.business' },
  { place: 'onboarding', href: '#/onboarding', icon: 'plus', key: 'more.start' },
];

/**
 * More (the phone's fifth tab, 3H1): the places that have no tab of their own. Each is a link, so choosing one goes
 * there and closes the sheet; the place on screen is marked current.
 */
function MoreSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const route = useRoute();
  const title = t('more.title');
  return (
    <Sheet label="" title={title} name={title} onClose={onClose} returnFocus={returnFocus}>
      <nav aria-label={t('more.places')}>
        <ul className={s.more}>
          {MORE_LINKS.map((link) => (
            <li key={link.place}>
              <a className={s.moreLink} href={link.href} aria-current={route.place === link.place ? 'page' : undefined}>
                <span className={s.moreIcon}><Icon name={link.icon} size={18} /></span>
                <span className={s.moreWord}>{t(link.key)}</span>
                <Icon name="chevron-right" size={16} className={s.moreChevron} />
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </Sheet>
  );
}

/** Shown for a sheet kind nobody registered yet: says so, never pretends. */
export function UnknownSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  return <Sheet label="" title={t('sheet.unknown')} onClose={onClose} returnFocus={returnFocus} />;
}

export const BASE_SHEETS: Readonly<Record<string, SheetComponent>> = { run: RunSheetKind, receipt: ReceiptSheet, 'ca-receipt': CaReceiptSheet, more: MoreSheet,
  // W4 4G4: the notification centre the bell opens.
  notifications: NotificationCentre };
