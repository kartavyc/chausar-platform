import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { saveTextFile } from '../../parts/custody';
import type { DeliveryLite, SocialCalendarFile } from '../../engine/types';
import s from './Work.module.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** The engine's answers that mean "this draft has no calendar file": the screen then shows nothing for it. */
const NO_CALENDAR = new Set(['CALENDAR_NOT_A_SOCIAL_DRAFT', 'CALENDAR_NO_SLOTS']);

/**
 * The calendar file (Ink v2 wave 2, 2F2, catalogue S1): for each content calendar draft the owner accepted or edited,
 * "Download the calendar file" saves the CSV the engine built from the approved draft (venture.social.calendar),
 * exactly as it came and under the name the engine gave it. The screen shows, in the engine's words, the posts it left
 * out (with their channel and words from the same answer, so nothing is joined from an older list), the posts that got
 * an apostrophe, the posts that are threads to post by hand, and where the draft and the plan differ. No file is built
 * here and no date is worked out here. A draft the engine says has no calendar shows nothing.
 */
export function CalendarFile({ drafts }: { drafts: DeliveryLite[] }) {
  const accepted = drafts.filter((draft) => !draft.practice && (draft.status === 'accepted' || draft.status === 'edited'));
  return <>{accepted.map((draft) => <DraftCalendar key={draft.id} draft={draft} />)}</>;
}

function DraftCalendar({ draft }: { draft: DeliveryLite }) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const listId = useId();
  const gapsId = useId();
  const file = useResource('venture.social.calendar', { runId: draft.id });
  const [fresh, setFresh] = useState<SocialCalendarFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (file.error && NO_CALENDAR.has(file.error.code)) return null;
  const shown = fresh ?? file.data;
  if (!shown && !file.error) return null;

  /** Asks the engine again on the owner's click, so the file saved is the file as it is now. */
  async function download() {
    setBusy(true);
    setNote(null);
    setProblem(null);
    try {
      const made = await client.request('venture.social.calendar', { runId: draft.id });
      setFresh(made);
      if (made.rows === 0) setNote(t('work.calendar.nothing'));
      else if (!saveTextFile(made.fileName, made.csv, 'text/csv')) setProblem(t('work.calendar.cantSave'));
    } catch (error) {
      setProblem(t('work.calendar.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  const failure = !shown && file.error ? t('work.calendar.failed', { message: file.error.message }) : null;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className={s.heading}>{t('work.calendar.heading')}</h2>
      {shown && (
        <>
          <p className={s.note}>
            {shown.rows === 0 ? t('work.calendar.empty') : t('work.calendar.rows', { count: String(shown.rows) })}{' '}
            <Button variant="quiet" disabled={busy} onClick={() => void download()}>{busy ? t('work.calendar.making') : t('work.calendar.download')}</Button>
          </p>
          {note && <p className={s.note} role="status">{note}</p>}
          {shown.defused.length > 0 && <p className={s.note}>{t('work.calendar.defused', { count: String(shown.defused.length) })}</p>}
          {shown.threads.length > 0 && <p className={s.note}>{t('work.calendar.threads', { count: String(shown.threads.length) })}</p>}
          {shown.gaps.length > 0 && (
            <>
              <p id={gapsId} className={s.note}>{t('work.calendar.gaps')}</p>
              <ul className={s.files} aria-labelledby={gapsId}>
                {shown.gaps.map((gap) => <li key={gap}>{gap}</li>)}
              </ul>
            </>
          )}
          {shown.blocked.length > 0 && (
            <>
              <p id={listId} className={s.note}>{t('work.calendar.blocked')}</p>
              <ul className={s.list} aria-labelledby={listId}>
                {shown.blocked.map((item) => (
                  <li key={item.draftId} className={s.item} data-row="" data-row-id={`calendar-${item.draftId}`} tabIndex={-1}>
                    <span className={s.who}>{item.name}</span>
                    <span className={s.what}>{item.text}</span>
                    <div className={s.tail}><span className={s.state}>{item.line}</span></div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {(problem ?? failure) && <p className={s.problem} role="alert">{problem ?? failure}</p>}
    </section>
  );
}
