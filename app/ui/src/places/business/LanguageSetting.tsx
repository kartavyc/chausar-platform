import { useState } from 'react';
import { useLanguageChoice, useT, type Language } from '../../text';
import { TileSection, messageOf } from './shared';
import b from './Business.module.css';

/**
 * Language (C5 task 36): the owner's own pick, for the whole app on this computer. It says plainly the Hindi is
 * machine-translated and that what the engine and the owner's AI write stays in English. C1 places this row in its group.
 */
export function LanguageSetting() {
  const t = useT();
  const { language, available, choose } = useLanguageChoice();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!available) return null;

  async function pick(next: Language) {
    setBusy(true);
    setProblem(null);
    try {
      await choose(next);
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TileSection title={t('common.language.title')}>
      <label className={b.line}>
        <span className="sr-only">{t('common.language.title')}</span>
        <select value={language} disabled={busy} onChange={(event) => void pick(event.currentTarget.value as Language)}>
          <option value="en" lang="en">English</option>
          <option value="hi" lang="hi">हिन्दी</option>
        </select>
      </label>
      <p className={b.note}>{t('common.language.note')}</p>
      {problem && <p className={b.problem} role="alert">{problem}</p>}
    </TileSection>
  );
}
