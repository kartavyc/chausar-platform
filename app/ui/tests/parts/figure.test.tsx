import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPortal } from 'react-dom';
import { Count, Figure, proofOf, type FigureProof } from '../../src/parts/Figure';
import { Button } from '../../src/parts/Button';
import { Receipt } from '../../src/parts/Receipt';
import { ModelEstimate } from '../../src/parts/ModelEstimate';
import { TextProvider } from '../../src/text';
import { assertFiguresProved, assertInkRules, assertNoInlineStyles, assertOnePrimary } from '../helpers/ink-rules';

afterEach(() => vi.unstubAllEnvs());

/** A Figure built from untyped engine data, which the type cannot stop. */
const untyped = (proof: object) => proof as FigureProof;

describe('Figure', () => {
  it('shows a receipted amount in DM Mono with its receipt beside it', () => {
    const { container } = render(<Figure value="₹18,880" receiptId="R-0419" />);
    const figure = container.querySelector('[data-figure]')!;
    const number = figure.querySelector('[data-ui-number]')!;
    expect(number.textContent).toBe('₹18,880');
    expect(number.classList.contains('mono')).toBe(true);
    expect(figure.contains(screen.getByRole('button', { name: 'Receipt R-0419' }))).toBe(true);
    expect(figure.querySelector('[data-estimate]')).toBeNull();
  });

  it('opens the receipt through the handler it is given', () => {
    const onReceipt = vi.fn();
    render(<Figure value="₹18,880" receiptId="R-0419" onReceipt={onReceipt} />);
    fireEvent.click(screen.getByRole('button', { name: 'Receipt R-0419' }));
    expect(onReceipt).toHaveBeenCalledWith('R-0419');
  });

  it('labels a model-written number "model estimate" and never offers a receipt', () => {
    const { container } = render(<Figure value="18,000" estimate />);
    const figure = container.querySelector('[data-figure]')!;
    expect(figure.querySelector('[data-ui-number]')!.textContent).toBe('18,000');
    expect(figure.querySelector('[data-estimate]')!.textContent).toBe('model estimate');
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[data-receipt]')).toBeNull();
  });

  it('says "model estimate" in Hindi too', () => {
    const { container } = render(<TextProvider language="hi"><Figure value="18,000" estimate /></TextProvider>);
    expect(container.querySelector('[data-estimate]')!.textContent).toBe('मॉडल का अनुमान');
  });

  it('takes a receipt or the estimate label: both, or neither, does not compile', () => {
    // @ts-expect-error a model estimate never carries a receipt
    const both = <Figure value="₹5" receiptId="R-1" estimate />;
    // @ts-expect-error a figure always carries its proof
    const neither = <Figure value="₹5" />;
    expect([both, neither]).toHaveLength(2);
  });

  it('takes the figure sizes of the D type scale and the dark goal-card look', () => {
    const { container } = render(<Figure value="₹31,600" receiptId="R-0421" size="stat" tone="dark" />);
    const figure = container.querySelector('[data-figure]') as HTMLElement;
    expect(figure.dataset.size).toBe('stat');
    expect(figure.dataset.tone).toBe('dark');
    expect((figure.querySelector('[data-receipt]') as HTMLElement).dataset.tone).toBe('dark');
  });
});

describe('Figure with untyped engine data', () => {
  it('in development, a figure with no proof throws instead of drawing a dead "Receipt" button', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Figure value="₹5,000" {...untyped({})} />)).toThrow(/₹5,000.*no proof/);
    expect(() => render(<Figure value="₹5,000" {...untyped({ receiptId: '' })} />)).toThrow(/₹5,000.*no proof/);
    expect(() => render(<Figure value="₹5,000" {...untyped({ receiptId: '   ' })} />)).toThrow(/no proof/);
  });

  it('in production, a figure with no proof renders nothing at all', () => {
    vi.stubEnv('DEV', false);
    const { container } = render(<><Figure value="₹5,000" {...untyped({})} /><Figure value="₹6,000" {...untyped({ receiptId: '' })} /></>);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('an estimate sent with a receipt id shows the estimate and no receipt', () => {
    const { container } = render(<Figure value="₹5,000" {...untyped({ estimate: true, receiptId: 'R-1' })} />);
    expect(container.querySelector('[data-estimate]')).not.toBeNull();
    expect(container.querySelector('[data-receipt]')).toBeNull();
  });

  it('on the dark goal card a "model estimate" chip takes the goal card colours, so it reads there', () => {
    const { container } = render(<Figure value="18,000" estimate tone="dark" />);
    const chip = container.querySelector('[data-estimate]') as HTMLElement;
    expect(chip.dataset.tone).toBe('dark');
    const css = readFileSync(join(import.meta.dirname, '../../src/parts/ModelEstimate.module.css'), 'utf8');
    expect(css).toMatch(/\[data-tone='dark'\]\s*\{[^}]*border-color:\s*var\(--goal-line\)[^}]*color:\s*var\(--goal-mute\)/);
  });
});

