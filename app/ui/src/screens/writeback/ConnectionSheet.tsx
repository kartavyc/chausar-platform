/**
 * One write connection's sheet: account details and link, its sign-in for writing, the read
 * switch, the write grants action by action, the sandbox test, and Disconnect with a confirm
 * step. A secret is typed only into a password field, read once on send, and cleared; it is
 * never kept in screen state and never shown back.
 */
import { useRef, useState, type FormEvent } from 'react';
import { KeyValue } from '../../parts/KeyValue';
import { useAct } from '../work/kit/reply.ts';
import { dayTime } from '../work/kit/format.ts';
import { pageStyles } from '../work/kit/Page';
import { changed, credentialStored, qualification, type Connection, type Qualification } from './contract.ts';
import { Button, Note, Refused, Section, fieldLabel, known, say, systemName, type WbProps } from './shared.tsx';
import s from './writeback.module.css';

/** Account details, the system and the link, as name and value pairs. */
export function accountPairs(p: WbProps, c: Connection) {
  const { w } = p;
  const link = c.link === null ? w['wb4.sheet.linkNone']
    : c.link.label === null ? w['wb4.sheet.linkUnnamed']
    : say(w, c.link.active ? 'wb4.sheet.linkActive' : 'wb4.sheet.linkPaused', { label: c.link.label });
  return [
    { name: w['wb4.sheet.system'], value: systemName(w, c.system) },
    { name: w['wb4.sheet.env'], value: w[`wb4.env.${c.environment}`] },
    ...Object.entries(c.account).map(([name, value]) => ({ name: fieldLabel(w, name), value })),
    { name: w['wb4.sheet.link'], value: link },
    ...(p.view === 'simple' ? [] : [{ name: w['wb4.sheet.created'], value: dayTime(c.createdAt, p.language) }]),
  ];
}

function CredentialBlock({ p, c, reload }: { p: WbProps; c: Connection; reload: () => void }) {
  const { w } = p;
  const act = useAct(p.rpc);
  const first = useRef<HTMLInputElement>(null);
  const second = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState<'saved' | 'removed' | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  const own = c.environment !== 'practice' && c.link === null && c.credentialShape !== 'none';
  const pair = c.credentialShape === 'pair';
  const idLabel = c.system === 'mail' ? w['wb4.cred.mailId'] : w['wb4.cred.pairId'];
  const secretLabel = c.system === 'mail' ? w['wb4.cred.mailSecret'] : w['wb4.cred.pairSecret'];
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const a = first.current?.value ?? '', b = second.current?.value ?? '';
    // Clear the fields at once: the secret leaves the screen with this request.
    if (first.current) first.current.value = '';
    if (second.current) second.current.value = '';
    setDone(null); setLocal(null);
    if (pair && a.includes(':')) { setLocal(w['wb4.cred.colon']); return; }
    const out = await act.run('writeback.credentials.set', { connectionId: c.id, secret: pair ? `${a}:${b}` : a }, credentialStored);
    if (out.ok) { setDone('saved'); reload(); }
  };
  const remove = async () => {
    setDone(null);
    const out = await act.run('writeback.credentials.remove', { connectionId: c.id }, credentialStored);
    if (out.ok) { setDone('removed'); reload(); }
  };
  return (
    <Section title={w['wb4.cred.title']}>
      <KeyValue pairs={[{ name: w['wb4.cred.state'], value: w[`wb4.cred.${c.credential}`] }]} onReceipt={p.openReceipt} />
      {c.environment === 'practice' ? <Note>{w['wb4.cred.practiceNote']}</Note>
        : c.link !== null ? <Note>{w['wb4.cred.linkedNote']}</Note>
        : c.credentialShape === 'none' ? <Note>{w['wb4.cred.noneNote']}</Note>
        : null}
      {own && p.admin && (
        <form className={s.form} onSubmit={e => void send(e)} data-part="credential" autoComplete="off">
          {pair ? (
            <>
              <label>{idLabel}<input ref={first} type="text" required autoComplete="off" spellCheck={false} maxLength={2000} /></label>
              <label>{secretLabel}<input ref={second} type="password" required autoComplete="new-password" maxLength={2000} /></label>
            </>
          ) : (
            <label>{w['wb4.cred.token']}<input ref={first} type="password" required autoComplete="new-password" maxLength={4096} /></label>
          )}
          {p.view !== 'simple' && <Note>{w['wb4.cred.desktop']}</Note>}
          <div className={pageStyles.actions}>
            <Button submit variant="quiet" disabled={act.busy}>{w['wb4.cred.save']}</Button>
            {(c.credential === 'stored' || c.credential === 'unreadable') && <Button variant="link" danger disabled={act.busy} onClick={() => void remove()}>{w['wb4.cred.remove']}</Button>}
          </div>
        </form>
      )}
      {done !== null && <Note>{w[done === 'saved' ? 'wb4.cred.saved' : 'wb4.cred.removed']}</Note>}
      {local !== null && <p className={pageStyles.refusal} role="alert">{local}</p>}
      <Refused w={w} code={act.refusal} />
    </Section>
  );
}

