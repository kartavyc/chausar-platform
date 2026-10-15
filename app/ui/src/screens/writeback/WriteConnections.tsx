/**
 * Write connections (WK-06, "write status is shown apart from read status"): the systems
 * Chausar may write to, each with its account details, its link to a read connection, its own
 * sign-in, the actions granted one by one, and the sandbox test. A row opens its sheet through
 * the address's `sheet` (the connection id). Nothing here computes a figure.
 */
import { useRef, useState, type FormEvent } from 'react';
import { Sheet } from '../../parts/Sheet';
import { useAct, useReply } from '../work/kit/reply.ts';
import { pageStyles } from '../work/kit/Page';
import { ENVIRONMENTS, changed, overview, type Connection, type Environment, type Overview, type SystemId } from './contract.ts';
import { Button, Frame, Note, Refused, dense, fieldLabel, say, systemName, type WbProps } from './shared.tsx';
import { ConnectionBody } from './ConnectionSheet.tsx';
import s from './writeback.module.css';

type Column = 'label' | 'system' | 'env' | 'read' | 'credential' | 'grants';
const COLUMNS: Readonly<Record<WbProps['view'], readonly Column[]>> = {
  simple: ['label', 'system', 'credential'],
  guided: ['label', 'system', 'env', 'credential', 'grants'],
  books: ['label', 'system', 'env', 'read', 'credential', 'grants'],
};
const HEAD: Readonly<Record<Column, 'wb4.col.label' | 'wb4.col.system' | 'wb4.col.env' | 'wb4.col.read' | 'wb4.col.credential' | 'wb4.col.grants'>> = {
  label: 'wb4.col.label', system: 'wb4.col.system', env: 'wb4.col.env', read: 'wb4.col.read', credential: 'wb4.col.credential', grants: 'wb4.col.grants',
};

export function grantCount(p: WbProps, c: Connection): string {
  const grantable = c.actions.filter(a => a.grantable);
  return say(p.w, 'wb4.grants.count', { n: grantable.filter(a => a.granted).length, total: grantable.length });
}

