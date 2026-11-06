/**
 * The Chausar story (W4 4C2; D-Today: the first of the stories, `st-av av-cz` with the mark, "Ask anything"): Chausar
 * itself, as chief of staff, before the agents. It opens Chats with a new chat and the cursor in the box; nothing is
 * asked or sent until the owner writes and presses Send. StoriesRow draws it as its `lead`.
 */

import { useT } from '../../text';
import { askChausar } from '../../shell/ask';
import { ChausarAvatar } from '../../parts/Avatar';
import s from './ChausarStory.module.css';

export function ChausarStory() {
  const t = useT();
  return (
    <button type="button" className={s.story} aria-label={t('today.chausar.label')} onClick={() => askChausar('')}>
      <ChausarAvatar size={60} />
      <span className={s.name}>{t('today.chausar.name')}</span>
      <span className={s.status}>{t('today.chausar.status')}</span>
    </button>
  );
}
