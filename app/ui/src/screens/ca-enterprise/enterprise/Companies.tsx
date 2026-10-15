/**
 * Books, Companies (enterprise part 3, "Companies: the group and how it combines"): the group's
 * companies, which one is chosen (or All companies), and for administrators the group itself
 * (`enterprise.group.set`: each row a branch id and a name). Combined figures would show what
 * was removed between group companies; that elimination is not built, and the page says so.
 */
import { useState } from 'react';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import type { PlaceRenderProps } from '../../../places/types.ts';
import { Frame, Group, Note, Outcome, useWhere } from './Frame';
import { canChange, useRead, useSend } from './kit.ts';
import { validateCompanies, type Companies } from './validate.ts';
import s from './Enterprise.module.css';

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
type Row = { readonly key: string; readonly id: string; readonly name: string };

export function CompaniesScreen({ p }: { p: PlaceRenderProps }) {
  const t = useT();
  const where = useWhere();
  const { state, replace } = useRead(p, 'enterprise.companies', validateCompanies);
  const choose = useSend(p.rpc, validateCompanies);
  const pick = async (id: string) => { const done = await choose.send('enterprise.company.set', { id }); if (done !== null && p.live(p.address)) replace(done); };
  return (
    <Frame where={where('books', 'companies')} title={t('SH-01.sub.books.companies')} loaded={state}>
      {(group) => (
        <>
          <Group title={t('ENX-companies.group')}>
            {group.companies.length === 0 ? <Note>{t('ENX-companies.none')}</Note> : (
              <ul className={s.list}>
                {[...group.companies, { id: 'all', name: t('SH-06.companies.all') }].map((c) => (
                  <li key={c.id} className={s.item} data-company={c.id}>
                    <span className={s.itemHead}>
                      <span className={s.name}>{c.name}</span>
                      {c.id !== 'all' && p.view === 'books' && <span className={s.mono}>{c.id}</span>}
                      {group.chosen === c.id ? <span className={s.label}>{t('ENX-companies.chosen')}</span>
                        : <Button variant="link" onClick={() => void pick(c.id)} disabled={choose.sent.kind === 'sending'}>{t('ENX-companies.choose', { name: c.name })}</Button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Outcome sent={choose.sent} done={() => null} />
          </Group>
          <Group title={t('ENX-companies.combined')}>
            <Note>{t('ENX-companies.eliminations')}</Note>
          </Group>
          {canChange(p) && <GroupEditor p={p} group={group} onSaved={replace} />}
        </>
      )}
    </Frame>
  );
}

function GroupEditor({ p, group, onSaved }: { p: PlaceRenderProps; group: Companies; onSaved: (v: Companies) => void }) {
  const t = useT();
  const [rows, setRows] = useState<readonly Row[]>(() => group.companies.map((c) => ({ key: c.id, id: c.id, name: c.name })));
  const [problem, setProblem] = useState<string | null>(null);
  const { sent, send } = useSend(p.rpc, validateCompanies);
  const change = (key: string, next: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...next } : r)));
  const save = async () => {
    const clean = rows.map((r) => ({ id: r.id.trim(), name: r.name.trim() }));
    const ids = clean.map((r) => r.id);
    if (clean.length > 50 || clean.some((r) => !BRANCH.test(r.id) || r.id === 'all' || r.name.length === 0 || r.name.length > 120) || new Set(ids).size !== ids.length) {
      setProblem(t('ENX-companies.rowsProblem')); return;
    }
    setProblem(null);
    const done = await send('enterprise.group.set', { companies: clean });
    if (done !== null && p.live(p.address)) onSaved(done);
  };
  return (
    <Group title={t('ENX-companies.edit')} note={t('ENX-companies.editNote')}>
      <ul className={s.list}>
        {rows.map((r) => (
          <li key={r.key} className={s.item}>
            <span className={s.form}>
              <Field label={t('ENX-companies.branch')} value={r.id} onChange={(e) => change(r.key, { id: e.currentTarget.value })} autoComplete="off" />
              <Field label={t('ENX-companies.name')} value={r.name} onChange={(e) => change(r.key, { name: e.currentTarget.value })} autoComplete="off" />
              <Button variant="link" onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}>{t('ENX-companies.removeRow')}</Button>
            </span>
          </li>
        ))}
      </ul>
      <span className={s.line}>
        <Button variant="quiet" onClick={() => setRows((cur) => [...cur, { key: `new-${Date.now()}-${cur.length}`, id: '', name: '' }])} disabled={rows.length >= 50}>{t('ENX-companies.addRow')}</Button>
        <Button onClick={() => void save()} disabled={sent.kind === 'sending'}>{t('ENX-companies.save')}</Button>
      </span>
      {problem !== null && <p className={s.status} role="alert">{problem}</p>}
      <Outcome sent={sent} />
    </Group>
  );
}
