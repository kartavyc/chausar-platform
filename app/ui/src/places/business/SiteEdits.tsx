import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { SiteEditLite } from '../../engine/types';
import { TileSection, messageOf } from './shared';
import s from './Business.module.css';

export type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string };

/** Past this many line pairs the diff stops looking for common lines and shows the old text out, the new text in. */
const MAX_CELLS = 250_000;

/**
 * The change as lines: what stayed, what went and what came in, by the longest run of lines both texts share. Text
 * work only; the engine holds the real before and after and their hashes.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  if (a.length * b.length > MAX_CELLS) return [...a.map((text) => ({ kind: 'removed' as const, text })), ...b.map((text) => ({ kind: 'added' as const, text }))];
  const width = b.length + 1;
  const common = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i * width + j] = a[i] === b[j] ? common[(i + 1) * width + j + 1]! + 1 : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i]! }); i++; j++; }
    else if (common[(i + 1) * width + j]! >= common[i * width + j + 1]!) { out.push({ kind: 'removed', text: a[i]! }); i++; }
    else { out.push({ kind: 'added', text: b[j]! }); j++; }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++]! });
  while (j < b.length) out.push({ kind: 'added', text: b[j++]! });
  return out;
}

/**
 * Edits to the website (venture.site.*): staged first, shown as a line diff, written only when the owner applies the
 * exact version reviewed (the edit's plan hash goes back as the reviewed hash), read back by the engine, and put back
 * with Revert. Writing and putting back each ask a second time. The engine has no list of edits yet, so this page
 * keeps the ones staged here until it closes.
 */
export function SiteEdits() {
  const t = useT();
  const client = useEngine();
  const [edits, setEdits] = useState<SiteEditLite[]>([]);
  const [staging, setStaging] = useState(false);
  const [path, setPath] = useState('');
  const [summary, setSummary] = useState('');
  const [after, setAfter] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function stage(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const edit = await client.request('venture.site.stage', { path: path.trim(), summary: summary.trim(), after });
      setEdits((now) => [edit, ...now.filter((e) => e.id !== edit.id)]);
      setStaging(false);
      setPath(''); setSummary(''); setAfter('');
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  const replace = (edit: SiteEditLite) => setEdits((now) => now.map((e) => (e.id === edit.id ? edit : e)));

  return (
    <TileSection title={t('business.site.title')}>
      <p className={s.line}>{t('business.site.line')}</p>
      {edits.length > 0 && (
        <ul className={s.steps}>
          {edits.map((edit) => <EditLine key={edit.id} edit={edit} onChanged={replace} />)}
        </ul>
      )}
      {staging ? (
        <form className={s.form} onSubmit={(event) => void stage(event)}>
          <Field label={t('business.site.path')} hint={t('business.site.pathHint')} value={path} maxLength={200} autoComplete="off" spellCheck={false} onChange={(event) => setPath(event.currentTarget.value)} />
          <Field label={t('business.site.summary')} value={summary} maxLength={200} onChange={(event) => setSummary(event.currentTarget.value)} />
          <Field multiline label={t('business.site.after')} hint={t('business.site.afterHint')} rows={6} spellCheck={false} value={after} onChange={(event) => setAfter(event.currentTarget.value)} />
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}>
            <Button variant="quiet" onClick={() => { setStaging(false); setProblem(null); }}>{t('approval.cancel')}</Button>
            <Button variant="primary" type="submit" disabled={busy}>{t('business.site.stageIt')}</Button>
          </div>
        </form>
      ) : (
        <div className={s.buttons}><Button size="sm" onClick={() => setStaging(true)}>{t('business.site.stage')}</Button></div>
      )}
    </TileSection>
  );
}

type Phase = 'idle' | 'confirm' | 'sending';

/** One staged edit: what it changes, the diff, then Apply or Revert, each asking twice, and the engine's log. */
function EditLine({ edit, onChanged }: { edit: SiteEditLite; onChanged: (edit: SiteEditLite) => void }) {
  const t = useT();
  const client = useEngine();
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (phase === 'confirm') cancelRef.current?.focus(); }, [phase]);
  const action = edit.state === 'staged' ? 'apply' : edit.state === 'applied' ? 'revert' : null;
  const diff = lineDiff(edit.before, edit.after);

  async function run(how: 'apply' | 'revert') {
    setPhase('sending');
    setProblem(null);
    try {
      const next = await client.request(how === 'apply' ? 'venture.site.apply' : 'venture.site.revert', { editId: edit.id, reviewedHash: edit.planDigest });
      onChanged(next);
    } catch (error) {
      setProblem(messageOf(error));
    }
    setPhase('idle');
  }

  return (
    <li className={s.step} data-row="" data-row-id={edit.id} data-second-ask="" tabIndex={-1} aria-labelledby={titleId}>
      <span id={titleId}>{edit.summary}</span>
      <span className={s.stepWho}><span className="mono">{edit.path}</span> · {t(`business.site.state.${edit.state}`)}</span>
      <div className={s.diff} role="group" aria-label={t('business.site.diff', { path: edit.path })}>
        {diff.map((line, i) => (line.kind === 'removed' ? (
          <del key={i} className={s.removed}><span className="sr-only">{t('business.site.removed')} </span>{line.text || ' '}</del>
        ) : line.kind === 'added' ? (
          <ins key={i} className={s.added}><span className="sr-only">{t('business.site.added')} </span>{line.text || ' '}</ins>
        ) : (
          <span key={i} className={s.same}>{line.text || ' '}</span>
        )))}
      </div>
      {edit.state !== 'staged' && edit.log.length > 0 && (
        <ul className={s.log}>
          {edit.log.map((entry, i) => <li key={`${entry.at}:${i}`}>{entry.line}</li>)}
        </ul>
      )}
      {action && phase === 'confirm' ? (
        <div className={s.form}>
          <p className={s.said}>{t(action === 'apply' ? 'business.site.applyAsk' : 'business.site.revertAsk', { path: edit.path })}</p>
          <div className={s.buttons}>
            <Button ref={cancelRef} onClick={() => setPhase('idle')}>{t('approval.cancel')}</Button>
            <Button variant="primary" data-confirm="" onClick={() => void run(action)}>{t(action === 'apply' ? 'business.site.applyConfirm' : 'business.site.revertConfirm')}</Button>
          </div>
        </div>
      ) : action ? (
        <div className={s.buttons}>
          <Button variant={action === 'apply' ? 'primary' : 'secondary'} disabled={phase === 'sending'} onClick={() => setPhase('confirm')}>
            {t(action === 'apply' ? 'business.site.apply' : 'business.site.revert')}
          </Button>
        </div>
      ) : null}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </li>
  );
}
