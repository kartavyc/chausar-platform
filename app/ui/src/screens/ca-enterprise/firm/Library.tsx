/**
 * CA-07 The firm's library: recipes, ready-made jobs and checks the firm reuses across
 * clients. Structure only: the engine refuses a body that holds any client's values.
 * The body is typed as JSON and only checked here to be one object; export hands the
 * person the engine's own file.
 */
import { useState, type FormEvent } from 'react';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import { Choice } from '../../../parts/Choice';
import { Field } from '../../../parts/Field';
import {
  LIBRARY_KINDS, parseObject, validateLibrary, validateLibraryAdded, validateLibraryExport, validateLibraryRemoved, type LibraryKind,
} from './contract.ts';
import { AskTwice, Group, Outcome, Page, dayText, powers, saveFile, useRead, useSend, type P } from './kit';
import s from './Firm.module.css';

export function LibraryScreen({ p }: { p: P }) {
  const t = useT();
  const { change, admin } = powers(p);
  const { state, reload } = useRead(p, 'firm.library.list', {}, validateLibrary);
  const removed = useSend(p, validateLibraryRemoved);
  const exported = useSend(p, validateLibraryExport);
  const remove = async (id: string) => { if ((await removed.send('firm.library.remove', { id })) !== null) reload(); };
  const exportOne = async (id: string) => {
    const done = await exported.send('firm.library.export', { id });
    if (done !== null) saveFile(done.file.name, done.file.json, 'application/json');
  };
  return (
    <Page where={t('CAX-where.library')} title={t('CAX-library.title')} loaded={state} viewer={p.viewer}>
      {({ items }) => (
        <>
          <p className={s.quiet}>{t('CAX-library.rule')}</p>
          {items.length === 0 ? <p className={s.text}>{t('CAX-library.none')}</p> : (
            <ul className={s.list}>
              {items.map((item) => (
                <li key={item.id} className={s.item} data-item={item.id}>
                  <span className={s.itemHead}>
                    <span className={s.name}>{item.title}</span>
                    <span className={s.quiet}>{t(`CAX-libkind.${item.kind}`)}</span>
                    <span className={s.quiet}>{t('CAX-library.added', { date: dayText(item.addedAt, p.language) })}</span>
                  </span>
                  <span className={s.actions}>
                    <Button variant="link" onClick={() => void exportOne(item.id)}>{t('CAX-library.export')}</Button>
                    {admin && <AskTwice label={t('CAX-library.remove')} ask={t('CAX-library.removeAsk', { title: item.title })} confirm={t('CAX-library.removeYes')}
                      onConfirm={() => void remove(item.id)} disabled={removed.sent.kind === 'sending'} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Outcome sent={removed.sent} />
          <Outcome sent={exported.sent} />
          {change && <AddItem p={p} onAdded={reload} />}
        </>
      )}
    </Page>
  );
}

function AddItem({ p, onAdded }: { p: P; onAdded: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<LibraryKind>('recipe');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<{ title?: string; body?: string }>({});
  const added = useSend(p, validateLibraryAdded);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    const parsed = parseObject(body);
    const next: { title?: string; body?: string } = {};
    if (name.length === 0 || name.length > 120) next.title = t('CAX-library.needTitle');
    if (parsed === null) next.body = t('CAX-library.needBody');
    setProblem(next);
    if (next.title !== undefined || next.body !== undefined || parsed === null) return;
    const done = await added.send('firm.library.add', { kind, title: name, body: parsed });
    if (done !== null) { setTitle(''); setBody(''); onAdded(); }
  };
  return (
    <Group title={t('CAX-library.add')} note={t('CAX-library.addNote')}>
      <form className={s.stack} onSubmit={(e) => void submit(e)}>
        <Choice<LibraryKind> label={t('CAX-library.kind')} options={LIBRARY_KINDS.map((k) => ({ value: k, label: t(`CAX-libkind.${k}`) }))} value={kind} onChange={setKind} />
        <Field label={t('CAX-library.itemTitle')} value={title} onChange={(e) => setTitle(e.currentTarget.value)} problem={problem.title} autoComplete="off" />
        <label className={s.label}>
          {t('CAX-library.body')}
          <textarea className={s.textarea} value={body} onChange={(e) => setBody(e.currentTarget.value)} spellCheck={false} />
        </label>
        {problem.body !== undefined && <p className={s.problem} role="status">{problem.body}</p>}
        <span><Button submit disabled={added.sent.kind === 'sending'}>{t('CAX-library.addButton')}</Button></span>
      </form>
      {added.sent.kind === 'done' && <p className={s.text} role="status">{t('CAX-library.addedOne', { title: added.sent.value.item.title })}</p>}
      <Outcome sent={added.sent} />
    </Group>
  );
}
