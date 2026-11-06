import { useT } from '../text';
import { Icon } from '../parts/Icon';
import { closeSheet, openSheet, useRoute } from './navigation';
import s from '../parts/NotificationBell.module.css';

/** C7 task 24: Help, beside the bell: opens the help sheet, quoted from Chausar's own guide. */
export function HelpButton({ look = 'outlined' }: { look?: 'outlined' | 'bare' }) {
  const t = useT();
  const route = useRoute();
  const open = route.sheet?.kind === 'help';
  return (
    <button type="button" className={s.bell} data-look={look} aria-label={t('help.title')} aria-expanded={open}
      onClick={() => (open ? closeSheet() : openSheet('help', 'guide'))}>
      <Icon name="circle-help" size={look === 'bare' ? 20 : 18} />
    </button>
  );
}
