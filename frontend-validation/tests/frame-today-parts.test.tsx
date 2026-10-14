import type { ReactElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Approval, Language } from '../../app/ui/src/app/presentation';
import type { ReceiptView } from '../../app/ui/src/bridge/receipt-view';
import { receiptViewFromEvidence } from '../../app/ui/src/bridge/receipt-view';
import { Receipt } from '../../app/ui/src/parts/Receipt';
import { Table, sortRows, TABLE_ROW_PX, type TableColumn, type TableRow } from '../../app/ui/src/parts/Table';
import { Drawing, type DrawingDescription } from '../../app/ui/src/parts/Drawing';
import { TwoSides } from '../../app/ui/src/patterns/TwoSides';
import { SettingsRows } from '../../app/ui/src/patterns/SettingsRows';
import { ApprovalSheet, type ApprovalSheetApproval, type ApprovalSheetProps } from '../../app/ui/src/patterns/ApprovalSheet';
import { receiptEvidenceFixture } from '../../app/ui/tests/fixtures';
import en from '../../app/ui/src/text/en.json';
import hi from '../../app/ui/src/text/hi.json';

// Synthetic fixtures only. jsdom has no layout, so virtualization is checked against the
// supplied viewport height and the drawn rows, not against pixels.
function show(ui: ReactElement, language: Language = 'en') {
  return render(<TextProvider language={language}>{ui}</TextProvider>);
}

afterEach(() => {
  cleanup();
});

/* ---------- catalogues ---------- */

test('new words exist in both catalogues with no em dash or exclamation', () => {
  const prefixes = ['RECEIPT.', 'TABLE.', 'DRAWING.', 'SETTINGS.', 'WK-02.'];
  const enKeys = Object.keys(en).filter((k) => prefixes.some((p) => k.startsWith(p)));
  expect(enKeys.length).toBeGreaterThan(60);
  for (const key of enKeys) {
    expect(hi).toHaveProperty([key]);
    for (const text of [(en as Record<string, string>)[key], (hi as Record<string, string>)[key]]) {
      expect(text).not.toMatch(/[—!]/);
    }
  }
  for (const key of ['RECEIPT.openRows', 'RECEIPT.export', 'WK-02.runPractice']) {
    expect([...(en as Record<string, string>)[key]!].length).toBeLessThanOrEqual(22);
    expect([...(hi as Record<string, string>)[key]!].length).toBeLessThanOrEqual(22);
  }
});

/* ---------- Receipt ---------- */

function bareReceipt(): ReceiptView {
  return {
    receiptId: 'receipt-1',
    workedOut: { calculation: 'net-sales', rowsRead: { exact: '217', display: '217' }, totalChecked: true },
    calculation: 'net-sales',
    asKnownOn: '30 Sep 2026, 09:14',
    rowsCounted: { exact: '214', display: '214' },
    leftOut: [{ reason: 'Cancelled orders', rows: { exact: '3', display: '3' } }],
    totals: [{ key: 'net', label: 'Net sales', figure: { kind: 'money', exact: '31000000', display: '₹3,10,000', receiptId: 'receipt-1', labels: [] } }],
    smallPrint: {},
  };
}

test('receipt draws the six parts with only the small print supplied', () => {
  const onReceipt = vi.fn();
  show(<Receipt receipt={bareReceipt()} onReceipt={onReceipt} />);
  const receipt = screen.getByRole('article', { name: 'Receipt receipt-1' });
  expect(within(receipt).getByText('217 rows read')).toBeTruthy();
  expect(within(receipt).getByText('Calculation chosen: net-sales')).toBeTruthy();
  expect(within(receipt).getByText('No question asked')).toBeTruthy();
  expect(within(receipt).getByText('Total checked')).toBeTruthy();
  expect(within(receipt).getByText('30 Sep 2026, 09:14')).toBeTruthy();
  expect(within(receipt).getByText('Left out: Cancelled orders')).toBeTruthy();
  // Small print: only the receipt id, because nothing else was supplied.
  const small = receipt.querySelectorAll('[data-small]');
  expect([...small].map((el) => el.getAttribute('data-small'))).toEqual(['id']);
  for (const word of ['Source', 'Recipe', 'Meaning', 'Rate', 'Forecast', 'Number check', 'Allowed by', 'Model route']) {
    expect(within(receipt).queryByText(word)).toBeNull();
  }
  // No links without callbacks.
  expect(within(receipt).queryByRole('button', { name: 'Open the rows' })).toBeNull();
  expect(within(receipt).queryByRole('button', { name: 'Export' })).toBeNull();
  // The total is a figure that opens its receipt.
  fireEvent.click(within(receipt).getByRole('button', { name: '₹3,10,000' }));
  expect(onReceipt).toHaveBeenCalledWith('receipt-1');
});

