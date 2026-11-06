import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Row, StatusMark } from '../../src/parts/Row';
import { Avatar } from '../../src/parts/Avatar';
import { runKey } from '../../src/shell/keys';
import { assertInkRules } from '../helpers/ink-rules';

const css = (file: string) => readFileSync(join(import.meta.dirname, '../../src/parts', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The body of the first rule whose selector is exactly `selector`. */
const rule = (text: string, selector: string) => {
  for (const [, sel, body] of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (sel!.trim() === selector) return body!;
  throw new Error(`no rule ${selector}`);
};

describe('Row, the D list row (lrow)', () => {
  it('draws a mark (avatar or status circle) first, then the title and sub, then the aside, the actions and the end time', () => {
    const { container } = render(
      <ul>
        <Row
          id="r1" mark={<Avatar name="Editor" state="working" size={32} />} title="Cutting shorts from episode 13" line="Editor"
          aside={<span>3 of 5</span>} actions={<button type="button">Open</button>} end="4m"
        />
      </ul>,
    );
    const row = container.querySelector('li')!;
    const parts = [...row.children].map((el) => el.textContent);
    expect(parts).toEqual(['ED', 'Cutting shorts from episode 13Editor', '3 of 5', 'Open', '4m']);
    expect(row.firstElementChild!.querySelector('[aria-hidden="true"]')!.textContent).toBe('ED');
    const end = row.lastElementChild!;
    expect(end.classList.contains('mono')).toBe(false); // B2: the body font
  });

  it('is 60 px with a soft line between rows and none above the first; a dense row is 52 px', () => {
    const { container } = render(<ul><Row id="a" title="A" /><Row id="b" title="B" dense /></ul>);
    const [a, b] = [...container.querySelectorAll('li')];
    expect(a!.hasAttribute('data-dense')).toBe(false);
    expect(b!.hasAttribute('data-dense')).toBe(true);
    const text = css('Row.module.css');
    expect(rule(text, '.row')).toMatch(/border-top:\s*var\(--hair\) solid var\(--line-soft\)/);
    expect(rule(text, '.row')).toMatch(/min-height:\s*60px/);
    expect(rule(text, '.row:first-child')).toMatch(/border-top:\s*0/);
    expect(rule(text, '.row[data-dense]')).toMatch(/min-height:\s*52px/);
  });

  it('a row whose link has no address yet shows a disabled "link not ready yet", which J, K, Enter, A and D never use', () => {
    const { container } = render(<ul><Row id="share" title="Share link for episode 14" linkPending /></ul>);
    const pending = screen.getByRole('button', { name: 'link not ready yet' });
    expect(pending).toHaveProperty('disabled', true);
    expect(pending.hasAttribute('data-open')).toBe(false);
    expect(pending.hasAttribute('data-key')).toBe(false);
    expect(container.querySelector('li')!.contains(pending)).toBe(true);
  });

  it('J, K and Enter move through rows with marks and asides as before', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <main>
        <ul>
          <Row id="one" mark={<StatusMark tone="ok" />} title="First" onOpen={onOpen} end="2m" />
          <Row id="two" mark={<Avatar name="Producer" state="waiting" size={32} />} title="Second" aside={<span>Waiting on you</span>} onOpen={onOpen} linkPending />
          <Row id="three" title="Third" dense />
        </ul>
      </main>,
    );
    const main = container.querySelector('main')!;
    const focused = () => (document.activeElement as HTMLElement).dataset.rowId;
    expect(runKey('next', main, () => {})).toBe(true);
    expect(focused()).toBe('one');
    runKey('next', main, () => {});
    expect(focused()).toBe('two');
    runKey('next', main, () => {});
    expect(focused()).toBe('three');
    runKey('previous', main, () => {});
    expect(focused()).toBe('two');
    expect(runKey('open', main, () => {})).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();
    expect((onOpen.mock.calls[0]![0] as HTMLElement).textContent).toBe('Second');
  });
});

describe('StatusMark, the D status circle (.sic)', () => {
  it('is a hidden shape whose icon differs by tone, so colour never carries the state alone', () => {
    const icons = { ok: 'check', no: 'x', question: 'circle-help', estimate: 'trending-up', fail: 'triangle-alert' } as const;
    for (const [tone, icon] of Object.entries(icons)) {
      const { container, unmount } = render(<StatusMark tone={tone as keyof typeof icons} />);
      const mark = container.firstElementChild as HTMLElement;
      expect(mark.getAttribute('aria-hidden')).toBe('true');
      expect(mark.dataset.tone).toBe(tone);
      expect(mark.querySelector(`svg.lucide-${icon}`), tone).not.toBeNull();
      unmount();
    }
    const text = css('Row.module.css');
    expect(rule(text, ".mark[data-tone='ok']")).toMatch(/background:\s*var\(--accent-soft\)[^}]*color:\s*var\(--accent-text\)/);
    expect(rule(text, ".mark[data-tone='question']")).toMatch(/background:\s*var\(--wait-soft\)[^}]*color:\s*var\(--wait\)/);
    expect(rule(text, ".mark[data-tone='fail']")).toMatch(/background:\s*var\(--fail-soft\)[^}]*color:\s*var\(--fail\)/);
  });

  it('on a phone, what wraps under the words lines up with them: 28 px in under a status circle, 32 px under an avatar', () => {
    const text = css('Row.module.css');
    expect(rule(text, '.mark')).toMatch(/width:\s*var\(--av-28\)[^}]*height:\s*var\(--av-28\)/);
    expect(rule(text, '.row')).toMatch(/--lead:\s*var\(--av-32\)/);
    expect(rule(text, '.row:has(> .lead > .mark)')).toMatch(/--lead:\s*var\(--av-28\)/);
    const narrow = /@media\s*\(max-width:\s*759px\)\s*\{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '';
    expect(narrow).toMatch(/padding-left:\s*calc\(var\(--lead\) \+ var\(--sp-3\)\)/);
    expect(narrow).not.toMatch(/--av-32/);
  });
});
