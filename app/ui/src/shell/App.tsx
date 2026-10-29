import { useMemo, useRef, useState, type ReactNode } from 'react';
import { EngineProvider, useEngine, useEngineEvents, useEngineStatus } from '../engine/context';
import { TextProvider, useT, type Language } from '../text';
import { SheetTitleContext } from '../parts/Sheet';
import { ShellToolsContext } from '../parts/PageTitle';
import { AskBox } from './AskBox';
import { forgetAskWords, useAskKey } from './ask';
import { Bell, NotifyProvider } from './Bell';
import { StatusLine } from '../parts/StatusLine';
import { closeSheet, forgetFocusOrigin, returnFocus, useRoute } from './navigation';
import { useShellKeys } from './keys';
import { PLACES, SHEETS } from './places';
import { Rail } from './Rail';
import { UnknownSheet } from './sheets';
import { PhoneTabs, TopBar } from './TopBar';
import { TrialBanner } from './TrialBanner';
import { useNarrow } from './useNarrow';
import { BootScreen } from '../places/onboarding/BootScreen';
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
  const [privacy, setPrivacy] = useState(0);
  useEngineEvents((event) => {
    if (event.type !== 'privacy.forgotten') return;
    forgetAskWords();
    forgetFocusOrigin();
    // Discard every local page/sheet buffer even when its subsequent read fails.
    setPrivacy((generation) => generation + 1);
  });
  const line = <StatusLine status={status} transport={client.transport} />;
  return <BootScreen status={line}>{(checking) => <Frame key={privacy} statusLine={line} checking={checking} />}</BootScreen>;
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
  useAskKey();

  const { Place } = PLACES[route.place];
  const sheet = route.sheet;
  const SheetKind = sheet ? SHEETS[sheet.kind] ?? UnknownSheet : null;
  const covered = narrow && Boolean(sheet && SheetKind);
  const [sheetTitle, setSheetTitle] = useState<string | undefined>();
  const dialog = covered ? { role: 'dialog', 'aria-modal': true, 'aria-labelledby': sheetTitle } : {};
  const shellTools = useMemo(() => (narrow ? null : <><AskBox /><Bell /></>), [narrow]);

  return (
    // One notification list for the bell and the centre (W4 4G4), so they never disagree.
    <NotifyProvider>
    <div className={s.app} data-phone={narrow ? '' : undefined} data-sheet-open={sheet ? '' : undefined} data-boot={checking ? '' : undefined}>
      <button type="button" className={s.skip} inert={covered} onClick={() => main.current?.focus()}>{t('shell.skip')}</button>
      <div className={s.status}>{statusLine}</div>
      {narrow
        ? <div className={s.top} inert={covered}><TopBar /></div>
        : <div className={s.rail}><Rail route={route} /></div>}
      <main ref={main} id="main" tabIndex={-1} className={s.main} inert={covered}>
        {/* Beside the rail, every page header carries the Ask box (W4 4C2) and the bell (W4 4G4); on a phone the bell sits
            in the top bar and Chats has a tab. */}
        <ShellToolsContext.Provider value={shellTools}>
          {/* W4 4J21: a business started on the hosted app without an account says so above every place. */}
          <div className={s.page}><TrialBanner /><Place key={route.place} /></div>
        </ShellToolsContext.Provider>
      </main>
      {sheet && SheetKind && (
        <div className={s.sheet} data-cover={narrow ? '' : undefined} {...dialog}>
          <SheetTitleContext.Provider value={setSheetTitle}>
            <SheetKind key={`${sheet.kind}:${sheet.id}`} id={sheet.id} onClose={closeSheet} returnFocus={returnFocus} />
          </SheetTitleContext.Provider>
        </div>
      )}
      {narrow && <div className={s.tabs} inert={covered}><PhoneTabs route={route} /></div>}
    </div>
    </NotifyProvider>
  );
}