function ReadBlock({ p, c, reload }: { p: WbProps; c: Connection; reload: () => void }) {
  const { w } = p;
  const act = useAct(p.rpc);
  const saved = c.actions.filter(a => a.granted).map(a => a.action);
  const toggle = async (next: boolean) => {
    const out = await act.run('writeback.grant', { connectionId: c.id, read: next, write: saved }, changed);
    if (out.ok) reload();
  };
  return (
    <Section title={w['wb4.read.title']}>
      {p.admin ? (
        <div className={s.form}>
          <label className={s.check}>
            <input type="checkbox" checked={c.read} disabled={act.busy} onChange={e => void toggle(e.currentTarget.checked)} />
            {w['wb4.read.switch']}
          </label>
        </div>
      ) : <p>{c.read ? w['wb4.read.on'] : w['wb4.read.off']}</p>}
      <Refused w={w} code={act.refusal} />
    </Section>
  );
}

function GrantBlock({ p, c, reload }: { p: WbProps; c: Connection; reload: () => void }) {
  const { w, view } = p;
  const act = useAct(p.rpc);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(c.actions.filter(a => a.granted).map(a => a.action)));
  const [saved, setSaved] = useState(false);
  const flip = (action: string, on: boolean) => { setSaved(false); setChecked(prev => { const next = new Set(prev); if (on) next.add(action); else next.delete(action); return next; }); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const write = c.actions.filter(a => a.grantable && checked.has(a.action)).map(a => a.action);
    const out = await act.run('writeback.grant', { connectionId: c.id, write }, changed);
    if (out.ok) { setSaved(true); reload(); }
  };
  const meta = (a: Connection['actions'][number]) => {
    const parts: string[] = [];
    if (view !== 'simple') parts.push(w[`wb4.kind.${a.kind}`], w[`wb4.status.${a.status}`]);
    if (a.alwaysWaits) parts.push(w['wb4.grant.waits']);
    if (a.tier === 'prepare-only') parts.push(w['wb4.grant.prepareOnly']);
    else if (!a.grantable) parts.push(w['wb4.grant.notInstalled']);
    if (a.sandboxVerified) parts.push(w['wb4.grant.sandbox']);
    if (view === 'books') { parts.push(w[`wb4.qual.${a.qualification}`]); if (a.writeScore !== null) parts.push(a.writeScore); }
    return parts.join(' · ');
  };
  return (
    <Section title={w['wb4.grant.title']}>
      {view !== 'simple' && <Note>{w['wb4.grant.note']}</Note>}
      {c.actions.length === 0 ? <Note>{w['wb4.grant.none']}</Note> : (
        <form className={s.form} onSubmit={e => void save(e)} data-part="grants">
          <ul className={s.grants}>
            {c.actions.map(a => (
              <li key={a.action} className={s.grant} data-action={a.action} data-grantable={a.grantable ? 'yes' : 'no'}>
                <label className={s.check}>
                  <input type="checkbox" name={a.action} checked={a.grantable && checked.has(a.action)} disabled={!p.admin || !a.grantable || act.busy}
                    onChange={e => flip(a.action, e.currentTarget.checked)} />
                  {a.title}
                </label>
                <p className={s.meta}>{meta(a)}</p>
              </li>
            ))}
          </ul>
          {p.admin && <div className={pageStyles.actions}><Button submit variant="filled" disabled={act.busy}>{w['wb4.grant.save']}</Button></div>}
        </form>
      )}
      {saved && <Note>{w['wb4.grant.saved']}</Note>}
      <Refused w={w} code={act.refusal} />
    </Section>
  );
}

