import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ClockProvider } from '../../src/shell/clock';
import { LOCALE, setDateLanguage, useDay, useDayKey, useLocalToday, useMoment, useMonth, useOwnerHour, useTime, useWeekday } from '../../src/parts/when';
import { formatClock, formatCount, formatMoney, formatMoneyRange } from '../../../../platform/runtime/owner-format';

/*
 * One-shot B2 task 4: every day and time on a screen goes through parts/when.ts, which reads the owner zone and the
 * app's one clock. Under a fixed zone and clock each hook writes the same words on any computer: the zone is pinned
 * here, and the CI runners (UTC) and this laptop (India) both run the file.
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

// C5 task 38: under the Hindi pack, dates read in Hindi with Latin digits; money and counts do not change.
describe('parts/when.ts in Hindi', () => {
  afterEach(() => setDateLanguage('en'));

  it('the language-to-locale map keeps Latin digits for Hindi', () => {
    expect(LOCALE).toEqual({ en: 'en-IN', hi: 'hi-IN-u-nu-latn' });
  });

  // Round 6 (re-check 036): Hindi's own "am" and "pm" are the English letters, so a time said the part of the day in
  // English ("8:00 am"); it says it in Hindi words ("रात 12:41"), with Latin digits.
  it('days, times and months read in Hindi with Latin digits; a calendar day does not move', () => {
    setDateLanguage('hi');
    expect(read('Asia/Kolkata')).toEqual({
      day: '3 नव॰ 2026', calendar: '3 नव॰ 2026', blank: '', short: '3 नव॰', time: 'रात 12:41', moment: '3 नव॰ 2026, रात 12:41',
      momentShort: '3 नव॰, रात 12:41', month: 'नवंबर 2026', monthShort: 'नव॰', weekday: 'मंगलवार, 3 नवंबर', today: '2026-11-03',
      key: '2026-11-03', hour: '0',
    });
    expect(read('America/New_York')).toMatchObject({ day: '2 नव॰ 2026', calendar: '3 नव॰ 2026', time: 'दोपहर 2:11', today: '2026-11-02' });
  });

  it('a time of day says the part of the day in Hindi, never am or pm', () => {
    setDateLanguage('hi');
    expect(['08:00', '13:30', '17:00', '21:37'].map(formatClock)).toEqual(['सुबह 8:00', 'दोपहर 1:30', 'शाम 5:00', 'रात 9:37']);
    expect(['08:00', '21:37'].map(formatClock).join(' ')).not.toMatch(/\b(?:am|pm)\b/i);
    setDateLanguage('en');
    expect(formatClock('08:00')).toBe('8:00 am');
  });

  it('no Devanagari digit ever shows, and going back to English reads as before', () => {
    setDateLanguage('hi');
    expect(Object.values(read('Asia/Kolkata')).join(' ')).not.toMatch(/[०-९]/);
    setDateLanguage('en');
    expect(read('Asia/Kolkata')).toMatchObject({ day: '3 Nov 2026', time: '12:41 am', month: 'November 2026' });
  });

  it('money and counts stay as they are', () => {
    setDateLanguage('hi');
    expect(formatMoney('10000000', 'INR')).toBe('₹1,00,000');
    expect(formatMoneyRange('300000', '1200000', 'INR')).toBe('₹3,000 to ₹12,000');
    expect(formatCount(100000, 'IN')).toBe('1,00,000');
  });
});
