/**
 * The parts W4 feeds, drawn with test-style props for the screenshot walk: what Today's goal card and next step, the
 * Start gallery, Network's paths and pipeline, Chats and Money's charts look like once the engine sends their data.
 * Every value here is sample data written for this page (the same kind the part tests use); the page says so at the
 * top, and none of it is in src/.
 */

import type { ReactNode } from 'react';
import { EngineProvider } from '../src/engine/context';
import type { EngineClient } from '../src/engine/types';
import { TextProvider, type Language } from '../src/text';
import { Avatar } from '../src/parts/Avatar';
import { Board, BoardCard, type BoardColumn } from '../src/parts/Board';
import { ChatThread, type ThreadEntry } from '../src/parts/ChatThread';
import { Composer } from '../src/parts/Composer';
import { DiffCard } from '../src/parts/DiffCard';
import { Gallery, type GalleryWay } from '../src/parts/Gallery';
import { PathLine } from '../src/parts/PathLine';
import { StrengthDots } from '../src/parts/StrengthDots';
import { Bento, Tile, TileHead } from '../src/parts/Tile';
import { AgingBar } from '../src/parts/charts/AgingBar';
import { BarChart } from '../src/parts/charts/BarChart';
import { CashLine } from '../src/parts/charts/CashLine';
import { SplitBar } from '../src/parts/charts/SplitBar';
import type { AgingData, BarSeries, CashData, SplitData } from '../src/parts/charts/types';
import { GoalCard } from '../src/places/today/GoalCard';
import type { GoalCardData } from '../src/places/today/goal';
import { NextStep } from '../src/places/today/NextStep';
import s from './specimens.module.css';

const TITLES: Record<string, { title: string; line: string }> = {
  goal: { title: 'Goal, next step and the Start gallery', line: 'Today\'s goal card with a goal set (W4 4I), the next best step beside it, the goal card asking for a goal, and the ways to earn (W4 4J, tiles in W5).' },
  network: { title: 'Network and the pipeline', line: 'Search results with strength and warm paths (W4 4D), and the pipeline in the stages W4 4E brings.' },
  chats: { title: 'Chats and agent chat', line: 'Chausar as chief of staff (W4 4C), and an agent\'s proposed instruction change (W4 4B).' },
  money: { title: 'Money charts', line: 'In and out by month, who owes you by age, cash by week and AI spend by department (W4 4J money views, 4A).' },
};

const noop = () => {};
const resolved = () => Promise.resolve();

function Section({ id, title, span = 12, children, meta }: { id: string; title: string; span?: 4 | 5 | 6 | 7 | 8 | 12; children: ReactNode; meta?: ReactNode }) {
  return (
    <Tile as="section" span={span} labelledBy={id}>
      <TileHead id={id} title={title} meta={meta} />
      {children}
    </Tile>
  );
}

// ------------------------------------------------------------------------------------------------ goal and gallery

const SET: GoalCardData = {
  state: 'set', month: 'October', invoiced: { value: '₹1,18,400', receiptId: 'R-0410' }, goal: { value: '₹1,50,000', receiptId: 'R-0409' },
  percent: '79%', daysLeft: '8 days left',
  bar: { invoicedPermille: 789, readyPermille: 126, pacePermille: 742, label: "79% of the goal invoiced. Issuing INV-0042 takes it to 92%. Today's pace is 74%." },
  ready: { value: '₹18,880', receiptId: 'R-0419' },
  foot: [
    { id: 'pace', label: "Against today's pace", amount: { value: '₹7,110', receiptId: 'R-0422' }, trend: 'ahead' },
    { id: 'still', label: 'Still to invoice', amount: { value: '₹31,600', receiptId: 'R-0421' } },
    { id: 'received', label: 'Received so far', amount: { value: '₹86,200', receiptId: 'R-0402' } },
  ],
};
const UNSET: GoalCardData = { state: 'unset', month: 'November', invoiced: { value: '₹0', receiptId: 'R-0411' }, suggested: '₹1,20,000' };

