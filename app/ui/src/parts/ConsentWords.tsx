/**
 * One-shot B1 (SCREENS P5, hands-on rows 5 and S3): a consent said once, in one line, with the exact words the owner
 * agrees to kept whole behind a closed "What's sent" fold. The text is the engine's own (its digest is what the owner
 * agrees to), so it is shown as it came and never shortened; only the one line above it is the screen's.
 */

import { useT } from '../text';
import { cx } from './cx';
import s from './ConsentWords.module.css';
import { Fold } from './Fold';

export function ConsentWords({ line, text, className }: {
  line?: string | undefined;
  /** The engine's consent, whole. A list when one line covers more than one consent (the first run's two sign-ins): each is its own paragraph in the one fold. */
  text: string | readonly string[];
  className?: string | undefined;
}) {
  const t = useT();
  const texts = typeof text === 'string' ? [text] : text;
  return (
    <div className={cx(s.consent, className)} data-consent-words="">
      {line && <p className={s.line}>{line}</p>}
      <Fold summary={t('consent.whatSent')} className={s.fold}>
        {texts.map((each) => <p key={each} className={s.text}>{each}</p>)}
      </Fold>
    </div>
  );
}
