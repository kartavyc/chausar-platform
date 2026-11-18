import { useT } from '../text';
import { PRACTICE_REASON, STAGE_PLACE } from '../../../../platform/runtime/venture/core/launch-stage';
import s from './ApprovalRow.module.css';

/**
 * The way to the Stage setting, beside a card whose own words say its draft is a practice draft and that drafts are
 * used once the business is live (the engine's sentence, core/launch-stage.ts PRACTICE_REASON). Found on Windows,
 * 16 Nov 2026: the card named a setting and gave no way there. Code decides it from that exact sentence, so words
 * that name a setting always carry the way to it. Any other card shows nothing. Going live still asks twice, there.
 * Round 7 (re-check 036): with Hindi on, Today says that sentence from the pack (plan-words.ts), and the link vanished.
 * The sentence in the owner's language is the same sentence, so it carries the link too: words never take a control away.
 */
export function StageLink({ line }: { line: string | undefined }) {
  const t = useT();
  if (!line || !(line.includes(PRACTICE_REASON) || line.includes(t('today.card.practice')))) return null;
  return <p className={s.note}><a href={STAGE_PLACE} data-stage-link="">{t('approval.stageLink')}</a></p>;
}
