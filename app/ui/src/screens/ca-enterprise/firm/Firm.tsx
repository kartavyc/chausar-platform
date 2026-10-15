/**
 * The firm's own settings:
 *   CA-08 Who opens which client (trust/clientaccess): narrows which clients a person of the
 *         firm may open. A client's owner gives the seat; the firm cannot add itself to a client.
 *   CA-09 Invite a client (tools/invite): a name, then the one-time code (shown once) and the
 *         one-page guide to forward; clients invited and not joined.
 *   CA-11 The firm's name on reports (trust/firmname), and the plan's price, marked planned.
 */
import { useState, type FormEvent } from 'react';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import { Choice } from '../../../parts/Choice';
import { Field } from '../../../parts/Field';
import {
  validateAssigned, validateClientCode, validateClientsList, validateFirmSet, validateFirmStatus, validatePeople,
  type ClientCode, type ClientRow, type PersonRow,
} from './contract.ts';
import { Group, LoadedState, Outcome, Page, powers, useRead, useSend, type P } from './kit';
import { GuideShown } from './open';
import s from './Firm.module.css';

// ---------- CA-08 ----------

export function ClientAccessScreen({ p }: { p: P }) {
  const t = useT();
  const { admin } = powers(p);
  const people = useRead(p, 'firm.people.list', {}, validatePeople);
  const clients = useRead(p, 'clients.list', { filter: 'all', limit: 200 }, validateClientsList);
  return (
    <Page where={t('CAX-where.clientaccess')} title={t('CAX-access.title')} loaded={people.state} viewer={p.viewer}>
      {({ people: rows }) => (
        <>
          <p className={s.text}>{t('CAX-access.rule')}</p>
          {rows.length === 0 ? <p className={s.text}>{t('CAX-access.none')}</p> : (
            <ul className={s.list}>
              {rows.map((person) => (
                <PersonItem key={person.memberId} p={p} person={person} admin={admin}
                  clients={clients.state.kind === 'ready' ? clients.state.value.rows : null} onChanged={people.reload} />
              ))}
            </ul>
          )}
          {admin && clients.state.kind !== 'ready' && <LoadedState loaded={clients.state} />}
        </>
      )}
    </Page>
  );
}

type Scope = 'all' | 'chosen';

function PersonItem({ p, person, admin, clients, onChanged }: { p: P; person: PersonRow; admin: boolean; clients: ClientRow[] | null; onChanged: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState<Scope>(person.clients === '*' ? 'all' : 'chosen');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(person.clients === '*' ? [] : person.clients));
  const assigned = useSend(p, validateAssigned);
  const names = new Map((clients ?? []).map((c) => [c.clientId, c.name]));
  const summary = person.clients === '*' ? t('CAX-access.allClients')
    : person.clients.length === 0 ? t('CAX-access.noClients')
      : t('CAX-access.someClients', { clients: person.clients.map((id) => names.get(id) ?? id).join(', ') });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const done = await assigned.send('firm.people.assign', { memberId: person.memberId, clients: scope === 'all' ? '*' : [...chosen] });
    if (done !== null) { setEditing(false); onChanged(); }
  };
  return (
    <li className={s.item} data-member={person.memberId}>
      <span className={s.itemHead}><span className={s.name}>{person.name}</span><span className={s.quiet}>{person.role}</span></span>
      <span className={s.quiet}>{summary}</span>
      {admin && !editing && <span><Button variant="link" onClick={() => setEditing(true)}>{t('CAX-access.change')}</Button></span>}
      {admin && editing && (
        <form className={s.stack} onSubmit={(e) => void save(e)}>
          <Choice<Scope> label={t('CAX-access.mayOpen', { name: person.name })} options={[{ value: 'all', label: t('CAX-access.optAll') }, { value: 'chosen', label: t('CAX-access.optChosen') }]}
            value={scope} onChange={setScope} />
          {scope === 'chosen' && (clients === null ? <p className={s.quiet}>{t('CAX-access.noList')}</p> : (
            <ul className={s.plain}>
              {clients.map((c) => (
                <li key={c.clientId}>
                  <label className={s.checkLabel}>
                    <input type="checkbox" checked={chosen.has(c.clientId)} onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setChosen((prev) => { const next = new Set(prev); if (on) next.add(c.clientId); else next.delete(c.clientId); return next; });
                    }} />
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
          ))}
          <p className={s.quiet}>{t('CAX-access.narrows')}</p>
          <span className={s.actions}>
            <Button submit disabled={assigned.sent.kind === 'sending'}>{t('CAX-save')}</Button>
            <Button variant="link" onClick={() => setEditing(false)}>{t('CAX-cancel')}</Button>
          </span>
        </form>
      )}
      <Outcome sent={assigned.sent} />
    </li>
  );
}

// ---------- CA-09 ----------