test('receipt draws every supplied small print line in order and opens rows and export', () => {
  const onRows = vi.fn();
  const onExport = vi.fn();
  const r: ReceiptView = {
    ...bareReceipt(),
    workedOut: { ...bareReceipt().workedOut, question: 'What did we sell in September?' },
    smallPrint: {
      route: { kind: 'local', sendLevel: 'shape-only', cost: '₹0.40' },
      source: { names: 'Tally', wayIn: 'exported-file', readAt: '30 Sep' },
      numberGuard: { passed: true, matched: { exact: '3', display: '3' }, of: { exact: '3', display: '3' } },
      allowedBy: { text: 'You asked' },
      recipe: { state: 'tested', acceptedBy: 'you', grade: 'owner' },
    },
  };
  show(<Receipt receipt={r} onReceipt={() => {}} onOpenRows={onRows} onExport={onExport} />);
  const keys = [...document.querySelectorAll('[data-small]')].map((el) => el.getAttribute('data-small'));
  expect(keys).toEqual(['source', 'recipe', 'guard', 'allowed', 'route', 'id']);
  expect(screen.getByText('Tally · an exported file · read 30 Sep')).toBeTruthy();
  expect(screen.getByText('3 of 3 numbers match the receipt')).toBeTruthy();
  expect(screen.getByText('Your question: What did we sell in September?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open the rows' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect(onRows).toHaveBeenCalledWith('receipt-1');
  expect(onExport).toHaveBeenCalledWith('receipt-1');
  // Lines appear top to bottom: each carries the next index.
  const order = [...document.querySelectorAll<HTMLElement>('.m-appear')].map((el) => el.style.getPropertyValue('--i'));
  expect(order).toEqual(order.map((_, i) => String(i)));
});

test('receipt from the engine adapter renders in Hindi with a missing total as words', () => {
  const fixture = receiptEvidenceFixture();
  const view = receiptViewFromEvidence({ ...fixture, coverage: { ...fixture.coverage, completeness: 'empty' } }, { language: 'hi', timeZone: 'Asia/Kolkata' });
  show(<Receipt receipt={view} onReceipt={() => {}} />, 'hi');
  expect(screen.getAllByText('पक्का नहीं').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /₹/ })).toBeNull();
  expect(screen.getByText('कुल नहीं जांचा गया')).toBeTruthy();
});

/* ---------- Table ---------- */

const columns: TableColumn[] = [
  { id: 'name', label: 'Customer', kind: 'text', sortable: true },
  { id: 'amount', label: 'Amount', kind: 'money', sortable: true },
  { id: 'act', label: 'Action', kind: 'action' },
];

function moneyRow(id: string, paise: string, name = id): TableRow {
  return {
    id,
    cells: {
      name: { kind: 'text', text: name },
      amount: { kind: 'money', value: { kind: 'money', exact: paise, display: `D${paise}`, receiptId: `rc-${id}`, labels: [] } },
      act: { kind: 'action', actionId: 'remind', label: 'Remind' },
    },
  };
}

function manyRows(n: number): TableRow[] {
  return Array.from({ length: n }, (_, i) => moneyRow(`r${i}`, String(i), `Customer ${String(i).padStart(5, '0')}`));
}

