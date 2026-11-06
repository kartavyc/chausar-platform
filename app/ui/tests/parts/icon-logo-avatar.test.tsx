import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SquarePlay } from 'lucide-react';
import { Icon } from '../../src/parts/Icon';
import { DEPT_ICONS, DEPT_IDS, ICONS, type IconName } from '../../src/parts/icons';
import { Logo } from '../../src/parts/Logo';
import { Avatar, ChausarAvatar, initialsOf } from '../../src/parts/Avatar';

const parts = join(import.meta.dirname, '../../src/parts');

/**
 * The CSS rule behind a CSS-module class seen in the DOM. In tests a module class reads `_<name>_<hash>`
 * (vitest's stable class names), so the name is taken back out and its rule read from the module's own text.
 */
function ruleOf(file: string, className: string): string {
  const name = /^_(\w+)_[0-9a-f]{6}$/.exec(className)?.[1];
  if (!name) throw new Error(`not a CSS module class: ${className}`);
  const css = readFileSync(join(parts, file), 'utf8');
  const rule = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (rule === undefined) throw new Error(`no rule .${name} in ${file}`);
  return rule;
}
const moduleClass = (el: Element) => [...el.classList].find((c) => /^_\w+_[0-9a-f]{6}$/.test(c))!;

/** D-STYLE.md section 5, in its order, then the five more the boards use. */
const D_STYLE_ICONS = [
  'sun', 'messages-square', 'users', 'briefcase', 'contact', 'wallet', 'plug',
  'chevrons-up-down', 'chevron-down', 'chevron-right', 'arrow-right', 'bell', 'sparkles', 'target', 'calendar', 'pencil',
  'trending-up', 'receipt-text', 'check', 'x', 'lock', 'eye', 'eye-off', 'history', 'rotate-ccw', 'triangle-alert',
  'circle-help', 'clock', 'tag', 'stamp', 'send', 'file-text', 'file-pen', 'bot', 'play', 'plus', 'message-square',
  'layout-grid', 'mic', 'arrow-left-right', 'scissors', 'youtube',
  'handshake', 'megaphone', 'package', 'indian-rupee', 'wrench',
];
const BOARD_ICONS = ['shield-check', 'upload', 'search', 'sliders-horizontal', 'paperclip'];
// W4 packages add the names they need here, one line each.
// 4I2: behind today's pace, beside trending-up for ahead.
BOARD_ICONS.push('trending-down');

describe('Icon', () => {
  it('is a quiet svg by default: hidden from screen readers, not focusable, the D stroke', () => {
    const { container } = render(<Icon name="bell" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.dataset.size).toBe('18');
  });

  it('takes the six D sizes', () => {
    for (const size of [12, 14, 16, 18, 20, 22] as const) {
      const { container, unmount } = render(<Icon name="check" size={size} />);
      const svg = container.querySelector('svg')!;
      expect(svg.dataset.size).toBe(String(size));
      expect(svg.getAttribute('width')).toBe(String(size));
      unmount();
    }
  });

  it('with a label it is an image with that name', () => {
    render(<Icon name="lock" label="Locked" />);
    const img = screen.getByRole('img', { name: 'Locked' });
    expect(img.getAttribute('aria-hidden')).toBeNull();
  });

  it('can be drawn filled, like the play mark', () => {
    const { container } = render(<Icon name="play" filled />);
    expect(container.querySelector('svg')!.hasAttribute('data-filled')).toBe(true);
  });

  it('the allowlist is exactly the D-STYLE icons plus the five the boards use', () => {
    expect(Object.keys(ICONS).sort()).toEqual([...D_STYLE_ICONS, ...BOARD_ICONS].sort());
  });

  it('every name in the allowlist draws an svg', () => {
    for (const name of Object.keys(ICONS) as IconName[]) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg'), name).not.toBeNull();
      unmount();
    }
  });

  it('lucide-react 1.x ships no brand icons, so youtube is drawn as the plain square-play', () => {
    expect(ICONS.youtube).toBe(SquarePlay);
  });

  it('each department has its D icon', () => {
    expect(DEPT_IDS).toEqual(['sales', 'mkt', 'prod', 'money', 'ops']);
    expect(DEPT_ICONS).toEqual({ sales: 'handshake', mkt: 'megaphone', prod: 'package', money: 'indian-rupee', ops: 'wrench' });
  });
});

