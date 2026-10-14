/**
 * First run, steps four and five, as one independently mounted screen. No rail: a top
 * bar with the wordmark and the English/Hindi choice, then the six steps across a
 * centred 720 column and the current step's task. The controller owns every read and
 * the one mutation; this file only shows its state and forwards clicks.
 *
 * The parent owns the mount, the language, the view (FR-01's choice, applied to the root
 * `data-view` by the parent), the live guard, the certification of the earlier stages,
 * the Continue journey and the "Start from a conversation" destination.
 * Nothing mounts by itself. The screen starts one read of the packs when it is first
 * shown with an idle controller and cancels the controller when it is unmounted; it
 * never publishes on its own. The walking square stays on Meanings through a verified
 * publication; the parent advances it on its own Continue.
 */

import { useEffect, useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import type { Language, StepItem, StepState, View } from '../../app/presentation.ts';
import { Wordmark } from '../../app/Rail';
import { useT } from '../../app/text';
import { Button } from '../../parts/Button';
import { Steps } from '../../parts/Steps';
import type { DictionaryDraft, FirstRunCode } from './contracts.ts';
import type { FirstRunController, FirstRunHandoff, FirstRunState } from './controller.ts';
import { Meanings } from './Meanings';
import { PickPack } from './PickPack';
import type { FirstRunConversationLink } from './PickPack';
import { FirstRunText } from './text';
import s from './FirstRun.module.css';

export interface FirstRunIntents {
  /** FR-06: the underlined alternative to a pack, as a real internal link. Drawn only with a genuine in-app destination. */
  readonly startFromConversation?: FirstRunConversationLink | undefined;
  /** FR-08: Continue after a verified publication. Shown only when supplied. */
  readonly onContinue?: ((handoff: FirstRunHandoff) => void) | undefined;
  /** An explicit parent-owned settings journey (FR-02 territory). Without it the settings row says the change is not available here. */
  readonly onChangeSettings?: ((draft: DictionaryDraft) => void) | undefined;
}

/**
 * What the parent certifies about the stages this slice cannot see. This slice cannot
 * verify You, Vault, Model or the file part of Your books; an uncertified stage is drawn
 * as "not sure what happened", and the shared Steps part then rests the walking square
 * on the first stage that is not done.
 */
export interface FirstRunStagesDone {
  readonly you: boolean;
  readonly vault: boolean;
  readonly model: boolean;
  /** The file or connection part of Your books, which this slice does not do. */
  readonly books: boolean;
}

export interface FirstRunScreenProps {
  readonly controller: FirstRunController;
  readonly language: Language;
  readonly onLanguage: (language: Language) => void;
  /**
   * The view the person chose in FR-01 (main design: one app shown three ways; view and language are
   * separate choices). The parent keeps it and sets the existing root `data-view` for the shared size
   * tokens; here it only decides how many preview words a closed row has room for. Guided when absent.
   * This slice draws no view selector.
   */
  readonly view?: View | undefined;
  readonly stagesDone: FirstRunStagesDone;
  readonly intents?: FirstRunIntents | undefined;
}

export type FirstRunStepPosition = 'books' | 'meanings';

const STEP_KEYS = ['STEP.you', 'STEP.vault', 'STEP.model', 'STEP.books', 'STEP.meanings', 'STEP.first-answer'] as const;
const LANGUAGES: readonly Language[] = ['en', 'hi'];

/** The six steps with the walking square on the step this slice is at, and the earlier stages exactly as the parent certified them. */
export function firstRunSteps(position: FirstRunStepPosition, stagesDone: FirstRunStagesDone): readonly StepItem[] {
  const certified = (done: boolean): StepState => (done ? 'done' : 'unsure');
  const states: readonly StepState[] = [
    certified(stagesDone.you),
    certified(stagesDone.vault),
    certified(stagesDone.model),
    position === 'books' ? 'waiting-for-you' : certified(stagesDone.books),
    position === 'meanings' ? 'waiting-for-you' : 'not-reached',
    'not-reached',
  ];
  return STEP_KEYS.map((nameKey, index) => ({ nameKey, state: states[index] ?? 'not-reached' }));
}

function positionOf(state: FirstRunState): FirstRunStepPosition {
  switch (state.kind) {
    case 'review':
    case 'unknown':
    case 'published':
      return 'meanings';
    default:
      return 'books';
  }
}

const SENTENCED: ReadonlySet<FirstRunCode> = new Set<FirstRunCode>([
  'NO_AUTHORITY', 'REVIEW_NOT_CURRENT', 'CONTEXT_CHANGED', 'ACCESS_DENIED', 'VAULT_LOCKED', 'DIGEST_UNAVAILABLE', 'PUBLISH_NOT_COMMITTED', 'ALREADY_CURRENT',
]);

function Unavailable({ code, onAgain }: { code: FirstRunCode; onAgain: () => void }) {
  const t = useT();
  return (
    <div>
      <p className={s.status}>{SENTENCED.has(code) ? t(`FR.unavailable.${code}`) : t('FR.unavailable')}</p>
      <p className={[s.hash, 'fig'].join(' ')}>{t('FR.code', { code })}</p>
      <p className={s.after}><Button variant="link" onClick={onAgain}>{t('FR.again')}</Button></p>
    </div>
  );
}

/**
 * The English/Hindi choice in the approved vocabulary (a row of words, the chosen one
 * underlined, radio semantics) with the keyboard rule the shared part lacks here: an
 * arrow moves the choice and the focus together, so Enter or Space on the focused word
 * keeps the language it shows.
 */
function LanguageChoice({ language, onLanguage }: { language: Language; onLanguage: (language: Language) => void }) {
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

function Shell({ language, onLanguage, steps, children }: { language: Language; onLanguage: (language: Language) => void; steps: readonly StepItem[]; children: ReactNode }) {
  const t = useT();
  return (
    <div className={s.shell} lang={language}>
      <header className={s.top}>
        <Wordmark />
        <LanguageChoice language={language} onLanguage={onLanguage} />
      </header>
      <main className={s.page} tabIndex={-1} aria-label={t('SH-01.region.page')} data-region="page">
        <Steps steps={steps} className={s.steps} />
        {children}
      </main>
    </div>
  );
}

function Body({ state, controller, intents, view }: { state: FirstRunState; controller: FirstRunController; intents: FirstRunIntents; view: View }) {
  const t = useT();
  switch (state.kind) {
    case 'idle':
    case 'loading':
      return <p role="status" className={s.status}>{t('FR.loading')}</p>;
    case 'left':
      // A controller-checked departure (Continue, the settings change): the parent is navigating; nothing is read.
      return <p role="status" className={s.status}>{t('FR.left')}</p>;
    case 'read-only':
      return <p className={s.status}>{t('FR.readOnly')}</p>;
    case 'unavailable':
      return <Unavailable code={state.code} onAgain={() => { void controller.load(); }} />;
    case 'choose':
      return <PickPack packs={state.packs} onChoose={pack => { controller.choosePack(pack); }} conversation={intents.startFromConversation} onLeave={() => { controller.cancel(); }} />;
    case 'review':
    case 'unknown':
    case 'published':
      // A new review generation remounts the rows, so no open or editing state survives a pack change, even to the same pack.
      return <Meanings key={state.kind === 'review' ? state.review.generation : state.kind} state={state} controller={controller} intents={intents} view={view} />;
  }
}

/**
 * The same task without its own frame, for a parent that draws the six steps itself (the
 * first-run journey). It reads the packs once when first shown with an idle controller and
 * cancels the controller when it is unmounted, exactly as the screen does.
 */
export function FirstRunTask({ controller, language, view = 'guided', intents = {} }: { controller: FirstRunController; language: Language; view?: View | undefined; intents?: FirstRunIntents | undefined }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => {
    if (controller.snapshot().kind === 'idle') void controller.load();
    return () => { controller.cancel(); };
  }, [controller]);
  return (
    <FirstRunText language={language}>
      <Body state={state} controller={controller} intents={intents} view={view} />
    </FirstRunText>
  );
}

export function FirstRunScreen({ controller, language, onLanguage, view = 'guided', stagesDone, intents = {} }: FirstRunScreenProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  // One read of the packs when first shown with an idle controller (reads only; the controller refuses a second load
  // while one is in flight). A controller left through Continue stays `left` until the parent unmounts this screen.
  // Unmounting cancels the controller: private data is hidden, an issued attempt stays pinned, nothing is published.
  useEffect(() => {
    if (controller.snapshot().kind === 'idle') void controller.load();
    return () => { controller.cancel(); };
  }, [controller]);
  return (
    <FirstRunText language={language}>
      <Shell language={language} onLanguage={onLanguage} steps={firstRunSteps(positionOf(state), stagesDone)}>
        <Body state={state} controller={controller} intents={intents} view={view} />
      </Shell>
    </FirstRunText>
  );
}
