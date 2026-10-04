/**
 * FR-08 "Agree what your words mean" (picture S09): the title with how many are done,
 * one row per proposed meaning and one row for the proposed currency and GST mode,
 * each a hairline row of square, word, grey meaning, grey state and arrow. The grey
 * meaning on a closed row is the first words of the exact meaning, clearly truncated,
 * as many as the parent's view has room for (at least one in Simple); the open row shows the
 * whole exact text, the evidence ("none yet": the Engine supplies none here),
 * Accept (filled) and Change (quiet).
 * Change edits the plain-language meaning only: the editor holds the whole exact text,
 * the full meaning is not repeated beside it, and while it is open Save is the one filled
 * button and Publish is not offered. At the bottom: the pending calendar, ordering and
 * Today choices, that nothing has left this computer, and the one action the state
 * allows: Publish once everything is accepted, Read back after an unresolved result,
 * Continue after a verified publication.
 *
 * Every Accept, Save and Publish names the exact review it was rendered for (revision
 * and content digest); the controller refuses anything older. Continue names the exact
 * verified publication and the settings Change names the exact review revision; the
 * controller checks the live guard (and, for Continue, one fresh context) and cancels
 * itself before the parent's callback receives anything, so a retained old control
 * delivers nothing. Only a click on Accept accepts. Only a click on Publish publishes. No
 * effect, mount, selection or callback does either.
 *
 * Provenance is the text, not the acceptance: a meaning equal to what the pack proposed
 * is the Engine's own English and is marked `lang="en"`; a meaning the person wrote is
 * their own words with no language claim, whether or not it is accepted, and the pack's
 * original text stays inspectable behind a closed disclosure. Opening that disclosure
 * shows the exact original in place of the current meaning; closing it restores the
 * current meaning and its controls. The two full versions are never repeated together.
 */

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { PageHeader } from '../../app/PageHeader';
import type { View } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { Button } from '../../parts/Button';
import { Square } from '../../parts/Square';
import type { DictionaryDraft } from './contracts.ts';
import { meaningText } from './contracts.ts';
import { handoffPinOf } from './controller.ts';
import type { FirstRunController, FirstRunHandoff, FirstRunState, PublishedSummary, ReviewNotice } from './controller.ts';
import { acceptedRows, allReviewed, pinOf, rowAccepted, settingsAccepted, SETTINGS_ROW } from './review.ts';
import type { Review, ReviewPin, ReviewRow as ReviewRowData } from './review.ts';
import { Arrow, moveBetweenRows, PREVIEW_WORDS_BY_VIEW, previewOf } from './rows';
import s from './FirstRun.module.css';

export type MeaningsState = Extract<FirstRunState, { kind: 'review' | 'unknown' | 'published' }>;

export interface MeaningsIntents {
  readonly onContinue?: ((handoff: FirstRunHandoff) => void) | undefined;
  /** An explicit parent-owned settings journey. Without it the panel says the change is not available here. */
  readonly onChangeSettings?: ((draft: DictionaryDraft) => void) | undefined;
}

export interface MeaningsProps {
  state: MeaningsState;
  controller: FirstRunController;
  intents: MeaningsIntents;
  /** The parent's chosen view (FR-01). Presentational only: how many preview words a closed row has room for. */
  view: View;
}

function MeaningEditor({ initial, onSave, onDiscard }: { initial: string; onSave: (meaning: string) => void; onDiscard: () => void }) {
  const t = useT();
  const id = useId();
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState(false);
  const saveLabel = t('FR-08.edit.save');
  const discardLabel = t('FR-08.edit.discard');
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let checked: string;
    try { checked = meaningText(value); } catch { setProblem(true); return; }
    onSave(checked);
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDiscard(); }
  };
  return (
    <form className={s.editor} onSubmit={save}>
      <label htmlFor={id} className={s.editorLabel}>{t('FR-08.edit.label')}</label>
      <textarea
        id={id}
        className={s.textarea}
        rows={3}
        value={value}
        onChange={event => { setValue(event.currentTarget.value); setProblem(false); }}
        onKeyDown={onKey}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        autoFocus
      />
      {problem && <p id={`${id}-problem`} className={s.problem}>{t('FR-08.edit.problem')}</p>}
      <div className={s.actions}>
        <Button variant="link" onClick={onDiscard}>{discardLabel}</Button>
        <Button variant="filled" submit>{saveLabel}</Button>
      </div>
    </form>
  );
}