describe('proofOf', () => {
  it('turns an engine record into the proof a Figure takes, the estimate winning over a receipt', () => {
    expect(proofOf({ receiptId: 'R-0412' })).toEqual({ receiptId: 'R-0412' });
    expect(proofOf({ estimate: true })).toEqual({ estimate: true });
    expect(proofOf({ receiptId: 'R-9999', estimate: true })).toEqual({ estimate: true });
    expect(proofOf({})).toBeNull();
    expect(proofOf({ receiptId: '', estimate: false })).toBeNull();
    expect(proofOf({ receiptId: '   ' })).toBeNull();
  });
});

describe('Count', () => {
  it('is mono text with no proof and no data-ui-number: steps, people and runs are counted, not money', () => {
    const { container } = render(<Count value={3} />);
    const count = container.firstElementChild as HTMLElement;
    expect(count.textContent).toBe('3');
    expect(count.classList.contains('mono')).toBe(true);
    expect(count.hasAttribute('data-count')).toBe(true);
    expect(container.querySelector('[data-ui-number], [data-figure]')).toBeNull();
  });
});

describe('assertFiguresProved', () => {
  it('passes on receipted and estimated figures, and returns the numbers it checked', () => {
    const { container } = render(<><Figure value="₹18,880" receiptId="R-0419" /><Figure value="18,000" estimate /><Count value="7" /></>);
    expect(assertFiguresProved(container)).toHaveLength(2);
  });

  it('fails on a bare number', () => {
    const { container } = render(<p>Invoiced <span className="mono" data-ui-number="">₹5,000</span></p>);
    expect(() => assertFiguresProved(container)).toThrow(/₹5,000.*not inside a \[data-figure\]/);
  });

  it('fails on a figure with no receipt and no estimate', () => {
    const { container } = render(<span data-figure=""><span data-ui-number="">₹5,000</span></span>);
    expect(() => assertFiguresProved(container)).toThrow(/₹5,000.*no receipt and no "model estimate"/);
  });

  it('fails on a figure that holds both a receipt and the estimate label', () => {
    const { container } = render(<span data-figure=""><span data-ui-number="">₹5,000</span><Receipt id="R-1" /><ModelEstimate /></span>);
    expect(() => assertFiguresProved(container)).toThrow(/₹5,000.*both a receipt and "model estimate"/);
  });

  it('fails on a figure inside another, whose receipt could pass for the outer one', () => {
    const { container } = render(<span data-figure=""><span data-ui-number="">₹9,000</span><Figure value="₹5,000" receiptId="R-1" /></span>);
    expect(() => assertFiguresProved(container)).toThrow(/inside another \[data-figure\]/);
  });

  it('fails on a count that is marked as a number', () => {
    const { container } = render(<span className="mono" data-count="" data-ui-number="">3</span>);
    expect(() => assertFiguresProved(container)).toThrow(/count/);
  });

  it('checks the root itself as well as what is inside it', () => {
    const { container } = render(<span data-ui-number="">₹1</span>);
    expect(() => assertFiguresProved(container.firstElementChild!)).toThrow(/₹1/);
  });

  it('fails on a figure with no number, and on one with two', () => {
    const empty = render(<span data-figure=""><Receipt id="R-1" /></span>);
    expect(() => assertFiguresProved(empty.container)).toThrow(/holds 0 \[data-ui-number\]/);
    empty.unmount();
    const two = render(<span data-figure=""><span data-ui-number="">₹1</span><span data-ui-number="">₹2</span><Receipt id="R-1" /></span>);
    expect(() => assertFiguresProved(two.container)).toThrow(/holds 2 \[data-ui-number\]/);
  });

  it('fails on a legacy figure that marks its wrapper but not its number', () => {
    const { container } = render(<p>Billed <span className="mono" data-figure="">₹5,000</span></p>);
    expect(() => assertFiguresProved(container)).toThrow(/holds 0 \[data-ui-number\]/);
  });

  it('fails on money written as plain text outside any figure', () => {
    const { container } = render(<p>Billed <span className="mono">₹5,000</span> and <span>$12.50</span> and €3</p>);
    expect(() => assertFiguresProved(container)).toThrow(/"₹5,000" looks like money outside a figure/);
    expect(() => assertFiguresProved(container)).toThrow(/\$12\.50/);
    expect(() => assertFiguresProved(container)).toThrow(/€3/);
  });

  it('fails on a count that holds money', () => {
    const { container } = render(<p><Count value="₹5,000" /></p>);
    expect(() => assertFiguresProved(container)).toThrow(/count "₹5,000" looks like money/);
  });

  it('does not flag what the owner types, receipt ids, counts or plain numbers', () => {
    const { container } = render(
      <form>
        <input aria-label="Price" defaultValue="₹5,000" />
        <textarea aria-label="Note" defaultValue="Charge ₹5,000 next time" />
        <select aria-label="Plan" defaultValue="a"><option value="a">₹500 a month</option></select>
        <p>3 of 5 steps done. 12 need you. Run 31 took 4m. Invoice INV-0042. <Receipt id="R-0419" /> <Count value="7" /></p>
      </form>,
    );
    expect(assertFiguresProved(container)).toHaveLength(0);
  });

  it('a model-written amount labelled through ModelEstimate is not bare money', () => {
    const { container } = render(<p><ModelEstimate value="About ₹18,000 a month" /></p>);
    expect(() => assertFiguresProved(container)).not.toThrow();
  });

  it('quoted words in a [data-content] block (a draft, a message, a title option) are not money Chausar states', () => {
    const title = 'B: "The ₹2,000 mic that beat my ₹20,000 one"';
    const quoted = render(<ul><li data-content="">{title}</li><li><p data-content="">Classes at <b>₹499</b> this month</p></li></ul>);
    expect(() => assertFiguresProved(quoted.container)).not.toThrow();
    quoted.unmount();
    const bare = render(<ul><li>{title}</li></ul>);
    expect(() => assertFiguresProved(bare.container)).toThrow(/₹2,000 mic.*looks like money outside a figure/);
  });

  it('a quote beside it does not excuse a bare amount in a heading', () => {
    const { container } = render(<article><h3>Classes at ₹499</h3><p data-content="">Classes at ₹499</p></article>);
    expect(() => assertFiguresProved(container)).toThrow(/"Classes at ₹499" looks like money outside a figure/);
  });

  it('figures inside a [data-content] block are still checked', () => {
    const { container } = render(<div data-content="">Your share <span className="mono" data-ui-number="">₹5,000</span></div>);
    expect(() => assertFiguresProved(container)).toThrow(/₹5,000.*not inside a \[data-figure\]/);
  });

  it('a receipt needs an id and a control: an empty data-receipt or a marked span is no proof', () => {
    const span = render(<span data-figure=""><span data-ui-number="">₹5</span><span data-receipt="R-1">R-1</span></span>);
    expect(() => assertFiguresProved(span.container)).toThrow(/₹5.*no receipt and no "model estimate"/);
    span.unmount();
    const blank = render(<span data-figure=""><span data-ui-number="">₹6</span><button type="button" data-receipt="  ">Receipt</button></span>);
    expect(() => assertFiguresProved(blank.container)).toThrow(/₹6.*no receipt and no "model estimate"/);
  });

  it('an estimate label needs its words: an empty data-estimate is no proof', () => {
    const { container } = render(<span data-figure=""><span data-ui-number="">₹7</span><span data-estimate="" /></span>);
    expect(() => assertFiguresProved(container)).toThrow(/₹7.*no receipt and no "model estimate"/);
  });

  it('a figure group lets the amounts of one document share the one proof inside it', () => {
    const { container } = render(
      <div data-figure-group="">
        <p>Monthly books <span className="mono">₹1,000.00</span></p>
        <p>GST at 18% <span className="mono">₹180.00</span></p>
        <Figure value="₹1,180.00" receiptId="R-77" />
      </div>,
    );
    expect(assertFiguresProved(container)).toHaveLength(1);
  });

  it('a figure group with no proof inside it, or with both kinds, fails', () => {
    const bare = render(<div data-figure-group=""><p>Monthly books <span className="mono">₹1,000.00</span></p></div>);
    expect(() => assertFiguresProved(bare.container)).toThrow(/figure group "Monthly books ₹1,000.00" has no receipt and no "model estimate"/);
    bare.unmount();
    const both = render(<div data-figure-group=""><s>₹25,000</s> ₹30,000 <Receipt id="R-1" /><ModelEstimate /></div>);
    expect(() => assertFiguresProved(both.container)).toThrow(/both a receipt and "model estimate"/);
  });

  it('checks the whole page by default, so a sheet rendered in a portal is checked too', () => {
    function Sheet() {
      return <p>Page {createPortal(<aside>Total <span className="mono" data-ui-number="">₹9,999</span></aside>, document.body)}</p>;
    }
    const { container } = render(<Sheet />);
    // The render container misses the portal; the default root, document.body, does not.
    expect(() => assertFiguresProved(container)).not.toThrow();
    expect(() => assertFiguresProved()).toThrow(/₹9,999/);
    expect(() => assertInkRules()).toThrow(/₹9,999/);
  });
});

