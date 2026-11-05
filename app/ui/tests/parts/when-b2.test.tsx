import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ClockProvider } from '../../src/shell/clock';
import { useDay, useDayKey, useLocalToday, useMoment, useMonth, useOwnerHour, useTime, useWeekday } from '../../src/parts/when';

/*
 * One-shot B2 task 4: every day and time on a screen goes through parts/when.ts, which reads the owner zone and the
 * app's one clock. Under a fixed zone and clock each hook writes the same words on any computer (the gate runs this
 * file with TZ=UTC and TZ=America/New_York too).
 */

const NOW = '2026-11-02T19:11:00.000Z'; // 12:41 am on 3 Nov in India; still 2 Nov in UTC and New York

function Words() {
  const day = useDay(), short = useDay('short'), time = useTime(), moment = useMoment(), momentShort = useMoment('short');
  const month = useMonth(), monthShort = useMonth('short'), weekday = useWeekday(), today = useLocalToday(), key = useDayKey();
  return (
    <ul>
      <li data-w="day">{day(NOW)}</li><li data-w="calendar">{day('2026-11-03')}</li><li data-w="blank">{day(null)}</li>
      <li data-w="short">{short(NOW)}</li><li data-w="time">{time(NOW)}</li><li data-w="moment">{moment(NOW)}</li>
      <li data-w="momentShort">{momentShort(NOW)}</li><li data-w="month">{month('2026-11')}</li><li data-w="monthShort">{monthShort('2026-11')}</li>
      <li data-w="weekday">{weekday(NOW)}</li><li data-w="today">{today()}</li><li data-w="key">{key(NOW)}</li><li data-w="hour">{useOwnerHour()}</li>
    </ul>
  );
}

const read = (zone: string) => {
  const { container, unmount } = render(<ClockProvider now={() => new Date(NOW)} zone={zone}><Words /></ClockProvider>);
  const words = Object.fromEntries([...container.querySelectorAll('[data-w]')].map((li) => [li.getAttribute('data-w'), li.textContent]));
  unmount();
  return words;
};

describe('parts/when.ts', () => {
  it('reads every instant in the owner zone, and a calendar day as itself', () => {
    expect(read('Asia/Kolkata')).toEqual({
      day: '3 Nov 2026', calendar: '3 Nov 2026', blank: '', short: '3 Nov', time: '12:41 am', moment: '3 Nov 2026, 12:41 am',
      momentShort: '3 Nov, 12:41 am', month: 'November 2026', monthShort: 'Nov', weekday: 'Tuesday, 3 November', today: '2026-11-03',
      key: '2026-11-03', hour: '0',
    });
  });
  it('another zone reads the same instant as its own day and time; the calendar day does not move', () => {
    expect(read('America/New_York')).toMatchObject({ day: '2 Nov 2026', calendar: '3 Nov 2026', time: '2:11 pm', today: '2026-11-02', hour: '14' });
  });
});
