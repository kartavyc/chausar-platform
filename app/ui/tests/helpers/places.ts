/**
 * Every place and sub-page at rest, by the address an owner opens. The word budgets (tests/budgets.test.tsx) measure
 * each of them and the one-primary walk (tests/one-primary-view-b4.test.tsx) walks them, so both read this one list.
 */

export interface PlaceAtRest {
  id: string;
  hash: string;
  /** Money at a glance answers as the real engine does (RECEIPTED). */
  receipted?: boolean;
  /** Measured as a phone shows it. */
  narrow?: boolean;
}

/** Money at a glance as the real engine sends it (platform/runtime/venture/money/overview.ts), as money.test.tsx has it. */
export const RECEIPTED = {
  lines: [
    { id: 'owed', label: 'Clients owe you', value: '₹26,200.00', receiptId: 'R-0430' },
    { id: 'received', label: 'Came in this month', value: '₹86,200.00', receiptId: 'R-0402' },
    { id: 'spent', label: 'AI and tools this month', value: '₹60.10, includes estimates', receiptId: 'R-0431', estimate: true },
  ],
};

export interface SheetAtRest {
  id: string;
  /** The address that opens the sheet over its place. */
  hash: string;
}

/**
 * Every sheet with a word budget (B4 task 11), measured at rest in tests/budgets.test.tsx against the "sheets" list of
 * tests/baselines/words.json. To add one: a line here, and run the budgets test: it says what to write there.
 */
export const SHEETS: SheetAtRest[] = [
  { id: 'plan', hash: '#/today?sheet=view:plan:plan-ledgerline-1' },
  { id: 'run', hash: '#/work?sheet=run:29' },
  { id: 'invoice', hash: '#/money/invoices?sheet=invoice:inv-0039' },
  { id: 'payment', hash: '#/money/invoices?sheet=payment:inv-0039' },
  { id: 'client', hash: '#/clients?sheet=client:c-boat' },
  { id: 'agent', hash: '#/team?sheet=agent:editor' },
  { id: 'agent/chat', hash: '#/team?sheet=agent:editor&tab=chat' },
  { id: 'agent/instructions', hash: '#/team?sheet=agent:editor&tab=instructions' },
  { id: 'agent/notes', hash: '#/team?sheet=agent:editor&tab=notes' },
  { id: 'import', hash: '#/clients/network?sheet=network-import:new' },
  { id: 'accountant', hash: '#/money?sheet=accountant:books' },
];

export interface CardAtRest {
  id: string;
  hash: string;
  /** The card on that page; the first match is measured. */
  selector: string;
}

/** Every card with a word budget (B4 task 11), against the "cards" list of tests/baselines/words.json. */
export const CARDS: CardAtRest[] = [
  { id: 'approval', hash: '#/today', selector: 'article[data-card][data-row-id]' },
  { id: 'next-step', hash: '#/today', selector: '[data-next-step]' },
  { id: 'goal', hash: '#/today', selector: 'section[data-card][data-state]' },
];

export const PLACES: PlaceAtRest[] = [
  { id: 'today', hash: '#/today' },
  // W4 4C2: Chats, a new chat beside the list.
  { id: 'chats', hash: '#/chats' },
  { id: 'team', hash: '#/team' },
  { id: 'work', hash: '#/work' },
  { id: 'clients', hash: '#/clients' },
  { id: 'clients/pipeline', hash: '#/clients/pipeline' },
  { id: 'clients/network', hash: '#/clients/network' },
  { id: 'money', hash: '#/money', receipted: true },
  // W6 6H1: the Apps place (its budget is its first measure, 121 words rounded up).
  { id: 'apps', hash: '#/apps' },
  { id: 'money/invoices', hash: '#/money/invoices' },
  { id: 'money/books', hash: '#/money/books' },
  { id: 'money/spend', hash: '#/money/spend' },
  { id: 'money/journal', hash: '#/money/journal' },
  // W4 4J20: Money's new pages (their numbers are set at integration).
  { id: 'money/bills', hash: '#/money/bills' },
  { id: 'money/margins', hash: '#/money/margins' },
  { id: 'money/businesses', hash: '#/money/businesses' },
  { id: 'connections', hash: '#/connections' },
  { id: 'connections/ai', hash: '#/connections/ai' },
  { id: 'business/plan', hash: '#/business/plan' },
  { id: 'business/prices', hash: '#/business/prices' },
  { id: 'business/goals', hash: '#/business/goals' },
  { id: 'business/build', hash: '#/business/build' },
  { id: 'business/keep', hash: '#/business/keep' },
  { id: 'onboarding', hash: '#/onboarding' },
  // W4 4G4: the approval page and Business > Notifications (their numbers are set at integration).
  { id: 'approve', hash: '#/approve/next' },
  { id: 'business/notifications', hash: '#/business/notifications' },
  // W6 6J2: Business > Reports, the opt-in Send report (its budget is set from its first measure).
  { id: 'business/reports', hash: '#/business/reports' },
  // W4 4J22a: Practice with drills, what the loop tried and the guidance report; Routines (numbers set at integration).
  { id: 'business/practice', hash: '#/business/practice' },
  { id: 'business/routines', hash: '#/business/routines' },
  // C1 task 7: Settings' list is measured once, alone, as a phone shows it at #/business; beside a page it is not counted.
  { id: 'business', hash: '#/business', narrow: true },
  // C1 task 5: Work's Ideas, a page of its own.
  { id: 'work/ideas', hash: '#/work/ideas' },
];