describe('assertOnePrimary', () => {
  it('passes when every card and row holds at most one primary', () => {
    const { container } = render(
      <>
        <article data-card=""><Button>Later</Button><Button variant="primary">Approve</Button></article>
        <article data-card=""><Button>Watch</Button><Button variant="primary" locked>Approve</Button></article>
        <ul><li data-row=""><Button variant="primary">Run again</Button></li></ul>
      </>,
    );
    expect(() => assertOnePrimary(container)).not.toThrow();
  });

  it('fails on a card with two primaries, naming them', () => {
    const { container } = render(<article data-card="" aria-label="Episode 14"><Button variant="primary">Approve</Button><Button variant="primary">Issue</Button></article>);
    expect(() => assertOnePrimary(container)).toThrow(/Episode 14.*2 filled primaries.*Approve.*Issue/);
  });

  it('fails on a list row with two primaries', () => {
    const { container } = render(<ul><li data-row="" data-row-id="q-1"><Button variant="primary">Approve</Button><Button variant="primary">Send</Button></li></ul>);
    expect(() => assertOnePrimary(container)).toThrow(/q-1/);
  });

  it('a row that is not a list item counts too', () => {
    const { container } = render(<div role="group" data-row="" data-row-id="evidence-1"><Button variant="primary">Use it</Button><Button variant="primary">Keep</Button></div>);
    expect(() => assertOnePrimary(container)).toThrow(/evidence-1/);
  });

  it('checks the whole page by default, portals included', () => {
    function Sheet() {
      return createPortal(<article data-card="" aria-label="In a sheet"><Button variant="primary">A</Button><Button variant="primary">B</Button></article>, document.body);
    }
    render(<Sheet />);
    expect(() => assertOnePrimary()).toThrow(/In a sheet/);
  });

  it('counts every primary inside a card, nested ones too: they are all filled buttons on that card', () => {
    const { container } = render(
      <article data-card="" aria-label="Outer"><Button variant="primary">Approve</Button><ul><li data-row=""><Button variant="primary">Send</Button></li></ul></article>,
    );
    expect(() => assertOnePrimary(container)).toThrow(/Outer/);
  });
});

describe('assertNoInlineStyles and assertInkRules', () => {
  it('fail on any element with a style attribute', () => {
    const { container } = render(<span />);
    container.firstElementChild!.setAttribute('data-x', '');
    expect(() => assertNoInlineStyles(container)).not.toThrow();
    const styled = document.createElement('span');
    styled.style.width = '60%';
    container.append(styled);
    expect(() => assertNoInlineStyles(container)).toThrow(/style/);
    expect(() => assertInkRules(container)).toThrow(/style/);
  });

  it('assertInkRules runs all three on a clean tree', () => {
    const { container } = render(<article data-card=""><Figure value="₹18,880" receiptId="R-0419" /><Button variant="primary">Issue</Button></article>);
    expect(() => assertInkRules(container)).not.toThrow();
  });
});