test('table draws only the visible rows of 10,000 and keeps the full row count', () => {
  show(<Table label="Invoices" columns={columns} rows={manyRows(10000)} onOpen={() => {}} onReceipt={() => {}} height={320} overscan={4} />);
  const grid = screen.getByRole('grid', { name: 'Invoices' });
  expect(grid.getAttribute('aria-rowcount')).toBe('10001');
  const drawn = grid.querySelectorAll('[data-row-id]');
  expect(drawn.length).toBe(320 / TABLE_ROW_PX + 4);
  expect(drawn.length).toBeLessThan(40);
  expect(drawn[0]?.getAttribute('aria-rowindex')).toBe('2');
  // Scroll far down: other rows are drawn, with their true indices.
  const body = grid.querySelector<HTMLElement>('[role="rowgroup"]:last-child')!;
  body.scrollTop = 5000 * TABLE_ROW_PX;
  fireEvent.scroll(body);
  const after = [...grid.querySelectorAll('[data-row-id]')].map((el) => el.getAttribute('data-row-id'));
  expect(after).toContain('r5000');
  expect(after).toContain('r0'); // the row holding the tab stop stays drawn
  expect(after.length).toBeLessThan(40);
  const r5000 = grid.querySelector('[data-row-id="r5000"]');
  expect(r5000?.getAttribute('aria-rowindex')).toBe('5002');
});

test('table sorts money by exact value and text by supplied key, never by display', () => {
  const rows = [moneyRow('a', '200'), moneyRow('b', '-5'), moneyRow('c', '10'), { id: 'd', cells: { name: { kind: 'text' as const, text: 'zz', sortKey: '0' }, amount: { kind: 'money' as const, value: { kind: 'missing' as const, missing: 'unknown' as const } } } }];
  const asc = sortRows(rows, columns, { columnId: 'amount', direction: 'ascending' }).map((r) => r.id);
  expect(asc).toEqual(['b', 'c', 'a', 'd']);
  const desc = sortRows(rows, columns, { columnId: 'amount', direction: 'descending' }).map((r) => r.id);
  expect(desc).toEqual(['a', 'c', 'b', 'd']);
  // Values far past 2^53 compare exactly.
  const big = [moneyRow('x', '90071992547409930'), moneyRow('y', '90071992547409921')];
  expect(sortRows(big, columns, { columnId: 'amount', direction: 'ascending' }).map((r) => r.id)).toEqual(['y', 'x']);
  // Text sorts by its sortKey when supplied.
  expect(sortRows(rows, columns, { columnId: 'name', direction: 'ascending' }).map((r) => r.id)).toEqual(['d', 'a', 'b', 'c']);

  show(<Table label="Invoices" columns={columns} rows={rows} onReceipt={() => {}} />);
  const header = screen.getByRole('columnheader', { name: 'Amount' });
  expect(header.getAttribute('aria-sort')).toBe('none');
  fireEvent.click(within(header).getByRole('button', { name: 'Amount' }));
  expect(header.getAttribute('aria-sort')).toBe('ascending');
  const order = () => [...document.querySelectorAll('[data-row-id]')].sort((p, q) => Number(p.getAttribute('aria-rowindex')) - Number(q.getAttribute('aria-rowindex'))).map((el) => el.getAttribute('data-row-id'));
  expect(order()).toEqual(['b', 'c', 'a', 'd']);
  fireEvent.click(within(header).getByRole('button', { name: 'Amount' }));
  expect(header.getAttribute('aria-sort')).toBe('descending');
  expect(order()).toEqual(['a', 'c', 'b', 'd']);
});

