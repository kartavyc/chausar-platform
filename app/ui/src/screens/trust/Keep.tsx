/**
 * TR-04 Keep: how long each kind of data is kept (an admin changes it), and everything
 * the app writes to disk.
 */
import { useState, type FormEvent } from 'react';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note } from './kit/Screen';
import { Frame, Outcome, bytesText, countText, powers, type P } from './common';
import { wholeNumber } from './paise.ts';
import { validateKeep, type Keep } from './validate.ts';
import { COMMON, KEEP, fill } from './words.ts';
import s from './Trust.module.css';

export function KeepView({ p, mode, onChanged }: { p: P; mode: 'page' | 'sheet'; onChanged?: () => void }) {
  const c = words(COMMON, p.language);
  const { state, reload } = useEngine(p.rpc, 'trustx.keep', {}, validateKeep);
  return (
    <Frame p={p} mode={mode} where={c.whereRetention} title={mode === 'page' ? c.retention : c.keep} loaded={state}>
      {(keep) => <KeepBody p={p} keep={keep} reload={() => { reload(); onChanged?.(); }} />}
    </Frame>
  );
}

function KeepBody({ p, keep, reload }: { p: P; keep: Keep; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(KEEP, p.language);
  const { admin } = powers(p);
  return (
    <>
      <Group title={w.kindsTitle}>
        {keep.kinds.length === 0 ? <p className={s.quiet}>{w.kindsNone}</p> : (
          <ul className={s.list}>
            {keep.kinds.map((k) => (
              <li key={k.kind} className={s.item}>
                <span className={s.itemHead}><span className={s.name}>{k.kind}</span><span>{k.days === null ? w.until : fill(w.days, { days: countText(k.days) })}</span></span>
                {k.note.length > 0 && <span className={s.quiet}>{k.note}</span>}
                {admin && <KeepForm p={p} kind={k.kind} days={k.days} reload={reload} />}
              </li>
            ))}
          </ul>
        )}
        <Note>{admin ? w.daysHint : c.adminOnly}</Note>
      </Group>
      <Group title={w.inventoryTitle}>
        {keep.inventory.length === 0 ? <p className={s.quiet}>{w.inventoryNone}</p> : (
          <ul className={s.list}>
            {keep.inventory.map((f) => (
              <li key={f.path} className={s.item}>
                <span className={s.mono}>{f.path}</span>
                <span className={s.quiet}>{f.what} · {bytesText(f.bytes, p.language)}</span>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}

function KeepForm({ p, kind, days, reload }: { p: P; kind: string; days: number | null; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(KEEP, p.language);
  const [typed, setTyped] = useState(days === null ? '' : String(days));
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validateKeep);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = typed.trim() === '' ? null : wholeNumber(typed, 3650);
    if (value === 0 || (value === null && typed.trim() !== '')) { setProblem(w.badDays); return; }
    setProblem(undefined);
    if (await send('trustx.setKeep', { kind, days: value }) !== null && p.live(p.address)) reload();
  };
  return (
    <form className={s.form} onSubmit={(e) => void submit(e)}>
      <Field label={fill(w.daysField, { kind })} value={typed} onChange={(e) => setTyped(e.currentTarget.value)} inputMode="numeric" problem={problem} placeholder={w.until} />
      <Button submit disabled={sent.kind === 'sending'}>{c.save}</Button>
      <Outcome sent={sent} language={p.language} />
    </form>
  );
}
