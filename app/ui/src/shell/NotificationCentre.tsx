/**
 * The notification centre (Ink v2 wave 4, 4G4; spec 5.7, catalogue O12), the sheet the bell opens: what the engine's
 * centre lists for the open business, newest first, each with its kind and time and "New" until read; the newest daily
 * digest in the engine's own words with its receipt; Mark all read; and the way to the settings. An item is a link to
 * its approval on the standalone page (`#/approve/<rowId>`, O11), where the same decision is made as on Today; following
 * it marks the item read. Alerts outside the app never carry any of this: they say a count only.
 */

import { useId, useState } from 'react';
import { useLanguage, useT, type Language } from '../text';
import { useEngine } from '../engine/context';
import { Button } from '../parts/Button';
import { Chip } from '../parts/Chip';
import { EmptyState } from '../parts/EmptyState';
import { Receipt } from '../parts/Receipt';
import { Sheet } from '../parts/Sheet';
import { stateText } from '../parts/states';
import type { NotificationView } from '../engine/types';
import { useNotifyList } from './Bell';
import type { SheetComponentProps } from './sheets';
import s from './NotificationCentre.module.css';

/** When an item came, on this computer's calendar and clock: "21 Oct, 10:06". */
export function whenOf(at: string, language: Language): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

export function NotificationCentre({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const language = useLanguage();
  const client = useEngine();
  const list = useNotifyList();
  const digestId = useId();
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
    <Sheet label="" title={title} name={title} line={line} onClose={onClose} returnFocus={returnFocus}>
      <div className={s.centre} data-centre="">
        {list.error && !data && <p className={s.problem}>{t('sheet.failed', { message: list.error.message })}</p>}
        {!data && !list.error && <p className={s.quiet}>{t('sheet.loading')}</p>}
        {problem && <p className={s.problem} role="alert">{problem}</p>}
        {data && data.unread > 0 && (
          <div className={s.tools}>
            <Button variant="secondary" size="sm" onClick={() => void read({ all: true })}>{t('centre.markAll')}</Button>
          </div>
        )}
        {data?.digest && (
          <section className={s.digest} aria-labelledby={digestId}>
            <h3 id={digestId} className={s.heading}>{t('centre.digest', { day: whenOf(data.digest.at, language) })}</h3>
            {/* The digest's figures come from receipts the engine names; its words are the engine's own. */}
            <p className={s.digestLine} data-figure-group={data.digest.receiptIds.length ? '' : undefined}>
              {data.digest.line}
              {data.digest.receiptIds.map((id) => <span key={id}> <Receipt id={id} /></span>)}
            </p>
          </section>
        )}
        {data && data.items.length > 0 && (
          <ul className={s.items} aria-label={title}>
            {data.items.map((item) => <Item key={item.id} item={item} language={language} onFollow={() => { if (!item.read) void read({ ids: [item.id] }); }} />)}
          </ul>
        )}
        {data && data.items.length === 0 && <EmptyState title={t('centre.empty')} />}
        <a className={s.settings} href="#/business/notifications">{t('centre.settings')}</a>
      </div>
    </Sheet>
  );
}

function Item({ item, language, onFollow }: { item: NotificationView; language: Language; onFollow: () => void }) {
  const t = useT();
  return (
    <li className={s.item} data-unread={item.read ? undefined : ''}>
      <a className={s.link} href={`#/approve/${item.rowId}`} onClick={onFollow}>
        <span className={s.title}>{item.title}</span>
        <span className={s.meta}>
          <span data-kind="">{stateText(t, 'queue', item.kind)}</span>
          <span aria-hidden="true" data-sep="">·</span>
          <time className="mono" dateTime={item.at}>{whenOf(item.at, language)}</time>
        </span>
      </a>
      {!item.read && <Chip className={s.fresh}>{t('centre.new')}</Chip>}
    </li>
  );
}
