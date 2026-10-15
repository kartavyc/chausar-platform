/**
 * Trust, Teams: the teams "My team" stands for in Whose. Each team has a name and its members.
 * Administrators change the whole list at once with `enterprise.teams.set`; members are chosen
 * from `enterprise.access.list` when this seat may read it, and are shown by id otherwise.
 */
import { useState } from 'react';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import type { PlaceRenderProps } from '../../../places/types.ts';
import { Frame, Note, Outcome, useWhere } from './Frame';
import { canChange, useRead, useSend } from './kit.ts';
import { validateAccess, validateTeams, type Team } from './validate.ts';
import s from './Enterprise.module.css';

type Draft = { readonly key: string; readonly id?: string; readonly name: string; readonly memberIds: readonly string[] };
const toDrafts = (teams: readonly Team[]): Draft[] => teams.map((x) => ({ key: x.id, id: x.id, name: x.name, memberIds: x.memberIds }));

export function TeamsScreen({ p }: { p: PlaceRenderProps }) {
  const t = useT();
  const where = useWhere();
  const teams = useRead(p, 'enterprise.teams.list', validateTeams);
  return (
    <Frame where={where('trust', 'teams')} title={t('SH-01.sub.trust.teams')} loaded={teams.state}>
      {({ teams: list }) => <TeamsBody p={p} teams={list} onSaved={(v) => teams.replace(v)} />}
    </Frame>
  );
}

function TeamsBody({ p, teams, onSaved }: { p: PlaceRenderProps; teams: readonly Team[]; onSaved: (v: { teams: Team[] }) => void }) {
  const t = useT();
  const edit = canChange(p);
  const people = useRead(p, 'enterprise.access.list', validateAccess);
  const names = new Map(people.state.kind === 'ready' ? people.state.value.people.map((x) => [x.memberId, x.name] as const) : []);
  const [drafts, setDrafts] = useState<readonly Draft[]>(() => toDrafts(teams));
  const [problem, setProblem] = useState<string | null>(null);
  const { sent, send } = useSend(p.rpc, validateTeams);
  const change = (key: string, next: Partial<Draft>) => setDrafts((cur) => cur.map((d) => (d.key === key ? { ...d, ...next } : d)));
  const save = async () => {
    if (drafts.some((d) => d.name.trim().length === 0 || d.name.trim().length > 120)) { setProblem(t('ENX-teams.needName')); return; }
    setProblem(null);
    const payload = drafts.map((d) => ({ ...(d.id !== undefined ? { id: d.id } : {}), name: d.name.trim(), memberIds: [...d.memberIds] }));
    const done = await send('enterprise.teams.set', { teams: payload });
    if (done !== null && p.live(p.address)) { setDrafts(toDrafts(done.teams)); onSaved(done); }
  };
  const who = (id: string) => names.get(id) ?? id;
  if (!edit) {
    return (
      <>
        {teams.length === 0 ? <Note>{t('ENX-teams.none')}</Note> : (
          <ul className={s.list}>
            {teams.map((team) => (
              <li key={team.id} className={s.item} data-team={team.id}>
                <span className={s.name}>{team.name}</span>
                <span className={s.note}>{team.memberIds.length === 0 ? t('ENX-teams.noMembers') : team.memberIds.map(who).join(', ')}</span>
              </li>
            ))}
          </ul>
        )}
        <Note>{t('ENX-readOnly')}</Note>
      </>
    );
  }
  const choices = people.state.kind === 'ready' ? people.state.value.people.filter((x) => x.active) : [];
  return (
    <>
      <Note>{t('ENX-teams.intro')}</Note>
      {drafts.length === 0 && <Note>{t('ENX-teams.none')}</Note>}
      <ul className={s.list}>
        {drafts.map((d, i) => (
          <li key={d.key} className={s.item} data-team={d.id ?? `new-${i}`}>
            <Field label={t('ENX-teams.name')} value={d.name} onChange={(e) => change(d.key, { name: e.currentTarget.value })} autoComplete="off" />
            {choices.length > 0 ? (
              <fieldset className={s.checks}>
                <legend>{t('ENX-teams.members')}</legend>
                {choices.map((m) => (
                  <label key={m.memberId} className={s.check}>
                    <input type="checkbox" checked={d.memberIds.includes(m.memberId)}
                      onChange={(e) => { const on = e.currentTarget.checked; change(d.key, { memberIds: on ? [...d.memberIds.filter((x) => x !== m.memberId), m.memberId] : d.memberIds.filter((x) => x !== m.memberId) }); }} />
                    {m.name}
                  </label>
                ))}
              </fieldset>
            ) : (
              <span className={s.note}>{d.memberIds.length === 0 ? t('ENX-teams.noMembers') : d.memberIds.map(who).join(', ')}</span>
            )}
            <span><Button variant="link" onClick={() => setDrafts((cur) => cur.filter((x) => x.key !== d.key))}>{t('ENX-teams.remove', { name: d.name || t('ENX-teams.unnamed') })}</Button></span>
          </li>
        ))}
      </ul>
      <span className={s.line}>
        <Button variant="quiet" onClick={() => setDrafts((cur) => [...cur, { key: `new-${Date.now()}-${cur.length}`, name: '', memberIds: [] }])}>{t('ENX-teams.add')}</Button>
        <Button onClick={() => void save()} disabled={sent.kind === 'sending'}>{t('ENX-teams.save')}</Button>
      </span>
      {problem !== null && <p className={s.status} role="alert">{problem}</p>}
      <Outcome sent={sent} />
    </>
  );
}
