import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TextProvider } from '../../app/ui/src/app/text';
import type { ChartValue, FigureOrMissing, Missing } from '../../app/ui/src/app/presentation';
import { Chart } from '../../app/ui/src/parts/charts/Chart';
import { Columns } from '../../app/ui/src/parts/charts/Columns';
import { RankedBars } from '../../app/ui/src/parts/charts/RankedBars';
import { Bridge } from '../../app/ui/src/parts/charts/Bridge';
import { GoalLine } from '../../app/ui/src/parts/charts/GoalLine';
import { StepLine } from '../../app/ui/src/parts/charts/StepLine';
import { PairBars } from '../../app/ui/src/parts/charts/PairBars';
import { Spark } from '../../app/ui/src/parts/charts/Spark';
import { RuleBar } from '../../app/ui/src/parts/charts/RuleBar';
import { Strip } from '../../app/ui/src/parts/Strip';
import type { BridgeStep } from '../../app/ui/src/parts/charts/types';
import en from '../../app/ui/src/text/en.json';
import hi from '../../app/ui/src/text/hi.json';

// Every figure here is synthetic. The parts have no bridge; receipts are a spy.
const words = en as Record<string, string>;

function show(ui: ReactElement, language: 'en' | 'hi' = 'en') {
  return render(<TextProvider language={language}>{ui}</TextProvider>);
}

function fig(exact: string, display: string, receiptId: string): FigureOrMissing {
  return { kind: 'money', exact, display, receiptId, labels: [] };
}

function gap(missing: Missing = 'not-loaded-yet'): FigureOrMissing {
  return { kind: 'missing', missing };
}

function val(id: string, label: string, value: FigureOrMissing, extra: Partial<ChartValue> = {}): ChartValue {
  return { id, label, value, ...extra };
}

const open = (label: string, amount: string) => `Open the receipt for ${label}, ${amount}`;

/** Focus the first button, then Right, Right, Left, End, Home. Focus moves mark to mark
 *  and holds at the ends. */
function expectArrowMoves(buttons: HTMLElement[]) {
  expect(buttons.length).toBeGreaterThan(1);
  const [first] = buttons;
  const last = buttons[buttons.length - 1];
  first!.focus();
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first!, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(buttons[1]);
  fireEvent.keyDown(buttons[1]!, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first!, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first!, { key: 'End' });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last!, { key: 'Home' });
  expect(document.activeElement).toBe(first);
}

function noButtonNamed(fragment: string) {
  for (const b of screen.queryAllByRole('button')) expect(b.getAttribute('aria-label') ?? b.textContent ?? '').not.toContain(fragment);
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is unavailable in this fixture suite'));
});

afterEach(() => cleanup());

test('the new chart words exist in both catalogues with no em dash or exclamation mark', () => {
  const keys = Object.keys(en).filter((k) => k.startsWith('CHART.bridge.') || k.startsWith('CHART.goalLine.') || k.startsWith('CHART.ruleBar.') || k.startsWith('CHART.strip.'));
  expect(keys.sort()).toEqual(['CHART.bridge.guess', 'CHART.bridge.guessLabel', 'CHART.bridge.mixed', 'CHART.goalLine.rule', 'CHART.ruleBar.value', 'CHART.strip.failed', 'CHART.strip.open']);
  for (const k of keys) {
    const h = (hi as Record<string, string>)[k];
    expect(h, k).toBeTypeOf('string');
    for (const text of [words[k]!, h!]) expect(text).not.toMatch(/[—!]/);
  }
});

