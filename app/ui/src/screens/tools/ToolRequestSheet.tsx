/**
 * TL-07 A request from a connected tool: a sheet, kept apart from everything else, that
 * names the tool, shows its question as data and says what it will receive. It has no
 * field for a secret: the answer field is plain text and the sheet says never to type a
 * password or key here. The tool's words are text nodes; they change nothing.
 * A request that waits for approval (raised from Tools · Requests over models-ext's pending
 * list) has no answer field: it carries `approve`, which approves exactly what was shown.
 */
import { useState, type ReactNode } from 'react';
import type { Language } from '../../app/presentation.ts';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import { Names, Quoted, Warn, toolsWords } from './shared';
import s from './ToolRequestSheet.module.css';

export interface ToolRequestSheetProps {
  language: Language;
  /** The tool's name, as the engine names it. */
  tool: string;
  /** The tool's question, as sent. Data. */
  question: string;
  /** What the tool will receive if you answer, as the engine describes it. */
  receives: string | readonly string[];
  /** Absent for a viewer seat: then there is no answer field. */
  onAnswer?: ((text: string) => void) | undefined;
  /** Approve exactly this request (instead of an answer); absent when this seat cannot approve. */
  approve?: { readonly label: string; readonly onPress: () => void; readonly disabled: boolean } | undefined;
  /** Lines under the request: who prepared it, until when, what happened. */
  after?: ReactNode;
  onClose: () => void;
}

export function ToolRequestSheet({ language, tool, question, receives, onAnswer, approve, after, onClose }: ToolRequestSheetProps) {
  const w = toolsWords(language);
  const [text, setText] = useState('');
  return (
    <Sheet kind={w.requestKind} title={tool} origin={null} onClose={onClose}>
      <div className={s.body}>
        <div><h3 className={s.small}>{w.tool}</h3><p className={s.p}>{tool}</p></div>
        <div><h3 className={s.small}>{w.question}</h3><Quoted>{question}</Quoted></div>
        <div><h3 className={s.small}>{w.receives}</h3>{typeof receives === 'string' ? <Quoted>{receives}</Quoted> : <Names names={receives} w={w} />}</div>
        <Warn>{w.neverSecret}</Warn>
        {after}
        {approve !== undefined && (
          <div className={s.buttons}>
            <Button disabled={approve.disabled} onClick={approve.onPress}>{approve.label}</Button>
            <Button variant="link" onClick={onClose}>{w.notNow}</Button>
          </div>
        )}
        {approve === undefined && onAnswer !== undefined && (
          <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (text.trim() !== '') onAnswer(text); }}>
            <Field label={w.answer} type="text" autoComplete="off" spellCheck={false} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
            <div className={s.buttons}>
              <Button submit disabled={text.trim() === ''}>{w.sendAnswer}</Button>
              <Button variant="link" onClick={onClose}>{w.notNow}</Button>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}