test('table keys move the row focus, Enter opens, money opens its receipt separately', () => {
  const onOpen = vi.fn();
  const onReceipt = vi.fn();
  const onAction = vi.fn();
  show(<Table label="Invoices" columns={columns} rows={manyRows(200)} onOpen={onOpen} onReceipt={onReceipt} onAction={onAction} height={320} />);
  const first = screen.getByRole('button', { name: 'Customer 00000' });
  expect(first.tabIndex).toBe(0);
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(document.activeElement?.textContent).toBe('Customer 00001');
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(document.activeElement?.textContent).toBe('Customer 00199');
  expect(document.activeElement?.closest('[role="row"]')?.getAttribute('aria-rowindex')).toBe('201');
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement?.textContent).toBe('Customer 00000');
  // Only one tab stop among the rows.
  expect([...document.querySelectorAll('[data-row-main]')].filter((el) => (el as HTMLElement).tabIndex === 0).length).toBe(1);
  // Enter on the row button opens it (a native button press).
  fireEvent.click(document.activeElement!);
  expect(onOpen).toHaveBeenCalledWith('r0', expect.any(HTMLElement));
  // Right reaches the money figure, which opens its receipt and not the row.
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(document.activeElement?.textContent).toBe('D0');
  fireEvent.click(document.activeElement!);
  expect(onReceipt).toHaveBeenCalledWith('rc-r0');
  expect(onOpen).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(document.activeElement?.textContent).toBe('Remind');
  fireEvent.click(document.activeElement!);
  expect(onAction).toHaveBeenCalledWith('r0', 'remind');
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  expect(document.activeElement?.textContent).toBe('Customer 00000');
  // The open button and the figure button are separate, neither inside the other.
  const row = document.querySelector('[data-row-id="r0"]')!;
  const main = row.querySelector('[data-row-main]')!;
  expect(main.querySelector('button')).toBeNull();
});

/* ---------- Drawing ---------- */

const node = (id: string, label: string) => ({ id, mark: 'cha' as const, label });

test('drawing draws up to six typed nodes and refuses seven or long labels', () => {
  const ok: DrawingDescription = {
    layout: 'row',
    sentence: 'What left this computer today.',
    nodes: [node('a', 'Your books'), node('b', 'Shape only'), node('c', 'The model')],
    links: [{ from: 'a', to: 'b', kind: 'arrow' }, { from: 'b', to: 'c', kind: 'dashed' }, { from: 'a', to: 'c', kind: 'arrow' }],
  };
  const { unmount } = show(<Drawing drawing={ok} />);
  expect(document.querySelectorAll('[data-node]').length).toBe(3);
  expect(document.querySelectorAll('[data-link="dashed"]').length).toBe(1);
  expect(screen.getByText('Shape only leads to The model'.replace('leads', 'may lead'))).toBeTruthy();
  expect(screen.getByText('What left this computer today.')).toBeTruthy();
  unmount();

  const seven: DrawingDescription = { ...ok, nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => node(id, id)), links: [] };
  show(<Drawing drawing={seven} />);
  expect(screen.getByRole('note').textContent).toBe(en['DRAWING.refused']);
  expect(document.querySelector('svg')).toBeNull();
  cleanup();

  const wordy: DrawingDescription = { ...ok, nodes: [node('a', 'one two three four five')], links: [] };
  show(<Drawing drawing={wordy} />);
  expect(screen.getByRole('note')).toBeTruthy();
  cleanup();

  const dangling: DrawingDescription = { ...ok, links: [{ from: 'a', to: 'nowhere', kind: 'arrow' }] };
  show(<Drawing drawing={dangling} />);
  expect(screen.getByRole('note')).toBeTruthy();
});

/* ---------- TwoSides and SettingsRows ---------- */

test('two sides keep their own headings and labels', () => {
  show(
    <TwoSides
      title="Why it changed"
      left={{ heading: 'As known then', label: 'measured', children: <p>Left body</p> }}
      right={{ heading: 'As known now', label: 'guess', children: <p>Right body</p> }}
    />,
  );
  const group = screen.getByRole('group', { name: 'Why it changed' });
  const left = within(group).getByRole('region', { name: /As known then/ });
  const right = within(group).getByRole('region', { name: /As known now/ });
  expect(within(left).getByText('Left body')).toBeTruthy();
  expect(within(right).getByText('Right body')).toBeTruthy();
  expect(within(left).getByText('measured')).toBeTruthy();
  expect(within(right).getByText('guess')).toBeTruthy();
  expect(left.contains(right)).toBe(false);
});