const WAY: GalleryWay = {
  id: 'wedding-videos', name: 'Wedding invitation videos', line: 'Short invitation videos for couples and their families, in their languages.', icon: 'play',
  dept: 'prod', category: 'Video', hours: '4 to 8 h a week', youDo: 'Talk to couples, approve each video before it goes out.',
  team: { names: ['Producer', 'Editor', 'Billing'], line: 'Writes the script, cuts the video, sends the invoice.' }, pay: { range: '₹3,000 to ₹8,000', per: 'per video' },
};
const WAYS: GalleryWay[] = [
  WAY,
  { ...WAY, id: 'gst-kirana', name: 'GST filing for kirana shops', line: 'Monthly GST returns for small shops, signed off by your CA.', icon: 'receipt-text', dept: 'money', category: 'Books and tax', hours: '6 to 10 h a week', youDo: 'Meet shop owners, send papers to your CA.', team: { names: ['Bookkeeper', 'Billing'], line: 'Reads the bills, drafts the return, tracks payment.' }, pay: { range: '₹1,500 to ₹3,000', per: 'per shop a month' } },
  { ...WAY, id: 'tuition', name: 'Online maths tuition', line: 'Worksheets and weekly tests for school children.', icon: 'users', dept: 'sales', category: undefined, running: 'Lumen Studio', hours: '8 to 12 h a week', youDo: 'Teach the live classes.', team: { names: ['Researcher', 'Producer'], line: 'Makes worksheets, books the parents.' }, pay: { range: '₹800 to ₹2,000', per: 'per child a month' } },
];

