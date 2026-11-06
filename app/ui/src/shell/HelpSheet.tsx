import { useState } from 'react';
import { useT } from '../text';
import { Sheet } from '../parts/Sheet';
import { Field } from '../parts/Field';
import { Button } from '../parts/Button';
import { openSheet } from './navigation';
import { GUIDE_URL, findGuide, guideLink, type GuideSection } from './help';
import type { SheetComponentProps } from './sheets';
import s from './sheets.module.css';

/**
 * C7 task 24: Help, from Chausar's own guide. A box, the sections that match (code only, findGuide), and the chosen
 * section's own words quoted as they are in the guide, with "Read it in the guide" opening that part of the guide's page.
 * When nothing matches it says so, with the guide's link and nothing else. What's new opens from here too.
 */
export function HelpSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [chosen, setChosen] = useState<GuideSection | null>(null);
  const found = asked === null ? [] : findGuide(asked);
  const shown = chosen ?? found[0] ?? null;
  return (
    <Sheet label={t('help.label')} title={t('help.title')} onClose={onClose} returnFocus={returnFocus}>
      <form className={s.helpForm} role="search" onSubmit={(event) => { event.preventDefault(); setAsked(question.trim() || null); setChosen(null); }}>
        <Field label={t('help.box')} value={question} maxLength={200} onChange={(event) => setQuestion(event.currentTarget.value)} />
        <Button type="submit" disabled={!question.trim()}>{t('help.find')}</Button>
      </form>
      {asked !== null && found.length === 0 && (
        <p className={s.helpLine} data-help-none="">{t('help.none')} <a href={GUIDE_URL} target="_blank" rel="noreferrer">{t('help.guide')}</a></p>
      )}
      {found.length > 1 && (
        <ul className={s.helpList} aria-label={t('help.results')}>
          {found.map((section) => (
            <li key={section.anchor}>
              <Button size="sm" variant="quiet" aria-pressed={shown?.anchor === section.anchor} onClick={() => setChosen(section)}>{section.title}</Button>
            </li>
          ))}
        </ul>
      )}
      {shown && (
        <section aria-label={shown.title} data-help-section={shown.anchor}>
          <h3 className={s.helpTitle}>{shown.title}</h3>
          {/* The guide's own words, as they are written there. */}
          <blockquote className={s.helpQuote} data-content="">{shown.text}</blockquote>
          <a href={guideLink(shown.anchor)} target="_blank" rel="noreferrer">{t('help.read')}</a>
        </section>
      )}
      <p className={s.helpLine}><Button size="sm" variant="quiet" onClick={() => openSheet('whats-new', 'latest')}>{t('help.whatsNew')}</Button></p>
    </Sheet>
  );
}