/** Optional detail behind a closed disclosure. The summary is a real control at the minimum target height. */
function Disclosure({ summary, children, testId, open, onToggle }: { summary: string; children: ReactNode; testId: string; open: boolean; onToggle: () => void }) {
  return (
    <details className={s.disclosure} data-first-run-disclosure={testId} open={open}>
      <summary className={[s.summary, s.detail].join(' ')} onClick={event => { event.preventDefault(); onToggle(); }}>{summary}</summary>
      {children}
    </details>
  );
}

interface RowShellProps {
  id: string;
  open: boolean;
  mark: 'wait' | 'you' | 'unsure';
  stateKey: string;
  word: string;
  /** Engine data is marked as English; an interface word is not. */
  wordLang?: 'en' | undefined;
  /** The grey meaning of a closed row: exact first words, or null for no preview. */
  preview: { readonly text: string; readonly lang: 'en' | undefined } | null;
  onToggle: () => void;
  mainRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}

function RowShell({ id, open, mark, stateKey, word, wordLang, preview, onToggle, mainRef, children }: RowShellProps) {
  const t = useT();
  const panelId = useId();
  return (
    <li className={[s.row, open ? s.open : ''].filter(Boolean).join(' ')} data-first-run-row="" data-row-id={id}>
      <div className={s.line}>
        <button ref={mainRef} type="button" className={s.main} data-row-main="" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={onToggle} onKeyDown={moveBetweenRows}>
          <Square mark={mark} wordsKey={stateKey} />
          <span className={s.word} lang={wordLang}>{word}</span>
          {preview !== null && !open && <span className={s.preview} lang={preview.lang} data-row-preview="">{preview.text}</span>}
          <span className={s.state} aria-hidden="true">{t(stateKey)}</span>
        </button>
        <span className={s.arrowSlot} aria-hidden="true"><Arrow open={open} /></span>
      </div>
      {open && <div id={panelId} className={s.panel}>{children}</div>}
    </li>
  );
}

interface ReviewRowProps {
  row: ReviewRowData;
  /** The pin every control of this render names, or null while the digest is being computed. */
  pin: ReviewPin | null;
  revision: string;
  previewWords: number;
  open: boolean;
  editing: boolean;
  /** After publication, during a publish, or after a departure the rows stay readable and offer no control. */
  readOnly: boolean;
  onToggle: () => void;
  onAccept: (pin: ReviewPin) => void;
  onStartEdit: () => void;
  onSave: (meaning: string, revision: string) => void;
  onDiscard: () => void;
}

