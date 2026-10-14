/**
 * RP-06 Due dates: "This table has not been checked by a CA yet." at the top, then each date
 * with what is due, when, its official source as a link with the source's own date (and a
 * plain note when that source could not be checked), when it was last checked and which kind of
 * business, GST mode and state it applies to. Every date comes from the engine's
 * published table; nothing here works one out. The owner or a cofounder sets the small
 * business profile. It works with no data connected.
 */
import { useState } from 'react';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import type { PlaceRenderProps } from '../../places/types.ts';
import { words } from '../../places/types.ts';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { Group, Note, Screen } from '../trust/kit/Screen';
import { day, isAdmin, refusal } from './shared';
import { GST_MODES, STATE_CODE, httpsUrl, validateDue, validateDueProfile, type DueDates as Due, type DueProfile, type GstMode } from './validate.ts';
import { WORDS, fill, type Words } from './words.ts';
import s from './Reports.module.css';

export function DueDates({ language, view, member, viewer, rpc }: PlaceRenderProps) {
  const w = words(WORDS, language);
  const { state, reload } = useEngine(rpc, 'reportsx.due', {}, validateDue);
  const admin = isAdmin(member, viewer);
  return (
    <Screen where={w.where} title={w.duedates} loaded={state}>
      {(due) => (
        <>
          <p className={s.say}>{w.caNote}</p>
          {view !== 'simple' && <p className={s.quiet}>{fill(w.tableVersion, { version: due.table.version, date: day(due.table.publishedAt, language) })}</p>}
          <Profile due={due} w={w} admin={admin} rpc={rpc} onSaved={reload} />
          {!due.covered && (
            <Group title={w.notCovered}>
              <Note>{fill(w.coveredKinds, { list: due.coveredKinds.join(', ') })}</Note>
            </Group>
          )}
          <Group title={w.duedates}>
            {due.rows.length === 0 ? <Note>{w.dueNone}</Note> : (
              <ul className={s.items}>
                {due.rows.map((row) => {
                  const href = httpsUrl(row.source.url);
                  return (
                    <li key={row.id} className={s.item}>
                      <span className={s.stack}>
                        <span className={s.itemText}>{row.what}</span>
                        <span className={s.quiet}>
                          {href !== null ? <a href={href} target="_blank" rel="noopener noreferrer">{row.source.title}</a> : <span>{row.source.title}</span>}
                          {' · '}{fill(w.lastChecked, { date: day(row.lastChecked, language) })}
                        </span>
                        <span className={s.quiet}>{row.source.date !== null ? fill(w.sourceDate, { date: day(row.source.date, language) }) : w.sourceUndated}</span>
                        {!row.source.confirmed && <span className={s.quiet}>{w.sourceUnconfirmed}</span>}
                        {row.checkOld && <span className={s.quiet}>{w.checkOld}</span>}
                        <span className={s.quiet}>{fill(w.appliesKinds, { list: row.appliesTo.kinds.join(', ') })}</span>
                        <span className={s.quiet}>{fill(w.appliesGst, { list: row.appliesTo.gstModes.map((m) => gstWord(m, w)).join(', ') })}</span>
                        <span className={s.quiet}>{fill(w.appliesStates, { list: row.appliesTo.states.join(', ') })}</span>
                        {view === 'books' && <span className={[s.quiet, s.code].join(' ')}>{row.id}</span>}
                      </span>
                      <span className={s.say}>{fill(w.dueOn, { date: day(row.dueOn, language) })}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Group>
        </>
      )}
    </Screen>
  );
}

function gstWord(mode: string, w: Words): string {
  return (GST_MODES as readonly string[]).includes(mode) ? w[`gst.${mode as GstMode}`] : mode;
}

function Profile({ due, w, admin, rpc, onSaved }: { due: Due; w: Words; admin: boolean; rpc: PlaceRenderProps['rpc']; onSaved: () => void }) {
  const [kind, setKind] = useState(due.profile?.kind ?? '');
  const [gstMode, setGstMode] = useState<GstMode | null>(due.profile?.gstMode ?? null);
  const [code, setCode] = useState(due.profile?.state ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const saver = useSend(rpc, validateDueProfile);
  const current = due.profile;

  if (!admin) {
    return (
      <Group title={w.profile} note={w.profileReadOnly}>
        <Note>{current === null ? w.noProfile : `${current.kind} · ${gstWord(current.gstMode, w)} · ${current.state}`}</Note>
      </Group>
    );
  }
  const save = () => {
    const profile: DueProfile | null = gstMode === null ? null : { kind: kind.trim(), gstMode, state: code.trim().toUpperCase() };
    if (profile === null || profile.kind.length === 0) return setProblem(w.badKind);
    if (!STATE_CODE.test(profile.state)) return setProblem(w.badState);
    setProblem(null);
    void saver.send('reportsx.setDueProfile', { ...profile }).then((r) => { if (r !== null) onSaved(); });
  };
  return (
    <Group title={w.profile} note={current === null ? w.noProfile : undefined}>
      <form className={s.stack} onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label={w.kind} value={kind} maxLength={100} list="reports-covered-kinds" onChange={(e) => setKind(e.currentTarget.value)} />
        <datalist id="reports-covered-kinds">{due.coveredKinds.map((k) => <option key={k} value={k} />)}</datalist>
        <Choice<GstMode> label={w.gstMode} options={GST_MODES.map((m) => ({ value: m, label: w[`gst.${m}`] }))} value={gstMode} onChange={setGstMode} />
        <Field label={w.stateCode} value={code} maxLength={2} autoCapitalize="characters" onChange={(e) => setCode(e.currentTarget.value)} />
        {problem !== null && <Note status>{problem}</Note>}
        {saver.sent.kind === 'refused' && <Note status>{refusal(saver.sent.code, w)}</Note>}
        {saver.sent.kind === 'done' && <Note status>{w.saved}</Note>}
        <div><Button submit disabled={saver.sent.kind === 'sending'}>{saver.sent.kind === 'sending' ? w.saving : w.save}</Button></div>
      </form>
    </Group>
  );
}
