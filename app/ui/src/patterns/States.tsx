/**
 * States: the fixed states of part 10 of the main file, with their words.
 * Loading shows what was known last time, with its time, and no spinner. Failed shows
 * what happened, what it means and what to do, with a short code and never the raw error.
 * Not built yet (SH-13) names the day when one was supplied, and which part is missing
 * when the adapter named it from a `todayx.capabilities` group (notBuiltFromCapabilities). Read only hides mutation controls
 * elsewhere; here it says who holds the pen when that is known.
 *
 * `boundary-state` is the neutral form: the checked view state exactly as it came, for
 * when nothing richer is known. It shows the fixed sentence for the state, then the
 * supplied reason code and the supplied time, as given. It names no holder, no rule
 * owner, no count of months and no date that was not supplied.
 */

import type { ReactNode } from 'react';
import type { ScreenState, ViewState } from '../app/presentation.ts';
import { pluralSelector } from '../app/plural.ts';
import { useT } from '../app/text';
import { Button } from '../parts/Button';
import { Label } from '../parts/Label';
import { MissingWords } from '../parts/Figure';
import s from './States.module.css';

export interface StateProps {
  state: ScreenState;
  /** The one action some states offer, already localised. */
  action?: { label: string; onPress: () => void } | undefined;
  /** What this screen will hold, for the empty state. A text key. */
  emptyKey?: string | undefined;
  className?: string | undefined;
}

/** The fixed sentence for each checked view state. Ready has none. */
const BOUNDARY_KEY: Readonly<Record<Exclude<ViewState['kind'], 'ready' | 'empty'>, string>> = {
  'no-change': 'ST.noChange.plain',
  loading: 'ST.loading',
  partial: 'ST.partial.plain',
  stale: 'ST.stale.plain',
  insufficient: 'ST.notEnough.plain',
  'not-yet': 'ST.notYet',
  'rule-stopped': 'ST.rule.plain',
  failed: 'ST.failed',
  'network-waiting': 'ST.network',
  'read-only': 'ST.readOnly.plain',
  hidden: 'ST.hidden',
  locked: 'ST.locked',
  'not-built': 'ST.notBuilt',
};

export function State({ state, action, emptyKey = 'ST.empty.review', className }: StateProps): ReactNode {
  const t = useT();
  const cls = [s.state, className].filter(Boolean).join(' ');
  const act = action ? (
    <Button variant="link" onClick={action.onPress}>
      {action.label}
    </Button>
  ) : null;

  switch (state.kind) {
    case 'ready':
      return null;
    case 'loading':
      return (
        <p className={cls} role="status">
          {state.lastKnownAt !== undefined ? t('ST.loading.lastKnown', { time: state.lastKnownAt }) : t('ST.loading')}
          {state.reading !== undefined && <span className={s.note}>{t('ST.loading.reading', { what: state.reading })}</span>}
        </p>
      );
    case 'empty':
      return (
        <p className={cls}>
          {t(emptyKey)} {act}
        </p>
      );
    case 'partial':
      return (
        <p className={cls}>
          <MissingWords missing={state.missing} />
          {state.detail !== undefined && <span className={s.note}>{state.detail}</span>}
        </p>
      );
    case 'no-change':
      return <p className={cls}>{state.since !== undefined ? t('ST.noChange', { since: state.since }) : t('ST.noChange.plain')}</p>;
    case 'not-enough':
      return (
        <p className={cls}>
          {state.monthsNotLoaded && state.monthsNotLoaded.exact !== null
            ? t('ST.notEnough', { count: pluralSelector(state.monthsNotLoaded.exact), display: state.monthsNotLoaded.display })
            : t('ST.notEnough.plain')}{' '}
          {act}
        </p>
      );
    case 'stale':
      return (
        <p className={cls}>
          <Label kind="stale" /> <span>{t('ST.stale.since', { date: state.workedOutOn })}</span>{' '}
          {action && (
            <Button variant="link" onClick={action.onPress}>
              {t('ST.rebuild')}
            </Button>
          )}
        </p>
      );
    case 'not-yet':
      return (
        <p className={cls}>
          {t('ST.notYet')} <span className={s.note}>{t('ST.notYet.wanted')}</span> {act}
        </p>
      );
    case 'stopped-by-rule':
      return (
        <p className={cls}>
          {t('ST.rule', { rule: state.rule })}
          {state.who !== undefined && <span className={s.note}>{t('ST.rule.who', { who: state.who })}</span>}
        </p>
      );
    case 'failed':
      return (
        <div className={cls}>
          {state.what !== undefined ? <p className={s.p}>{state.what}</p> : <p className={s.p}>{t('ST.failed')}</p>}
          {state.means !== undefined && <p className={s.p}>{state.means}</p>}
          {(state.action !== undefined || act) && (
            <p className={s.p}>
              {state.action} {act}
            </p>
          )}
          <p className={[s.code, 'fig'].join(' ')}>{t('ST.failed.code', { code: state.code })}</p>
        </div>
      );
    case 'waiting-for-network':
      return (
        <p className={cls} role="status">
          {t('ST.network')}
        </p>
      );
    case 'read-only':
      return <p className={cls}>{state.holder !== undefined ? t('ST.readOnly', { holder: state.holder }) : t('ST.readOnly.plain')}</p>;
    case 'hidden':
      return (
        <p className={cls}>
          {t('ST.hidden')}
          {state.rows !== undefined && state.rows.exact !== null && (
            <span className={s.note}>{t('ST.hidden.total', { count: pluralSelector(state.rows.exact), display: state.rows.display })}</span>
          )}
        </p>
      );
    case 'refused':
      return <p className={cls}>{t('ST.refused', { reason: state.reason })}</p>;
    case 'locked':
      return <p className={cls}>{t('ST.locked')}</p>;
    case 'not-built': {
      const c = state.capability;
      const known = c !== undefined && c.state !== 'live' ? c : undefined;
      return (
        <div className={cls}>
          <p className={s.p}>{known?.expectedDay !== undefined ? t('ST.notBuilt.day', { day: known.expectedDay }) : t('ST.notBuilt')}</p>
          {state.part !== undefined && <p className={s.p}>{t('SH-13.part', { part: state.part })}</p>}
          {known !== undefined && state.part === undefined && <p className={[s.code, 'fig'].join(' ')}>{t('ST.boundary.reason', { code: known.reasonCode })}</p>}
          {known?.state === 'partial' && (
            <p className={s.note}>
              <Label kind="experimental" /> {t('ST.partial.label')}
            </p>
          )}
        </div>
      );
    }
    case 'boundary-state': {
      const source = state.source;
      const kind = source.kind;
      if (kind === 'ready') return null;
      if (kind === 'empty') {
        return (
          <p className={cls}>
            {t(emptyKey)} {act}
          </p>
        );
      }
      const live = kind === 'loading' || kind === 'network-waiting';
      return (
        <div className={cls} role={live ? 'status' : undefined}>
          <p className={s.p}>
            {t(BOUNDARY_KEY[kind])} {act}
          </p>
          {'asOf' in source && source.asOf !== null && <p className={[s.code, 'fig'].join(' ')}>{t('ST.boundary.asOf', { asOf: source.asOf })}</p>}
          {'reasonCode' in source && <p className={[s.code, 'fig'].join(' ')}>{t('ST.boundary.reason', { code: source.reasonCode })}</p>}
        </div>
      );
    }
  }
}
