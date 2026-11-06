import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ownerFormatProblems } from '../helpers/ink-rules';

/*
 * One-shot B2 task 12: the screen guard for money and time. Outside a receipt sheet, quoted client or AI words and form
 * fields, no text on a screen may show the exact money form ("INR 2,000.00"), four decimals ("USD 0.0042"), or a
 * 24-hour time in a <time> ("00:41"). assertInkRules runs it on every place test.
 */

describe('assertOwnerFormats', () => {
  it('reports the exact money form and a 24-hour time, and leaves the receipt sheet alone', () => {
    const { container } = render(
      <main>
        <p data-figure="">INR 2,000.00</p>
        <p><time dateTime="2026-11-02T19:11:00.000Z">00:41</time></p>
        <p>Cost under $0.01, on 3 Nov 2026, 12:41 am</p>
        <section data-receipt-sheet=""><p>USD 0.0042</p><p>INR 2,000.00</p></section>
        <blockquote data-content="">The client wrote INR 5,000.00 at 14:30</blockquote>
        <input aria-label="Amount" defaultValue="INR 9.0000" />
      </main>,
    );
    const problems = ownerFormatProblems(container);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/INR 2,000\.00/);
    expect(problems[1]).toMatch(/00:41/);
  });

  it('passes the owner form: rupees, dollars, codes for other currencies, the 12-hour clock', () => {
    const { container } = render(
      <main><p>₹2,000 and $5,000 and SGD 5,000, on your own AI plan</p><p><time dateTime="x">12:41 am</time></p></main>,
    );
    expect(ownerFormatProblems(container)).toEqual([]);
  });
});