describe('Logo', () => {
  it('is the two-square mark: the first square in ink, the second in the accent', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(2);
    expect(ruleOf('Logo.module.css', moduleClass(rects[0]!))).toMatch(/fill:\s*var\(--fg\)/);
    expect(ruleOf('Logo.module.css', moduleClass(rects[1]!))).toMatch(/fill:\s*var\(--accent\)/);
  });

  it('inside the Chausar avatar the first square takes the on-selected colour, so it inverts with the theme', () => {
    const { container } = render(<Logo variant="in-avatar" />);
    const rects = container.querySelectorAll('rect');
    expect(ruleOf('Logo.module.css', moduleClass(rects[0]!))).toMatch(/fill:\s*var\(--on-selected\)/);
    expect(ruleOf('Logo.module.css', moduleClass(rects[1]!))).toMatch(/fill:\s*var\(--accent\)/);
  });

  it('with the wordmark it says "chausar", in lowercase', () => {
    render(<Logo wordmark />);
    expect(screen.getByText('chausar')).toBeTruthy();
  });

  it('holds no colour of its own: the accent comes from the token', () => {
    const tsx = readFileSync(join(parts, 'Logo.tsx'), 'utf8');
    expect(tsx).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('puts its class on the mark when there is no wordmark, and on the wrapper when there is', () => {
    const mark = render(<Logo className="brand-mark" />);
    expect(mark.container.querySelector('svg')!.classList.contains('brand-mark')).toBe(true);
    mark.unmount();
    const both = render(<Logo wordmark className="brand" />);
    expect((both.container.firstElementChild as HTMLElement).classList.contains('brand')).toBe(true);
    expect(both.container.querySelector('svg')!.classList.contains('brand')).toBe(false);
  });
});

describe('initialsOf', () => {
  it('takes the first letter of the first two words, or the first two of one word', () => {
    expect(initialsOf('Editor')).toBe('ED');
    expect(initialsOf('Meera Joshi')).toBe('MJ');
    expect(initialsOf('Iyer & Co')).toBe('IC');
    expect(initialsOf('lumen studio')).toBe('LS');
  });

  it('keeps a Devanagari vowel sign with its letter (one grapheme cluster per word)', () => {
    expect(initialsOf('राहुल मेहता')).toBe('रामे');
  });

  it('says "?" when there is nothing to take', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('  & ')).toBe('?');
    expect(initialsOf('★ # !')).toBe('?');
  });

  it('skips punctuation inside a word: only letters and digits become initials', () => {
    expect(initialsOf('A.')).toBe('A');
    expect(initialsOf("O'Neil")).toBe('ON');
    expect(initialsOf('J.R.')).toBe('JR');
    expect(initialsOf('J. R. Mehta')).toBe('JR');
    expect(initialsOf('★ Star Traders')).toBe('ST');
    expect(initialsOf('#1 Store')).toBe('1S');
  });

  it('never gives more than two, even when a letter grows as it is uppercased', () => {
    // German ß uppercases to SS; each initial keeps only its first letter, so the pair stays two.
    expect(initialsOf('ßtraße')).toBe('ST');
    expect(initialsOf('Śrī')).toBe('ŚR');
    for (const name of ['ßtraße', 'ﬁne arts', 'Editor', 'क्षितिज शर्मा']) {
      expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(initialsOf(name))], name).toHaveLength(2);
    }
  });

  it('takes whole grapheme clusters in Hindi names, conjuncts included', () => {
    expect(initialsOf('क्षितिज शर्मा')).toBe('क्षिश');
    expect(initialsOf('राहुल')).toBe('राहु');
    expect(initialsOf('१२३')).toBe('१२');
  });
});

