/**
 * Banner: a thin strip above the page for a condition that changes what the whole app
 * does. A few words and at most one button. They stack in a fixed order.
 */

import type { BannerItem, BannerKind } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Button } from './Button';
import s from './Banner.module.css';

const ORDER: ReadonlyArray<BannerKind> = [
  'driving',
  'demo-clock',
  'read-only',
  'sending-closed',
  'jobs-paused',
  'update-needed',
  'no-connection',
];

const ACTION_KEY: Partial<Record<BannerKind, string>> = {
  driving: 'SH-03.driving.action',
  'read-only': 'SH-03.read-only.action',
  'sending-closed': 'SH-03.sending-closed.action',
  'update-needed': 'SH-03.update-needed.action',
};

export function Banner({ item }: { item: BannerItem }) {
  const t = useT();
  const actionKey = ACTION_KEY[item.kind];
  return (
    <div className={s.banner} role="status">
      <span className={s.text}>{t(`SH-03.${item.kind}`, item.values)}</span>
      {item.action && actionKey && (
        <Button variant="link" onClick={item.action.onPress} className={s.action}>
          {t(actionKey)}
        </Button>
      )}
    </div>
  );
}

export function Banners({ items }: { items: ReadonlyArray<BannerItem> }) {
  const sorted = [...items].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  if (sorted.length === 0) return null;
  return (
    <div className={s.stack}>
      {sorted.map((b) => (
        <Banner key={b.kind} item={b} />
      ))}
    </div>
  );
}
