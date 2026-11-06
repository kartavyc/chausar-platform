import { useId, useState, type KeyboardEvent } from 'react';
import { useT } from '../../text';
import { goToHref } from '../../shell/nav';
import { findSettings, type SettingsGroup } from '../../shell/settings';
import s from './SettingsList.module.css';

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
    <nav className={s.list} aria-label={t('business.settings.nav')} data-settings-list="">
      <input
        type="search" className={s.search} value={query} aria-label={t('business.settings.search')} placeholder={t('business.settings.search')}
        autoComplete="off" spellCheck={false} onChange={(event) => setQuery(event.currentTarget.value)} onKeyDown={onKey}
      />
      {shown.map((group) => (
        <div key={group.id} className={s.group}>
          <h2 id={`${base}-${group.id}`} className={s.heading}>{t(group.title)}</h2>
          <ul className={s.pages} aria-labelledby={`${base}-${group.id}`}>
            {group.pages.map((p) => (
              <li key={p.sub}>
                <a className={s.link} href={p.href} aria-current={p.sub === current ? 'page' : undefined}>{t(p.title)}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {outside.length > 0 && (
        <ul className={s.pages}>
          {outside.map((m) => <li key={m.href}><a className={s.link} href={m.href}>{t(m.title)}</a></li>)}
        </ul>
      )}
      {found && shown.length === 0 && outside.length === 0 && <p className={s.none} role="status">{t('business.settings.none')}</p>}
    </nav>
  );
}
