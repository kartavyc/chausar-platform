/**
 * The closing switch (TD-01 "Daily closing on"): one settings row under the closing row, in every
 * view, for a seat that may change it (the host supplies `onSetClosing` only to an owner or a
 * cofounder, the seats `todayx.closing.set` admits).
 *
 * Why a settings row here and not a Trust page: daily closing is a Today preference whose only
 * effect is the closing row right above it, so it sits where its effect is seen. SettingsRows is
 * the design's pattern for an on/off preference (rules, the rhythm, a source's settings): a closed
 * row that names the setting and its current choice in words, opening to the No and Yes pair.
 * The current choice comes only from the checked `todayx.closing` reply; nothing is assumed.
 */
import { useT } from '../../app/text';
import { SettingsRows } from '../../patterns/SettingsRows';
import type { TodayData, TodayIntents } from './TodayData.ts';
import { allowsTodayMutation } from './permissions.ts';
import s from './Today.module.css';

export function ClosingSwitch({ data, intents }: { data: TodayData; intents: TodayIntents }) {
  const t = useT();
  const closing = data.closing, onSet = intents.onSetClosing;
  if (closing === undefined || onSet === undefined || !allowsTodayMutation(data.state)) return null;
  return (
    <div className={s.closingSwitch} data-closing-switch="">
      <SettingsRows label={t('FT4.closing.label')} rows={[{
        id: 'daily-closing', what: t('FT4.closing.switch'),
        current: t(closing.on ? 'FT4.closing.on' : 'FT4.closing.off'),
        choice: { form: 'yes-no', value: closing.on, onChange: (yes: boolean) => { if (yes !== closing.on) onSet(yes); } },
      }]} />
    </div>
  );
}
