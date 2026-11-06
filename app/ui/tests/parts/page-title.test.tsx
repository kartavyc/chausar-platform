// PageTitle, D's `header.phead` (w3 plan, package 3A2): an optional eyebrow, one h1, a sub line with its count in
// bold, and a group of page tools on the right.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PageTitle } from '../../src/parts/PageTitle';
import { TextProvider } from '../../src/text';
import { rule } from '../helpers/css';
import type { ReactNode } from 'react';

const draw = (node: ReactNode, language: 'en' = 'en') => render(<TextProvider language={language}>{node}</TextProvider>);

describe('PageTitle', () => {
  it('renders one h1 and an empty line slot when given only a title', () => {
    const { container } = draw(<PageTitle title="Team" />);
    const header = container.querySelector('header')!;
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy();
    expect(header.querySelectorAll('p')).toHaveLength(1);
    expect(header.querySelector('[data-line-slot]')!.textContent).toBe('');
    expect(within(header).queryByRole('group')).toBeNull();
  });

  it('B4 task 5: the line slot holds one line of height with or without a line, so sub-pages keep one header', () => {
    const { container, rerender } = draw(<PageTitle title="Money" line="Every figure opens its receipt." />);
    const slot = container.querySelector('[data-line-slot]')!;
    expect(slot.textContent).toBe('Every figure opens its receipt.');
    expect(rule('PageTitle.module.css', '.line')).toContain('min-height: 1lh');
    rerender(<TextProvider language="en"><PageTitle title="Money" /></TextProvider>);
    expect(container.querySelector('[data-line-slot]')).toBe(slot);
    expect(slot.textContent).toBe('');
  });

  it('B4 task 5: below 900 px an empty slot and a long line give their height back', () => {
    const narrow = rule('PageTitle.module.css', '.line:empty', '(max-width: 899px)');
    expect(narrow).toContain('display: none');
    const { container, rerender } = draw(<PageTitle title="Money" line="Short." />);
    expect(container.querySelector('[data-line-slot]')!.hasAttribute('data-long')).toBe(false);
    rerender(<TextProvider language="en"><PageTitle title="Money" line={'A line long enough that it wraps on a small window, so it would push the page.'} /></TextProvider>);
    expect(container.querySelector('[data-line-slot]')!.hasAttribute('data-long')).toBe(true);
  });

  it('puts the eyebrow in a p before the h1', () => {
    const { container } = draw(<PageTitle eyebrow="Friday, 23 October" title="Good evening" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    const eyebrow = container.querySelector('header p')!;
    expect(eyebrow.textContent).toBe('Friday, 23 October');
    expect(eyebrow.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('bolds the count it is given inside the sub line, once, and leaves the rest as text', () => {
    const { container } = draw(<PageTitle title="Today" line="12 need you, across 3 businesses. 12 is a lot." count="12" />);
    const sub = container.querySelector('header p')!;
    expect(sub.textContent).toBe('12 need you, across 3 businesses. 12 is a lot.');
    const bold = sub.querySelectorAll('b');
    expect(bold).toHaveLength(1);
    expect(bold[0]!.textContent).toBe('12');
    expect(sub.firstChild).toBe(bold[0]);
  });

  it('bolds the count only where it stands as a whole number: never the 2 inside 12 or a part of 1,200', () => {
    const at = (line: string, count: string) => {
      const { container, unmount } = draw(<PageTitle title="Today" line={line} count={count} />);
      const sub = container.querySelector('header p')!;
      const bold = [...sub.querySelectorAll('b')].map((b) => [b.previousSibling?.textContent ?? '', b.textContent]);
      expect(sub.textContent).toBe(line);
      unmount();
      return bold;
    };
    expect(at('12 need you, across 2 businesses', '2')).toEqual([['12 need you, across ', '2']]);
    expect(at('12 need you', '2')).toEqual([]);
    expect(at('₹1,200 owed on 1 invoice', '1')).toEqual([['₹1,200 owed on ', '1']]);
    expect(at('₹1,200 owed', '1,200')).toEqual([['₹', '1,200']]);
    expect(at('12.5 hours, then 12 more', '12')).toEqual([['12.5 hours, then ', '12']]);
    expect(at('Needs you: 2.', '2')).toEqual([['Needs you: ', '2']]);
    expect(at('Waiting (a+b) 3', '(a+b)')).toEqual([['Waiting ', '(a+b)']]);
  });

  it('draws the sub line plain when the count is not in it, or when no count is given', () => {
    const { container, rerender } = draw(<PageTitle title="Today" line="Nothing needs you" count="12" />);
    expect(container.querySelector('header p b')).toBeNull();
    expect(container.querySelector('header p')!.textContent).toBe('Nothing needs you');
    rerender(<TextProvider language="en"><PageTitle title="Clients" line="4 clients" /></TextProvider>);
    expect(container.querySelector('header p b')).toBeNull();
  });

  it('renders the tools in a labelled group after the title block', () => {
    const { container } = draw(<PageTitle title="Team" line="7 agents" tools={<button type="button">Add an agent</button>} />);
    const group = screen.getByRole('group', { name: 'Page tools' });
    expect(within(group).getByRole('button', { name: 'Add an agent' })).toBeTruthy();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.contains(h1)).toBe(false);
    expect(container.querySelector('header')!.lastElementChild).toBe(group);
  });



  it('carries no style attribute', () => {
    const { container } = draw(<PageTitle eyebrow="Friday" title="Today" line="12 need you" count="12" tools={<span>x</span>} />);
    expect(container.querySelector('[style]')).toBeNull();
  });
});
