/**
 * FR-01 Welcome: the view as three small drawings, and whether there is a business or an
 * idea. The language is chosen in the top bar. Nothing is stored here: the language and
 * view live with the parent, in memory, until the vault exists.
 *
 * A workspace already open on this computer comes first ("Open <name>"). Otherwise the
 * workspace folders already on this computer (`todayx.workspaces`, names only) come first as
 * "Open <folder>", when the host can draw the lock screen for one. The demo shop and an
 * existing locked workspace open only through the parent's own callbacks.
 */

import { useId } from 'react';
import type { View } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { Act, Actions, Note, StepHeader } from './JourneyParts';
import s from './Journey.module.css';

const VIEWS: readonly View[] = ['simple', 'guided', 'books'];
const SKETCH: Readonly<Record<View, string>> = { simple: s.sketchSimple ?? '', guided: '', books: s.sketchBooks ?? '' };
const LINES: Readonly<Record<View, number>> = { simple: 2, guided: 3, books: 5 };

export interface WelcomeProps {
  readonly view: View;
  readonly onView: (view: View) => void;
  /** The workspace open now, if any: offered first. */
  readonly openWorkspace: string | null;
  readonly onOpen: () => void;
  readonly onBusiness: () => void;
  readonly onIdea: () => void;
  readonly onRecover: () => void;
  readonly onDemo?: (() => void) | undefined;
  /** Workspace folders already on this computer (names only, nothing decrypted). */
  readonly folders?: readonly string[] | undefined;
  /** Open one of them: the host draws its lock screen for that folder. */
  readonly onOpenFolder?: ((folder: string) => void) | undefined;
  /** FR-14: join a workspace that lives on another computer. */
  readonly onJoin?: (() => void) | undefined;
}

export function Welcome({ view, onView, openWorkspace, onOpen, onBusiness, onIdea, onRecover, onDemo, folders = [], onOpenFolder, onJoin }: WelcomeProps) {
  const t = useT();
  const name = useId();
  const legend = useId();
  return (
    <section data-first-run-screen="welcome">
      <StepHeader step={1} title="FR-01.title" lede="FR-01.lede" />
      {openWorkspace !== null && (
        <Actions><Act variant="filled" label="FR-01.open.btn" values={{ name: openWorkspace }} onClick={onOpen} /></Actions>
      )}
      {openWorkspace === null && onOpenFolder !== undefined && folders.length > 0 && (
        <div data-welcome-folders="">
          <Actions>{folders.map((folder, index) => <Act key={folder} variant={index === 0 ? 'filled' : 'quiet'} label="FR-01.open.btn" values={{ name: folder }} onClick={() => onOpenFolder(folder)} />)}</Actions>
          <Note k="FR-01.folders.note" />
        </div>
      )}
      <fieldset className={s.drawings} aria-labelledby={legend}>
        <legend id={legend} className={s.sectionTitle}>{t('FR-01.view')}</legend>
        {VIEWS.map(option => (
          <label key={option} className={[s.drawing, option === view ? s.drawingChosen : ''].filter(Boolean).join(' ')} data-view-drawing={option}>
            <span className={[s.sketch, SKETCH[option]].filter(Boolean).join(' ')} aria-hidden="true">
              {Array.from({ length: LINES[option] }, (_, index) => <span key={index} className={s.sketchLine} style={{ width: `${100 - index * 12}%` }} />)}
            </span>
            <span className={s.radioRow}>
              <input type="radio" name={name} value={option} checked={option === view} onChange={() => onView(option)} />
              <span className={s.drawingName}>{t(`SH-06.view.${option}`)}</span>
            </span>
            <span className={s.note}>{t(`FR-01.view.${option}.note`)}</span>
          </label>
        ))}
      </fieldset>
      <h2 className={s.sectionTitle} style={{ marginTop: 'var(--sp6)' }}>{t('FR-01.which')}</h2>
      <Actions>
        <Act variant={openWorkspace === null && (onOpenFolder === undefined || folders.length === 0) ? 'filled' : 'quiet'} label="FR-01.business.btn" onClick={onBusiness} />
        <Act label="FR-01.idea.btn" onClick={onIdea} />
      </Actions>
      <Actions>
        {onDemo !== undefined ? <Act variant="link" label="FR-01.demo.btn" onClick={onDemo} /> : <Note k="FR-01.demo.notBuilt" />}
        {openWorkspace === null && <Act variant="link" label="FR-01.recover.btn" onClick={onRecover} />}
        {openWorkspace === null && onJoin !== undefined && <Act variant="link" label="FR-14.join.btn" onClick={onJoin} />}
      </Actions>
      <Note k="FR-01.memory" />
    </section>
  );
}
