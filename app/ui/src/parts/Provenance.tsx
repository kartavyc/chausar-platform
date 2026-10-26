import { useId, useState, type ReactNode } from 'react';
import { useT } from '../text';
import { ModelEstimate } from './ModelEstimate';
import s from './Provenance.module.css';

/**
 * What kind of words these are: someone's own words, quoted (a client's mail, a review), or prose a model wrote.
 * Never both: quoted words are not the model's.
 */
type ProvenanceKind = { quoted?: boolean | undefined; estimate?: never } | { estimate?: boolean | undefined; quoted?: never };

export type ProvenanceProps = ProvenanceKind & {
  /** Where the value came from. Shown on hover and on keyboard focus; left out, there is nothing to reveal. */
  source?: string | undefined;
  /** Its link has no address yet: a disabled "link not ready yet" follows it. */
  linkPending?: boolean | undefined;
  children: ReactNode;
};

/**
 * An evidence-backed value: a dotted underline, and its source on hover and on keyboard focus. Esc hides the source
 * without moving focus. The honesty lines of catalogue U17 come with it: quoted words say "Shown as written" on a
 * line under them, prose a model wrote carries "model estimate", and a link that is not ready says so.
 */
export function Provenance({ source, quoted, estimate, linkPending, children }: ProvenanceProps) {
  const t = useT();
  const tipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  const words = quoted ? <q className={s.quote} data-content="">{children}</q> : children;
  const value = source === undefined ? (
    <span>{words}</span>
  ) : (
    <span
      className={s.value}
      tabIndex={0}
      aria-describedby={tipId}
      onMouseEnter={() => { setHovered(true); setDismissed(false); }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => { setFocused(true); setDismissed(false); }}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); setDismissed(true); } }}
    >
      <span className={s.text}>{words}</span>
      <span id={tipId} role="tooltip" className={s.tip} hidden={!open}>{t('provenance.source', { source })}</span>
    </span>
  );
  if (!quoted && !estimate && !linkPending) return value;
  return (
    <span className={quoted ? s.quoted : s.with} data-quoted={quoted ? '' : undefined}>
      {value}
      {estimate && <ModelEstimate />}
      {linkPending && <PendingLink />}
      {quoted && <span className={s.asWritten}>{t('provenance.quoted')}</span>}
    </span>
  );
}

/**
 * A link that has no address yet (a share page still being made, a site not yet built): a disabled control that says
 * so, never a link that goes nowhere (catalogue U17).
 */
export function PendingLink() {
  const t = useT();
  return (
    <button type="button" className={s.pending} disabled data-link-pending="">
      {t('provenance.linkPending')}
    </button>
  );
}