function ConnectForm({ p, o, onDone }: { p: WbProps; o: Overview; onDone: (id: string) => void }) {
  const { w } = p;
  const act = useAct(p.rpc);
  const first = o.systems[0]?.system ?? 'mail';
  const environments: readonly Environment[] = o.demo ? ['practice'] : ENVIRONMENTS;
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState<SystemId>(first);
  const [label, setLabel] = useState('');
  const [blank, setBlank] = useState(false);
  const [environment, setEnvironment] = useState<Environment>(environments[0] ?? 'practice');
  const [account, setAccount] = useState<Record<string, string>>({});
  const [linkTo, setLinkTo] = useState('');
  const spec = o.systems.find(x => x.system === system);
  const linkable = environment === 'practice' ? [] : o.linkable.filter(l => l.system === system);
  if (!open) return <div className={pageStyles.actions}><Button variant="quiet" onClick={() => setOpen(true)}>{w['wb4.connect.open']}</Button></div>;
  const pickSystem = (next: string) => { const found = o.systems.find(x => x.system === next); if (found) { setSystem(found.system); setAccount({}); setLinkTo(''); } };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (label.trim() === '') { setBlank(true); return; }
    setBlank(false);
    const fields: Record<string, string> = {};
    for (const f of spec?.fields ?? []) { const v = (account[f.name] ?? '').trim(); if (v) fields[f.name] = v; }
    const link = linkable.some(l => l.id === linkTo) ? { linkTo } : {};
    const out = await act.run('writeback.connect', { system, label: label.trim(), environment, account: fields, ...link }, changed);
    if (out.ok) { setOpen(false); setLabel(''); setAccount({}); setLinkTo(''); onDone(out.value.id); }
  };
  return (
    <form className={s.form} onSubmit={e => void send(e)} aria-label={w['wb4.connect.title']}>
      <h2 className={s.h}>{w['wb4.connect.title']}</h2>
      <label>{w['wb4.connect.system']}
        <select value={system} onChange={e => pickSystem(e.currentTarget.value)}>
          {o.systems.map(x => <option key={x.system} value={x.system}>{systemName(w, x.system)}</option>)}
        </select>
      </label>
      <label>{w['wb4.connect.label']}<input value={label} required maxLength={100} onChange={e => setLabel(e.currentTarget.value)} /></label>
      {blank && <p role="alert">{w['wb4.connect.labelBlank']}</p>}
      <label>{w['wb4.connect.env']}
        <select value={environment} onChange={e => { const next = environments.find(x => x === e.currentTarget.value); if (next) { setEnvironment(next); if (next === 'practice') setLinkTo(''); } }}>
          {environments.map(x => <option key={x} value={x}>{w[`wb4.env.${x}`]}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>{w['wb4.connect.account']}</legend>
        {(spec?.fields.length ?? 0) === 0 && <Note>{w['wb4.connect.noFields']}</Note>}
        {spec?.fields.map(f => (
          <label key={f.name}>{f.required ? fieldLabel(w, f.name) : say(w, 'wb4.connect.optional', { name: fieldLabel(w, f.name) })}
            <input name={f.name} value={account[f.name] ?? ''} placeholder={f.example} required={f.required} maxLength={300} autoComplete="off"
              onChange={e => { const v = e.currentTarget.value; setAccount(a => ({ ...a, [f.name]: v })); }} />
          </label>
        ))}
      </fieldset>
      {linkable.length > 0 && (
        <label>{w['wb4.connect.link']}
          <select value={linkTo} onChange={e => setLinkTo(e.currentTarget.value)}>
            <option value="">{w['wb4.connect.linkNone']}</option>
            {linkable.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
      )}
      {p.view !== 'simple' && <Note>{w['wb4.connect.note']}</Note>}
      <div className={pageStyles.actions}>
        <Button submit variant="filled" disabled={act.busy}>{w['wb4.connect.send']}</Button>
        <Button variant="link" onClick={() => setOpen(false)}>{w['wb4.cancel']}</Button>
      </div>
      <Refused w={w} code={act.refusal} />
    </form>
  );
}

export function WritePage({ p }: { p: WbProps }) {
  const { w, view } = p;
  const { loaded, reload } = useReply(p.host, 'writeback.overview', {}, overview);
  const origin = useRef<HTMLElement | null>(null);
  const opened = p.address.sheet ?? null;
  const open = (c: Connection, el: HTMLElement) => { origin.current = el; p.navigate({ place: 'work', sub: 'write', sheet: c.id }); };
  const close = () => p.navigate({ place: 'work', sub: 'write' });
  const columns = COLUMNS[view];
  const cell = (c: Connection, k: Column) => {
    switch (k) {
      case 'label': return <button type="button" className={s.open} onClick={e => open(c, e.currentTarget)}>{c.label}</button>;
      case 'system': return systemName(w, c.system);
      case 'env': return w[`wb4.env.${c.environment}`];
      case 'read': return c.read ? w['wb4.read.on'] : w['wb4.read.off'];
      case 'credential': return w[`wb4.cred.${c.credential}`];
      case 'grants': return grantCount(p, c);
    }
  };
  return (
    <Frame p={p} title={w['wb4.write.title']} loaded={loaded} reload={reload} count={o => String(o.connections.length)}>
      {o => {
        const current = opened === null ? null : o.connections.find(c => c.id === opened) ?? null;
        return (
          <div className={s.split} data-open={opened !== null ? '' : undefined}>
            <div className={s.pane}>
              {view !== 'simple' && <Note>{w['wb4.apart']}</Note>}
              {o.demo && <Note>{w['wb4.demo']}</Note>}
              {o.connections.length === 0 ? <Note>{w['wb4.empty']}</Note> : (
                <table className={[pageStyles.table, dense(view)].join(' ')}>
                  <thead><tr>{columns.map(k => <th key={k} scope="col">{w[HEAD[k]]}</th>)}</tr></thead>
                  <tbody>{o.connections.map(c => <tr key={c.id} data-connection={c.id}>{columns.map(k => <td key={k}>{cell(c, k)}</td>)}</tr>)}</tbody>
                </table>
              )}
              {p.admin && <ConnectForm p={p} o={o} onDone={id => { reload(); p.navigate({ place: 'work', sub: 'write', sheet: id }); }} />}
            </div>
            {opened !== null && (
              <Sheet key={opened} kind={w['wb4.sheet.kind']} title={current?.label ?? w['wb4.sheet.kind']} onClose={close} origin={origin.current}>
                {current === null
                  ? <Note>{w['wb4.sheet.gone']}</Note>
                  : <ConnectionBody p={p} c={current} reload={reload} onGone={() => { reload(); close(); }} />}
              </Sheet>
            )}
          </div>
        );
      }}
    </Frame>
  );
}
