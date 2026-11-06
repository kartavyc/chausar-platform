import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EngineProvider, useEngine, useEngineStatus } from '../engine/context';
import { TextProvider, useT, type Language } from '../text';
import { SheetMotionContext, SheetTitleContext } from '../parts/Sheet';
import { afterExit, motionOff } from '../parts/motion';
import { ShellToolsContext } from '../parts/PageTitle';
import { AskBox } from './AskBox';
import { useAskKey } from './ask';
import { Bell, NotifyProvider } from './Bell';
import { StatusLine } from '../parts/StatusLine';
import { closeSheet, returnFocus, useRoute } from './navigation';
import { PrivacyBoundary } from './PrivacyBoundary';
import { useShellKeys } from './keys';
import { PLACES, SHEETS } from './places';
import { Rail } from './Rail';
import { UnknownSheet, type SheetComponent } from './sheets';
import type { SheetRef } from './routes';
import { PhoneTabs, TopBar } from './TopBar';
import { TrialBanner } from './TrialBanner';
import { useNarrow } from './useNarrow';
import { useMotionPreference } from './motionPreference';
import { OwnerZone } from './clock';
import { PairScreen } from './PairScreen';
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
 * opened business remounts the frame. A browser that is not paired, or whose session ended, sees only PairScreen (C4 task 42).
 */
export function Shell() {
  const client = useEngine();
  // One-shot C3: the owner's Animations choice, read once at the top and applied to <html data-motion>.
  useMotionPreference();
  const status = useEngineStatus();
  const line = <StatusLine status={status} transport={client.transport} />;
  if (status.state === 'unpaired' || status.state === 'session-ended') return <PairScreen />;
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
  useAskKey();

  const { Place } = PLACES[route.place];
  const sheet = route.sheet;
  const SheetKind = sheet ? SheetFor(sheet) : null;
  const covered = narrow && Boolean(sheet && SheetKind);
  const motion = useSheetMotion(sheet, SheetKind);
  const shown = motion.shown;
  const [sheetTitle, setSheetTitle] = useState<string | undefined>();
  const dialog = covered ? { role: 'dialog', 'aria-modal': true, 'aria-labelledby': sheetTitle } : {};
  const shellTools = useMemo(() => (narrow ? null : <><AskBox /><Bell /></>), [narrow]);

  return (
    // One notification list for the bell and the centre (W4 4G4), so they never disagree.
    <OwnerZone>
    <NotifyProvider>
    <div className={s.app} data-phone={narrow ? '' : undefined} data-sheet-open={shown ? '' : undefined} data-boot={checking ? '' : undefined}>
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
          <div className={s.page}><TrialBanner /><AiGo /><Place key={route.place} /></div>
        </ShellToolsContext.Provider>
      </main>
      {/* One-shot C3: a closed sheet stays as an inert, hidden leaving copy (the same element) until its exit ends. */}
      {shown && (
        <div ref={motion.holder} className={s.sheet} data-cover={narrow ? '' : undefined} {...(motion.state === 'leaving' ? { inert: true, 'aria-hidden': true } : dialog)}>
          <SheetTitleContext.Provider value={motion.state === 'leaving' ? null : setSheetTitle}>
            <SheetMotionContext.Provider value={motion.state}>
              <shown.Kind key={`${shown.sheet.kind}:${shown.sheet.id}`} id={shown.sheet.id} onClose={closeSheet} returnFocus={returnFocus} />
            </SheetMotionContext.Provider>
          </SheetTitleContext.Provider>
        </div>
      )}
      {narrow && <div className={s.tabs} inert={covered}><PhoneTabs route={route} /></div>}
    </div>
    </NotifyProvider>
    </OwnerZone>
  );
}

const SheetFor = (sheet: SheetRef): SheetComponent => SHEETS[sheet.kind] ?? UnknownSheet;
type Shown = { sheet: SheetRef; Kind: SheetComponent };
const keyOf = (shown: Shown | null) => (shown ? `${shown.sheet.kind}:${shown.sheet.id}` : null);

/**
 * One-shot C3 task 5: the one sheet, as it opens, is replaced and leaves. When the address loses its sheet, the last
 * one stays drawn as a leaving copy (the same element, so nothing reloads), focus goes back to its opener at once, and
 * the copy goes when its exit animation ends (or its timer, or at once with motion off). A sheet that opens while one
 * leaves replaces it at once. A sheet that takes another's place (Read to Edit) cross-fades instead of sliding in.
 */
function useSheetMotion(sheet: SheetRef | undefined, Kind: SheetComponent | null) {
  const live: Shown | null = sheet && Kind ? { sheet, Kind } : null;
  const [last, setLast] = useState<Shown | null>(live);
  const [leaving, setLeaving] = useState<Shown | null>(null);
  const [replacing, setReplacing] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  if (keyOf(live) !== keyOf(last)) {
    setLast(live);
    setLeaving(!live && last && !motionOff() ? last : null);
    setReplacing(Boolean(live && last));
  }
  const leavingKey = keyOf(leaving);
  // Focus goes back at close, while the copy still leaves (the Sheet's own unmount then finds nothing to do).
  useLayoutEffect(() => {
    if (leavingKey) returnFocus();
  }, [leavingKey]);
  useEffect(() => {
    if (!leavingKey) return undefined;
    return afterExit(holder.current?.querySelector('aside[data-sheet]') ?? null, () => setLeaving(null));
  }, [leavingKey]);
  const shown = live ?? leaving;
  const state: SheetMotion = live ? (replacing ? 'replacing' : null) : leaving ? 'leaving' : null;
  return { shown, state, holder };
}
type SheetMotion = 'leaving' | 'replacing' | null;
