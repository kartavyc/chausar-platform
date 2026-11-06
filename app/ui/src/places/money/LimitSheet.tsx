/**
 * When a spend limit is used up (W4 4F2, M3; `?sheet=limit:business`, or `limit:<preset>` for one key's own limit):
 * the engine's words for what stopped, and the ways on it offers, each as a link to where it is done. Raise the limit
 * (the limits under the paid calls on Spend, or the key's own on Your AI), connect another key (Your AI), or wait
 * until the month starts again. There are no credits to buy: the owner pays for AI directly.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { Sheet } from '../../parts/Sheet';
import type { LimitReachedView } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { useDay } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';

/** Where each way on is done. Waiting is done nowhere: it is said, not linked. */
const WHERE: Readonly<Record<'raise' | 'connect', (limit: LimitReachedView) => string>> = {
  raise: (limit) => (limit.scope === 'key' ? '#/connections/ai' : '#/money/spend'),
  connect: () => '#/connections/ai',
};

export function LimitSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const policy = useResource('venture.spend.policy.get', {});
  const all = [...(policy.data?.limitReached ? [policy.data.limitReached] : []), ...(policy.data?.keyLimits ?? [])];
  const limit = all.find((item) => (id === 'business' ? item.scope === 'business' : item.presetId === id));
  const reset = policy.data?.meter?.resetOn;
  const day = useDay('short');
  return (
    <Sheet label={t('money.limit.label')} title={t('money.limit.title')} onClose={onClose} returnFocus={returnFocus}>
      {policy.error && <p className={s.failed} role="status" data-engine-line="">{t('money.failed', { message: policy.error.message })}</p>}
      {policy.data && !limit && <p className={s.quietLine}>{t('money.limit.none')}</p>}
      {limit && (
        <>
          {/* The engine's own sentence: what stopped and why (it may name the limit, which the meter's receipt proves). */}
          <p className={v.limitLine} data-engine-line="">{limit.line}</p>
          <ul className={v.limitWays}>
            {limit.options.map((option) => (
              <li key={option.id} className={v.limitWay}>
                {option.id === 'wait'
                  ? <span>{reset ? t('money.limit.wait', { date: day(reset) }) : option.label}</span>
                  : <a className={s.more} href={WHERE[option.id](limit)} onClick={onClose}>{t(option.id === 'raise' ? (limit.scope === 'key' ? 'money.limit.raiseKey' : 'money.limit.raise') : 'money.limit.connect')}</a>}
              </li>
            ))}
          </ul>
          <p className={s.quietLine}>{t('money.limit.noCredits')}</p>
        </>
      )}
    </Sheet>
  );
}