function QualifyBlock({ p, c, reload }: { p: WbProps; c: Connection; reload: () => void }) {
  const { w, view } = p;
  const act = useAct(p.rpc);
  const [cases, setCases] = useState<Readonly<Record<string, string>>>({});
  const [result, setResult] = useState<Qualification | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  const granted = c.actions.filter(a => a.granted && a.grantable);
  const title = (action: string) => c.actions.find(a => a.action === action)?.title ?? action;
  const why = c.environment !== 'sandbox' ? w['wb4.q.needSandbox']
    : !['stored', 'linked', 'not-needed'].includes(c.credential) ? w['wb4.q.needKey']
    : granted.length === 0 ? w['wb4.q.needGrant'] : null;
  const filled = granted.filter(a => (cases[a.action] ?? '').trim() !== '');
  const run = async (event: FormEvent) => {
    event.preventDefault();
    setLocal(null); setResult(null);
    const list: { action: string; payload: Record<string, unknown> }[] = [];
    for (const a of filled) {
      let payload: unknown;
      try { payload = JSON.parse(cases[a.action] ?? ''); } catch { payload = undefined; }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) { setLocal(say(w, 'wb4.q.badJson', { action: a.title })); return; }
      list.push({ action: a.action, payload: payload as Record<string, unknown> });
    }
    const out = await act.run('writeback.qualifySandbox', { connectionId: c.id, cases: list }, qualification);
    if (out.ok) { setResult(out.value); reload(); }
  };
  return (
    <Section title={w['wb4.q.title']}>
      {view !== 'simple' && <Note>{w['wb4.q.explain']}</Note>}
      {why !== null ? <Note>{why}</Note> : p.admin && (
        <form className={s.form} onSubmit={e => void run(e)} data-part="qualify">
          {view === 'books'
            ? granted.map(a => (
              <label key={a.action}>{say(w, 'wb4.q.case', { action: a.title })}
                <textarea className={s.mono} rows={4} spellCheck={false} value={cases[a.action] ?? ''}
                  onChange={e => { const v = e.currentTarget.value; setCases(prev => ({ ...prev, [a.action]: v })); }} />
              </label>
            ))
            : <Note>{w['wb4.q.casesInBooks']}</Note>}
          {filled.length > 0 && <div className={pageStyles.actions}><Button submit variant="quiet" disabled={act.busy}>{w['wb4.q.run']}</Button></div>}
        </form>
      )}
      {local !== null && <p className={pageStyles.refusal} role="alert">{local}</p>}
      <Refused w={w} code={act.refusal} />
      {result !== null && (
        <ul className={s.grants} data-part="qualify-result">
          {result.rows.map(r => (
            <li key={r.action} className={s.grant}>
              <span>{title(r.action)} · {say(w, 'wb4.q.score', { score: r.score })}</span>
              {r.checks.map(x => (
                <span key={x.name} className={s.meta}>{known(w, `wb4.q.check.${x.name}`) ?? x.name}: {x.passed ? w['wb4.q.passed'] : w['wb4.q.failed']}</span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {view !== 'simple' && c.sandboxRuns.map(r => (
        <p key={`${r.action}-${r.at}`} className={s.meta}>{say(w, 'wb4.q.earlier', { action: title(r.action), score: r.score, date: dayTime(r.at, p.language) })}</p>
      ))}
    </Section>
  );
}

function DisconnectBlock({ p, c, onGone }: { p: WbProps; c: Connection; onGone: () => void }) {
  const { w } = p;
  const act = useAct(p.rpc);
  const [asking, setAsking] = useState(false);
  const go = async () => {
    const out = await act.run('writeback.disconnect', { connectionId: c.id }, changed);
    if (out.ok) onGone();
  };
  return (
    <div className={s.section} data-part="disconnect">
      {asking ? (
        <>
          <p>{say(w, 'wb4.disc.ask', { label: c.label })}</p>
          <div className={pageStyles.actions}>
            <Button variant="quiet" danger disabled={act.busy} onClick={() => void go()}>{w['wb4.disc.yes']}</Button>
            <Button variant="link" onClick={() => setAsking(false)}>{w['wb4.disc.no']}</Button>
          </div>
        </>
      ) : <div className={pageStyles.actions}><Button variant="quiet" danger onClick={() => setAsking(true)}>{w['wb4.disc.open']}</Button></div>}
      <Refused w={w} code={act.refusal} />
    </div>
  );
}

export function ConnectionBody({ p, c, reload, onGone }: { p: WbProps; c: Connection; reload: () => void; onGone: () => void }) {
  return (
    <div className={s.pane} data-connection={c.id}>
      <KeyValue pairs={accountPairs(p, c)} onReceipt={p.openReceipt} />
      <CredentialBlock p={p} c={c} reload={reload} />
      <ReadBlock p={p} c={c} reload={reload} />
      <GrantBlock p={p} c={c} reload={reload} />
      <QualifyBlock p={p} c={c} reload={reload} />
      {p.admin && <DisconnectBlock p={p} c={c} onGone={onGone} />}
    </div>
  );
}