test('settings rows open in place, one at a time, with No and Yes or a row of words', () => {
  const onYes = vi.fn();
  const onWord = vi.fn();
  show(
    <SettingsRows
      label="Trust"
      rows={[
        { id: 'share', what: 'Share structure', current: 'No', choice: { form: 'yes-no', value: false, onChange: onYes } },
        { id: 'send', what: 'Send level', current: 'Shape only', choice: { form: 'words', value: 'shape', onChange: onWord, options: [{ value: 'nothing', label: 'Nothing' }, { value: 'shape', label: 'Shape only' }, { value: 'samples', label: 'Samples' }] } },
      ]}
    />,
  );
  const share = screen.getByRole('button', { name: /Share structure/ });
  expect(share.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('radiogroup')).toBeNull();
  fireEvent.click(share);
  expect(share.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
  expect(onYes).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: /Send level/ }));
  expect(share.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('radio', { name: 'Samples' }));
  expect(onWord).toHaveBeenCalledWith('samples');
  cleanup();

  show(<SettingsRows label="Trust" readOnly rows={[{ id: 'share', what: 'Share structure', current: 'No', choice: { form: 'yes-no', value: false, onChange: onYes } }]} />);
  fireEvent.click(screen.getByRole('button', { name: /Share structure/ }));
  expect((screen.getByRole('radio', { name: 'Yes' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(en['SETTINGS.locked'])).toBeTruthy();
});

/* ---------- ApprovalSheet variants ---------- */

function approval(over: Partial<ApprovalSheetApproval> = {}): ApprovalSheetApproval {
  const base: Approval = {
    approvalId: 'ap-1',
    kind: 'message',
    state: 'prepared',
    what: 'Send a payment reminder',
    target: [{ name: 'To', value: 'Kiran Retail Demo' }],
    change: { asWritten: 'Dear Kiran, invoice 42 is due.' },
    steps: [
      { nameKey: 'STEP.prepared', state: 'done' },
      { nameKey: 'STEP.approve', state: 'waiting-for-you' },
      { nameKey: 'STEP.send', state: 'not-reached' },
      { nameKey: 'STEP.read-back', state: 'not-reached' },
      { nameKey: 'STEP.recorded', state: 'not-reached' },
    ],
    note: 'Nothing changes in your books. Expires in 24 hours.',
    readOnly: false,
    prepareOnly: false,
    needsSecondAsk: false,
    can: ['approve', 'notNow', 'change', 'drop'],
  };
  return { ...base, ...over };
}

function sheet(a: ApprovalSheetApproval, extra: Partial<ApprovalSheetProps> = {}) {
  const props: ApprovalSheetProps = {
    approval: a,
    origin: null,
    onClose: vi.fn(),
    onApprove: vi.fn(),
    onSecondAsk: vi.fn(),
    onNotNow: vi.fn(),
    onChange: vi.fn(),
    onDrop: vi.fn(),
    onDownloadPrepared: vi.fn(),
    onReceipt: vi.fn(),
    ...extra,
  };
  show(<ApprovalSheet {...props} />);
  return props;
}

test('message approval shows the waiting reason, exact text, five steps, the note and its controls', () => {
  const p = sheet(approval({ waitsBecause: 'messages to outsiders always wait', tierWord: 'tier 2' }));
  expect(screen.getByText('Waits because messages to outsiders always wait.')).toBeTruthy();
  expect(screen.getByText('Dear Kiran, invoice 42 is due.').tagName).toBe('PRE');
  expect(screen.getByText('tier 2')).toBeTruthy();
  expect(document.querySelectorAll('ol li').length).toBe(5);
  expect(screen.getByText('Nothing changes in your books. Expires in 24 hours.')).toBeTruthy();
  for (const name of ['Approve', 'Not now', 'Change', 'Drop']) expect(screen.getByRole('button', { name })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(p.onApprove).toHaveBeenCalledWith('ap-1');
  expect(p.onSecondAsk).not.toHaveBeenCalled();
});

test('record change shows before and after side by side with the old value struck through', () => {
  sheet(approval({ kind: 'record-change', change: { fields: [{ name: 'Price', before: '₹120', after: '₹135' }] } }));
  const old = screen.getByText('₹120');
  expect(old.tagName).toBe('S');
  expect(screen.getByText('₹135').tagName).toBe('TD');
  expect(screen.getByRole('columnheader', { name: 'Before' })).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'After' })).toBeTruthy();
});

