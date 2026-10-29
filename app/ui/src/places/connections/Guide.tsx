import {localizedBooksGuide} from './BooksGuide';
import {localizedPlaybookGuide} from './PlaybookGuide';
import { useId } from 'react';
import { useLanguage, useT } from '../../text';
import { Icon } from '../../parts/Icon';
import type { ConnectorGuideLite, ConnectorLadder } from '../../engine/types';
import s from './Connections.module.css';
import g from './Guide.module.css';

/** A day the engine sent ("2026-10-16") as the reader's calendar writes it, "16 Oct 2026". */
function dayOf(day: string, language: string): string {
  const at = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? day : new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(at);
}

/**
 * A connector's setup guide in its sheet (W4 4J21, from 4J7's build/guides.ts, catalogue K11), every line in the
 * engine's words: the numbered steps that ask for the least access the code uses (the engine numbers them), the step
 * people skip, what the platform charges (with the day the catalogue noted it, when it did), how Chausar checks access,
 * what it sends ("Sends: nothing, so ..."), and what the agents can and can't do. A connection set up part way names
 * its missing setting first.
 */
export function Guide({ guide: originalGuide, connectorId }: { guide: ConnectorGuideLite; connectorId?: string }) {
  const t = useT();
  const guide = localizedPlaybookGuide(t, connectorId, localizedBooksGuide(t, connectorId, originalGuide));
  const language = useLanguage();
  const headingId = useId();
  const stepsId = useId();
  return (
    <section className={s.sheetSection} aria-labelledby={headingId} data-guide-section="">
      <h3 id={headingId} className={s.sheetHeading}>{t('connections.guide.title')}</h3>
      {guide.missing && <p className={g.missing} role="note" data-guide="missing"><Icon name="triangle-alert" size={16} /><span>{guide.missing}</span></p>}
      <p id={stepsId} className="sr-only">{t('connections.guide.steps')}</p>
      <ol className={g.steps} aria-labelledby={stepsId}>
        {guide.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <p className={g.line} data-guide="skipped"><span className={g.label}>{t('connections.guide.skipped')}</span> {guide.skipped}</p>
      <p className={g.line} data-guide="charges">
        <span className={g.label}>{t('connections.guide.charges')}</span> {guide.charges.line}
        {guide.charges.checkedOn && <> {t('connections.guide.noted', { day: dayOf(guide.charges.checkedOn, language) })}</>}
      </p>
      <p className={g.line} data-guide="checks">{guide.checks}</p>
      <p className={g.line} data-guide="sends">{guide.sends}</p>
      <p className={g.line} data-guide="limits">{guide.agentLimits}</p>
    </section>
  );
}

/**
 * How far one mode is proven on this business (build/connector-truth.ts, K6), in plain words. "Documented" is only ever
 * a planned mode, whose Planned label already says it, so it adds no line.
 */
export function LadderWord({ ladder }: { ladder: ConnectorLadder | undefined }) {
  const t = useT();
  if (!ladder || ladder === 'documented') return null;
  return <p className={g.ladder} data-ladder={ladder}>{t(`connections.guide.ladder.${ladder}`)}</p>;
}
