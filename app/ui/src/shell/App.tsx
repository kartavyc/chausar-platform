import { useRef } from 'react';
import { EngineProvider, useEngine, useEngineStatus } from '../engine/context';
import { TextProvider, useT, type Language } from '../text';
import { StatusLine } from '../parts/StatusLine';
import { closeSheet, returnFocus, useRoute } from './navigation';
import { useShellKeys } from './keys';
import { PLACES, SHEETS } from './places';
import { Rail } from './Rail';
import { UnknownSheet } from './sheets';
import { FirstRun, StartedContext, useFirstRun } from '../places/onboarding';
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
 * The frame: a thin status line when something is wrong, the rail, the place, and at most one sheet beside the
 * place (never modal; below 760 px it covers the place). The address decides the place and the sheet.
 */
export function Shell() {
  const t = useT();
  const client = useEngine();
  const status = useEngineStatus();
  const route = useRoute();
  const main = useRef<HTMLElement>(null);
  useShellKeys({ mainRef: main, onClose: closeSheet });
  // No business on this computer yet: only the one-sentence start. A new business remounts the frame.
  const first = useFirstRun();

  const { Place } = PLACES[route.place];
  const sheet = route.sheet;
  const SheetKind = sheet ? SHEETS[sheet.kind] ?? UnknownSheet : null;

  if (first.boot === 'first-run') return <FirstRun status={<StatusLine status={status} transport={client.transport} />} onStarted={first.started} />;

  return (
    <StartedContext.Provider value={first.started}>
      <div key={first.generation} className={s.app} data-sheet-open={sheet ? '' : undefined} data-boot={first.boot === 'checking' ? '' : undefined}>
        <button type="button" className={s.skip} onClick={() => main.current?.focus()}>{t('shell.skip')}</button>
        <div className={s.status}><StatusLine status={status} transport={client.transport} /></div>
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
    </StartedContext.Provider>
  );
}
