import { useRef, type ReactNode } from 'react';
import { EngineProvider, useEngine, useEngineStatus } from '../engine/context';
import { TextProvider, useT, type Language } from '../text';
import { StatusLine } from '../parts/StatusLine';
import { closeSheet, returnFocus, useRoute } from './navigation';
import { useShellKeys } from './keys';
import { PLACES, SHEETS } from './places';
import { Rail } from './Rail';
import { UnknownSheet } from './sheets';
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
  const line = <StatusLine status={status} transport={client.transport} />;
  return <BootScreen status={line}>{(checking) => <Frame statusLine={line} checking={checking} />}</BootScreen>;
}

/**
 * The frame: a thin status line when something is wrong, the rail, the place, and at most one sheet beside the
 * place (never modal; below 1100 px it lies over the place). The address decides the place and the sheet.
 */
function Frame({ statusLine, checking }: { statusLine: ReactNode; checking: boolean }) {
  const t = useT();
  const route = useRoute();
  const main = useRef<HTMLElement>(null);
  useShellKeys({ mainRef: main, onClose: closeSheet });

  const { Place } = PLACES[route.place];
  const sheet = route.sheet;
  const SheetKind = sheet ? SHEETS[sheet.kind] ?? UnknownSheet : null;

  return (
    <div className={s.app} data-sheet-open={sheet ? '' : undefined} data-boot={checking ? '' : undefined}>
      <button type="button" className={s.skip} onClick={() => main.current?.focus()}>{t('shell.skip')}</button>
      <div className={s.status}>{statusLine}</div>
      <div className={s.rail}><Rail route={route} /></div>
      <main ref={main} id="main" tabIndex={-1} className={s.main}>
        <div className={s.page}><Place key={route.place} /></div>
      </main>
      {sheet && SheetKind && (
        <div className={s.sheet}>
          <SheetKind key={`${sheet.kind}:${sheet.id}`} id={sheet.id} onClose={closeSheet} returnFocus={returnFocus} />
        </div>
      )}
    </div>
  );
}