describe('RankedBars', () => {
  const values = [
    val('a', 'Asha Traders', fig('120000', 'INR 1,200.00', 'r-a'), { emphasis: true }),
    val('b', 'Bharat Mills', fig('40000', 'INR 400.00', 'r-b')),
    val('c', 'Credit notes', fig('-25000', '-INR 250.00', 'r-c')),
    val('d', 'Dev Stores', gap('withheld')),
  ];
  const chart = { form: 'ranked-bars' as const, sentence: 'Sales by customer, largest first.', values };

  test('known rows are buttons that open their own receipt, in the order given', () => {
    const onReceipt = vi.fn();
    show(<RankedBars chart={chart} onReceipt={onReceipt} />);
    const group = screen.getByRole('group', { name: chart.sentence });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([open('Asha Traders', 'INR 1,200.00'), open('Bharat Mills', 'INR 400.00'), open('Credit notes', '-INR 250.00')]);
    fireEvent.click(buttons[2]!);
    expect(onReceipt).toHaveBeenCalledWith('r-c');
    fireEvent.keyDown(buttons[0]!, { key: 'Enter' });
    expect(onReceipt).toHaveBeenLastCalledWith('r-a');
  });

  test('a negative value draws a bar left of the shared zero; written values stay as given', () => {
    const { container } = show(<RankedBars chart={chart} onReceipt={() => {}} />);
    const rects = Array.from(container.querySelectorAll('g[data-mark] > rect[rx]'));
    expect(rects).toHaveLength(3);
    const [pos, , neg] = rects.map((r) => ({ x: Number(r.getAttribute('x')), w: Number(r.getAttribute('width')) }));
    expect(neg!.x + neg!.w).toBeCloseTo(pos!.x, 5);
    expect(screen.getByText('-INR 250.00')).toBeTruthy();
  });

  test('a missing row writes its words and is not a button', () => {
    show(<RankedBars chart={chart} onReceipt={() => {}} />);
    expect(screen.getByText(words['MISSING.withheld']!)).toBeTruthy();
    noButtonNamed('Dev Stores');
  });

  test('arrow keys move from row to row', () => {
    show(<RankedBars chart={chart} onReceipt={() => {}} />);
    expectArrowMoves(screen.getAllByRole('button'));
  });

  test('empty input and all-missing input give the chart-state reason', () => {
    show(<RankedBars chart={{ ...chart, values: [] }} onReceipt={() => {}} />);
    expect(screen.getByText(words['CHART.unavailable.CHART_HAS_NO_POINTS']!)).toBeTruthy();
    cleanup();
    show(<RankedBars chart={{ ...chart, values: [val('x', 'Nobody', gap())] }} onReceipt={() => {}} />);
    expect(screen.getByText(words['CHART.unavailable.CHART_HAS_NO_KNOWN_POINTS']!)).toBeTruthy();
    expect(screen.getByText(`Nobody: ${words['MISSING.not-loaded-yet']}`)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('Bridge', () => {
  const step = (id: string, label: string, kind: BridgeStep['kind'], value: FigureOrMissing, from?: string, to?: string): BridgeStep => ({
    id, label, kind, value, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }),
  });
  const steps: BridgeStep[] = [
    step('s', 'August', 'start', fig('100000', 'INR 1,000.00', 'r-start'), '0', '100000'),
    step('m1', 'Fewer sales', 'measured', fig('-40000', '-INR 400.00', 'r-m1'), '100000', '60000'),
    step('m2', 'Late payments', 'measured', gap('not-counted')),
    step('m3', 'Price rise', 'measured', fig('10000', 'INR 100.00', 'r-m3'), '60000', '70000'),
    step('g1', 'Festival week', 'guess', fig('-5000', '-INR 50.00', 'r-g1'), '70000', '65000'),
    step('e', 'September', 'end', fig('65000', 'INR 650.00', 'r-end'), '0', '65000'),
  ];
  const chart = { form: 'bridge' as const, sentence: 'Why sales moved from August to September.', steps };

  test('start, causes and end are buttons for their receipts; a guess says so in its name and in words', () => {
    const onReceipt = vi.fn();
    show(<Bridge chart={chart} onReceipt={onReceipt} />);
    const buttons = within(screen.getByRole('group', { name: chart.sentence })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      open('August', 'INR 1,000.00'),
      open('Fewer sales', '-INR 400.00'),
      open('Price rise', 'INR 100.00'),
      open('Festival week, a guess', '-INR 50.00'),
      open('September', 'INR 650.00'),
    ]);
    fireEvent.click(buttons[3]!);
    expect(onReceipt).toHaveBeenCalledWith('r-g1');
    expect(screen.getAllByText(words['CHART.bridge.guess']!)).toHaveLength(1);
  });

  test('a missing cause is a gap with its words, not a button', () => {
    show(<Bridge chart={chart} onReceipt={() => {}} />);
    expect(screen.getByText(`Late payments: ${words['MISSING.not-counted']}`)).toBeTruthy();
    noButtonNamed('Late payments');
  });

  test('segments are placed from the levels the engine sent, below zero too', () => {
    const below: BridgeStep[] = [
      step('s', 'Start', 'start', fig('-20000', '-INR 200.00', 'r-s'), '0', '-20000'),
      step('u', 'Up', 'measured', fig('50000', 'INR 500.00', 'r-u'), '-20000', '30000'),
      step('e', 'End', 'end', fig('30000', 'INR 300.00', 'r-e'), '0', '30000'),
    ];
    const { container } = show(<Bridge chart={{ ...chart, steps: below }} onReceipt={() => {}} />);
    const bars = Array.from(container.querySelectorAll('g[data-mark] > rect[rx]')).map((r) => ({ y: Number(r.getAttribute('y')), h: Number(r.getAttribute('height')) }));
    expect(bars).toHaveLength(3);
    const [start, up, end] = bars;
    // The start hangs below zero; the cause spans from the start's foot to the end's top.
    expect(start!.y + start!.h).toBeCloseTo(up!.y + up!.h, 5);
    expect(up!.y).toBeCloseTo(end!.y, 5);
    expect(start!.y).toBeCloseTo(end!.y + end!.h, 5);
  });

  test('a guess among measured causes is refused and written out, every figure still opening its receipt', () => {
    const onReceipt = vi.fn();
    const mixed = [steps[0]!, steps[4]!, steps[1]!, steps[5]!];
    show(<Bridge chart={{ ...chart, steps: mixed }} onReceipt={onReceipt} />);
    expect(screen.getByText(words['CHART.bridge.mixed']!)).toBeTruthy();
    expect(screen.getByText('Festival week, a guess')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '-INR 50.00' }));
    expect(onReceipt).toHaveBeenCalledWith('r-g1');
  });

  test('arrow keys move from step to step', () => {
    show(<Bridge chart={chart} onReceipt={() => {}} />);
    expectArrowMoves(screen.getAllByRole('button'));
  });

  test('empty input gives the chart-state reason', () => {
    show(<Bridge chart={{ ...chart, steps: [] }} onReceipt={() => {}} />);
    expect(screen.getByText(words['CHART.unavailable.CHART_HAS_NO_POINTS']!)).toBeTruthy();
  });
});

