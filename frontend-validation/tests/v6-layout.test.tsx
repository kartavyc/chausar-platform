import { readFileSync } from 'node:fs';
import { parse, type Root, type Rule } from 'postcss';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AskLine, useVoiceHold, type AskLineProps } from '../../app/ui/src/app/AskLine';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Language, StatTile } from '../../app/ui/src/app/presentation';
import { TodayScreen } from '../../app/ui/src/screens/today/Today';
import type { TodayData, TodayIntents } from '../../app/ui/src/screens/today/TodayData';
import en from '../../app/ui/src/text/en.json';
import hi from '../../app/ui/src/text/hi.json';
import askStyles from '../../app/ui/src/app/AskLine.module.css';

// These checks inspect the actual CSS policy and rendered content. jsdom does not
// compute layout; no width, overflow, font metric or screenshot claim is made here.
const css = (path: string): Root => parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const askCss = css('../../app/ui/src/app/AskLine.module.css');
const todayCss = css('../../app/ui/src/screens/today/Today.module.css');
const frameCss = css('../../app/ui/src/app/Frame.module.css');
const tokenCss = css('../../app/ui/src/tokens/tokens.css');

function valueOf(rule: Rule, property: string): string | undefined {
  let value: string | undefined;
  rule.walkDecls(property, declaration => { value = declaration.value; });
  return value;
}

function baseValue(source: Root, selector: string, property: string): string | undefined {
  let value: string | undefined;
  source.walkRules(rule => {
    if (rule.parent?.type !== 'root' || !rule.selectors.includes(selector)) return;
    value = valueOf(rule, property) ?? value;
  });
  return value;
}

// Evaluate only the declared named-container breakpoint, not browser geometry.
// An accidental viewport media rule must fail instead of being silently modelled.
function tileTemplate(contentWidth: number, four: boolean): string | undefined {
  let template: string | undefined;
  todayCss.walkRules(rule => {
    if (!rule.selectors.some(selector => selector === '.tiles' || (four && selector === '.tilesFour'))) return;
    const value = valueOf(rule, 'grid-template-columns');
    if (value === undefined) return;
    if (rule.parent?.type === 'root') {
      template = value;
      return;
    }
    if (rule.parent?.type !== 'atrule' || rule.parent.name !== 'container') {
      throw new Error('Today tile responsiveness must measure its own content container');
    }
    const query = /^today\s+\(max-width:\s*(\d+)px\)$/.exec(rule.parent.params);
    if (!query?.[1]) throw new Error('Expected the named Today content-width boundary');
    if (contentWidth <= Number(query[1])) template = value;
  });
  return template;
}

function AskFixture(props: AskLineProps) {
  const hold = useVoiceHold(props.voice);
  return <AskLine {...props} hold={hold} />;
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in V6 frontend fixture checks'));
});

