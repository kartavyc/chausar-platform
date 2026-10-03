/**
 * Rail: the wordmark and the two-square mark, the places, and at the foot the workspace
 * and who you are. The place you are in is ink; the others are grey. An open place
 * shows its sub-places under it, indented, with a hairline at the left. Only Today
 * carries a count (the CA firm's Clients also carries one, as drawn).
 * In the Simple view More stays ink while you are in Books, Reports, Tools or Trust, and
 * lists those four under it, so nothing is lost and you can see where you are.
 * Under 1024 wide the rail becomes a bar across the top: the wordmark, the name of the
 * place you are actually in as a menu, and Today's count.
 */

import { useId, type ReactNode } from 'react';
import type { Address, Count, PlaceId } from './presentation.ts';
import { useT } from './text';
import { formatAddress } from './routes.ts';
import { morePlaces, railCountShown, railEntry, railPlaces, type ShellConfig } from './places.ts';
import s from './Rail.module.css';

export function Wordmark() {
  const t = useT();
  return (
    <span className={s.wordmark}>
      <svg className={s.mark} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <rect x="1" y="1" width="9" height="9" rx="1.5" className={s.m1} />
        <rect x="10" y="10" width="9" height="9" rx="1.5" className={s.m2} />
      </svg>
      <span className={s.word}>{t('SH-01.wordmark')}</span>
    </span>
  );
}

export interface RailProps {
  shell: ShellConfig;
  address: Address;
  onNavigate: (a: Address) => void;
  counts?: Partial<Record<PlaceId, Count>> | undefined;
  /** The workspace menu trigger, rendered at the foot. */
  foot: ReactNode;
  narrow: boolean;
}

export function Rail({ shell, address, onNavigate, counts, foot, narrow }: RailProps) {
  const t = useT();
  const places = railPlaces(shell);
  const menuId = useId();
  const entry = railEntry(shell, address.place);

  const go = (place: PlaceId, sub?: string) => {
    const a: Address = { place };
    if (sub !== undefined) a.sub = sub;
    onNavigate(a);
  };

  const countOf = (id: PlaceId) => (railCountShown(shell, id) ? counts?.[id] : undefined);

  const list = (
    <ul className={s.places}>
      {places.map((p) => {
        const here = p.id === entry;
        const count = countOf(p.id);
        /* More holds whole places; every other entry holds its own sub-places. */
        const held = p.id === 'more' ? morePlaces() : [];
        return (
          <li key={p.id} className={s.placeItem}>
            <a
              href={formatAddress({ place: p.id })}
              className={[s.place, here ? s.here : ''].join(' ')}
              aria-current={here ? (p.id === address.place ? 'page' : 'true') : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(p.id);
              }}
            >
              <span>{t(p.nameKey)}</span>
              {count && (
                <span className={[s.count, 'fig'].join(' ')} aria-label={t('SH-01.count', { count: count.display })}>
                  {count.display}
                </span>
              )}
            </a>
            {here && held.length > 0 && (
              <ul className={s.subs}>
                {held.map((hp) => {
                  const heldHere = address.place === hp.id;
                  return (
                    <li key={hp.id}>
                      <a
                        href={formatAddress({ place: hp.id })}
                        className={[s.sub, heldHere ? s.here : ''].join(' ')}
                        aria-current={heldHere ? 'page' : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          go(hp.id);
                        }}
                      >
                        {t(hp.nameKey)}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
            {here && p.subs.length > 0 && (
              <ul className={s.subs}>
                {p.subs.map((sp) => {
                  const subHere = address.sub === sp.id || (address.sub === undefined && sp === p.subs[0]);
                  return (
                    <li key={sp.id}>
                      <a
                        href={formatAddress({ place: p.id, sub: sp.id })}
                        className={[s.sub, subHere ? s.here : ''].join(' ')}
                        aria-current={subHere ? 'page' : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          go(p.id, sp.id);
                        }}
                      >
                        {t(sp.nameKey)}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );

  if (narrow) {
    const count = countOf('today');
    return (
      <nav className={s.topbar} aria-label={t('SH-01.rail.label')} data-region="rail">
        <Wordmark />
        <details className={s.menu}>
          {/* F6 lands here: the one control of the bar that is visible while the menu is closed. */}
          <summary className={s.summary} aria-controls={menuId} data-region-entry="">
            <span>{t(`SH-01.place.${address.place}`)}</span>
            {count && (
              <span className={[s.count, 'fig'].join(' ')} aria-label={t('SH-01.count', { count: count.display })}>
                {count.display}
              </span>
            )}
          </summary>
          <div id={menuId} className={s.menuBody}>
            {list}
            <div className={s.foot}>{foot}</div>
          </div>
        </details>
      </nav>
    );
  }

  return (
    <nav className={s.rail} aria-label={t('SH-01.rail.label')} data-region="rail">
      <div className={s.top}>
        <Wordmark />
      </div>
      {list}
      <div className={s.foot}>{foot}</div>
    </nav>
  );
}
