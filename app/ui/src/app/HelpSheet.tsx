/**
 * Help (SH-12): three short lists in a sheet. The keys, drawn from KEY_MAP (keys.ts), the
 * same list the frame's key handler reads, so nothing is listed that does not work and
 * nothing works that is not listed. The word list in plain words (main design, part 16).
 * What works with no internet and what waits, from the `todayx.help` reply's codes.
 *
 * A sheet body: the host places it in a Sheet. It reads nothing itself.
 */

import type { HelpReply } from '../bridge/todayx-contract.ts';
import { KEY_MAP } from './keys.ts';
import { useT } from './text';
import s from './ShellSheets.module.css';

/** The words a person meets on the screens, in the order they meet them. */
export const HELP_WORDS = [
  'receipt',
  'source',
  'meaning',
  'recipe',
  'approval',
  'send-level',
  'route',
  'seat',
  'pen',
  'demo-clock',
  'sheet',
  'banner',
  'view',
  'square',
  'coverage',
  'marking',
  'starter-pack',
] as const;

/** The offline codes `todayx.help` may send that have words here. Another code is shown as
 *  "another part" with its code, never dropped. */
export const OFFLINE_CODES = [
  'books-answers',
  'receipts',
  'calculation-menu',
  'meanings',
  'local-checks',
  'exports',
  'lock',
  'plain-questions',
  'model-requests',
  'scheduled-reads',
  'sending',
  'connector-reads',
  'updates',
  'phone-messages',
] as const;

function offlineKey(code: string): string | null {
  return (OFFLINE_CODES as readonly string[]).includes(code) ? `SH-12.offline.${code}` : null;
}

export interface HelpSheetProps {
  /** The validated `todayx.help` reply, or null while it is not loaded. */
  offline: HelpReply | null;
  /** Which key names to show first. Both are always listed. */
  platform?: 'windows' | 'mac' | undefined;
}

export function HelpSheet({ offline, platform = 'windows' }: HelpSheetProps) {
  const t = useT();
  const line = (code: string) => {
    const k = offlineKey(code);
    return <li key={code}>{k !== null ? t(k) : t('SH-12.offline.other', { code })}</li>;
  };
  return (
    <div className={s.stack}>
      <section className={s.section} aria-labelledby="help-keys">
        <h3 id="help-keys" className={s.heading}>
          {t('SH-12.keys')}
        </h3>
        <dl className={s.keys}>
          {KEY_MAP.map((k) => (
            <div key={k.id} className={s.pair} data-key={k.id}>
              <dt className="fig">
                {platform === 'mac' ? k.mac : k.windows}
                {k.mac !== k.windows && (
                  <span className={s.note}> {platform === 'mac' ? t('SH-12.key.windows', { keys: k.windows }) : t('SH-12.key.mac', { keys: k.mac })}</span>
                )}
              </dt>
              <dd>{t(k.textKey)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={s.section} aria-labelledby="help-words">
        <h3 id="help-words" className={s.heading}>
          {t('SH-12.words')}
        </h3>
        <dl className={s.keys}>
          {HELP_WORDS.map((w) => (
            <div key={w} className={s.pair}>
              <dt>{t(`SH-12.word.${w}`)}</dt>
              <dd>{t(`SH-12.word.${w}.meaning`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={s.section} aria-labelledby="help-offline">
        <h3 id="help-offline" className={s.heading}>
          {t('SH-12.offline')}
        </h3>
        {offline === null ? (
          <p className={s.note}>{t('SH-12.offline.notLoaded')}</p>
        ) : (
          <>
            <p className={s.note}>{t('SH-12.offline.works')}</p>
            {offline.offline.works.length > 0 ? <ul className={s.list}>{offline.offline.works.map(line)}</ul> : <p className={s.note}>{t('SH-12.offline.none')}</p>}
            <p className={s.note}>{t('SH-12.offline.waits')}</p>
            {offline.offline.waits.length > 0 ? <ul className={s.list}>{offline.offline.waits.map(line)}</ul> : <p className={s.note}>{t('SH-12.offline.none')}</p>}
          </>
        )}
      </section>
    </div>
  );
}
