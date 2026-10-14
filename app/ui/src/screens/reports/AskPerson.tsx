/**
 * RP-08 Ask a person, a sheet of the exports page: a question, a receipt and a reason make one
 * file for the person's own accountant or CA. The receipt is picked from the person's saved
 * answers in Ask (`askx.saved`, only those whose receipt still opens), or typed as an id. The app
 * sends nothing. An accountant or CA seat can also open a question file made in this workspace
 * (`reportsx.questions`, `reportsx.openQuestion`); the file is shown as text, never as markup.
 */
import { useState } from 'react';
import type { Language } from '../../app/presentation.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import type { PlaceRenderProps } from '../../places/types.ts';
import { words } from '../../places/types.ts';
import { count } from '../../format/index.ts';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { Group, Note, screenState } from '../trust/kit/Screen';
import { day, refusal, when } from './shared';
import { SHEET_ID, validateAskPerson, validateOpenedQuestion, validateQuestionFiles, validateSaved, type SavedReceipt } from './validate.ts';
import { WORDS, fill, type Words } from './words.ts';
import s from './Reports.module.css';

const NONE = '__none';

export interface AskPersonSheetProps extends PlaceRenderProps { origin: HTMLElement | null; onClose: () => void }

export function AskPersonSheet({ language, member, viewer, rpc, origin, onClose }: AskPersonSheetProps) {
  const w = words(WORDS, language);
  const readOnly = viewer || member.role === 'viewer';
  const accountant = !viewer && member.role === 'accountant';
  return (
    <Sheet kind={w.exports} title={w.ask} onClose={onClose} origin={origin}>
      <div className={s.stack}>
        <Note>{w.askNote}</Note>
        <p className={s.say}>{w.sendsNothing}</p>
        {readOnly ? <Note>{w.askReadOnly}</Note> : <MakeFile w={w} language={language} rpc={rpc} />}
        {accountant && <OpenFile w={w} language={language} rpc={rpc} />}
      </div>
    </Sheet>
  );
}

function savedLabel(item: SavedReceipt, w: Words, language: Language): string {
  return fill(w.savedAnswer, { question: item.question ?? w.savedUntitled, date: day(item.savedAt.slice(0, 10), language) });
}

function MakeFile({ w, language, rpc }: { w: Words; language: Language; rpc: PlaceRenderProps['rpc'] }) {
  const [question, setQuestion] = useState('');
  const [picked, setPicked] = useState<string>(NONE);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const saved = useEngine(rpc, 'askx.saved', {}, validateSaved);
  const maker = useSend(rpc, validateAskPerson);
  const list = saved.state.kind === 'ready' ? saved.state.value : [];

  const make = () => {
    const q = question.trim(), r = reason.trim(), id = typed.trim().length > 0 ? typed.trim() : picked === NONE ? '' : picked;
    if (q.length === 0) return setProblem(w.needQuestion);
    if (r.length === 0) return setProblem(w.needReason);
    if (id.length > 0 && !SHEET_ID.test(id)) return setProblem(w.badReceipt);
    setProblem(null);
    void maker.send('reportsx.askPerson', id.length > 0 ? { question: q, reason: r, receiptId: id } : { question: q, reason: r });
  };

  return (
    <>
      <form className={s.stack} onSubmit={(e) => { e.preventDefault(); make(); }}>
        <Field label={w.question} value={question} maxLength={4000} onChange={(e) => setQuestion(e.currentTarget.value)} />
        {list.length > 0 && (
          <Choice<string> label={w.receiptPick} value={picked} onChange={(v) => { setPicked(v); setTyped(''); }}
            options={[{ value: NONE, label: w.receiptNone }, ...list.map((item) => ({ value: item.receiptId, label: savedLabel(item, w, language) }))]} />
        )}
        {saved.state.kind === 'ready' && list.length === 0 && <Note>{w.receiptsEmpty}</Note>}
        {saved.state.kind === 'not-built' && <Note>{w.receiptsNotBuilt}</Note>}
        {saved.state.kind === 'failed' && <Note>{fill(w.receiptsFailed, { code: saved.state.code })}</Note>}
        <Field label={list.length > 0 ? w.receiptTyped : w.receiptId} value={typed} maxLength={200} onChange={(e) => setTyped(e.currentTarget.value)} />
        <Field label={w.reason} value={reason} maxLength={2000} onChange={(e) => setReason(e.currentTarget.value)} />
        {problem !== null && <Note status>{problem}</Note>}
        {maker.sent.kind === 'refused' && <Note status>{refusal(maker.sent.code, w)}</Note>}
        <div><Button variant="filled" submit disabled={maker.sent.kind === 'sending'}>{maker.sent.kind === 'sending' ? w.making : w.make}</Button></div>
      </form>
      {maker.sent.kind === 'done' && (
        <div className={s.stack} role="status">
          <p className={s.say}>{fill(w.fileName, { name: maker.sent.value.file.name })}</p>
          <p className={[s.quiet, s.code].join(' ')}>{fill(w.checkNumber, { check: maker.sent.value.file.sha256 })}</p>
          <p className={s.quiet}>{w.sendsNothing}</p>
        </div>
      )}
    </>
  );
}

/** For an accountant or CA seat: the question files of this workspace, each opened as plain text. */
function OpenFile({ w, language, rpc }: { w: Words; language: Language; rpc: PlaceRenderProps['rpc'] }) {
  const files = useEngine(rpc, 'reportsx.questions', {}, validateQuestionFiles);
  const opener = useSend(rpc, validateOpenedQuestion);
  return (
    <Group title={w.openQuestion} note={w.questionFiles}>
      {files.state.kind === 'not-built' ? <Note>{w.questionFilesNotBuilt}</Note>
        : files.state.kind !== 'ready' ? <State state={screenState(files.state)} />
        : files.state.value.length === 0 ? <Note>{w.questionFilesNone}</Note> : (
          <ul className={s.items}>
            {files.state.value.map((file) => (
              <li key={file.name} className={s.item}>
                <span className={[s.itemText, s.code].join(' ')}>{fill(w.questionFileMade, { name: file.name, when: when(file.at, w, language) })}</span>
                <Button variant="link" disabled={opener.sent.kind === 'sending'} onClick={() => { void opener.send('reportsx.openQuestion', { name: file.name }); }}>{w.openFile}</Button>
              </li>
            ))}
          </ul>
        )}
      {opener.sent.kind === 'refused' && <Note status>{refusal(opener.sent.code, w)}</Note>}
      {opener.sent.kind === 'done' && (
        <section className={s.stack} aria-label={opener.sent.value.name}>
          <p className={s.say}>{fill(w.questionFileMade, { name: opener.sent.value.name, when: when(opener.sent.value.at, w, language) })}</p>
          <p className={s.quiet}>{`${fill(w.fileSize, { size: count(String(opener.sent.value.bytes)) })} · ${fill(w.checkNumber, { check: opener.sent.value.sha256 })}`}</p>
          <p className={s.quiet}>{w.questionFileNote}</p>
          <pre className={s.preview}>{opener.sent.value.text}</pre>
          <div><Button variant="link" onClick={opener.clear}>{w.questionFileClose}</Button></div>
        </section>
      )}
    </Group>
  );
}