describe('GoalLine', () => {
  const values = [
    val('w1', 'Week 1', fig('10', '10', 'r-w1')),
    val('w2', 'Week 2', gap()),
    val('w3', 'Week 3', fig('-5', '-5', 'r-w3')),
    val('w4', 'Week 4', fig('30', '30', 'r-w4')),
  ];
  const goal = val('goal', 'Goal', fig('50', '50', 'r-goal'));
  const chart = { form: 'goal-line' as const, sentence: 'Invoices chased each week against the goal of 50.', values, goal, from: 'Week 1', to: 'Week 4' };

  test('points and the goal rule are buttons opening their receipts; the rule carries its label', () => {
    const onReceipt = vi.fn();
    show(<GoalLine chart={chart} onReceipt={onReceipt} />);
    const buttons = within(screen.getByRole('group', { name: chart.sentence })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([open('Week 1', '10'), open('Week 3', '-5'), open('Week 4', '30'), open('Goal', '50')]);
    fireEvent.click(buttons[3]!);
    expect(onReceipt).toHaveBeenCalledWith('r-goal');
    expect(screen.getByText('Goal: 50', { selector: 'text' })).toBeTruthy();
  });

  test('a missing week and a missing goal are words, never buttons', () => {
    show(<GoalLine chart={{ ...chart, goal: val('goal', 'Goal', gap('not-agreed')) }} onReceipt={() => {}} />);
    expect(screen.getByText(`Week 2: ${words['MISSING.not-loaded-yet']}`)).toBeTruthy();
    expect(screen.getByText(`Goal: ${words['MISSING.not-agreed']}`)).toBeTruthy();
    noButtonNamed('Week 2');
    noButtonNamed('Goal');
  });

  test('arrow keys move from point to point and on to the goal', () => {
    show(<GoalLine chart={chart} onReceipt={() => {}} />);
    expectArrowMoves(screen.getAllByRole('button'));
  });

  test('empty input gives the chart-state reason', () => {
    show(<GoalLine chart={{ ...chart, values: [] }} onReceipt={() => {}} />);
    expect(screen.getByText(words['CHART.unavailable.CHART_HAS_NO_POINTS']!)).toBeTruthy();
  });
});

describe('StepLine', () => {
  const values = [
    val('v1', '1 Jul', fig('5000', 'INR 50.00', 'r-v1')),
    val('v2', '9 Jul', fig('-2000', '-INR 20.00', 'r-v2')),
    val('v3', '20 Jul', gap('unknown')),
    val('v4', '2 Aug', fig('8000', 'INR 80.00', 'r-v4')),
  ];
  const chart = { form: 'step-line' as const, sentence: 'What the GST payable was believed to be over July.', values, from: '1 Jul', to: '2 Aug' };

  test('each known step is a button for its receipt, negatives included', () => {
    const onReceipt = vi.fn();
    show(<StepLine chart={chart} onReceipt={onReceipt} />);
    const buttons = within(screen.getByRole('group', { name: chart.sentence })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([open('1 Jul', 'INR 50.00'), open('9 Jul', '-INR 20.00'), open('2 Aug', 'INR 80.00')]);
    fireEvent.click(buttons[1]!);
    expect(onReceipt).toHaveBeenCalledWith('r-v2');
  });

  test('a gap breaks the line and writes its words', () => {
    const { container } = show(<StepLine chart={chart} onReceipt={() => {}} />);
    expect(container.querySelectorAll('path')).toHaveLength(2);
    expect(screen.getByText(`20 Jul: ${words['MISSING.unknown']}`)).toBeTruthy();
    noButtonNamed('20 Jul');
  });

  test('arrow keys move from step to step', () => {
    show(<StepLine chart={chart} onReceipt={() => {}} />);
    expectArrowMoves(screen.getAllByRole('button'));
  });

  test('empty and all-missing input give the chart-state reason', () => {
    show(<StepLine chart={{ ...chart, values: [] }} onReceipt={() => {}} />);
    expect(screen.getByText(words['CHART.unavailable.CHART_HAS_NO_POINTS']!)).toBeTruthy();
    cleanup();
    show(<StepLine chart={{ ...chart, values: [values[2]!] }} onReceipt={() => {}} />);
    expect(screen.getByText(words['CHART.unavailable.CHART_HAS_NO_KNOWN_POINTS']!)).toBeTruthy();
  });
});

describe('PairBars', () => {
  const chart = {
    form: 'pair-bars' as const,
    sentence: 'Unmatched rows before and after the meaning was tried on a copy.',
    before: val('before', 'Before', fig('412', '412', 'r-before')),
    after: val('after', 'After', fig('-14', '-14', 'r-after')),
  };

  test('before and after are buttons for their own receipts', () => {
    const onReceipt = vi.fn();
    show(<PairBars chart={chart} onReceipt={onReceipt} />);
    const buttons = within(screen.getByRole('group', { name: chart.sentence })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([open('Before', '412'), open('After', '-14')]);
    fireEvent.click(buttons[0]!);
    fireEvent.keyDown(buttons[1]!, { key: ' ' });
    expect(onReceipt.mock.calls).toEqual([['r-before'], ['r-after']]);
  });

  test('a missing side writes its words and is not a button', () => {
    show(<PairBars chart={{ ...chart, after: val('after', 'After', gap('not-counted')) }} onReceipt={() => {}} />);
    expect(screen.getByText(words['MISSING.not-counted']!)).toBeTruthy();
    noButtonNamed('After');
  });

  test('arrow keys move between the two bars', () => {
    show(<PairBars chart={chart} onReceipt={() => {}} />);
    expectArrowMoves(screen.getAllByRole('button'));
  });

  test('two missing sides give the chart-state reason', () => {
    show(<PairBars chart={{ ...chart, before: val('before', 'Before', gap()), after: val('after', 'After', gap()) }} onReceipt={() => {}} />);
    expect(screen.getByText(words['CHART.unavailable.CHART_HAS_NO_KNOWN_POINTS']!)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('Strip', () => {
  const cells = [
    { state: 'done' as const, label: 'April', receiptId: 'r-apr' },
    { state: 'done' as const, label: 'May', receiptId: 'r-may' },
    { state: 'loading' as const, label: 'June' },
    { state: 'refused' as const, label: 'July' },
    { state: 'failed' as const, label: 'August' },
    { state: 'not-done' as const, label: 'September' },
    { state: 'done' as const, label: 'October' },
  ];

  test('a loaded month with a receipt is a button; the other months are words only', () => {
    const onReceipt = vi.fn();
    show(<Strip cells={cells} sentence="Months of Tally loaded this year." onReceipt={onReceipt} />);
    const group = screen.getByRole('group', { name: 'Months of Tally loaded this year.' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Open the receipt for April, done', 'Open the receipt for May, done']);
    fireEvent.click(buttons[1]!);
    expect(onReceipt).toHaveBeenCalledWith('r-may');
    expect(screen.getByText(`August: ${words['CHART.strip.failed']}.`)).toBeTruthy();
    expect(screen.getByText(`July: ${words['STRIP.refused']}.`)).toBeTruthy();
    expect(screen.getByText(`October: ${words['STRIP.done']}.`)).toBeTruthy();
    noButtonNamed('October');
  });

  test('arrow keys move between loaded months', () => {
    show(<Strip cells={cells} sentence="Months loaded." onReceipt={() => {}} />);
    expectArrowMoves(screen.getAllByRole('button'));
  });

  test('without onReceipt the strip keeps its old behaviour, with the failed word added', () => {
    const { container } = show(<Strip cells={cells} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelector('[aria-hidden="true"]')!.children).toHaveLength(cells.length);
    expect(container.textContent).toContain(`August: ${words['CHART.strip.failed']}.`);
  });

  test('a chart strip with no cells gives the chart-state reason', () => {
    show(<Strip cells={[]} sentence="Months loaded." onReceipt={() => {}} />);
    expect(screen.getByText(words['CHART.unavailable.CHART_HAS_NO_POINTS']!)).toBeTruthy();
  });
});

describe('Spark', () => {
  const chart = {
    form: 'spark' as const,
    sentence: 'Receivables over twelve weeks, rising at the end.',
    values: [val('a', 'W1', fig('100', '1', 'r-1')), val('b', 'W2', gap()), val('c', 'W3', fig('-50', '-0.5', 'r-3')), val('d', 'W4', fig('300', '3', 'r-4'))],
    figure: fig('300', 'INR 3.00', 'r-row'),
  };

  test('the trend is a picture with its sentence; only the row figure is a button and opens the receipt', () => {
    const onReceipt = vi.fn();
    show(<Spark chart={chart} onReceipt={onReceipt} />);
    expect(screen.getByRole('img', { name: chart.sentence })).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onReceipt).toHaveBeenCalledWith('r-row');
    // Nothing to move among: the arrow keys leave the single control where it is.
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[0]);
  });

  test('a missing point breaks the line; a negative point is still drawn', () => {
    const { container } = show(<Spark chart={chart} onReceipt={() => {}} />);
    // One lone point before the gap, one run after it.
    expect(container.querySelectorAll('path')).toHaveLength(1);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  test('a missing row figure is words and not a button', () => {
    show(<Spark chart={{ ...chart, figure: gap('withheld') }} onReceipt={() => {}} />);
    expect(screen.getByText(words['MISSING.withheld']!)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  test('empty input gives the chart-state reason and keeps the figure', () => {
    show(<Spark chart={{ ...chart, values: [] }} onReceipt={() => {}} />);
    expect(screen.getByText(words['CHART.unavailable.CHART_HAS_NO_POINTS']!)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'INR 3.00' })).toBeTruthy();
  });
});

describe('RuleBar', () => {
  const chart = {
    form: 'rule-bar' as const,
    sentence: 'An invoice of INR 620 against the rule for small invoices, INR 500.',
    rule: val('rule', 'Small invoice limit', fig('50000', 'INR 500.00', 'r-rule')),
    example: val('ex', 'This invoice', fig('62000', 'INR 620.00', 'r-ex')),
    caption: '398 of 412 past invoices fit',
  };

  test('the example and the rule are buttons with written labels, and the caption is shown as given', () => {
    const onReceipt = vi.fn();
    show(<RuleBar chart={chart} onReceipt={onReceipt} />);
    const buttons = within(screen.getByRole('group', { name: chart.sentence })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([open('This invoice', 'INR 620.00'), open('Small invoice limit', 'INR 500.00')]);
    fireEvent.click(buttons[1]!);
    expect(onReceipt).toHaveBeenCalledWith('r-rule');
    expect(screen.getByText('Small invoice limit: INR 500.00', { selector: 'text' })).toBeTruthy();
    expect(screen.getByText('This invoice: INR 620.00', { selector: 'text' })).toBeTruthy();
    expect(screen.getByText('398 of 412 past invoices fit')).toBeTruthy();
  });

  test('a negative example runs left of zero', () => {
    const { container } = show(<RuleBar chart={{ ...chart, example: val('ex', 'Credit note', fig('-10000', '-INR 100.00', 'r-ex')) }} onReceipt={() => {}} />);
    const bar = container.querySelector('g[data-mark] > rect[rx]')!;
    const zeroTick = container.querySelectorAll('svg > line')[1]!;
    expect(Number(bar.getAttribute('x')) + Number(bar.getAttribute('width'))).toBeCloseTo(Number(zeroTick.getAttribute('x1')), 5);
  });

  test('a missing rule writes its words and is not a button', () => {
    show(<RuleBar chart={{ ...chart, rule: val('rule', 'Small invoice limit', gap('not-agreed')) }} onReceipt={() => {}} />);
    expect(screen.getByText(`Small invoice limit: ${words['MISSING.not-agreed']}`)).toBeTruthy();
    noButtonNamed('Small invoice limit');
  });

  test('arrow keys move between the example and the rule', () => {
    show(<RuleBar chart={chart} onReceipt={() => {}} />);
    expectArrowMoves(screen.getAllByRole('button'));
  });

  test('both missing gives the chart-state reason', () => {
    show(<RuleBar chart={{ ...chart, rule: val('rule', 'Limit', gap()), example: val('ex', 'Invoice', gap()) }} onReceipt={() => {}} />);
    expect(screen.getByText(words['CHART.unavailable.CHART_HAS_NO_KNOWN_POINTS']!)).toBeTruthy();
  });
});

describe('shared behaviour', () => {
  test('Chart draws each new form from its typed description', () => {
    const onReceipt = vi.fn();
    show(<Chart chart={{ form: 'ranked-bars', sentence: 'By customer.', values: [val('a', 'A', fig('1', '1', 'r-a'))] }} onReceipt={onReceipt} />);
    fireEvent.click(screen.getByRole('button', { name: open('A', '1') }));
    expect(onReceipt).toHaveBeenCalledWith('r-a');
    cleanup();
    show(<Chart chart={{ form: 'strip', sentence: 'Months.', cells: [{ state: 'done', label: 'April', receiptId: 'r-apr' }] }} onReceipt={onReceipt} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the receipt for April, done' }));
    expect(onReceipt).toHaveBeenLastCalledWith('r-apr');
  });

  test('the existing Columns chart now moves mark to mark with the arrow keys too', () => {
    const values = [val('a', 'Jul', fig('1', '1', 'r-1')), val('b', 'Aug', fig('2', '2', 'r-2')), val('c', 'Sep', fig('3', '3', 'r-3'))];
    show(<Columns chart={{ form: 'columns', sentence: 'Sales by month.', values }} onReceipt={() => {}} />);
    expectArrowMoves(screen.getAllByRole('button'));
  });

  test('Hindi renders the guess word and the strip button in Hindi', () => {
    show(
      <>
        <Bridge chart={{ form: 'bridge', sentence: 'x', steps: [{ id: 'g', label: 'त्योहार', kind: 'guess', value: fig('1', '1', 'r'), from: '0', to: '1' }] }} onReceipt={() => {}} />
        <Strip cells={[{ state: 'done', label: 'अप्रैल', receiptId: 'r' }]} sentence="y" onReceipt={() => {}} />
      </>,
      'hi',
    );
    expect(screen.getByText((hi as Record<string, string>)['CHART.bridge.guess']!)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'अप्रैल, हो गया की रसीद खोलें' })).toBeTruthy();
  });
});
