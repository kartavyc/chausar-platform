/**
 * TEST FIXTURE ONLY. Picture S01, Today in the Guided view, as typed data for the picture
 * and word tests. Every business fact here is pretend and every name ends in Demo. This
 * file is never imported by app code and is never mounted by anything in app/: `mount`
 * takes its data from the integration adapter. Only tests and picture renders read it.
 * A real workspace with nothing loaded shows the missing-state words instead.
 *
 * Exact values are whole paise, whole counts and hundredths of a percent. Money displays
 * are what the format module gives. A count's display here also carries the picture's
 * unit word ("4 lines"); that is fixture text, not what the format module returns.
 * Point ids are fixture ids; a real chart carries the engine's own point ids.
 */

import type { ChartValue, Figure } from '../../app/presentation.ts';
import type { TodayData } from './TodayData.ts';

const rupees = (exact: string, display: string, receiptId: string): Figure => ({ kind: 'money', exact, display, receiptId, labels: [] });
const counted = (exact: string, display: string, receiptId: string): Figure => ({ kind: 'count', exact, display, receiptId, labels: [] });
const point = (id: string, label: string, value: Figure, emphasis = false): ChartValue => (emphasis ? { id, label, value, emphasis } : { id, label, value });

export const TODAY_S01_FIXTURE: TodayData = {
  state: { kind: 'ready' },
  date: 'Wednesday, 30 September',
  review: {
    count: { exact: '4', display: '4' },
    rows: [
      {
        id: 'ap-reminders',
        mark: 'wait',
        what: '3 payment reminders',
        note: 'overdue',
        figure: rupees('31000000', '₹3,10,000', 'R-0930-001'),
        detail: 'Each message is approved on its own.',
        can: ['review'],
      },
      {
        id: 'ap-payment',
        mark: 'wait',
        what: 'Payment to record',
        note: 'Lotus Stores Demo',
        figure: rupees('4850000', '₹48,500', 'R-0930-002'),
        detail: 'Matches invoice INV-0398.',
        can: ['review'],
      },
      {
        id: 'ap-bank',
        mark: 'wait',
        what: '4 bank matches',
        note: 'can be undone',
        figure: counted('4', '4 lines', 'R-0930-003'),
        detail: 'Four small changes inside your books.',
        can: ['review'],
      },
      {
        id: 'q-freight',
        mark: 'unsure',
        what: 'Freight Outward',
        note: 'selling cost, or cost of goods?',
        figure: counted('212', '212 orders', 'R-0930-004'),
        detail: 'One answer sorts 212 orders.',
        can: ['review'],
      },
    ],
  },
  thisMonth: [
    {
      id: 'collected',
      label: 'Collected in September',
      figure: rupees('60844000', '₹6,08,440', 'R-0930-010'),
      change: { kind: 'percent', exact: '-1800', display: '-18%', receiptId: 'R-0930-016', labels: [] },
      changeLabel: 'down',
      chartState: { state: 'available' },
      chart: {
        form: 'columns',
        sentence: 'Collected each month from April to September. September is lowest.',
        values: [
          point('fixture-apr', 'A', rupees('71200000', '₹7,12,000', 'R-0930-011')),
          point('fixture-may', 'M', rupees('70100000', '₹7,01,000', 'R-0930-012')),
          point('fixture-jun', 'J', rupees('73900000', '₹7,39,000', 'R-0930-013')),
          point('fixture-jul', 'J', rupees('72400000', '₹7,24,000', 'R-0930-014')),
          point('fixture-aug', 'A', rupees('74200000', '₹7,42,000', 'R-0930-015')),
          point('fixture-sep', 'S', rupees('60844000', '₹6,08,440', 'R-0930-010'), true),
        ],
      },
    },
    {
      id: 'cash',
      label: 'Cash in bank',
      figure: rupees('48230000', '₹4,82,300', 'R-0930-020'),
      changeLabel: 'as of 28 Sep',
      chartState: { state: 'available' },
      chart: {
        form: 'line',
        sentence: 'Cash in bank from 29 August to 28 September, ending at ₹4,82,300.',
        from: '29 Aug',
        to: '28 Sep',
        values: [
          point('fixture-0829', '29 Aug', rupees('52100000', '₹5,21,000', 'R-0930-021')),
          point('fixture-0903', '3 Sep', rupees('49800000', '₹4,98,000', 'R-0930-022')),
          point('fixture-0908', '8 Sep', rupees('46200000', '₹4,62,000', 'R-0930-023')),
          point('fixture-0913', '13 Sep', rupees('44000000', '₹4,40,000', 'R-0930-024')),
          point('fixture-0918', '18 Sep', rupees('53500000', '₹5,35,000', 'R-0930-025')),
          point('fixture-0923', '23 Sep', rupees('50100000', '₹5,01,000', 'R-0930-026')),
          point('fixture-0928', '28 Sep', rupees('48230000', '₹4,82,300', 'R-0930-020'), true),
        ],
      },
    },
    {
      id: 'overdue',
      label: 'Overdue',
      figure: rupees('31000000', '₹3,10,000', 'R-0930-030'),
      change: counted('3', '3', 'R-0930-033'),
      changeLabel: 'invoices',
      chartState: { state: 'available' },
      chart: {
        form: 'ordered-bar',
        sentence: 'Overdue by age: most of ₹3,10,000 is 15 to 30 days late.',
        values: [
          point('fixture-under-15', 'under 15 days', rupees('6800000', '₹68,000', 'R-0930-031')),
          point('fixture-15-to-30', '15 to 30 days late', rupees('24200000', '₹2,42,000', 'R-0930-032')),
        ],
      },
    },
  ],
  earlierToday: [
    { id: 'e1', mark: 'cha', time: '06:00', words: 'Tally', figure: counted('41', '41 read', 'R-0930-040') },
    { id: 'e2', mark: 'cha', time: '06:02', words: 'Bank', figure: counted('28', '28 of 31', 'R-0930-041') },
    { id: 'e3', mark: 'cha', time: '06:05', words: 'Zoho Books', note: 'read' },
    { id: 'e4', mark: 'unsure', time: '06:10', words: 'Statement', note: 'refused' },
    { id: 'e5', mark: 'cha', time: '08:30', words: 'Week ahead', note: 'ready' },
    { id: 'e6', mark: 'wait', time: '09:12', words: 'Now', figure: counted('4', '4 to review', 'R-0930-045') },
  ],
};

/** TEST FIXTURE ONLY. The same workspace with nothing loaded: what a real first morning
 *  looks like. The count is not known, and says so; it is not zero. */
export const TODAY_EMPTY_FIXTURE: TodayData = {
  state: { kind: 'ready' },
  date: 'Wednesday, 30 September',
  review: { count: { exact: null, display: 'not known' }, rows: [] },
  thisMonthMissing: 'not-loaded-yet',
  earlierToday: [],
};
