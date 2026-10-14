/**
 * RP-06 Due dates: "Not yet checked by a CA." at the top with the table's note, then each date
 * with what is due, when, its official source as a link with the source's own date (and a
 * plain note when that source could not be checked), when it was last checked and which kind of
 * business, GST mode and state it applies to, in words. Every date and every word of a row comes
 * from the engine's published table in the language asked for; nothing here works one out. The
 * owner or a cofounder sets the small business profile. It works with no data connected.
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

const OTHER = '__other';
const KIND = /^[a-z][a-z0-9-]{1,40}$/;

export function DueDates({ language, view, member, viewer, rpc }: PlaceRenderProps) {
  const w = words(WORDS, language);
  const { state, reload } = useEngine(rpc, 'reportsx.due', { language }, validateDue);
  const admin = isAdmin(member, viewer);
  return (
    <Screen where={w.where} title={w.duedates} loaded={state}>
      {(due) => (
        <>
          <p className={s.say}>{due.caNote}</p>
          <p className={s.quiet}>{due.tableNote}</p>
          {view !== 'simple' && <p className={s.quiet}>{fill(w.tableVersion, { version: due.table.version, date: day(due.table.publishedAt, language) })}</p>}
          <Profile due={due} w={w} admin={admin} rpc={rpc} onSaved={reload} />
          {!due.covered && (
            <Group title={w.notCovered}>
              <Note>{fill(w.coveredKinds, { list: due.kinds.map((k) => k.name).join(', ') })}</Note>
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
                        <span className={s.quiet}>{fill(w.appliesKinds, { list: row.appliesToWords.kinds.join(', ') })}</span>
                        <span className={s.quiet}>{fill(w.appliesGst, { list: row.appliesToWords.gstModes.join(', ') })}</span>
                        <span className={s.quiet}>{fill(w.appliesStates, { list: row.appliesToWords.states.join(', ') })}</span>
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

function Profile({ due, w, admin, rpc, onSaved }: { due: Due; w: Words; admin: boolean; rpc: PlaceRenderProps['rpc']; onSaved: () => void }) {
  const current = due.profile;
  const known = current !== null && due.kinds.some((k) => k.id === current.kind);
  const [kind, setKind] = useState<string | null>(current === null ? null : known ? current.kind : OTHER);
  const [other, setOther] = useState(current !== null && !known ? current.kind : '');
  const [gstMode, setGstMode] = useState<GstMode | null>(current?.gstMode ?? null);
  const [code, setCode] = useState(current?.state ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const saver = useSend(rpc, validateDueProfile);

  if (!admin) {
    const shown = due.profileWords;
    return (
      <Group title={w.profile} note={w.profileReadOnly}>
        <Note>{shown === null ? w.noProfile : `${shown.kind} · ${shown.gstMode} · ${shown.state}`}</Note>
      </Group>
    );
  }
  const save = () => {
    const chosen = kind === OTHER ? other.trim() : kind ?? '';
    if (!KIND.test(chosen)) return setProblem(w.badKind);
    const profile: DueProfile | null = gstMode === null ? null : { kind: chosen, gstMode, state: code.trim().toUpperCase() };
    if (profile === null) return setProblem(w.badKind);
    if (!STATE_CODE.test(profile.state) || !due.states.some((x) => x.code === profile.state)) return setProblem(w.badState);
    setProblem(null);
    void saver.send('reportsx.setDueProfile', { ...profile }).then((r) => { if (r !== null) onSaved(); });
  };
  const stateName = due.states.find((x) => x.code === code.trim().toUpperCase())?.name;
  return (
    <Group title={w.profile} note={current === null ? w.noProfile : undefined}>
      <form className={s.stack} onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Choice<string> label={w.kind} options={[...due.kinds.map((k) => ({ value: k.id, label: k.name })), { value: OTHER, label: w.kindOther }]}
          value={kind} onChange={(v) => { setKind(v); setProblem(null); }} />
        {kind === OTHER && <Field label={w.kindOtherName} value={other} maxLength={41} onChange={(e) => setOther(e.currentTarget.value)} />}
        <Choice<GstMode> label={w.gstMode} options={GST_MODES.map((m) => ({ value: m, label: w[`gst.${m}`] }))} value={gstMode} onChange={setGstMode} />
        <Field label={w.stateCode} value={code} maxLength={2} autoCapitalize="characters" list="reports-states" onChange={(e) => setCode(e.currentTarget.value)} />
        <datalist id="reports-states">{due.states.map((x) => <option key={x.code} value={x.code} label={x.name} />)}</datalist>
        {stateName !== undefined && <p className={s.quiet}>{stateName}</p>}
        {problem !== null && <Note status>{problem}</Note>}
        {saver.sent.kind === 'refused' && <Note status>{refusal(saver.sent.code, w)}</Note>}
        {saver.sent.kind === 'done' && <Note status>{w.saved}</Note>}
        <div><Button submit disabled={saver.sent.kind === 'sending'}>{saver.sent.kind === 'sending' ? w.saving : w.save}</Button></div>
      </form>
    </Group>
  );
}
