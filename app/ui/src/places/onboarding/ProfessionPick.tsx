import { useId, useState } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { FamilyLite } from '../../engine/types';
import { Button } from '../../parts/Button';
import f from './FirstRun.module.css';
import s from './ProfessionPick.module.css';

/**
 * "Which of these are you?" (one-shot A5, founder answer 3a): between About you and the rules step of the first run.
 * The AI's read picked the owner's exact profession (a catalogue profession of the field, checked by the engine); it is
 * listed first and chosen, marked as taken from what the owner wrote, then the field's other professions in the
 * engine's order (venture.about.families), then "None of these". With no pick (a tile, or no AI) nothing is chosen and
 * Continue waits for one. onDone gets the profession's id, or the field's id for "None of these", which the rules step
 * reads as before (the field's own words, no profession rules). The list is the engine's; nothing here invents one.
 */
export function ProfessionPick({ family, picked, onDone }: {
  family: FamilyLite; picked: { id: string; label: string } | null; onDone: (professionId: string) => void;
}) {
  const t = useT();
  const headingId = useId();
  const noteId = useId();
  const name = useId();
  const families = useResource('venture.about.families', {});
  const [choice, setChoice] = useState<string | null>(picked?.id ?? null);
  const listed = families.data?.families.find((tile) => tile.id === family.id)?.professions ?? [];
  const rest = listed.filter((item) => item.id !== picked?.id);
  const options = picked ? [picked, ...rest] : rest;

  return (
    <section className={f.wrap} aria-labelledby={headingId}>
      <h1 id={headingId} className={f.title}>{t('first-run.who.title')}</h1>
      <p className={f.sub}>{t('first-run.who.sub')}</p>
      <fieldset className={s.choices} aria-labelledby={headingId}>
        {options.map((item) => (
          <label key={item.id} className={s.choice}>
            <input type="radio" name={name} value={item.id} checked={choice === item.id} onChange={() => setChoice(item.id)} />
            <span>{item.label}</span>
            {item.id === picked?.id && <span className={s.tag}>{t('first-run.who.picked')}</span>}
          </label>
        ))}
        <label className={s.choice}>
          <input type="radio" name={name} value={family.id} checked={choice === family.id} onChange={() => setChoice(family.id)} />
          <span>{t('first-run.who.none')}</span>
        </label>
        {families.error && <p className={f.problem} role="alert">{t('first-run.who.failed', { message: families.error.message })}</p>}
        <div className={s.buttons}>
          <Button variant="primary" locked={!choice} lockedReason={t('first-run.who.pickFirst')} lockedNoteId={noteId} onClick={() => { if (choice) onDone(choice); }}>{t('first-run.who.continue')}</Button>
        </div>
        {!choice && <p className={s.note} id={noteId}>{t('first-run.who.pickFirst')}</p>}
      </fieldset>
    </section>
  );
}
