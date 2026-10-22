import { useId, useState } from 'react';
import { useT } from '../text';
import { useResource } from '../engine/context';
import { BusinessMenu } from './BusinessMenu';
import { RAIL_PLACES, type Route } from './routes';
import { cx } from '../parts/cx';
import s from './Rail.module.css';

/**
 * The rail (220 px): the business menu, then the six places. Today carries the count of what needs the owner,
 * across every business on this computer. Below 760 px it becomes a top bar with a place menu.
 */
export function Rail({ route }: { route: Route }) {
  const t = useT();
  const listId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const queue = useResource('venture.queue.list', { scope: 'all' }, { refreshOn: (event) => event.type === 'queue.changed' });
  const needsYou = queue.data?.needsYou ?? 0;

  return (
    <nav className={s.rail} aria-label={t('shell.places')} data-menu-open={menuOpen ? '' : undefined}>
      <div className={s.top}>
        <BusinessMenu onNavigate={() => setMenuOpen(false)} />
        <button type="button" className={s.menuButton} aria-expanded={menuOpen} aria-controls={listId} onClick={() => setMenuOpen((o) => !o)}>
          {menuOpen ? t('shell.menuClose') : t('shell.menu')}
        </button>
      </div>
      <ul id={listId} className={s.places}>
        {RAIL_PLACES.map((place) => {
          const here = route.place === place;
          return (
            <li key={place}>
              <a className={cx(s.place, here && s.on)} href={`#/${place}`} aria-current={here ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
                <span>{t(`place.${place}`)}</span>
                {place === 'today' && needsYou > 0 && (
                  <>
                    <span className={`${s.count} mono`} aria-hidden="true">{needsYou}</span>
                    <span className="sr-only">, {t('rail.needsYou', { count: needsYou })}</span>
                  </>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