test('money always goes to the second ask', () => {
  const p = sheet(approval({ kind: 'money', needsSecondAsk: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(p.onSecondAsk).toHaveBeenCalledWith('ap-1');
  expect(p.onApprove).not.toHaveBeenCalled();
  expect(screen.getByText(en['WK-02.secondAsk'])).toBeTruthy();
});

test('prepare-only and the voucher preview have no Approve', () => {
  sheet(approval({ kind: 'prepare-only', prepareOnly: true }));
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.getByRole('button', { name: en['BTN.download'] })).toBeTruthy();
  expect(screen.getByText(en['WK-02.prepareOnly'])).toBeTruthy();
  cleanup();

  sheet(approval({
    kind: 'voucher-preview',
    change: {},
    voucher: {
      lines: [
        { id: 'l1', ledger: 'Kiran Retail Demo', side: 'dr', amount: { kind: 'money', exact: '1180000', display: '₹11,800', receiptId: 'rv-1', labels: [] } },
        { id: 'l2', ledger: 'Sales', side: 'cr', amount: { kind: 'money', exact: '1000000', display: '₹10,000', receiptId: 'rv-2', labels: [] } },
      ],
    },
  }));
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.getByText(en['WK-02.voucherNotEntered'])).toBeTruthy();
  const table = document.querySelector('[data-voucher]')!;
  expect(within(table as HTMLElement).getByText('Dr')).toBeTruthy();
  expect(within(table as HTMLElement).getByText('Cr')).toBeTruthy();
  const debitRow = within(table as HTMLElement).getByText('Kiran Retail Demo').closest('tr')!;
  const cells = debitRow.querySelectorAll('td');
  expect(cells[0]?.textContent).toContain('₹11,800');
  expect(cells[1]?.textContent).toBe('');
});

test('practice relabels the sheet and Approve, and money still asks again', () => {
  const p = sheet(approval({ practice: true }));
  expect(screen.getByText('Practice: sends nothing, changes nothing')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Run practice' }));
  expect(p.onApprove).toHaveBeenCalledWith('ap-1');
  cleanup();

  const m = sheet(approval({ practice: true, kind: 'money' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run practice' }));
  expect(m.onSecondAsk).toHaveBeenCalled();
  expect(m.onApprove).not.toHaveBeenCalled();
});

test('a group shows each item one after another with its count, and a job shows its card', () => {
  sheet(approval({ kind: 'group', group: { index: '1', total: '3', canBeUndone: true } }));
  expect(screen.getByText('1 of 3')).toBeTruthy();
  expect(screen.getByText('can be undone')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Approve' }).length).toBe(1);
  cleanup();

  sheet(approval({ kind: 'job', change: {}, job: { name: 'Weekly reminders', facts: [{ name: 'When', value: 'Mondays' }] } }));
  const card = screen.getByRole('region', { name: 'The proposed job' });
  expect(within(card).getByText('Weekly reminders')).toBeTruthy();
  expect(within(card).getByText('Mondays')).toBeTruthy();
});

test('read only shows no mutation control in any variant', () => {
  for (const over of [
    { kind: 'message' as const },
    { kind: 'money' as const },
    { kind: 'group' as const, group: { index: '2', total: '3' } },
    { kind: 'message' as const, practice: true },
    { kind: 'prepare-only' as const, prepareOnly: true },
  ]) {
    sheet(approval({ ...over, readOnly: true }));
    for (const name of ['Approve', 'Run practice', 'Not now', 'Change', 'Drop', en['BTN.download']]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.getByText(en['WK-02.readOnly.plain'])).toBeTruthy();
    cleanup();
  }
});

test('approval variant words render in Hindi', () => {
  sheet(approval({ practice: true, waitsBecause: 'बाहर के संदेश हमेशा रुकते हैं' }));
  cleanup();
  render(
    <TextProvider language="hi">
      <ApprovalSheet approval={approval({ practice: true, waitsBecause: 'बाहर के संदेश हमेशा रुकते हैं' })} origin={null} onClose={() => {}} onApprove={() => {}} onSecondAsk={() => {}} onNotNow={() => {}} onReceipt={() => {}} />
    </TextProvider>,
  );
  expect(screen.getByRole('button', { name: hi['WK-02.runPractice'] })).toBeTruthy();
  expect(screen.getByText('रुका है क्योंकि बाहर के संदेश हमेशा रुकते हैं।')).toBeTruthy();
});
