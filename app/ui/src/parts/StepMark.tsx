import s from './Steps.module.css';

/** The current step: a quarter arc on a ring, drawn once and never turning (nothing loops). Steps and Progress share it. */
export function StillArc() {
  return (
    <svg className={s.arc} data-arc="" viewBox="0 0 20 20" width="20" height="20" focusable="false" aria-hidden="true">
      <circle className={s.arcTrack} cx="10" cy="10" r="7.5" fill="none" />
      <path className={s.arcPart} d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" />
    </svg>
  );
}