function ReviewRow({ row, pin, revision, previewWords, open, editing, readOnly, onToggle, onAccept, onStartEdit, onSave, onDiscard }: ReviewRowProps) {
  const t = useT();
  const mainRef = useRef<HTMLButtonElement | null>(null);
  const [originalOpen, setOriginalOpen] = useState(false);
  useEffect(() => { setOriginalOpen(false); }, [revision, editing, open]);
  const accepted = rowAccepted(row);
  const stateKey = accepted ? 'FR-08.state.accepted' : row.status === 'changed' ? 'FR-08.state.changed' : 'FR-08.state.proposed';
  const definition = row.definition;
  /** Provenance is the text itself: the Engine's own English only while the meaning is exactly what the pack proposed. */
  const original = definition.meaning === row.proposed;
  const acceptLabel = t('FR-08.row.accept');
  const focusMain = () => mainRef.current?.focus();
  const preview = previewOf(definition.meaning, previewWords);
  return (
    <RowShell
      id={definition.name} open={open} mark={accepted ? 'you' : 'wait'} stateKey={stateKey} word={definition.label} wordLang="en"
      preview={preview === null ? null : { text: preview.text, lang: original ? 'en' : undefined }} onToggle={onToggle} mainRef={mainRef}
    >
      {editing && !readOnly ? (
        // The editor holds the whole exact current text; it is not repeated beside the field.
        <MeaningEditor key={revision} initial={definition.meaning} onSave={meaning => { onSave(meaning, revision); focusMain(); }} onDiscard={() => { onDiscard(); focusMain(); }} />
      ) : (
        <>
          {!original && !originalOpen && <p className={s.detail}>{t('FR-08.row.yourWords')}</p>}
          <p className={s.meaning} lang={original ? 'en' : undefined} data-origin={original ? 'engine' : 'changed'} hidden={!original && originalOpen}>{definition.meaning}</p>
          <p className={s.detail}>{t('FR-08.row.evidence')}</p>
        </>
      )}
      {!original && !editing && (
        <Disclosure summary={t('FR-08.row.proposedWas')} testId="original" open={originalOpen} onToggle={() => setOriginalOpen(value => !value)}>
          <p className={s.quote} lang="en" data-origin="engine">{row.proposed}</p>
        </Disclosure>
      )}
      {readOnly || editing || originalOpen ? null : (
        <div className={s.actions}>
          {!accepted && (pin === null
            ? <span className={s.detail}>{t('FR-08.row.checking')}</span>
            : <Button variant="filled" onClick={() => { onAccept(pin); focusMain(); }}>{acceptLabel}</Button>)}
          <Button variant="quiet" onClick={onStartEdit}>{t('BTN.change')}</Button>
        </div>
      )}
    </RowShell>
  );
}

interface SettingsRowProps {
  review: Review;
  pin: ReviewPin | null;
  current: PublishedSummary | null;
  open: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onAccept: (pin: ReviewPin) => void;
  /** The parent-owned change, already controller-checked for this exact revision. Null when the parent offers none. */
  onChangeSettings: ((revision: string) => void) | null;
}

function SettingsRow({ review, pin, current, open, readOnly, onToggle, onAccept, onChangeSettings }: SettingsRowProps) {
  const t = useT();
  const mainRef = useRef<HTMLButtonElement | null>(null);
  const accepted = settingsAccepted(review);
  const draft = review.draft;
  const acceptLabel = t('FR-08.row.accept');
  const focusMain = () => mainRef.current?.focus();
  return (
    <RowShell id={SETTINGS_ROW} open={open} mark={accepted ? 'you' : 'unsure'} stateKey={accepted ? 'FR-08.state.accepted' : 'FR-08.state.needsAnswer'} word={t('FR-08.settings.word')} preview={null} onToggle={onToggle} mainRef={mainRef}>
      <dl className={s.pairs}>
        <dt>{t('FR-08.settings.currency')}</dt>
        <dd className="fig" lang="en">{draft.currency}</dd>
        <dt>{t('FR-08.settings.gst')}</dt>
        <dd>{t(`FR-08.settings.gst.${draft.gstMode}`)}</dd>
      </dl>
      <p className={s.detail}>{current === null ? t('FR-08.settings.current.none') : t('FR-08.settings.current', { version: String(current.version), pack: current.label })}</p>
      {!readOnly && (
        <div className={s.actions}>
          {!accepted && (pin === null
            ? <span className={s.detail}>{t('FR-08.row.checking')}</span>
            : <Button variant="filled" onClick={() => { onAccept(pin); focusMain(); }}>{acceptLabel}</Button>)}
          {onChangeSettings !== null
            ? <Button variant="quiet" onClick={() => onChangeSettings(review.revision)}>{t('BTN.change')}</Button>
            : <span className={s.detail}>{t('FR-08.settings.blocked')}</span>}
        </div>
      )}
    </RowShell>
  );
}