describe('Avatar', () => {
  it('is initials in a hidden span, on the neutral ground until a department is given', () => {
    const { container } = render(<Avatar name="Editor" />);
    const avatar = container.firstElementChild as HTMLElement;
    expect(avatar.getAttribute('aria-hidden')).toBe('true');
    expect(avatar.textContent).toBe('ED');
    expect(avatar.dataset.dept).toBe('none');
    expect(avatar.dataset.size).toBe('36');
    expect(avatar.hasAttribute('data-state')).toBe(false);
  });

  it('takes the department tint', () => {
    const { container } = render(<Avatar name="Editor" dept="prod" />);
    expect((container.firstElementChild as HTMLElement).dataset.dept).toBe('prod');
  });

  it('draws a ring for working, waiting and failed, and none for idle', () => {
    for (const state of ['working', 'waiting', 'failed'] as const) {
      const { container, unmount } = render(<Avatar name="Editor" state={state} />);
      expect((container.firstElementChild as HTMLElement).dataset.state).toBe(state);
      unmount();
    }
    const { container } = render(<Avatar name="Editor" state="idle" />);
    expect((container.firstElementChild as HTMLElement).hasAttribute('data-state')).toBe(false);
  });

  it('the ring rules use the ground token under the avatar and the ring colours', () => {
    const css = readFileSync(join(parts, 'Avatar.module.css'), 'utf8');
    expect(css).toMatch(/\[data-state\]\s*\{[^}]*box-shadow:[^}]*var\(--ring-ground[^}]*var\(--ring-colour\)/);
    expect(css).toMatch(/\[data-state='working'\]\s*\{[^}]*--ring-colour:\s*var\(--accent\)/);
    expect(css).toMatch(/\[data-state='waiting'\]\s*\{[^}]*--ring-colour:\s*var\(--wait-ring\)/);
    expect(css).toMatch(/\[data-state='failed'\]\s*\{[^}]*--ring-colour:\s*var\(--fail-ring\)/);
  });

  it('draws the department badge only when a department is given', () => {
    const { container, unmount } = render(<Avatar name="Editor" dept="prod" badge />);
    const badge = container.querySelector('[data-badge]')!;
    expect(badge.querySelector('svg')!.classList.contains('lucide-package')).toBe(true);
    unmount();
    const plain = render(<Avatar name="Editor" badge />);
    expect(plain.container.querySelector('[data-badge]')).toBeNull();
  });

  it('takes the D sizes', () => {
    for (const size of [24, 28, 32, 36, 40, 52, 60] as const) {
      const { container, unmount } = render(<Avatar name="Editor" size={size} />);
      expect((container.firstElementChild as HTMLElement).dataset.size).toBe(String(size));
      unmount();
    }
  });

  it('never makes an image or a network request', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { container } = render(<><Avatar name="Meera Joshi" dept="sales" state="working" badge size={60} /><ChausarAvatar /></>);
    expect(container.querySelector('img, image, picture')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('the Chausar avatar is the mark on the selected ground, hidden from screen readers', () => {
    const { container } = render(<ChausarAvatar size={60} state="working" />);
    const avatar = container.firstElementChild as HTMLElement;
    expect(avatar.getAttribute('aria-hidden')).toBe('true');
    expect(avatar.hasAttribute('data-chausar')).toBe(true);
    expect(avatar.dataset.size).toBe('60');
    expect(avatar.dataset.state).toBe('working');
    const first = container.querySelectorAll('rect')[0]!;
    expect(ruleOf('Logo.module.css', moduleClass(first))).toMatch(/fill:\s*var\(--on-selected\)/);
  });
});
