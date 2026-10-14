/**
 * Banner (SH-03): a thin strip above the page and above any open sheet, across the full
 * width, for a condition that changes what the whole app does. A few words and at most one
 * button. They stack in a fixed order. At most two show; the rest fold into one line,
 * "and 2 more", a disclosure that opens them where they are.
 */

import { useId, useState } from 'react';
import type { BannerItem, BannerKind } from '../app/presentation.ts';
import { foldBanners } from '../app/shell-banners.ts';
import { pluralSelector } from '../app/plural.ts';
import { useT } from '../app/text';
import { Button } from './Button';
import s from './Banner.module.css';

const ACTION_KEY: Readonly<Record<BannerKind, string | null>> = {
  driving: 'SH-03.driving.action',
  'demo-clock': 'SH-03.demo-clock.action',
  'read-only': 'SH-03.read-only.action',
  'sending-closed': 'SH-03.sending-closed.action',
  'jobs-paused': 'SH-03.jobs-paused.action',
  'update-needed': 'SH-03.update-needed.action',
  'no-connection': null,
};

export function Banner({ item }: { item: BannerItem }) {
  const t = useT();
  const actionKey = ACTION_KEY[item.kind];
  return (
    <div className={s.banner} data-banner={item.kind}>
      <span className={s.text}>{t(item.textKey ?? `SH-03.${item.kind}`, item.values)}</span>
      {item.action && actionKey !== null && (
        <Button variant="link" onClick={item.action.onPress} className={s.action}>
          {t(actionKey)}
        </Button>
      )}
    </div>
  );
}

export function Banners({ items }: { items: ReadonlyArray<BannerItem> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const restId = useId();
  const { shown, folded } = foldBanners(items);
  if (shown.length === 0) return null;
  const more = String(folded.length);
  return (
    <div className={s.stack} role="region" aria-label={t('SH-03.label')}>
      <div role="status" className={s.live}>
        {shown.map((b) => (
          <Banner key={b.kind} item={b} />
        ))}
      </div>
      {folded.length > 0 && (
        <>
          <div className={s.banner}>
            <Button variant="link" className={s.more} aria-expanded={open} aria-controls={restId} onClick={() => setOpen((o) => !o)}>
              {open ? t('SH-03.fewer') : t('SH-03.more', { count: pluralSelector(more), display: more })}
            </Button>
          </div>
          <div id={restId} hidden={!open}>
            {open && folded.map((b) => <Banner key={b.kind} item={b} />)}
          </div>
        </>
      )}
    </div>
  );
}