export function InviteScreen({ p }: { p: P }) {
  const t = useT();
  const { admin } = powers(p);
  const { state, reload } = useRead(p, 'clients.list', { filter: 'all', limit: 200 }, validateClientsList);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const added = useSend(p, validateClientCode);
  const again = useSend(p, validateClientCode);
  const [shown, setShown] = useState<{ code: ClientCode; name: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typed = name.trim();
    if (typed.length === 0 || typed.length > 120) { setProblem(t('CAX-invite.needName')); return; }
    setProblem(undefined);
    const done = await added.send('clients.add', { name: typed });
    if (done !== null) { setShown({ code: done, name: typed }); setName(''); reload(); }
  };
  const sendAgain = async (row: ClientRow) => {
    const done = await again.send('clients.guide', { clientId: row.clientId });
    if (done !== null) setShown({ code: done, name: row.name });
  };
  const done = () => { setShown(null); added.clear(); again.clear(); };
  return (
    <Page where={t('CAX-where.invite')} title={t('CAX-invite.title')} loaded={state} viewer={p.viewer}>
      {(list) => {
        const waiting = list.rows.filter((r) => r.state === 'invited');
        return (
          <>
            <p className={s.quiet}>{t('CAX-invite.lead')}</p>
            {admin ? (
              shown === null ? (
                <form className={s.form} onSubmit={(e) => void submit(e)}>
                  <Field label={t('CAX-invite.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} problem={problem} autoComplete="off" />
                  <span><Button submit disabled={added.sent.kind === 'sending'}>{t('CAX-invite.make')}</Button></span>
                </form>
              ) : <GuideShown shown={shown.code} name={shown.name} onDone={done} />
            ) : <p className={s.quiet}>{t('CAX-adminOnly')}</p>}
            <Outcome sent={added.sent} />
            <Group title={t('CAX-invite.waiting')}>
              {waiting.length === 0 ? <p className={s.text}>{t('CAX-invite.noneWaiting')}</p> : (
                <ul className={s.list}>
                  {waiting.map((row) => (
                    <li key={row.clientId} className={s.item} data-client={row.clientId}>
                      <span className={s.itemHead}><span className={s.name}>{row.name}</span><span className={s.quiet}>{t('CA-01.invited')}</span></span>
                      {admin && shown === null && <span><Button variant="link" onClick={() => void sendAgain(row)} disabled={again.sent.kind === 'sending'}>{t('CA-01.guide')}</Button></span>}
                    </li>
                  ))}
                </ul>
              )}
              {list.nextCursor !== null && <p className={s.quiet}>{t('CAX-many.firstOnly')}</p>}
              <Outcome sent={again.sent} />
            </Group>
          </>
        );
      }}
    </Page>
  );
}

// ---------- CA-11 ----------

export function FirmNameScreen({ p }: { p: P }) {
  const t = useT();
  const { admin } = powers(p);
  const { state, reload } = useRead(p, 'firm.status', {}, validateFirmStatus);
  return (
    <Page where={t('CAX-where.firmname')} title={t('CAX-firmname.title')} loaded={state} viewer={p.viewer}>
      {({ firm }) => firm === null ? <LoadedState loaded={{ kind: 'not-firm' }} /> : (
        <>
          <dl className={s.facts}>
            <dt>{t('CAX-firmname.name')}</dt><dd>{firm.name}</dd>
            <dt>{t('CAX-firmname.report')}</dt><dd>{firm.reportName ?? t('CAX-firmname.sameAsName')}</dd>
            <dt>{t('CAX-firmname.price')}</dt><dd>{t('CAX-firmname.planned')}</dd>
          </dl>
          {admin ? <NameForm p={p} name={firm.name} reportName={firm.reportName} onSaved={reload} /> : <p className={s.quiet}>{t('CAX-adminOnly')}</p>}
        </>
      )}
    </Page>
  );
}

function NameForm({ p, name, reportName, onSaved }: { p: P; name: string; reportName: string | null; onSaved: () => void }) {
  const t = useT();
  const [firmName, setFirmName] = useState(name);
  const [onReports, setOnReports] = useState(reportName ?? '');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const saved = useSend(p, validateFirmSet);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typed = firmName.trim(), report = onReports.trim();
    if (typed.length === 0 || typed.length > 120 || report.length > 120) { setProblem(t('CAX-firmname.needName')); return; }
    setProblem(undefined);
    if ((await saved.send('firm.name.set', { name: typed, reportName: report.length === 0 ? null : report })) !== null) onSaved();
  };
  return (
    <form className={s.stack} onSubmit={(e) => void submit(e)}>
      <Field label={t('CAX-firmname.name')} value={firmName} onChange={(e) => setFirmName(e.currentTarget.value)} problem={problem} autoComplete="off" />
      <Field label={t('CAX-firmname.report')} value={onReports} onChange={(e) => setOnReports(e.currentTarget.value)} autoComplete="off" />
      <p className={s.quiet}>{t('CAX-firmname.reportNote')}</p>
      <span><Button submit disabled={saved.sent.kind === 'sending'}>{t('CAX-save')}</Button></span>
      {saved.sent.kind === 'done' && <p className={s.text} role="status">{t('CAX-firmname.saved')}</p>}
      <Outcome sent={saved.sent} />
    </form>
  );
}
