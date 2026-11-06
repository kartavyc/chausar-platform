import { useEffect, useId, useState, type FormEvent } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { EngineError, type AgentNoteView, type AgentView } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { chatRefresh, dayWords } from './chat';
import s from './Team.module.css';
import c from './AgentChat.module.css';

const never = () => false;
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The note being written: a new one (noteId null) or a correction of the note as the owner opened it (basedOn). */
type Draft = { noteId: string | null; text: string; basedOn: string | null };

/**
 * The Notes tab (W4 4B3; engine 4B2; catalogue A5): what this agent keeps from the owner's words, each with where it
 * came from, when it was saved and whom it is about. The owner adds a note, corrects one (a note that changed since it
 * was opened keeps the owner's draft on screen with the engine's words), and forgets one after reading what Forget
 * does (it erases the words, so it cannot be undone). Every change is a line with Undo while Undo can still apply; an
 * Undo the engine says erases the note (undoing its first change) asks first with the same words as Forget.
 */
export function AgentNotes({ agent }: { agent: AgentView }) {
  const t = useT();
  const language = useLanguage();
  const client = useEngine();
  const listId = useId();
  const changesId = useId();
  const notes = useResource('venture.agents.notes.list', { agent: agent.id }, { refreshOn: chatRefresh });
  const clients = useResource('venture.client.list', {}, { refreshOn: never });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  /** A change whose Undo erases the note, asked about once more. */
  const [erasing, setErasing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const data = notes.data;
  const alive = new Set((data?.notes ?? []).map((note) => note.id));

  // A correction whose note changed since: once the list is read again, the draft is based on the note as it is now,
  // so the owner's next Save is a correction of what they can see above it.
  useEffect(() => {
    if (!draft?.noteId || !data) return;
    const now = data.notes.find((note) => note.id === draft.noteId);
    if (now && now.hash !== draft.basedOn) setDraft((was) => (was ? { ...was, basedOn: now.hash } : was));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(work: () => Promise<unknown>, failed: string, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await work();
      after?.();
    } catch (error) {
      // NOTE_CHANGED: the engine's words say the draft is still here, and it is; the note above is now its latest words,
      // and saving again replaces them.
      setProblem(error instanceof EngineError && error.code === 'NOTE_CHANGED' ? `${error.message} ${t('team.notes.changedReplace')}` : t(failed, { message: messageOf(error) }));
    } finally {
      setBusy(false);
      notes.reload();
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || draft.text.trim() === '') return;
    const params = draft.noteId ? { agent: agent.id, noteId: draft.noteId, text: draft.text.trim(), basedOn: draft.basedOn ?? '' } : { agent: agent.id, text: draft.text.trim() };
    void act(() => client.request('venture.agents.notes.edit', params), 'team.notes.saveFailed', () => setDraft(null));
  }

  function undo(changeId: string) {
    return act(() => client.request('venture.agents.notes.undo', { agent: agent.id, changeId }), 'team.notes.undoFailed', () => setErasing(null));
  }

  const about = (note: AgentNoteView) => {
    if (note.scope === 'agent') return t('team.notes.scope.agent');
    const id = note.scope.slice('client:'.length);
    return t('team.notes.scope.client', { client: clients.data?.find((one) => one.id === id)?.name ?? id });
  };

  const form = (labelKey: string) => (
    <form className={c.noteForm} onSubmit={save}>
      <Field multiline label={t(labelKey)} value={draft?.text ?? ''} rows={3} onChange={(event) => { const text = event.currentTarget.value; setDraft((was) => (was ? { ...was, text } : was)); }} />
      <div className={c.actions}>
        <Button size="sm" onClick={() => { setDraft(null); setProblem(null); }} disabled={busy}>{t('team.notes.cancel')}</Button>
        <Button size="sm" variant="primary" type="submit" disabled={busy || !draft || draft.text.trim() === ''}>{t('team.notes.save')}</Button>
      </div>
    </form>
  );

  return (
    <>
      <section className={s.section} aria-labelledby={listId}>
        <h3 id={listId} className={s.small}>{t('team.notes.title', { name: agent.name })}</h3>
        {notes.error && <p className={s.failed}>{t('team.notes.failed', { message: notes.error.message })}</p>}
        {!data && !notes.error && <p className={s.quiet}>{t('team.notes.loading')}</p>}
        {data && <p className={c.used}>{t('team.notes.used', { used: data.usedChars, limit: data.limitChars })}</p>}
        {data && data.notes.length === 0 && <p className={s.quiet}>{t('team.notes.none', { name: agent.name })}</p>}
        {data && data.notes.length > 0 && (
          <ul className={c.notes} aria-labelledby={listId}>
            {data.notes.map((note) => (
              <li key={note.id} className={c.note} data-note={note.id}>
                <p className={c.noteText} data-content="">{note.text}</p>
                <p className={c.noteMeta}>{about(note)} · {t('team.notes.captured', { date: dayWords(note.captured, language) })}</p>
                <p className={c.noteSource} data-content="">{note.source}</p>
                {draft?.noteId === note.id ? form('team.notes.editLabel') : forgetting === note.id ? (
                  <div className={c.ask} role="group" aria-label={t('team.notes.forgetAsk')}>
                    <p>{data.forgetLine ?? t('team.notes.forgetAsk')}</p>
                    <div className={c.actions}>
                      <Button size="sm" onClick={() => setForgetting(null)} disabled={busy}>{t('team.notes.keep')}</Button>
                      <Button
                        size="sm" variant="primary" disabled={busy}
                        onClick={() => void act(() => client.request('venture.agents.notes.forget', { agent: agent.id, noteId: note.id }), 'team.notes.forgetFailed', () => setForgetting(null))}
                      >
                        {t('team.notes.forgetYes')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={c.noteActions}>
                    <Button size="sm" onClick={() => { setProblem(null); setForgetting(null); setDraft({ noteId: note.id, text: note.text, basedOn: note.hash }); }}>{t('team.notes.edit')}</Button>
                    <Button size="sm" onClick={() => { setProblem(null); setDraft(null); setForgetting(note.id); }}>{t('team.notes.forget')}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {draft && draft.noteId === null ? form('team.notes.newLabel') : (
          data && <Button size="sm" className={c.addNote} onClick={() => { setProblem(null); setForgetting(null); setDraft({ noteId: null, text: '', basedOn: null }); }}>{t('team.notes.add')}</Button>
        )}
        {problem && <p className={c.problem} role="alert">{problem}</p>}
      </section>

      {data && data.changes.length > 0 && (
        <section className={s.section} aria-labelledby={changesId}>
          <h3 id={changesId} className={s.small}>{t('team.notes.changes')}</h3>
          <ul className={c.changes} aria-labelledby={changesId}>
            {data.changes.map((change) => (
              <li key={change.id} className={c.change}>
                <span className={c.changeLine}>{change.line}</span>
                <span className={c.changeAt}>{dayWords(change.at, language)}</span>
                {change.undone
                  ? <span className={c.changeAt}>{t('team.notes.undone')}</span>
                  : alive.has(change.noteId) && erasing !== change.id && (
                    <Button
                      size="sm" variant="quiet" disabled={busy} aria-label={t('team.notes.undoNamed', { line: change.line })}
                      onClick={() => (change.erases ? setErasing(change.id) : void undo(change.id))}
                    >
                      {t('team.notes.undo')}
                    </Button>
                  )}
                {erasing === change.id && (
                  <div className={c.ask} role="group" aria-label={t('team.notes.undoAsk')}>
                    <p>{data.forgetLine ?? t('team.notes.undoAsk')}</p>
                    <div className={c.actions}>
                      <Button size="sm" onClick={() => setErasing(null)} disabled={busy}>{t('team.notes.keep')}</Button>
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => void undo(change.id)}>{t('team.notes.undoErase')}</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
