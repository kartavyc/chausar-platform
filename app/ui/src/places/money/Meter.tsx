/**
 * This month's spend against its limit (W4 4F2, M4; on Spend): the engine's meter as a bar with its line ("79% of this
 * month's limit used") and the receipt of the month's spend it rests on, a quiet line when it is near the limit, and,
 * once the limit is used up or a key reached its own, what the owner can do (the limit sheet). The projection the
 * engine may add ("About 12 more drafts at today's cost") is said as one, never as what will happen. No limit set, no
 * meter. There are no credits: the owner pays for AI directly.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Receipt } from '../../parts/Receipt';
import { Tile } from '../../parts/Tile';
import { onRuns, useDay } from './words';
import v from './MoneyViews.module.css';

export function Meter() {
  const t = useT();
  const id = useId();
  const policy = useResource('venture.spend.policy.get', {}, { refreshOn: onRuns });
  const meter = policy.data?.meter;
  const reached = [...(policy.data?.limitReached ? [policy.data.limitReached] : []), ...(policy.data?.keyLimits ?? [])];
  const day = useDay('short');
  if (!meter && reached.length === 0) return null;
  return (
    <Tile as="section" labelledBy={id} className={v.meterTile}>
      <h2 id={id} className={v.meterTitle}>{t('money.meter.title')}</h2>
      {meter && (
        <>
          <p className={v.meterLine} data-near={meter.near ? '' : undefined} data-over={meter.over ? '' : undefined}>
            <span>{meter.line}</span>
            <Receipt id={meter.receiptId} />
          </p>
          {/* A bar in tokens: grey track, the accent while there is room, amber near the limit, red once it is used up.
              The engine's share in per mille is the bar's length (SVG width, never a style); the words say it too. */}
          <div className={v.meterBar} role="meter" aria-valuemin={0} aria-valuemax={1000} aria-valuenow={meter.usedPermille} aria-valuetext={meter.line} aria-label={t('money.meter.title')}>
            <svg viewBox="0 0 1000 8" preserveAspectRatio="none" width="100%" height="8" focusable="false" aria-hidden="true">
              <rect className={v.meterTrack} x="0" y="0" width="1000" height="8" rx="4" />
              <rect className={v.meterFill} data-state={meter.over ? 'over' : meter.near ? 'near' : 'room'} x="0" y="0" width={meter.usedPermille} height="8" rx="4" />
            </svg>
          </div>
          {/* When it starts again, in the UI's words from the engine's day. */}
          <p className={v.quiet}>{t('money.meter.reset', { date: day(meter.resetOn) })}</p>
          {meter.near && !meter.over && <p className={v.near}>{t('money.meter.near')}</p>}
          {meter.projection && (
            <p className={v.quiet}>
              <span>{meter.projection.line}</span>
              <span className={v.projected} data-projected="">{t('money.projected')}</span>
            </p>
          )}
        </>
      )}
      {reached.length > 0 && (
        <div className={v.meterReached}>
          <p>{t('money.meter.reached')}</p>
          <Button size="sm" onClick={(event) => openSheet('limit', reached[0]!.presetId ?? 'business', event.currentTarget)}>{t('money.meter.what')}</Button>
        </div>
      )}
    </Tile>
  );
}
