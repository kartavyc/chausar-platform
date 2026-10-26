import type { MouseEvent } from 'react';
import { useT } from '../text';
import { useResource } from '../engine/context';
import { BottomTabs, type BottomTab } from '../parts/BottomTabs';
import { Logo } from '../parts/Logo';
import type { IconName } from '../parts/icons';
import { BusinessMenu } from './BusinessMenu';
import { openSheet } from './navigation';
import { formatHash, type PlaceId, type Route } from './routes';
import s from './TopBar.module.css';

/**
 * The phone's top bar (D-Phone-Today `header.top`): the mark, which goes home to Today, then the business button and
 * its menu. It replaces the rail under 760 px; the places move to the bottom tabs. The bell and the account button
 * of the board wait for W4 (4G, and there is no account feature), so they are not drawn. Every target is 44 px.
 */
export function TopBar() {
  const t = useT();
  return (
    <header className={s.top} data-top-bar="">
      <a className={s.home} href="#/today" aria-label={t('rail.brand')}>
        <Logo />
      </a>
      <div className={s.business}>
        <BusinessMenu variant="bar" />
      </div>
    </header>
  );
}

/** The places that have a tab of their own; every other place is under More. W4 4C adds Chats second (and Clients
 *  moves under More then). */
const TAB_PLACES = ['today', 'team', 'work', 'clients'] as const satisfies readonly PlaceId[];
type TabPlace = (typeof TAB_PLACES)[number];
const TAB_ICONS: Readonly<Record<TabPlace | 'more', IconName>> = { today: 'sun', team: 'users', work: 'briefcase', clients: 'contact', more: 'layout-grid' };
const isTab = (place: PlaceId): place is TabPlace => (TAB_PLACES as readonly PlaceId[]).includes(place);

/** The sheet More opens: the rest of the places (sheets.tsx, `more`). */
export const MORE_SHEET = { kind: 'more', id: 'places' } as const;

/**
 * The phone's bottom tabs (D-Phone-Today `nav.tabs`): Today with what needs the owner across every business, Team,
 * Work, Clients, and More, which opens a sheet with Money, Connections, Business and a new business. More is the
 * current tab on those places. More is a real link to this page with its sheet, so Back closes it; pressed here it
 * goes through openSheet, so closing the sheet puts focus back on the tab.
 */
export function PhoneTabs({ route }: { route: Route }) {
  const t = useT();
  const queue = useResource('venture.queue.list', { scope: 'all' }, { refreshOn: (event) => event.type === 'queue.changed' });
  const needsYou = queue.data?.needsYou ?? 0;
  const more = formatHash({ ...route, sheet: MORE_SHEET });
  const tabs: BottomTab[] = [
    ...TAB_PLACES.map((place): BottomTab => ({
      id: place, href: `#/${place}`, label: t(`place.${place}`), icon: TAB_ICONS[place],
      badge: place === 'today' && needsYou > 0 ? needsYou : undefined,
    })),
    { id: 'more', href: more, label: t('phone.more'), icon: TAB_ICONS.more },
  ];

  function pressed(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as Element).closest?.('a');
    if (!link || link.getAttribute('href') !== more || event.defaultPrevented) return;
    event.preventDefault();
    openSheet(MORE_SHEET.kind, MORE_SHEET.id, link);
  }

  return (
    // The tabs are links; this only routes a press on More through openSheet (Enter on a link is a click too).
    <div className={s.tabs} onClick={pressed}>
      <BottomTabs tabs={tabs} current={isTab(route.place) ? route.place : 'more'} />
    </div>
  );
}
