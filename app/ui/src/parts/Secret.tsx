import { useT } from '../text';
import { Field } from './Field';
import { groupsOf } from './custody';
import s from './Secret.module.css';

/**
 * A code the engine sends once (a recovery code, a move code), in groups of four for reading. The groups are text
 * nodes side by side, so the group reads, copies and selects as the exact string.
 */
export function CodeGroups({ code, label }: { code: string; label: string }) {
  return (
    <div className={`${s.code} mono`} role="group" aria-label={label}>
      {groupsOf(code).map((part, i) => <span key={i} className={s.part}>{part}</span>)}
    </div>
  );
}

/**
 * A new passphrase, typed twice, shown only once the engine says this computer can't keep the key
 * (DEVICE_KEYS_UNAVAILABLE). `reason` is the engine's own sentence for why.
 */
export function NewPassphrase({ reason, first, again, onFirst, onAgain }: {
  reason: string; first: string; again: string; onFirst: (value: string) => void; onAgain: (value: string) => void;
}) {
  const t = useT();
  return (
    <div className={s.pair}>
      <p className={s.reason}>{reason}</p>
      <Field label={t('custody.newPassphrase')} type="password" autoComplete="new-password" spellCheck={false} value={first} onChange={(event) => onFirst(event.currentTarget.value)} hint={t('custody.passphraseHint')} />
      <Field label={t('custody.again')} type="password" autoComplete="new-password" spellCheck={false} value={again} onChange={(event) => onAgain(event.currentTarget.value)} />
    </div>
  );
}
