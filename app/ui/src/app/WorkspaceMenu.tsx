/**
 * Workspace, view and language (SH-06): a small menu at the foot of the rail. The
 * workspaces you have a seat in (each marked demo or real), the group companies in the
 * enterprise version, the three views, the languages, Lock now, About this build.
 * Every choice is a local callback intent; the adapter stores it. The view and the
 * language are independent choices.
 *
 * Menu behaviour comes from React Aria Components, the one unstyled accessibility library
 * this app uses. Its exact provisioned version is checked by the isolated build.
 */

import { Button as AriaButton } from 'react-aria-components/Button';
import { Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover, type Key } from 'react-aria-components/Menu';
import type { Language, View, WorkspaceIdentity } from './presentation.ts';
import { useT } from './text';
import s from './WorkspaceMenu.module.css';

export interface WorkspaceEntry {
  id: string;
  name: string;
  demo: boolean;
}

export interface CompanyEntry {
  id: string;
  name: string;
}

export interface WorkspaceMenuProps {
  workspace: WorkspaceIdentity;
  /** Listed only with `onSwitchWorkspace`: a workspace that cannot be chosen is not offered. */
  workspaces?: ReadonlyArray<WorkspaceEntry> | undefined;
  onSwitchWorkspace?: ((id: string) => void) | undefined;
  /** The workspace in use, marked chosen in the list. */
  workspaceId?: string | undefined;
  /** Enterprise: group companies and "All companies". Listed only with `onSwitchCompany`. */
  companies?: ReadonlyArray<CompanyEntry> | undefined;
  companyId?: string | undefined;
  onSwitchCompany?: ((id: string) => void) | undefined;
  view: View;
  onSetView: (v: View) => void;
  /** The enterprise version offers Guided and Books; Simple stays for staff who only approve or enter. */
  views?: ReadonlyArray<View> | undefined;
  language: Language;
  onSetLanguage: (l: Language) => void;
  onLock: () => void;
  onAbout: () => void;
  /** Help (SH-12), the same sheet as Ctrl /. Listed only when supplied. */
  onHelp?: (() => void) | undefined;
  /** Read the workspace again from the engine. Listed only when supplied. */
  onReadAgain?: (() => void) | undefined;
}

const VIEWS: ReadonlyArray<View> = ['simple', 'guided', 'books'];
const LANGS: ReadonlyArray<Language> = ['en', 'hi'];

export function WorkspaceMenu(p: WorkspaceMenuProps) {
  const t = useT();

  const onAction = (key: Key) => {
    const k = String(key);
    const [kind, id] = k.split(':', 2);
    if (kind === 'ws' && id) p.onSwitchWorkspace?.(id);
    else if (kind === 'co' && id) p.onSwitchCompany?.(id);
    else if (kind === 'view' && (id === 'simple' || id === 'guided' || id === 'books')) p.onSetView(id);
    else if (kind === 'lang' && (id === 'en' || id === 'hi')) p.onSetLanguage(id);
    else if (kind === 'lock') p.onLock();
    else if (kind === 'about') p.onAbout();
    else if (kind === 'help') p.onHelp?.();
    else if (kind === 'read') p.onReadAgain?.();
  };

  const views = p.views ?? VIEWS;

  return (
    <MenuTrigger>
      <AriaButton className={[s.trigger].join(' ')} aria-label={t('SH-06.open')}>
        <span className={s.name}>
          {p.workspace.name}
          {p.workspace.demo && <span className={s.demo}> {t('SH-06.demo')}</span>}
        </span>
        <span className={s.who}>{p.workspace.who}</span>
      </AriaButton>
      <Popover className={[s.popover].join(' ')} placement="top start">
        <Menu className={[s.menu].join(' ')} onAction={onAction}>
          {p.onSwitchWorkspace && p.workspaces && p.workspaces.length > 1 && (
            <MenuSection className={[s.section].join(' ')}>
              <Header className={s.header}>{t('SH-06.workspaces')}</Header>
              {p.workspaces.map((w) => (
                <MenuItem key={w.id} id={`ws:${w.id}`} className={[s.item, p.workspaceId === w.id ? s.chosen : ''].join(' ')}>
                  {w.name}
                  <span className={s.demo}> {w.demo ? t('SH-06.demo') : t('SH-06.real')}</span>
                </MenuItem>
              ))}
            </MenuSection>
          )}
          {p.onSwitchCompany && p.companies && p.companies.length > 0 && (
            <MenuSection className={[s.section].join(' ')}>
              <Header className={s.header}>{t('SH-06.companies')}</Header>
              {p.companies.map((c) => (
                <MenuItem key={c.id} id={`co:${c.id}`} className={[s.item, p.companyId === c.id ? s.chosen : ''].join(' ')}>
                  {c.name}
                </MenuItem>
              ))}
              <MenuItem id="co:all" className={[s.item, p.companyId === 'all' ? s.chosen : ''].join(' ')}>
                {t('SH-06.companies.all')}
              </MenuItem>
            </MenuSection>
          )}
          <MenuSection className={[s.section].join(' ')}>
            <Header className={s.header}>{t('SH-06.view')}</Header>
            {views.map((v) => (
              <MenuItem key={v} id={`view:${v}`} className={[s.item, p.view === v ? s.chosen : ''].join(' ')}>
                {t(`SH-06.view.${v}`)}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuSection className={[s.section].join(' ')}>
            <Header className={s.header}>{t('SH-06.language')}</Header>
            {LANGS.map((l) => (
              <MenuItem key={l} id={`lang:${l}`} className={[s.item, p.language === l ? s.chosen : ''].join(' ')}>
                <span lang={l}>{t(`SH-06.language.${l}`)}</span>
              </MenuItem>
            ))}
          </MenuSection>
          <MenuSection className={[s.section].join(' ')}>
            {p.onReadAgain && (
              <MenuItem id="read" className={[s.item].join(' ')}>
                {t('SH-06.readAgain')}
              </MenuItem>
            )}
            <MenuItem id="lock" className={[s.item].join(' ')}>
              {t('SH-06.lock')}
            </MenuItem>
            {p.onHelp && (
              <MenuItem id="help" className={[s.item].join(' ')}>
                {t('SH-12.title')}
              </MenuItem>
            )}
            <MenuItem id="about" className={[s.item].join(' ')}>
              {t('SH-06.about')}
            </MenuItem>
          </MenuSection>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
