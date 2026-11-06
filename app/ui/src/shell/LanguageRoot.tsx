/**
 * The owner's language (C5 task 36): one preference on this computer (app.preferences.*), read once the engine answers
 * and set from the Language row or Welcome back's link. The computer's language never decides. While a language loads,
 * the words already on screen stay. Hosted has no such preference yet, so it stays in English with no row or link.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useEngine, useEngineStatus } from '../engine/context';
import { LanguageChoiceContext, TextProvider, prepareLanguage, type Language } from '../text';

export function LanguageRoot({ language: first, children }: { language: Language; children: ReactNode }) {
  const client = useEngine();
  const ready = useEngineStatus().state === 'ok';
  const available = client.transport !== 'hosted';
  const [language, setLanguage] = useState<Language>(first);
  const asked = useRef(false);

  const apply = useCallback(async (next: Language) => {
    await prepareLanguage(next);
    setLanguage(next);
    document.documentElement.lang = next;
  }, []);

  useEffect(() => {
    if (!ready || !available || asked.current) return;
    asked.current = true;
    // An engine that can't answer leaves the words as they are.
    client.request('app.preferences.get', {}).then((preference) => apply(preference.language)).catch(() => {});
  }, [ready, available, client, apply]);

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