function noticeText(t: (key: string, values?: Record<string, string>) => string, notice: ReviewNotice): string {
  if (notice.code === 'PUBLISH_REFUSED') return t('FR-08.notice.PUBLISH_REFUSED', { code: notice.engineCode ?? notice.code });
  if (notice.code === 'DIGEST_STALE') return t('FR-08.notice.DIGEST_STALE');
  if (notice.code === 'ALREADY_CURRENT') return t('FR-08.notice.ALREADY_CURRENT');
  if (notice.code === 'PUBLISH_NOT_COMMITTED') return t('FR-08.notice.PUBLISH_NOT_COMMITTED');
  return t('FR-08.notice.other', { code: notice.code });
}

export function Meanings({ state, controller, intents, view }: MeaningsProps) {
  const t = useT();
  const titleId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // React may batch Change and a retained Publish click before committing editingId.
  // Revoke that rendered Publish synchronously; ending an edit never revives its token.
  const editGate = useRef<{ epoch: number; revision: string | null }>({ epoch: 0, revision: null });
  const review: Review | null = state.kind === 'review' ? state.review : state.kind === 'published' ? state.review : null;
  const readOnly = state.kind !== 'review';
  const publishing = state.kind === 'review' && state.publishing;
  const mutable = !readOnly && !publishing;
  // An editor cannot outlive the state it was opened in: a publish in flight, a verified publication,
  // an unresolved result or a departure all end it, and its Save and Discard go with it.
  const revision = review?.revision ?? null;
  useEffect(() => {
    if (!mutable || editGate.current.revision !== revision) {
      if (editGate.current.revision !== null) editGate.current.epoch += 1;
      editGate.current.revision = null;
      setEditingId(null);
    }
  }, [mutable, revision]);
  useEffect(() => () => { editGate.current.epoch += 1; editGate.current.revision = null; }, []);
  const editing = mutable && editGate.current.revision === revision ? editingId : null;
  const pin = review === null ? null : pinOf(review);
  const previewWords = PREVIEW_WORDS_BY_VIEW[view];
  const label = state.kind === 'review' ? state.review.draft.label : state.kind === 'published' ? state.published.label : state.attempt === null ? null : state.attempt.label;
  // The where-line is the pack under review; the six steps above already say which step this is.
  const where = label === null ? t('FR.step', { step: '5', of: '6' }) : label;
  const endEdit = () => {
    editGate.current.epoch += 1;
    editGate.current.revision = null;
    setEditingId(null);
  };
  const startEdit = (id: string, renderedRevision: string) => {
    const current = controller.snapshot();
    if (current.kind !== 'review' || current.publishing || current.review.revision !== renderedRevision) return;
    editGate.current.epoch += 1;
    editGate.current.revision = renderedRevision;
    setEditingId(id);
  };
  const toggle = (id: string) => {
    if (editGate.current.revision !== null) endEdit();
    setOpenId(open => (open === id ? null : id));
  };
  const reviewedRows = review === null ? null : acceptedRows(review).length + (settingsAccepted(review) ? 1 : 0);
  const rowsToReview = review === null ? null : review.rows.length + 1;
  const publishLabel = t('FR-08.publish');
  const onChangeSettings = intents.onChangeSettings;
  /** The settings change is controller-checked for the exact rendered revision and cancels this screen before the parent runs. */
  const changeSettings = onChangeSettings === undefined ? null : (revision: string) => {
    const result = controller.leaveToSettings(revision);
    const draft = result.ok ? result.admit() : null;
    if (draft !== null) onChangeSettings(draft);
  };

  let status: string;
  let detail: string | null = null;
  let action: ReactNode = null;
  if (state.kind === 'review') {
    // While a meaning is being edited its Save is the one filled button, so Publish is not offered at all.
    const publishPin = mutable && editing === null && pin !== null && allReviewed(state.review) ? pin : null;
    const publishEpoch = editGate.current.epoch;
    status = publishing ? t('FR-08.publishing') : state.notice !== null ? noticeText(t, state.notice) : publishPin !== null ? '' : t('FR-08.footer.review');
    action = publishPin === null ? null : <Button variant="filled" onClick={() => {
      if (editGate.current.revision !== null || editGate.current.epoch !== publishEpoch) return;
      void controller.publishDictionary(publishPin);
    }}>{publishLabel}</Button>;
  } else if (state.kind === 'unknown') {
    status = state.reconciling ? t('FR-08.reconciling')
      : state.attempt === null ? t('FR-08.unknown.hidden')
      : state.code === 'READ_INVALIDATED' ? t('FR-08.unknown.left')
      : state.code === 'PUBLISH_UNATTRIBUTED' ? t('FR-08.unknown.PUBLISH_UNATTRIBUTED')
      : t('FR-08.unknown');
    detail = t('FR.code', { code: state.code });
    action = state.reconciling ? null : <Button variant="quiet" onClick={() => { void controller.reconcile(); }}>{t('FR-08.reconcile')}</Button>;
  } else {
    status = t('FR-08.published', { version: String(state.published.version) });
    detail = t('FR-08.published.hash', { hash: state.published.hash });
    const onContinue = intents.onContinue;
    // Continue names this exact publication; the controller checks the guard and a fresh context, cancels
    // itself, and only then is the parent given the handoff. A retained old button delivers nothing.
    const handoffPin = handoffPinOf(state);
    action = onContinue === undefined ? null : (
      <Button variant="quiet" onClick={() => { void controller.leave(handoffPin).then(result => {
        const handoff = result.ok ? result.admit() : null;
        if (handoff !== null) onContinue(handoff);
      }); }}>{t('BTN.continue')}</Button>
    );
  }

  return (
    <>
      <PageHeader
        where={where}
        title={t('FR-08.title')}
        titleId={titleId}
        count={reviewedRows === null || rowsToReview === null ? undefined : { exact: String(reviewedRows), display: t('FR-08.progress', { done: String(reviewedRows), of: String(rowsToReview) }) }}
        aside={mutable ? <Button variant="link" onClick={() => { controller.backToPacks(); }}>{t('FR-08.changePack')}</Button> : undefined}
      />
      {review !== null && (
        <ul className={s.rows} data-first-run-list="meanings" aria-labelledby={titleId}>
          {review.rows.map(row => (
            <ReviewRow
              key={`${review.generation}:${row.definition.name}`}
              row={row}
              pin={pin}
              revision={review.revision}
              previewWords={previewWords}
              open={openId === row.definition.name}
              editing={editing === row.definition.name}
              readOnly={!mutable}
              onToggle={() => toggle(row.definition.name)}
              onAccept={rendered => { controller.acceptRow(row.definition.name, rendered); }}
              onStartEdit={() => startEdit(row.definition.name, review.revision)}
              onSave={(meaning, revision) => { endEdit(); controller.changeMeaning(row.definition.name, meaning, revision); }}
              onDiscard={endEdit}
            />
          ))}
          <SettingsRow
            review={review}
            pin={pin}
            current={state.kind === 'review' ? state.current : null}
            open={openId === SETTINGS_ROW}
            readOnly={!mutable}
            onToggle={() => toggle(SETTINGS_ROW)}
            onAccept={rendered => { controller.acceptSettings(rendered); }}
            onChangeSettings={changeSettings}
          />
        </ul>
      )}
      <div className={s.footer}>
        <div className={s.lines}>
          <p role="status" aria-live="polite" className={s.status}>{status}</p>
          {detail !== null && <p className={[s.hash, 'fig'].join(' ')}>{detail}</p>}
          <p className={s.detail}>{t('FR-08.footer.calendar')}</p>
          <p className={s.detail}>{t('FR-08.footer.local')}</p>
        </div>
        {action}
      </div>
    </>
  );
}