afterEach(() => {
  cleanup();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('Ask CSS gives long explanations their own row and keeps Ctrl K atomic without fixing input width', () => {
  expect(baseValue(askCss, '.line', 'display')).toBe('flex');
  expect(baseValue(askCss, '.line', 'flex-wrap')).toBe('wrap');
  expect(baseValue(askCss, '.state', 'flex')).toBe('1 0 100%');
  expect(baseValue(askCss, '.state', 'min-width')).toBe('0');
  expect(baseValue(askCss, '.state', 'white-space')).not.toBe('nowrap');
  expect(baseValue(askCss, '.key', 'flex')).toBe('0 0 auto');
  expect(baseValue(askCss, '.key', 'white-space')).toBe('nowrap');
  expect(baseValue(askCss, '.input', 'flex')).toBe('1 1 auto');
  expect(baseValue(askCss, '.input', 'min-width')).toBe('0');
  expect(baseValue(askCss, '.input', 'width')).toBeUndefined();
  for (const selector of ['.state', '.key', '.input']) {
    expect(baseValue(askCss, selector, 'display')).not.toBe('none');
    expect(baseValue(askCss, selector, 'text-overflow')).not.toBe('ellipsis');
    expect(baseValue(askCss, selector, 'overflow')).not.toBe('hidden');
  }
});

test('Today CSS stacks both three and four figures by content width, preserving wide and sheet layouts', () => {
  expect(baseValue(todayCss, '.today', 'container-type')).toBe('inline-size');
  expect(baseValue(todayCss, '.today', 'container-name')).toBe('today');
  // V6 390px window has 16px side gutters: the Today container is 358px.
  expect(baseValue(tokenCss, ':root', '--sp4')).toBe('16px');
  expect(baseValue(frameCss, '.narrow .column', 'padding-inline')).toBe('var(--sp4)');
  // At V6's 1366px wide window, the approved column is 720px, or 570px
  // beside the 480px sheet. A viewport-width query would miss the narrow case.
  expect(baseValue(tokenCss, ':root', '--col')).toBe('720px');
  expect(baseValue(tokenCss, ':root', '--col-sheet')).toBe('570px');
  expect(baseValue(tokenCss, ':root', '--sheet')).toBe('480px');
  expect(baseValue(frameCss, '.withSheet .column', 'width')).toBe('var(--col-sheet)');
  for (const four of [false, true]) {
    for (const contentWidth of [358, 480]) {
      expect(tileTemplate(contentWidth, four)).toBe('minmax(0, 1fr)');
    }
    for (const contentWidth of [481, 570, 720]) {
      expect(tileTemplate(contentWidth, four)).toBe(`repeat(${four ? 4 : 3}, minmax(0, 1fr))`);
    }
  }
});

for (const language of ['en', 'hi'] satisfies Language[]) {
  test(`Ask retains complete ${language} route, listening and read-only disclosures beside the editable field`, async () => {
    const user = userEvent.setup();
    const messages = language === 'en' ? en : hi;
    const holder = language === 'en'
      ? 'Synthetic owner with a deliberately long business and computer identity'
      : 'लंबे व्यापार नाम और कंप्यूटर पहचान वाला परीक्षण मालिक';
    const onAsk = vi.fn<AskLineProps['onAsk']>();
    render(<TextProvider language={language}>
      <AskFixture onAsk={onAsk} noModel readOnly={{ holder }} voice={{
        on: true, listening: true, onHoldStart: vi.fn(), onHoldEnd: vi.fn(), onOpenSettings: vi.fn(),
      }} />
    </TextProvider>);
    const form = screen.getByRole('search');
    const expected = [
      messages['SH-04.listening'], messages['SH-04.noModel'], messages['SH-04.readOnly'].replace('{holder}', holder),
    ];
    const stateClass = askStyles.state;
    const keyClass = askStyles.key;
    if (stateClass === undefined || keyClass === undefined) throw new Error('Ask CSS module must expose its state and key styles');
    for (const text of expected) {
      const explanation = screen.getByText(text, { exact: true });
      expect(explanation.textContent).toBe(text);
      expect(explanation.parentElement).toBe(form);
      expect(explanation.classList.contains(stateClass)).toBe(true);
    }
    const chord = screen.getByText(messages['SH-04.key'], { exact: true });
    expect(chord.textContent).toBe('Ctrl K');
    expect(chord.parentElement).toBe(form);
    expect(chord.classList.contains(keyClass)).toBe(true);
    const field = screen.getByRole('textbox', { name: messages['SH-04.placeholder'] });
    const reviewedText = '  Show receipt fixture_123456789 without rounding its amount?  ';
    await user.type(field, reviewedText);
    expect(onAsk).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onAsk).toHaveBeenCalledExactlyOnceWith(reviewedText);
    for (const text of expected) expect(screen.getByText(text, { exact: true }).textContent).toBe(text);
  });
}

for (const count of [3, 4]) {
  test(`Today keeps all ${count} long amount strings, chart evidence and receipt intents through tile reflow`, async () => {
    const user = userEvent.setup();
    const onReceipt = vi.fn<TodayIntents['onReceipt']>();
    const tiles: StatTile[] = Array.from({ length: count }, (_, index) => ({
      id: `synthetic-tile-${index}`,
      label: `Synthetic complete tile label ${index}`,
      figure: {
        kind: 'money', exact: `1234567890${index}`, display: `₹ 12,34,56,789.0${index}`,
        receiptId: `synthetic-amount-receipt-${index}`, labels: [],
      },
      chartState: { state: 'available' },
      chart: {
        form: 'columns', sentence: `Synthetic complete chart disclosure ${index}`,
        values: [{
          id: `synthetic-point-${index}`, label: `Point ${index}`,
          value: {
            kind: 'money', exact: `1234567890${index}`, display: `₹ 12,34,56,789.0${index}`,
            receiptId: `synthetic-chart-receipt-${index}`, labels: [],
          },
        }],
      },
    }));
    const data: TodayData = {
      state: { kind: 'ready' }, date: 'Synthetic fixture date', review: { rows: [] }, thisMonth: tiles,
    };
    render(<TextProvider language="en">
      <TodayScreen data={data} intents={{ onReceipt, onReview: vi.fn() }} view="guided" onNavigate={vi.fn()} />
    </TextProvider>);
    for (const [index, tile] of tiles.entries()) {
      if (tile.figure.kind === 'missing') throw new Error('Fixture figure is known');
      expect(screen.getByText(tile.label, { exact: true }).textContent).toBe(tile.label);
      const amount = screen.getByRole('button', { name: tile.figure.display });
      expect(amount.textContent).toBe(tile.figure.display);
      expect(amount.title).toContain(tile.figure.exact);
      expect(amount.title).toContain(tile.figure.receiptId);
      await user.click(amount);
      expect(onReceipt).toHaveBeenLastCalledWith(tile.figure.receiptId);
      const chart = screen.getByRole('group', { name: `Synthetic complete chart disclosure ${index}` });
      const mark = screen.getByRole('button', { name: `Open the receipt for Point ${index}, ${tile.figure.display}` });
      expect(chart.contains(mark)).toBe(true);
      await user.click(mark);
      expect(onReceipt).toHaveBeenLastCalledWith(`synthetic-chart-receipt-${index}`);
    }
    expect(onReceipt).toHaveBeenCalledTimes(count * 2);
  });
}
