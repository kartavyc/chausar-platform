/**
 * FirstRunStep: the frame every first-run step shares. No rail: a top bar with the
 * wordmark and the English/Hindi choice, the six Steps with the walking square, one task
 * area, and at the bottom the blocked line on every step. The line about what left this
 * computer is drawn only from the engine's answer (`leftThisComputer`), never as fixed
 * text: with no answer there is no line.
 *
 * The pattern only draws. The screen that uses it supplies the step states, the codes and
 * the task; every word here comes from the shared catalogue.
 */

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { Language, StepItem } from '../app/presentation.ts';
import { Wordmark } from '../app/Rail';
import { useT } from '../app/text';
import { Steps } from '../parts/Steps';
import s from './FirstRunStep.module.css';

/** What the next step waits for, as the engine's code; `not-built` when the engine cannot say yet. */
export type FirstRunBlocked = 'nothing' | 'no-vault' | 'no-source' | 'meanings-unpublished' | 'no-answer' | 'not-built';
/** Whether anything has left this computer, exactly as the engine answered. */
export type FirstRunLeft = 'nothing' | 'something' | 'unknown';

export interface FirstRunStepProps {
  readonly language: Language;
  readonly onLanguage: (language: Language) => void;
  readonly steps: readonly StepItem[];
  /** The blocked line. Null while it is being read. */
  readonly blocked: FirstRunBlocked | null;
  /** Null draws no line at all. */
  readonly left: FirstRunLeft | null;
  readonly children: ReactNode;
}

const LANGUAGES: readonly Language[] = ['en', 'hi'];

/** A row of words with radio semantics; an arrow moves the choice and the focus together. */
export function LanguageWords({ language, onLanguage }: { language: Language; onLanguage: (language: Language) => void }) {
  const t = useT();
  const id = useId();
  const words = useRef<Partial<Record<Language, HTMLButtonElement | null>>>({});
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = LANGUAGES.indexOf(language);
    let next: Language | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = LANGUAGES[(index + 1) % LANGUAGES.length];
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = LANGUAGES[(index - 1 + LANGUAGES.length) % LANGUAGES.length];
    if (next === undefined) return;
    event.preventDefault();
    words.current[next]?.focus();
    onLanguage(next);
  };
  return (
    <div className={s.language}>
      <span id={id} className="sr">{t('SH-06.language')}</span>
      <div role="radiogroup" aria-labelledby={id} className={s.languageWords} onKeyDown={onKey}>
        {LANGUAGES.map(option => {
          const chosen = option === language;
          return (
            <button
              key={option}
              ref={element => { words.current[option] = element; }}
              type="button"
              role="radio"
              aria-checked={chosen}
              tabIndex={chosen ? 0 : -1}
              lang={option}
              className={[s.languageWord, chosen ? s.languageChosen : ''].filter(Boolean).join(' ')}
              onClick={() => onLanguage(option)}
            >
              {t(`SH-06.language.${option}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FirstRunStep({ language, onLanguage, steps, blocked, left, children }: FirstRunStepProps) {
  const t = useT();
  return (
    <div className={s.shell} lang={language} data-first-run-step="">
      <header className={s.top}>
        <Wordmark />
        <LanguageWords language={language} onLanguage={onLanguage} />
      </header>
      <main className={s.page} tabIndex={-1} aria-label={t('SH-01.region.page')} data-region="page">
        <Steps steps={steps} className={s.steps} />
        <div className={s.task}>{children}</div>
        <footer className={s.foot}>
          {blocked === null
            ? <p className={s.line} role="status">{t('FRSTEP.blocked.reading')}</p>
            : <p className={s.line} data-first-run-blocked={blocked}>{t(`FRSTEP.blocked.${blocked}`)}</p>}
          {left !== null && <p className={s.line} data-first-run-left={left}>{t(`FRSTEP.left.${left}`)}</p>}
        </footer>
      </main>
    </div>
  );
}
