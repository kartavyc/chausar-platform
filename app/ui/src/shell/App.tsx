import { useMemo, useRef, useState, type ReactNode } from 'react';
import { EngineProvider, useEngine, useEngineStatus } from '../engine/context';
import { TextProvider, useT, type Language } from '../text';
import { SheetTitleContext } from '../parts/Sheet';
import { ShellToolsContext } from '../parts/PageTitle';
import { useFindKey } from './ask';
import { CommandBox } from './find/CommandBox';
import { CommandDialog, openFindDialog, useFindDialogOpen } from './find/CommandDialog';
import { Bell, NotifyProvider } from './Bell';
import { StatusLine } from '../parts/StatusLine';
import { closeSheet, returnFocus, useRoute } from './navigation';
import { PrivacyBoundary } from './PrivacyBoundary';
import { useShellKeys } from './keys';
import { PLACES, SHEETS } from './places';
import { Rail } from './Rail';
import { UnknownSheet } from './sheets';
import { PhoneTabs, TopBar } from './TopBar';
import { TrialBanner } from './TrialBanner';
import { useNarrow } from './useNarrow';
import { OwnerZone } from './clock';
import { BootScreen } from '../places/onboarding/BootScreen';
// W6 6H3 (D40): the owner's AI offers a place; the frame shows Open and Not now, and never opens it by itself.
import { AiGo } from '../parts/layout/AiGo';
import type { EngineClient } from '../engine/types';
import s from './App.module.css';

export function App({ client, language }: { client: EngineClient; language: Language }) {
  return (
    <EngineProvider client={client}>
      <TextProvider language={language}>
        <Shell />
      </TextProvider>
    </EngineProvider>
  );
}

/**
 * The window: the status line, then what BootScreen decides (the first run, Welcome back, or the frame). A new or newly
 * opened business remounts the frame.
 */
export function Shell() {
  const client = useEngine();
  const status = useEngineStatus();
  const line = <StatusLine status={status} transport={client.transport} />;
  return <BootScreen status={line}>{(checking) => <PrivacyBoundary>{(privacy) => <Frame key={privacy} statusLine={line} checking={checking} />}</PrivacyBoundary>}</BootScreen>;
}

/**
 * The frame: a thin status line when something is wrong, the rail, the place, and at most one sheet beside the
 * place (never modal; below 1100 px it lies over the place). The address decides the place and the sheet.
 * On a phone (under 760 px, spec 4.3) the rail gives way to the top bar and the bottom tabs, and a sheet covers the
 * screen under the status line: the top bar, the place and the tabs it covers are inert until it closes, so focus
 * never goes behind it, and its container is a modal dialog named by the sheet's title (w3 3I), so the page always
 * has a main landmark and a heading to land on: the place's, or the dialog's.
 */
function Frame({ statusLine, checking }: { statusLine: ReactNode; checking: boolean }) {
  const t = useT();
  const route = useRoute();
  const narrow = useNarrow();
  const main = useRef<HTMLElement>(null);
  useShellKeys({ mainRef: main, onClose: closeSheet });
  useFindKey(openFindDialog);
  const finding = useFindDialogOpen();

  const { Place } = PLACES[route.place];
  const sheet = route.sheet;
  const SheetKind = sheet ? SHEETS[sheet.kind] ?? UnknownSheet : null;
  // A sheet or the command dialog on a phone covers the screen under the status line; beside the rail the dialog
  // lies over the page, which stays out of reach until it closes.
  const covered = narrow && (Boolean(sheet && SheetKind) || finding);
  const behind = covered || finding;
  const [sheetTitle, setSheetTitle] = useState<string | undefined>();
  const dialog = narrow && sheet && SheetKind ? { role: 'dialog', 'aria-modal': true, 'aria-labelledby': sheetTitle } : {};
  // C2: beside the rail every page header carries the command bar and the bell. On Chats the header holds no bar (the
  // composer is the ask box there; B4 task 19's rule, held here until B4 lands): Ctrl K opens the dialog instead.
  const onChats = route.place === 'chats';
  const shellTools = useMemo(() => (narrow ? null : <>{!onChats && <CommandBox />}<Bell /></>), [narrow, onChats]);

  return (
    // One notification list for the bell and the centre (W4 4G4), so they never disagree.
    <OwnerZone>
    <NotifyProvider>
    <div className={s.app} data-phone={narrow ? '' : undefined} data-sheet-open={sheet ? '' : undefined} data-boot={checking ? '' : undefined}>
      <button type="button" className={s.skip} inert={behind} onClick={() => main.current?.focus()}>{t('shell.skip')}</button>
      <div className={s.status}>{statusLine}</div>
      {narrow
        ? <div className={s.top} inert={covered}><TopBar /></div>
        : <div className={s.rail} inert={behind}><Rail route={route} /></div>}
      <main ref={main} id="main" tabIndex={-1} className={s.main} inert={behind}>
        {/* Beside the rail, every page header carries the command bar (C2) and the bell (W4 4G4); on a phone both sit in
            the top bar. */}
        <ShellToolsContext.Provider value={shellTools}>
          {/* W4 4J21: a business started on the hosted app without an account says so above every place. */}
          <div className={s.page}><TrialBanner /><AiGo /><Place key={route.place} /></div>
        </ShellToolsContext.Provider>
      </main>
      {sheet && SheetKind && (
        <div className={s.sheet} data-cover={narrow ? '' : undefined} inert={finding} {...dialog}>
          <SheetTitleContext.Provider value={setSheetTitle}>
            <SheetKind key={`${sheet.kind}:${sheet.id}`} id={sheet.id} onClose={closeSheet} returnFocus={returnFocus} />
          </SheetTitleContext.Provider>
        </div>
      )}
      {narrow && <div className={s.tabs} inert={covered}><PhoneTabs route={route} /></div>}
      <CommandDialog cover={narrow} />
    </div>
    </NotifyProvider>
    </OwnerZone>
  );
}
