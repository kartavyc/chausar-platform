/**
 * The notification centre (Ink v2 wave 4, 4G4; spec 5.7, catalogue O12), the sheet the bell opens: what the engine's
 * centre lists for the open business, newest first, each with its kind and time and "New" until read; the newest daily
 * digest in the engine's own words with its receipt; Mark all read; and the way to the settings. An item is a link to
 * its card on Today (`#/today?focus=<rowId>`, one-shot C4 task 7), where Today scrolls to it and focuses it; following
 * it marks the item read. An ended item stays plain text. The items are grouped by the owner's day: Today and Earlier. Alerts outside the app never carry any of this: they say a count only.
 */

import { useId, useState } from 'react';
import { useT } from '../text';
import { useOwnerZone } from './clock';
import { useDayKey, useLocalToday } from '../parts/when';
import { formatMoment } from '../../../../platform/runtime/owner-format';
import { useEngine } from '../engine/context';
import { Button } from '../parts/Button';
import { Chip } from '../parts/Chip';
import { EmptyState } from '../parts/EmptyState';
import { Receipt } from '../parts/Receipt';
import { Sheet } from '../parts/Sheet';
import type { NotificationView } from '../engine/types';
import { useNotifyList } from './Bell';
import type { SheetComponentProps } from './sheets';
import s from './NotificationCentre.module.css';
import { LoadingPlace } from '../parts/Skeleton';

/** When an item came, in the owner's zone on the 12-hour clock: "21 Oct, 3:36 pm". Empty for a bad date. */
export function whenOf(at: string, zone: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return formatMoment(date, zone, 'short');
}

export function NotificationCentre({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const zone = useOwnerZone();
  const client = useEngine();
  const list = useNotifyList();
  const digestId = useId();
  const dayOf = useDayKey();
  const today = useLocalToday()();
  const [problem, setProblem] = useState<string | null>(null);
  const title = t('centre.title');
  const data = list.data;

  async function read(params: { ids: string[] } | { all: true }) {
    setProblem(null);
    try {
      await client.request('venture.notify.read', params);
      // The bell reads the same list, so both show the new count together.
      list.reload();
    } catch (error) {
      setProblem(t('centre.readFailed', { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  const line = data ? (data.unread > 0 ? t('centre.unread', { count: data.unread }) : t('centre.none')) : undefined;
  return (
    <Sheet label="" title={title} name={title} line={line} onClose={onClose} returnFocus={returnFocus}
      headerActions={data && data.unread > 0 && <Button variant="quiet" size="sm" onClick={() => void read({ all: true })}>{t('centre.markAll')}</Button>}>
      <div className={s.centre} data-centre="">
        {list.error && !data && <p className={s.problem}>{t('sheet.failed', { message: list.error.message })}</p>}
        {!data && !list.error && <LoadingPlace shape="sheet" />}
        {problem && <p className={s.problem} role="alert">{problem}</p>}
        {data?.digest && (
          <section className={s.digest} aria-labelledby={digestId}>
            <h3 id={digestId} className={s.heading}>{t('centre.digest', { day: whenOf(data.digest.at, zone) })}</h3>
            {/* The digest's figures come from receipts the engine names; its words are the engine's own. */}
            <p className={s.digestLine} data-figure-group={data.digest.receiptIds.length ? '' : undefined}>
              {data.digest.line}
              {data.digest.receiptIds.map((id) => <span key={id}> <Receipt id={id} /></span>)}
            </p>
          </section>
        )}
        {data && data.items.length > 0 && (['today', 'earlier'] as const).map((group) => {
          // C4 task 7: by the owner's day, newest first within each group as the engine lists them.
          const items = data.items.filter((item) => (dayOf(item.at) === today) === (group === 'today'));
          if (items.length === 0) return null;
          const name = t(group === 'today' ? 'centre.today' : 'centre.earlier');
          return (
            <section key={group} className={s.group} aria-label={name}>
              <h3 className={s.heading}>{name}</h3>
              <ul className={s.items} aria-label={name}>
                {items.map((item) => <Item key={item.id} item={item} zone={zone} onFollow={() => { if (!item.read) void read({ ids: [item.id] }); }} />)}
              </ul>
            </section>
          );
        })}
        {data && data.items.length === 0 && <EmptyState title={t('centre.empty')} />}
        <a className={s.settings} href="#/business/notifications">{t('centre.settings')}</a>
      </div>
    </Sheet>
  );
}

function Item({ item, zone, onFollow }: { item: NotificationView; zone: string; onFollow: () => void }) {
  const t = useT();
  const words = (
    <>
      <span className={s.title}>{item.title}</span>
      <span className={s.meta}>
        <time dateTime={item.at}>{whenOf(item.at, zone)}</time>
      </span>
    </>
  );
  return (
    <li className={s.item} data-item="" data-unread={item.read ? undefined : ''}>
      {item.ended ? <span className={s.link}>{words}</span> : <a className={s.link} href={`#/today?focus=${encodeURIComponent(item.rowId)}`} onClick={onFollow}>{words}</a>}
      {!item.read && <Chip className={s.fresh}>{t('centre.new')}</Chip>}
    </li>
  );
}
