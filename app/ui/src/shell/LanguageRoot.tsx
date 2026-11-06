/**
 * The owner's language (C5 task 36): one preference on this computer (app.preferences.*), read once the engine answers
 * and set from the Language row or Welcome back's link. The computer's language never decides. While a language loads,
 * the words already on screen stay. The phone and the paired browser read the same preference but only the computer's
 * own app changes it (the server keeps the set to the local owner). Hosted has none yet: English, with no row or link.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useEngine, useEngineStatus } from '../engine/context';
import { LanguageChoiceContext, TextProvider, prepareLanguage, type Language } from '../text';
import { setDateLanguage } from '../parts/when';

export function LanguageRoot({ language: first, children }: { language: Language; children: ReactNode }) {
  const client = useEngine();
  const ready = useEngineStatus().state === 'ok';
  const reads = client.transport !== 'hosted';
  const available = client.transport === 'desktop' || client.transport === 'fake';
  const [language, setLanguage] = useState<Language>(first);
  const asked = useRef(false);

  const apply = useCallback(async (next: Language) => {
    await prepareLanguage(next);
    setDateLanguage(next);
    setLanguage(next);
    document.documentElement.lang = next;
  }, []);

  useEffect(() => {
    if (!ready || !reads || asked.current) return;
    asked.current = true;
    // An engine that can't answer leaves the words as they are.
    client.request('app.preferences.get', {}).then((preference) => apply(preference.language)).catch(() => {});
  }, [ready, reads, client, apply]);

  const choose = useCallback(async (next: Language) => {
    await client.request('app.preferences.set', { language: next });
    await apply(next);
  }, [client, apply]);

  const choice = useMemo(() => ({ language, available, choose }), [language, available, choose]);
  return (
    <LanguageChoiceContext.Provider value={choice}>
      <TextProvider language={language}>{children}</TextProvider>
    </LanguageChoiceContext.Provider>
  );
}
