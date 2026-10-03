import { useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AskLine, useVoiceHold, type AskLineProps } from '../../app/ui/src/app/AskLine';
import { TextProvider } from '../../app/ui/src/app/text';
import { Sheet } from '../../app/ui/src/parts/Sheet';
import { TodayScreen } from '../../app/ui/src/screens/today/Today';
import type { TodayData, TodayIntents } from '../../app/ui/src/screens/today/TodayData';
import { ConversationAnswer } from '../../app/ui/src/screens/ask/ConversationAnswer';
import { validateConversationReadback } from '../../app/ui/src/bridge/conversation-contract';
import { fullCalculationReceiptFixture } from '../../app/ui/tests/fixtures';
import { readbackFixture } from '../../app/ui/tests/conversation-fixtures';

// All figures and checked replies are synthetic. Components have no live bridge.
function show(ui: ReactElement) {
  return render(<TextProvider language="en">{ui}</TextProvider>);
}

function todayData(): TodayData {
  return {
    state: { kind: 'ready' },
    date: 'Synthetic fixture · 1 October',
    review: {
      count: { exact: '2', display: '2' },
      rows: [
        {
          id: 'row-a', mark: 'you', what: 'Fixture review A', detail: 'Synthetic A detail', can: ['review'],
          figure: { kind: 'money', exact: '900', display: 'INR 9.00', receiptId: 'receipt-a', labels: [] },
        },
        {
          id: 'row-b', mark: 'you', what: 'Fixture review B', detail: 'Synthetic B detail', can: ['review'],
          figure: { kind: 'money', exact: '275', display: 'INR 2.75', receiptId: 'receipt-b', labels: [] },
        },
      ],
    },
  };
}

function ask(props: AskLineProps) {
  return show(<AskHarness {...props} />);
}

function AskHarness(props: AskLineProps) {
  const hold = useVoiceHold(props.voice);
  return <AskLine {...props} hold={hold} />;
}

function SheetHarness() {
  const origin = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" ref={origin} onClick={() => setOpen(true)}>Open fixture receipt</button>
      {open && (
        <Sheet kind="Receipt" title="Synthetic receipt detail" origin={origin.current} onClose={() => setOpen(false)}>
          <p>Checked fixture evidence</p>
        </Sheet>
      )}
    </>
  );
}

beforeEach(() => {
  // Fail locally if any component tries a network fetch. jsdom loads no remote assets.
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is unavailable in this fixture suite'));
});

