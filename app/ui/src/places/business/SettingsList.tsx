import { useId, useState, type KeyboardEvent } from 'react';
import { useT } from '../../text';
import { goToHref } from '../../shell/nav';
import { findSettings, type SettingsGroup, type SettingsMatch } from '../../shell/settings';
import { useLeavingList, type Drawn } from '../../parts/useLeaving';
import { LeaveRow } from '../../parts/LeaveRow';
import { useFlip } from '../../parts/flip';
import { motionOff } from '../../parts/motion';
import s from './SettingsList.module.css';

type Result = { page: Pick<SettingsMatch, 'sub' | 'title' | 'href'>; group: SettingsGroup['id'] | null };
const resultKey = (result: Result) => result.page.href;

/**
 * Settings' list (C1 task 7): one search box, then the four groups (shell/settings.ts), each a plain heading and its
 * pages as links, no boxes. The page on screen is `aria-current="page"`. Search filters the rows as the owner types;
 * a group with no match hides; no match says so; Enter opens the first match; Escape clears the box. Beside a page
 * from 760 px; alone on a phone at `#/business`.
 */
export function SettingsList({ groups, current }: { groups: readonly SettingsGroup[]; current: string | null }) {
  const t = useT();
  const base = useId();
  const [query, setQuery] = useState('');
  const found = query.trim() ? findSettings(query, t, groups) : null;
  const shown = groups
    .map((group) => ({ ...group, pages: found ? group.pages.filter((p) => found.some((m) => m.sub === p.sub)) : group.pages }))
    .filter((group) => group.pages.length > 0);
  const outside = found?.filter((m) => m.group === null) ?? [];
  const results: Result[] = [...shown.flatMap(group => group.pages.map(page => ({ page, group: group.id }))), ...outside.map(page => ({ page, group: null }))];
  const { drawn, left } = useLeavingList(results, resultKey);
  const list = useFlip<HTMLElement>(drawn.map(row => row.key).join('|'));
  const rows = (items: Drawn<Result>[]) => items.map(row => <LeaveRow key={row.key} row={{ ...row, arriving: row.arriving && !motionOff() }} left={left} flipId={row.key}>
    <a className={s.link} href={row.item.page.href} aria-current={row.item.page.sub === current ? 'page' : undefined}
      tabIndex={row.leaving ? -1 : undefined} onClick={event => { if (row.leaving) event.preventDefault(); }}>{t(row.item.page.title)}</a>
  </LeaveRow>);
  const outsideRows = drawn.filter(row => row.item.group === null);

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && found && found.length > 0) {
      event.preventDefault();
      goToHref(found[0]!.href);
    } else if (event.key === 'Escape' && query) {
      event.stopPropagation();
      setQuery('');
    }
  }

  return (
    <nav ref={list} className={s.list} aria-label={t('business.settings.nav')} data-settings-list="">
      <input
        type="search" className={s.search} value={query} aria-label={t('business.settings.search')} placeholder={t('business.settings.search')}
        autoComplete="off" spellCheck={false} onChange={(event) => setQuery(event.currentTarget.value)} onKeyDown={onKey}
      />
      {groups.map((group) => {
        const items = drawn.filter(row => row.item.group === group.id);
        return items.length === 0 ? null : (
        <div key={group.id} className={s.group}>
          <h2 id={`${base}-${group.id}`} className={s.heading}>{t(group.title)}</h2>
          <ul className={s.pages} aria-labelledby={`${base}-${group.id}`}>
            {rows(items)}
          </ul>
        </div>
      ); })}
      {outsideRows.length > 0 && (
        <ul className={s.pages}>
          {rows(outsideRows)}
        </ul>
      )}
      {found && shown.length === 0 && outside.length === 0 && <p className={s.none} role="status">{t('business.settings.none')}</p>}
    </nav>
  );
}