function Goal() {
  return (
    <>
      <div className={s.grid}>
        <div className={s.c7}><GoalCard data={SET} onEdit={noop} /></div>
        <div className={s.c5}>
          <NextStep
            data={{ rowId: 'q-invoice-mehta', title: 'Issue INV-0042 to Mehta Traders', line: 'Monthly books for September, due in 15 days.', agent: 'Billing', business: 'Ledgerline', total: { value: '₹18,880', receiptId: 'R-0419' }, goalAfter: '92%' }}
            primary={{ label: 'Issue invoice', locked: false, note: undefined, asksAgain: true }}
            onOpen={noop} onPrimary={noop}
          />
        </div>
        <div className={s.c7}><GoalCard data={UNSET} onSet={noop} /></div>
      </div>
      <h2 className={s.h2}>Ways to earn</h2>
      <Gallery ways={WAYS} featured="wedding-videos" onStart={noop} />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ network

const PEOPLE = [
  { name: 'Kavya Reddy', sub: 'Founder, Kesar Botanicals', level: 4 as const, path: [{ name: 'Meera Joshi', confirmed: true, strength: 'strong' as const }, { name: 'Kavya Reddy', confirmed: true, strength: 'strong' as const }], why: 'Meera Joshi worked with her at Kesar for two years.' },
  { name: 'Sameer Joshi', sub: 'Marketing lead, Pocket Audio', level: 2 as const, path: [{ name: 'Rahul Mehta', confirmed: true, strength: 'fair' as const }, { name: 'Sameer Joshi', confirmed: false }], why: 'Rahul Mehta and Sameer Joshi list the same company.' },
  { name: 'Asha Rao', sub: 'Owner, Rao Sweets', level: 5 as const, path: [{ name: 'Asha Rao', confirmed: true, strength: 'strong' as const }], why: 'A client since March; 14 emails both ways.' },
];

function Network() {
  const card = (id: string, name: string, sub: string, level: 0 | 1 | 2 | 3 | 4 | 5, extra?: ReactNode) => ({
    id, node: <BoardCard name={name} sub={sub} dept="sales"><StrengthDots level={level} />{extra}</BoardCard>,
  });
  const columns: BoardColumn[] = [
    { id: 'found', title: 'Found', hint: 'Not asked yet', cards: [card('n1', 'Kavya Reddy', 'Kesar Botanicals', 4, <PathLine people={PEOPLE[0]!.path} strength="strong" />), card('n2', 'Neha Gupta', 'Gupta Clinics', 1)] },
    { id: 'asked', title: 'Asked', cards: [card('n3', 'Sameer Joshi', 'Pocket Audio', 2, <PathLine people={PEOPLE[1]!.path} />)] },
    { id: 'talking', title: 'Talking', cards: [card('n4', 'Farhan Ali', 'Ali Opticals', 3)] },
    { id: 'proposal', title: 'Proposal', cards: [card('n5', 'Iyer and Co', 'Chartered accountants', 3)] },
    { id: 'won', title: 'Won', cards: [card('n6', 'Asha Rao', 'Rao Sweets', 5)] },
    { id: 'lost', title: 'Lost', folded: true, cards: [card('n7', 'Tarun Sethi', 'Sethi Motors', 1), card('n8', 'Rhea Menon', 'Menon Prints', 2)] },
    { id: 'not-now', title: 'Not now', folded: true, cards: [card('n9', 'Dev Malhotra', 'Malhotra Tiles', 1)] },
  ];
  return (
    <Bento>
      <Section id="sp-results" title="People who fit: brand owners in Pune" meta="3 found">
        <ul className={s.people}>
          {PEOPLE.map((person) => (
            <li key={person.name} className={s.person}>
              <Avatar name={person.name} dept="sales" size={40} />
              <div className={s.who}>
                <p className={s.name}>{person.name}</p>
                <p className={s.sub}>{person.sub}</p>
                <p className={s.why} data-content="">{person.why}</p>
              </div>
              <StrengthDots level={person.level} onOpen={noop} />
              <PathLine people={person.path} layout="named" />
            </li>
          ))}
        </ul>
      </Section>
      <Section id="sp-pipeline" title="Pipeline">
        <Board label="Pipeline board" columns={columns} />
      </Section>
    </Bento>
  );
}

// ------------------------------------------------------------------------------------------------ chats

const NOW = new Date('2026-10-23T13:30:00.000Z');
const CHIEF: ThreadEntry[] = [
  { kind: 'owner', id: 'm1', at: '2026-10-23T12:58:00.000Z', text: 'How is October going against the goal?' },
  { kind: 'agent', id: 'm2', at: '2026-10-23T12:58:30.000Z', text: 'You are at 79% of the October goal. Issuing INV-0042 to Mehta Traders takes you to 92%; it is waiting on Today.' },
  { kind: 'owner', id: 'm3', at: '2026-10-23T13:02:00.000Z', text: 'Will we make it by the end of the month?' },
  { kind: 'agent', id: 'm4', at: '2026-10-23T13:02:20.000Z', text: 'Likely, about ₹1,52,000 if two quotes are accepted.', estimate: true },
];
const EDITOR: ThreadEntry[] = [
  { kind: 'owner', id: 'e1', at: '2026-10-22T02:32:00.000Z', text: 'Cut episode 14 from the recording.' },
  { kind: 'run', id: 'r1', at: '2026-10-22T02:40:00.000Z', title: 'Cut episode 14', state: 'done', done: 3, duration: '4m' },
  { kind: 'agent', id: 'e2', at: '2026-10-22T03:10:00.000Z', text: 'Episode 14 is cut. It is on Today for you to watch.' },
  { kind: 'owner', id: 'e3', at: '2026-10-23T13:07:00.000Z', text: 'From now on, always add burned-in captions to shorts.' },
  { kind: 'run', id: 'r2', at: '2026-10-23T13:08:00.000Z', title: 'Shorts from episode 13', state: 'active', done: 3, total: 5 },
];

function Chats() {
  return (
    <Bento>
      <Section id="sp-chief" title="Chausar" span={7}>
        <ChatThread agent={{ name: 'Chausar', chausar: true }} entries={CHIEF} now={NOW} timeZone="Asia/Kolkata" />
        <Composer label="Ask Chausar" placeholder="Ask Chausar about your businesses" onSend={resolved} suggestions={['What needs me today?', 'Which client owes the most?']} />
      </Section>
      <Section id="sp-editor" title="Editor" span={5}>
        <ChatThread agent={{ name: 'Editor', dept: 'prod' }} entries={EDITOR} now={NOW} timeZone="Asia/Kolkata" />
        <DiffCard
          agent="Editor" dept="prod" appliesTo="Applies to every short from now on" fromVersion={4} toVersion={5}
          lines={[
            { kind: 'same', text: 'Cut shorts under 60 s with a clear hook' },
            { kind: 'removed', text: 'Captions only when the client asks' },
            { kind: 'added', text: 'Always add burned-in captions to shorts' },
          ]}
          onAccept={resolved} onReject={resolved} onUndo={resolved}
        />
        <Composer label="Message Editor" onSend={resolved} hint="Editor asks you before anything that publishes or spends." />
      </Section>
    </Bento>
  );
}

// ------------------------------------------------------------------------------------------------ money

const IN: BarSeries = { label: 'In', points: [
  { key: '05', label: 'May', valuePermille: 520, value: '₹52,000' }, { key: '06', label: 'Jun', valuePermille: 610, value: '₹61,000' },
  { key: '07', label: 'Jul', valuePermille: 700, value: '₹70,000' }, { key: '08', label: 'Aug', valuePermille: 610, value: '₹61,000' },
  { key: '09', label: 'Sep', valuePermille: 1000, value: '₹1,00,000' }, { key: '10', label: 'Oct, so far', valuePermille: 862, value: '₹86,200' },
] };
const OUT: BarSeries = { label: 'Out', points: [
  { key: '05', label: 'May', valuePermille: 240, value: '₹24,000' }, { key: '06', label: 'Jun', valuePermille: 250, value: '₹25,000' },
  { key: '07', label: 'Jul', valuePermille: 300, value: '₹30,000' }, { key: '08', label: 'Aug', valuePermille: 250, value: '₹25,000' },
  { key: '09', label: 'Sep', valuePermille: 270, value: '₹27,000' }, { key: '10', label: 'Oct, so far', valuePermille: 260, value: '₹26,000' },
] };
const AGING: AgingData = {
  label: 'Owed by age: not due yet ₹40,000, 1 to 30 days late ₹12,000, 31 to 60 days late ₹6,000, 61 to 90 days late ₹3,000, over 90 days ₹0',
  proof: { receiptId: 'R-0301' },
  buckets: [
    { id: 'not-due', label: 'Not due yet', count: '2 invoices', amount: '₹40,000', permille: 656 },
    { id: '1-30', label: '1 to 30 days late', count: '1 invoice', amount: '₹12,000', permille: 197 },
    { id: '31-60', label: '31 to 60 days late', count: '1 invoice', amount: '₹6,000', permille: 98 },
    { id: '61-90', label: '61 to 90 days late', count: '1 invoice', amount: '₹3,000', permille: 49 },
    { id: 'over-90', label: 'Over 90 days', count: 'none', amount: '₹0', permille: 0 },
  ],
};
const CASH: CashData = {
  label: 'Cash in the bank by week: ₹1,40,000 and ₹1,45,000, then a forecast of ₹1,30,000 and ₹1,20,000.',
  proof: { receiptId: 'R-0501' },
  axis: ['12 Oct', '19 Oct', '26 Oct', '2 Nov'],
  assumptions: ['Clients pay on the due date.', 'Costs stay at their usual weekly level.'],
  points: [
    { key: 'w0', label: 'Week of 12 Oct', actualPermille: 400, actual: '₹1,40,000', forecastPermille: null, forecast: null },
    { key: 'w1', label: 'Week of 19 Oct', actualPermille: 450, actual: '₹1,45,000', forecastPermille: 450, forecast: '₹1,45,000' },
    { key: 'w2', label: 'Week of 26 Oct', actualPermille: null, actual: null, forecastPermille: 300, forecast: '₹1,30,000' },
    { key: 'w3', label: 'Week of 2 Nov', actualPermille: null, actual: null, forecastPermille: 200, forecast: '₹1,20,000' },
  ],
};
const SPLIT: SplitData = {
  label: 'AI spend by department this month.', proof: { receiptId: 'R-0431' },
  parts: [
    { dept: 'prod', amount: '₹42.10', permille: 534 }, { dept: 'money', amount: '₹33.50', permille: 425 },
    { dept: 'ops', amount: '₹3.20', permille: 41 }, { dept: 'mkt', amount: '₹0.00', permille: 0 }, { dept: 'sales', amount: '₹0.00', permille: 0 },
  ],
};

function Money() {
  return (
    <Bento>
      <Section id="sp-inout" title="In and out by month" span={7}>
        <BarChart kind="money" proof={{ receiptId: 'R-0402' }} series={[IN, OUT]} label="Money in and out by month, May to October." />
      </Section>
      <Section id="sp-aging" title="Who owes you" span={5}>
        <AgingBar data={AGING} />
      </Section>
      <Section id="sp-cash" title="Cash, the next weeks" span={7}>
        <CashLine data={CASH} />
      </Section>
      <Section id="sp-split" title="AI spend by department" span={5}>
        <SplitBar data={SPLIT} />
      </Section>
    </Bento>
  );
}

// ------------------------------------------------------------------------------------------------ page

export function Specimens({ show, language, client }: { show: string; language: Language; client: EngineClient }) {
  const head = TITLES[show] ?? TITLES.goal!;
  return (
    <EngineProvider client={client}>
      <TextProvider language={language}>
        <main className={s.page} data-specimens="">
          <p className={s.eyebrow}>Dev page: sample props, not engine data</p>
          <h1 className={s.title}>{head.title}</h1>
          <p className={s.line}>{head.line}</p>
          {show === 'network' ? <Network /> : show === 'chats' ? <Chats /> : show === 'money' ? <Money /> : <Goal />}
        </main>
      </TextProvider>
    </EngineProvider>
  );
}