afterEach(() => {
  cleanup();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('Today keyboard movement keeps receipt activation separate from opening and reviewing its row', async () => {
  const user = userEvent.setup();
  const onReview = vi.fn<TodayIntents['onReview']>();
  const onReceipt = vi.fn<TodayIntents['onReceipt']>();
  show(<TodayScreen data={todayData()} intents={{ onReview, onReceipt }} view="guided" onNavigate={vi.fn()} />);
  const a = screen.getByRole('button', { name: /Fixture review A/ });
  const b = screen.getByRole('button', { name: /Fixture review B/ });
  const receipt = screen.getByRole('button', { name: 'INR 2.75' });

  a.focus();
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(b);
  expect(b.tabIndex).toBe(0);
  expect(a.tabIndex).toBe(-1);
  await user.keyboard('{ArrowRight}{Enter}');
  expect(document.activeElement).toBe(receipt);
  expect(onReceipt).toHaveBeenCalledExactlyOnceWith('receipt-b');
  expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
  expect(onReview).not.toHaveBeenCalled();

  await user.keyboard('{ArrowLeft}{Enter}');
  expect(document.activeElement).toBe(b);
  await user.click(screen.getByRole('button', { name: 'Review' }));
  expect(onReview).toHaveBeenCalledExactlyOnceWith('row-b', b);
  expect(onReceipt).toHaveBeenCalledTimes(1);
});

test('opening a sheet focuses its title and closing returns to the actual originating control', async () => {
  const user = userEvent.setup();
  show(<SheetHarness />);
  const origin = screen.getByRole('button', { name: 'Open fixture receipt' });
  origin.focus();
  await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Synthetic receipt detail' }));
  await user.click(screen.getByRole('button', { name: /^Close/ }));
  expect(screen.queryByRole('heading', { name: 'Synthetic receipt detail' })).toBeNull();
  expect(document.activeElement).toBe(origin);
});

test('read-only Today removes cash, prepare, setup and update mutations while receipts remain readable', async () => {
  const user = userEvent.setup();
  const base = todayData();
  const onPrepare = vi.fn<NonNullable<TodayIntents['onPrepare']>>();
  const onSaveClosing = vi.fn<NonNullable<TodayIntents['onSaveClosing']>>();
  const onResumeSetup = vi.fn<NonNullable<TodayIntents['onResumeSetup']>>();
  const onUpdate = vi.fn<NonNullable<TodayIntents['onUpdate']>>();
  const onReceipt = vi.fn<TodayIntents['onReceipt']>();
  const data: TodayData = {
    ...base,
    state: { kind: 'read-only', holder: 'Fixture owner' },
    review: { rows: [{ id: 'prepare-row', mark: 'you', what: 'Fixture prepare', detail: 'Synthetic detail', can: ['prepare'] }] },
    setup: { step: '1', of: '2', can: ['continue'] },
    update: { can: ['update'] },
    cash: {
      entered: { kind: 'money', exact: '900', display: 'INR 9.00', receiptId: 'receipt-cash', labels: [] },
      week: { form: 'columns', sentence: 'Synthetic chart with no supplied points', values: [] },
    },
  };
  const intents = { onReview: vi.fn(), onPrepare, onSaveClosing, onResumeSetup, onUpdate, onReceipt };
  const { rerender } = show(<TodayScreen data={data} intents={intents} view="simple" onNavigate={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Fixture prepare/ }));
  expect(screen.queryByRole('button', { name: 'Prepare' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: "Today's cash sales" })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'INR 9.00' }));
  expect(onReceipt).toHaveBeenCalledExactlyOnceWith('receipt-cash');
  const unentered: TodayData = {
    ...data, cash: { week: { form: 'columns', sentence: 'Synthetic chart with no supplied points', values: [] } },
  };
  rerender(<TextProvider language="en"><TodayScreen data={unentered} intents={intents} view="simple" onNavigate={vi.fn()} /></TextProvider>);
  expect(screen.queryByRole('textbox', { name: "Today's cash sales" })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Enter' })).toBeNull();
  for (const callback of [onPrepare, onSaveClosing, onResumeSetup, onUpdate]) expect(callback).not.toHaveBeenCalled();
});

test('Simple Today submits a cash string once without numeric conversion, then clears the field', async () => {
  const user = userEvent.setup();
  const onSaveClosing = vi.fn<NonNullable<TodayIntents['onSaveClosing']>>();
  const data: TodayData = {
    ...todayData(),
    cash: { week: { form: 'columns', sentence: 'Synthetic chart with no supplied points', values: [] } },
  };
  show(<TodayScreen data={data} intents={{ onReview: vi.fn(), onReceipt: vi.fn(), onSaveClosing }} view="simple" onNavigate={vi.fn()} />);
  const field = screen.getByRole('textbox', { name: "Today's cash sales" });
  if (!(field instanceof HTMLInputElement)) throw new Error('Cash field must be an input');
  await user.type(field, '00,450.70');
  expect(onSaveClosing).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(onSaveClosing).toHaveBeenCalledExactlyOnceWith('00,450.70');
  expect(field.value).toBe('');
});

test('Ask preserves reviewed question text, submits only on Enter and has no absent voice control', async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn<AskLineProps['onAsk']>();
  ask({ onAsk });
  const field = screen.getByRole('textbox', { name: 'Ask a question, or give a task' });
  if (!(field instanceof HTMLInputElement)) throw new Error('Ask field must be an input');
  const question = '  Show the fixture receipts?  ';
  await user.type(field, question);
  expect(onAsk).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /talk|voice/i })).toBeNull();
  await user.keyboard('{Enter}');
  expect(onAsk).toHaveBeenCalledExactlyOnceWith(question);
  expect(field.value).toBe('');
  await user.type(field, '   {Enter}');
  expect(onAsk).toHaveBeenCalledTimes(1);
});

