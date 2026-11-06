/**
 * One-shot B1 (SCREENS P5, hands-on rows 5 and S3): a consent said once, in one line, with the exact words the owner
 * agrees to kept whole behind a closed "What's sent" fold. The text is the engine's own (its digest is what the owner
 * agrees to), so it is shown as it came and never shortened; only the one line above it is the screen's.
 */

import { useT } from '../text';
import { cx } from './cx';
import s from './ConsentWords.module.css';
import { Fold } from './Fold';

export function ConsentWords({ line, text, className }: { line?: string | undefined; text: string; className?: string | undefined }) {
  const t = useT();
  return (
    <div className={cx(s.consent, className)} data-consent-words="">
      {line && <p className={s.line}>{line}</p>}
      <Fold summary={t('consent.whatSent')} className={s.fold}>
        <p className={s.text}>{text}</p>
      </Fold>
    </div>
  );
}
