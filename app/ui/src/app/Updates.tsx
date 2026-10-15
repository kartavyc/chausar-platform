/**
 * SH-08 Updates: a sheet body for the frame (and a block Trust, Vault may place). It shows the
 * version, the preview's expiry, the one sentence for the state, the steps in words while an
 * update runs, and Update only when the engine offered it and the host supplied the callback.
 * "Rolled back" offers Understood, which forgets the attempt. Nothing here calls the engine.
 */
import type { UpdatesReply } from '../bridge/todayx-contract.ts';
import { date } from '../format/dates.ts';
import { Button } from '../parts/Button';
import { State } from '../patterns/States';
import { useLanguage, useT } from './text';
import { updateOffered, updateSentence, updateSteps, type UpdateRun } from './updates-model.ts';
import s from './ShellSheets.module.css';

export interface UpdatesProps {
  /** The checked `todayx.updates` reply; null while it is read. */
  reply: UpdatesReply | null;
  run: UpdateRun;
  onUpdate?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
}

export function Updates({ reply, run, onUpdate, onDismiss }: UpdatesProps) {
  const t = useT();
  const language = useLanguage();
  if (reply === null) return <State state={{ kind: 'loading' }} />;
  if (reply.state === 'not-built') return <State state={{ kind: 'not-built', part: 'release' }} />;
  const sentence = updateSentence(reply, run);
  const steps = updateSteps(run);
  const offered = updateOffered(reply, run) && onUpdate !== undefined;
  return (
    <div className={s.stack} data-updates={reply.state}>
      {reply.version !== null && <p className={s.note}>{t('SH-08.version', { version: reply.version })}</p>}
      {reply.expiresAt !== null && <p className={s.note}>{t('SH-08.expires', { date: date(reply.expiresAt.slice(0, 10), 'short', language) })}</p>}
      {sentence !== null && <p className={s.p} role="status" data-update-sentence={sentence.key}>{t(sentence.key, sentence.values)}</p>}
      {steps.length > 0 && (
        <ol className={s.section} aria-label={t('SH-08.steps')}>
          {steps.map(step => (
            <li key={step.key} data-step-state={step.state} aria-current={step.state === 'now' ? 'step' : undefined}>
              {t(step.key)} · {t(`SH-08.step.${step.state}`)}
            </li>
          ))}
        </ol>
      )}
      {reply.state === 'ready' && !reply.canUpdate && run.phase === 'idle' && <p className={s.note}>{t('SH-08.owner-only')}</p>}
      <div className={s.actions}>
        {offered && <Button variant="filled" onClick={onUpdate}>{t('BTN.update')}</Button>}
        {reply.state === 'rolled-back' && reply.canUpdate && onDismiss !== undefined && run.phase === 'idle' && <Button onClick={onDismiss}>{t('SH-08.dismiss')}</Button>}
      </div>
    </div>
  );
}