test('an explicitly off microphone opens settings without starting or ending a voice hold', async () => {
  const user = userEvent.setup();
  const onHoldStart = vi.fn();
  const onHoldEnd = vi.fn();
  const onOpenSettings = vi.fn();
  const onAsk = vi.fn();
  ask({ onAsk, voice: { on: false, onHoldStart, onHoldEnd, onOpenSettings } });
  await user.click(screen.getByRole('button', { name: /^Voice is off/ }));
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
  expect(onHoldStart).not.toHaveBeenCalled();
  expect(onHoldEnd).not.toHaveBeenCalled();
  expect(onAsk).not.toHaveBeenCalled();
});

test('checked calculation figures retain engine display strings and open only the calculation receipt', async () => {
  const user = userEvent.setup();
  const receipt = fullCalculationReceiptFixture();
  const wire = readbackFixture(receipt);
  const saved = validateConversationReadback(wire, wire.id);
  const onReference = vi.fn();
  const onContinue = vi.fn();
  const onPreviewFinalWriting = vi.fn();
  const { container } = show(<ConversationAnswer saved={saved} onReference={onReference} onContinue={onContinue} onPreviewFinalWriting={onPreviewFinalWriting} />);
  for (const figure of receipt.figures) {
    const control = screen.getByRole('button', { name: new RegExp(`^${figure.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,: ]`) });
    expect(control.textContent).toBe(figure.display);
  }
  await user.click(screen.getByRole('button', { name: /^Earned[,: ]/ }));
  expect(onReference).toHaveBeenCalledExactlyOnceWith({ kind: 'calculation-receipt', id: receipt.id });
  expect(screen.queryByRole('button', { name: 'Answer this' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Preview writing' })).toBeNull();
  const details = Array.from(container.querySelectorAll('details'));
  expect(details.length).toBeGreaterThan(0);
  expect(details.every(detail => !detail.open)).toBe(true);
  expect(onContinue).not.toHaveBeenCalled();
  expect(onPreviewFinalWriting).not.toHaveBeenCalled();
});

test('checked partial coverage with no counted rows shows unknown and never renders supplied figure values', () => {
  const receipt = fullCalculationReceiptFixture();
  const partial = {
    ...receipt, rows: [], rowIds: [],
    coverage: { ...receipt.coverage, selectedRows: 0, countedRows: 0, completeness: 'partial' },
  };
  const question = '<img src="fixture" onerror="fixtureSecret()">';
  const wire = readbackFixture(partial, question);
  const saved = validateConversationReadback(wire, wire.id);
  const { container } = show(<ConversationAnswer saved={saved} onReference={vi.fn()} />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(question);
  expect(container.querySelector('img, script')).toBeNull();
  expect(screen.getAllByText('not sure').length).toBeGreaterThan(0);
  for (const figure of receipt.figures) {
    expect(screen.queryByRole('button', { name: new RegExp(`^${figure.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,: ]`) })).toBeNull();
  }
});

test('clarification continuation passes the saved id and preserves model receipt identity', async () => {
  const user = userEvent.setup();
  const wire = readbackFixture({ clarification: 'Which fixture period?', modelReceiptId: 'model_preview_fixture' });
  const saved = validateConversationReadback(wire, wire.id);
  const onContinue = vi.fn();
  const onReference = vi.fn();
  show(<ConversationAnswer saved={saved} onContinue={onContinue} onReference={onReference} />);
  await user.click(screen.getByRole('button', { name: 'Answer this' }));
  expect(onContinue).toHaveBeenCalledExactlyOnceWith(saved.id);
  await user.click(screen.getByRole('button', { name: 'model_preview_fixture' }));
  expect(onReference).toHaveBeenCalledExactlyOnceWith({ kind: 'model-receipt', id: 'model_preview_fixture' });
});
