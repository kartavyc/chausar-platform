import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { refusalWords } from '../../parts/custody';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { TriagePreview, TriageRule } from '../../engine/types';
import s from './TodayActions.module.css';

/** How many of the dry run's rows the box names; the rest are counted. */
const DRY_RUN_ROWS = 5;

/**
 * W4 4J19 (O18): "Sort Today by". The owner writes how they want Today ordered; their own AI maps the words to a rule
 * over fixed fields (venture.triage.preview), or, with no AI, the fixed choices are offered. The engine answers a dry run
 * of today's rows in that order, which the box lists, and Save keeps the rule (venture.triage.set); Today's order uses
 * it from then on. A rule only orders: it never hides a row. The screen orders nothing itself.
 */
export function TriageBox({ onClose }: { onClose: () => void }) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<TriagePreview | null>(null);
  const [chosen, setChosen] = useState<TriageRule | null>(null);
  const [said, setSaid] = useState<{ line: string; problem?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function dryRun() {
    setBusy(true);
    setSaid(null);
    try {
      const next = await client.request('venture.triage.preview', { text: text.trim() });
      setPreview(next);
      setChosen(next.rule);
    } catch (error) {
      setSaid({ line: refusalWords(error, t), problem: true });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview || !chosen) return;
    setBusy(true);
    setSaid(null);
    try {
      const result = await client.request('venture.triage.set', { rule: chosen, digest: preview.digest });
      setSaid({ line: result.line });
      setPreview(null);
    } catch (error) {
      setSaid({ line: refusalWords(error, t), problem: true });
    } finally {
      setBusy(false);
    }
  }

  const rows = preview?.rows ?? [];
  return (
    <section className={s.box} aria-labelledby={headingId} data-triage="">
      <h3 id={headingId} className={s.boxHead}>{t('today.triage.title')}</h3>
      <form className={s.boxForm} onSubmit={(event) => { event.preventDefault(); if (text.trim()) void dryRun(); }}>
        <Field label={t('today.triage.label')} hint={t('today.triage.hint')} value={text} maxLength={200} onChange={(event) => setText(event.currentTarget.value)} autoFocus />
        <div className={s.boxButtons}>
          <Button type="submit" disabled={busy || !text.trim()}>{t('today.triage.try')}</Button>
        </div>
      </form>
      {preview && (
        <>
          {preview.by === 'choices' && (
            <fieldset className={s.choices} data-triage-choices="">
              <legend className={s.hint}>{t('today.triage.noAi')}</legend>
              {preview.choices.map((choice) => (
                <label key={choice.words} className={s.choiceLabel}>
                  <input type="radio" name={headingId} checked={chosen?.words === choice.words} onChange={() => setChosen(choice)} />
                  <span>{choice.words}</span>
                </label>
              ))}
            </fieldset>
          )}
          {preview.rule && <p className={s.said} data-triage-rule="">{t('today.triage.rule', { words: preview.rule.words })}</p>}
          <div data-dry-run="">
            <p className={s.hint}>{preview.rule ? t('today.triage.dryRun') : t('today.triage.now')}</p>
            <ol className={s.dryRun}>
              {rows.slice(0, DRY_RUN_ROWS).map((row) => <li key={row.id}>{row.title}</li>)}
            </ol>
            {rows.length > DRY_RUN_ROWS && <p className={s.hint}>{t('today.triage.more', { count: String(rows.length - DRY_RUN_ROWS) })}</p>}
            <p className={s.hint}>{t('today.triage.nothingHidden')}</p>
          </div>
        </>
      )}
      {said && <p className={said.problem ? s.problem : s.said} role="status">{said.line}</p>}
      <div className={s.boxButtons}>
        <Button onClick={onClose}>{t('today.triage.close')}</Button>
        {preview && (
          <Button variant="primary" disabled={busy} locked={!chosen} lockedReason={t('today.triage.pickFirst')} onClick={() => { if (chosen) void save(); }}>
            {t('today.triage.save')}
          </Button>
        )}
      </div>
    </section>
  );
}
