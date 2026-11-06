import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Bento, Panel, SectionHead, Tile, TileHead } from '../../src/parts/Tile';
import { Inner, Lift } from '../../src/parts/Card';
import { Chip, CountChip, DeptChip, DeptDot, KindChip, PostureChip, StateChip } from '../../src/parts/Chip';
import { FilterChips } from '../../src/parts/FilterChips';
import { Segmented, departmentChoices } from '../../src/parts/Segmented';
import { StatTile } from '../../src/parts/StatTile';
import { revealInRow } from '../../src/parts/reveal';
import { Figure } from '../../src/parts/Figure';
import { Icon } from '../../src/parts/Icon';
import { DEPT_IDS, type IconName } from '../../src/parts/icons';
import { CATALOGUES, TextProvider, format } from '../../src/text';
import { assertFiguresProved, assertInkRules, assertNoInlineStyles, receiptMark } from '../helpers/ink-rules';
import { cssOf, rule } from '../helpers/css';

/**
 * Lay a row out for jsdom, which has none: the row is `width` wide, and each button or link inside it sits at the
 * offset and width given by `place` (by its text). Returns the stubs so a test can restore them.
 */
function layOut(width: number, place: (el: HTMLElement) => [left: number, size: number] | undefined) {
  return [
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) { return place(this)?.[0] ?? 0; }),
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return place(this)?.[1] ?? width; }),
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function () { return width; }),
  ];
}

/** The CSS-module class name an element carries for `name` (vitest names them `_<name>_<hash>`). */
const hasClass = (el: Element, name: string) => [...el.classList].some((c) => new RegExp(`^_${name}_[0-9a-f]{6}$`).test(c));

/** The markup Icon draws for a name, to tell which icon a part drew. */
function iconMarkup(name: IconName): string {
  const { container, unmount } = render(<Icon name={name} />);
  const html = container.querySelector('svg')!.innerHTML;
  unmount();
  return html;
}

const en = (key: string, values?: Record<string, string | number>) => format(CATALOGUES.en, 'en', key, values);
const hi = (key: string, values?: Record<string, string | number>) => format(CATALOGUES.hi, 'hi', key, values);

describe('Bento and Tile', () => {
  it('Bento is the 12-column grid, in the element and with the label it is given', () => {
    const { container } = render(<Bento as="section" label="Team at a glance"><Tile>One</Tile></Bento>);
    const grid = screen.getByRole('region', { name: 'Team at a glance' });
    expect(grid.tagName).toBe('SECTION');
    expect(hasClass(grid, 'bento')).toBe(true);
    expect(rule('Tile.module.css', '.bento')).toMatch(/grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/);
    expect(rule('Tile.module.css', '.bento')).toMatch(/gap:\s*var\(--gap-grid\)/);
    assertNoInlineStyles(container);
  });

  it('a tile renders the element it is given, with its span, tone and label passed through', () => {
    render(<><h2 id="runs-h">Running now</h2><Tile as="section" span={7} tone="fail" labelledBy="runs-h">Runs</Tile></>);
    const tile = screen.getByRole('region', { name: 'Running now' });
    expect(tile.tagName).toBe('SECTION');
    expect(tile.dataset.span).toBe('7');
    expect(tile.dataset.tone).toBe('fail');
    expect(tile.getAttribute('aria-labelledby')).toBe('runs-h');
    expect(hasClass(tile, 'tile')).toBe(true);
  });

  it('is a plain div with no span, tone or card marker by default', () => {
    const { container } = render(<Tile>Plain</Tile>);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.tagName).toBe('DIV');
    expect(tile.dataset.span).toBeUndefined();
    expect(tile.dataset.tone).toBeUndefined();
    expect(tile.hasAttribute('data-card')).toBe(false);
  });

  it('every span from 3 to 12 has its grid rule, and a phone stacks them', () => {
    for (let span = 3; span <= 12; span += 1) {
      const { container, unmount } = render(<Tile span={span as 3}>x</Tile>);
      expect((container.firstElementChild as HTMLElement).dataset.span).toBe(String(span));
      expect(rule('Tile.module.css', `.tile[data-span='${span}']`)).toMatch(new RegExp(`grid-column:\\s*span ${span}\\b`));
      unmount();
    }
    expect(rule('Tile.module.css', '.tile[data-span]', '(max-width: 759px)')).toMatch(/grid-column:\s*1 \/ -1/);
    expect(rule('Tile.module.css', '.panel[data-span]', '(max-width: 759px)')).toMatch(/grid-column:\s*1 \/ -1/);
  });

  it('anything in the bento without a span takes the full row, so nothing falls into one twelfth', () => {
    expect(rule('Tile.module.css', '.bento > :not([data-span])')).toMatch(/grid-column:\s*1 \/ -1/);
  });

  it('a name goes only on an element that can carry one: a plain div is never named', () => {
    render(<><Tile as="section" label="Runs">a</Tile><Inner as="li" label="Editor">b</Inner><Bento as="aside" label="Side">c</Bento></>);
    expect(screen.getByRole('region', { name: 'Runs' }).tagName).toBe('SECTION');
    expect(screen.getByRole('listitem', { name: 'Editor' }).tagName).toBe('LI');
    expect(screen.getByRole('complementary', { name: 'Side' }).tagName).toBe('ASIDE');
    // @ts-expect-error a plain div tile cannot be named
    void (<Tile label="x">a</Tile>);
    // @ts-expect-error nor labelled by a heading
    void (<Tile labelledBy="h">a</Tile>);
    // @ts-expect-error a plain div bento cannot be named
    void (<Bento label="x">a</Bento>);
    // @ts-expect-error a plain div panel cannot be named
    void (<Panel dept="prod" label="x">a</Panel>);
    // @ts-expect-error a plain div inner card cannot be named
    void (<Inner labelledBy="h">a</Inner>);
    // @ts-expect-error nor a lifted card
    void (<Lift as="div" label="x">a</Lift>);
  });

  it('the D tile: surface, line border, tile radius and the one tile shadow; a stopped tile keeps a red line only', () => {
    const tile = rule('Tile.module.css', '.tile');
    expect(tile).toMatch(/background:\s*var\(--surface\)/);
    expect(tile).toMatch(/border:\s*var\(--hair\) solid var\(--line\)/);
    expect(tile).toMatch(/border-radius:\s*var\(--r-tile\)/);
    expect(tile).toMatch(/box-shadow:\s*var\(--shadow-tile\)/);
    expect(tile).toMatch(/--ring-ground:\s*var\(--surface\)/);
    expect(rule('Tile.module.css', ".tile[data-tone='fail']")).toMatch(/border-color:\s*var\(--fail-line\)/);
    expect(rule('Tile.module.css', ".tile[data-tone='fail']")).not.toMatch(/gradient/);
  });

  it('tiles and panels are containers: a tile holding cards is not a card, and only the cards inside are', () => {
    const { container } = render(
      <Tile as="section" label="Working now">
        <Inner as="article" label="Editor">one</Inner>
        <Inner as="article" label="Researcher">two</Inner>
      </Tile>,
    );
    const tile = screen.getByRole('region', { name: 'Working now' });
    expect(tile.hasAttribute('data-card')).toBe(false);
    expect(container.querySelectorAll('[data-card]')).toHaveLength(2);
    const { container: p } = render(<Panel dept="prod"><Lift>agent</Lift></Panel>);
    expect((p.firstElementChild as HTMLElement).hasAttribute('data-card')).toBe(false);
    expect(p.querySelectorAll('[data-card]')).toHaveLength(1);
    // @ts-expect-error a department panel always holds agent cards, so it can never be one
    void (<Panel dept="prod" card>x</Panel>);
  });

  it('a tile that is itself one card (and holds none) carries data-card, so the one-primary rule holds it', () => {
    const { container } = render(<Tile card pad="compact">Card</Tile>);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.hasAttribute('data-card')).toBe(true);
    expect(tile.dataset.pad).toBe('compact');
    expect(rule('Tile.module.css', ".tile[data-pad='compact']")).toMatch(/padding:\s*var\(--pad-tile-compact\)/);
  });
});

describe('Panel, Inner and Lift set the ground a ring sits on', () => {
  it('a department panel takes its tint and line, and sets --ring-ground to the tint', () => {
    for (const dept of DEPT_IDS) {
      const { container, unmount } = render(<Panel dept={dept} as="article" span={5}>p</Panel>);
      const panel = container.firstElementChild as HTMLElement;
      expect(panel.tagName).toBe('ARTICLE');
      expect(panel.dataset.dept).toBe(dept);
      expect(panel.dataset.span).toBe('5');
      expect(hasClass(panel, 'panel')).toBe(true);
      const own = rule('Tile.module.css', `.panel[data-dept='${dept}']`);
      expect(own).toMatch(new RegExp(`--ring-ground:\\s*var\\(--${dept}-tint\\)`));
      expect(own).toMatch(new RegExp(`background:\\s*var\\(--${dept}-tint\\)`));
      expect(own).toMatch(new RegExp(`border-color:\\s*var\\(--${dept}-line\\)`));
      unmount();
    }
    expect(rule('Tile.module.css', '.panel')).toMatch(/padding:\s*var\(--pad-panel\)/);
  });

  it('Inner is the grey inner card and sets --ring-ground to it; Lift is the white lifted card on a tint', () => {
    const { container } = render(<><Inner as="article">in</Inner><Lift>lift</Lift><Inner card={false}>box</Inner></>);
    const [inner, lift, box] = [...container.children] as HTMLElement[];
    expect(inner!.tagName).toBe('ARTICLE');
    expect(hasClass(inner!, 'inner')).toBe(true);
    expect(hasClass(lift!, 'lift')).toBe(true);
    // Inner and Lift are the cards; a plain box that holds no action of its own opts out.
    expect(inner!.hasAttribute('data-card')).toBe(true);
    expect(lift!.hasAttribute('data-card')).toBe(true);
    expect(box!.hasAttribute('data-card')).toBe(false);
    const innerRule = rule('Card.module.css', '.inner');
    expect(innerRule).toMatch(/background:\s*var\(--inner\)/);
    expect(innerRule).toMatch(/--ring-ground:\s*var\(--inner\)/);
    expect(innerRule).toMatch(/border-radius:\s*var\(--r-card\)/);
    const liftRule = rule('Card.module.css', '.lift');
    expect(liftRule).toMatch(/background:\s*var\(--surface\)/);
    expect(liftRule).toMatch(/--ring-ground:\s*var\(--surface\)/);
    expect(liftRule).toMatch(/box-shadow:\s*var\(--shadow-lift\)/);
  });
});

describe('TileHead and SectionHead', () => {
  it('TileHead is an h2 at tile size with a meta line and a "more" link with a chevron', () => {
    const { container } = render(<TileHead id="team-h" title="Team at work" meta="3 working" more={{ href: '#/team', label: 'See team' }} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Team at work' });
    expect(heading.id).toBe('team-h');
    const sizeRule = [...heading.classList].map((c) => /^_(\w+)_[0-9a-f]{6}$/.exec(c)?.[1]).filter(Boolean).map((n) => rule('Tile.module.css', `.${n}`)).join(';');
    expect(sizeRule).toMatch(/font-size:\s*var\(--text-tile\)/);
    expect(screen.getByText('3 working')).toBeTruthy();
    const more = screen.getByRole('link', { name: 'See team' });
    expect(more.getAttribute('href')).toBe('#/team');
    const chevron = more.querySelector('svg')!;
    expect(chevron.getAttribute('aria-hidden')).toBe('true');
    expect(chevron.innerHTML).toBe(iconMarkup('chevron-right'));
    assertNoInlineStyles(container);
  });

  it('TileHead without meta or more is just the heading', () => {
    const { container } = render(<TileHead title="Earlier" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Earlier' })).toBeTruthy();
    expect(container.querySelector('a')).toBeNull();
  });

  it('SectionHead is an h2 at section size with an amber count chip', () => {
    render(<SectionHead id="needs-h" title="Needs you" count={12} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Needs you' });
    expect(heading.id).toBe('needs-h');
    const sizeRule = [...heading.classList].map((c) => /^_(\w+)_[0-9a-f]{6}$/.exec(c)?.[1]).filter(Boolean).map((n) => rule('Tile.module.css', `.${n}`)).join(';');
    expect(sizeRule).toMatch(/font-size:\s*var\(--text-section\)/);
    const count = heading.parentElement!.querySelector('[data-count]')!;
    expect(count.textContent).toBe('12');
    expect(count.closest('[data-tone]')!.getAttribute('data-tone')).toBe('wait');
  });
});

describe('chips', () => {
  it('StateChip says its words from states.ts and takes its tone from there; the dot is hidden', () => {
    const cases = [
      ['run', 'active', 'Working', 'working'],
      ['run', 'waiting', 'Waiting on you', 'wait'],
      ['run', 'failed', 'Failed', 'fail'],
      ['step', 'done', 'Done', 'done'],
      ['step', 'pending', 'Next', 'idle'],
      ['invoice', 'draft', 'Draft', 'neutral'],
    ] as const;
    for (const [kind, value, words, tone] of cases) {
      const { container, unmount } = render(<StateChip kind={kind} value={value} />);
      const chip = container.firstElementChild as HTMLElement;
      expect(chip.textContent).toBe(words);
      expect(chip.dataset.tone).toBe(tone);
      for (const mark of chip.querySelectorAll('[data-dot], svg')) expect(mark.getAttribute('aria-hidden')).toBe('true');
      unmount();
    }
  });

  it('working, waiting and stopped chips draw a dot; done draws a tick, so the shapes differ beyond colour', () => {
    const dot = (el: Element) => el.querySelector('[data-dot]');
    const { container: w } = render(<StateChip kind="run" value="active" />);
    expect(dot(w)).not.toBeNull();
    const { container: d } = render(<StateChip kind="run" value="done" />);
    expect(dot(d)).toBeNull();
    expect(d.querySelector('svg')!.innerHTML).toBe(iconMarkup('check'));
  });

  it('an engine value this build does not know reads "Unknown" in the neutral tone', () => {
    const { container } = render(<StateChip kind="run" value="paused-by-moon" />);
    expect(container.textContent).toBe('Unknown');
    expect((container.firstElementChild as HTMLElement).dataset.tone).toBe('neutral');
  });

  it('StateChip speaks Hindi', () => {
    const { container } = render(<TextProvider language="hi"><StateChip kind="run" value="waiting" /></TextProvider>);
    expect(container.textContent).toBe(hi('state.run.waiting'));
  });

  it('the chip tones map to their tokens (accent-soft, wait-soft, fail-soft, wash, the line chip)', () => {
    expect(rule('Chip.module.css', ".chip[data-tone='working']")).toMatch(/background:\s*var\(--accent-soft\)[\s\S]*color:\s*var\(--accent-text\)/);
    expect(rule('Chip.module.css', ".chip[data-tone='wait']")).toMatch(/background:\s*var\(--wait-soft\)[\s\S]*color:\s*var\(--wait\)/);
    expect(rule('Chip.module.css', ".chip[data-tone='fail']")).toMatch(/background:\s*var\(--fail-soft\)[\s\S]*color:\s*var\(--fail\)/);
    expect(rule('Chip.module.css', ".chip[data-tone='idle']")).toMatch(/background:\s*var\(--wash\)[\s\S]*color:\s*var\(--mute\)/);
    expect(rule('Chip.module.css', ".chip[data-tone='line']")).toMatch(/border:\s*var\(--hair\) solid var\(--line\)/);
  });

  it('a plain Chip shows the words it is given in a tone, for labels states.ts does not hold', () => {
    const { container } = render(<Chip tone="line">3 checks passed</Chip>);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.textContent).toBe('3 checks passed');
    expect(chip.dataset.tone).toBe('line');
    expect(chip.querySelector('[data-dot]')).toBeNull();
  });

  it('DeptChip names each of the five departments, on its tint', () => {
    const words = { sales: 'Sales and clients', mkt: 'Marketing', prod: 'Production', money: 'Money', ops: 'Operations' };
    for (const dept of DEPT_IDS) {
      const { container, unmount } = render(<DeptChip dept={dept} />);
      const chip = container.firstElementChild as HTMLElement;
      expect(chip.textContent).toBe(words[dept]);
      expect(chip.textContent).toBe(en(`dept.${dept}`));
      expect(chip.dataset.dept).toBe(dept);
      expect(rule('Chip.module.css', `.dept[data-dept='${dept}']`)).toMatch(new RegExp(`background:\\s*var\\(--${dept}-tint\\)[\\s\\S]*color:\\s*var\\(--${dept}\\)`));
      unmount();
    }
    const { container } = render(<TextProvider language="hi"><DeptChip dept="prod" /></TextProvider>);
    expect(container.textContent).toBe(hi('dept.prod'));
  });

  it('KindChip says the kind in words from states.ts with its icon; it can be amber or red; on a phone it is the icon alone', () => {
    const { container } = render(<KindChip kind="price" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.textContent).toBe('Price change');
    expect(chip.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(chip.querySelector('svg')!.innerHTML).toBe(iconMarkup('tag'));
    const { container: q } = render(<KindChip kind="question" tone="wait" />);
    expect((q.firstElementChild as HTMLElement).dataset.tone).toBe('wait');
    render(<KindChip kind="signoff" iconOnly />);
    const icon = screen.getByRole('img', { name: 'CA sign-off' });
    expect(icon.textContent).toBe('');
    expect(icon.querySelector('svg')!.innerHTML).toBe(iconMarkup('stamp'));
  });

  it('every queue kind has a KindChip icon', () => {
    for (const kind of ['draft', 'price', 'quote', 'plan', 'invoice', 'signoff', 'question', 'setup', 'locked', 'connector', 'bank'] as const) {
      const { container, unmount } = render(<KindChip kind={kind} />);
      expect(container.querySelector('svg'), kind).not.toBeNull();
      expect(container.textContent, kind).toBe(en(`state.queue.${kind}`));
      unmount();
    }
  });

  it('PostureChip says the posture with its icon', () => {
    const cases = [
      ['approve-each', 'Asks each time', 'shield-check'],
      ['shadow', 'Shadowing', 'eye'],
      ['rehearsal', 'Rehearsing', 'history'],
      ['auto-spot-check', 'Auto with spot checks', 'check'],
    ] as const;
    for (const [posture, words, icon] of cases) {
      const { container, unmount } = render(<PostureChip posture={posture} />);
      const chip = container.firstElementChild as HTMLElement;
      expect(chip.textContent).toBe(words);
      expect(chip.querySelector('svg')!.innerHTML).toBe(iconMarkup(icon));
      expect(chip.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
      unmount();
    }
  });

  it('CountChip is a Count on the amber ground, or neutral; with a label the number is hidden and the label read', () => {
    const { container } = render(<CountChip value={12} />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.dataset.tone).toBe('wait');
    expect(chip.querySelector('[data-count]')!.textContent).toBe('12');
    expect(chip.querySelector('[data-ui-number]')).toBeNull();
    const { container: n } = render(<CountChip value="3" tone="neutral" label="3 people" />);
    const neutral = n.firstElementChild as HTMLElement;
    expect(neutral.dataset.tone).toBe('neutral');
    expect(neutral.querySelector('[data-count]')!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(neutral.querySelector('.sr-only')!.textContent).toBe('3 people');
    expect(rule('Chip.module.css', ".count[data-tone='wait']")).toMatch(/background:\s*var\(--wait-soft\)[\s\S]*color:\s*var\(--wait\)/);
  });

  it('Hindi chips may wrap to two lines instead of being cut', () => {
    const css = cssOf('Chip.module.css');
    expect(css).toMatch(/\.chip:lang\(hi\)[^{]*\{[^}]*white-space:\s*normal/);
    expect(css).toMatch(/\.kind:lang\(hi\)[^{]*\{[^}]*white-space:\s*normal/);
  });
});

describe('FilterChips', () => {
  const options = [
    { id: 'all', label: 'All', count: 12 },
    { id: 'approve', label: 'To approve', count: 7 },
    { id: 'questions', label: 'Questions', count: 3 },
    { id: 'biz-ls', label: 'Lumen Studio', count: 7, business: true, separatorBefore: true },
    { id: 'biz-se', label: 'Sitara Events', count: 1, business: true, locked: true },
  ];

  it('is a labelled group of toggle buttons; the current one is pressed', () => {
    const { container } = render(<FilterChips label="Show" options={options} value="all" onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Show' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(screen.getByRole('button', { name: 'To approve 7', pressed: false })).toBeTruthy();
    assertNoInlineStyles(container);
  });

  it('counts are Counts, never figures', () => {
    const { container } = render(<FilterChips label="Show" options={options} value="all" onChange={() => {}} />);
    expect([...container.querySelectorAll('[data-count]')].map((c) => c.textContent)).toEqual(['12', '7', '3', '7', '1']);
    expect(container.querySelector('[data-ui-number]')).toBeNull();
    assertFiguresProved(container);
  });

  it('a business option shows its initials square, hidden; a locked one shows the lock and says "locked"', () => {
    const { container } = render(<FilterChips label="Show" options={options} value="all" onChange={() => {}} />);
    const lumen = screen.getByRole('button', { name: /^Lumen Studio/ });
    const square = lumen.querySelector('[data-business]')!;
    expect(square.textContent).toBe('LS');
    expect(square.getAttribute('aria-hidden')).toBe('true');
    const sitara = screen.getByRole('button', { name: 'Sitara Events, locked 1' });
    expect(sitara.querySelector('[data-business]')).toBeNull();
    expect(sitara.querySelector('svg')!.innerHTML).toBe(iconMarkup('lock'));
    expect(sitara.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    const separators = container.querySelectorAll('[data-separator]');
    expect(separators).toHaveLength(1);
    expect(separators[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(separators[0]!.nextElementSibling).toBe(lumen);
  });

  it('pressing an option calls onChange with its id', () => {
    const onChange = vi.fn();
    render(<FilterChips label="Show" options={options} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Questions 3' }));
    expect(onChange).toHaveBeenCalledWith('questions');
  });

  it('an option can carry a department dot or an icon, both hidden', () => {
    const { container } = render(
      <FilterChips label="Show departments" options={[{ id: 'all', label: 'All', icon: 'layout-grid' }, { id: 'prod', label: 'Production', dept: 'prod' }]} value="prod" onChange={() => {}} />,
    );
    const dot = container.querySelector('[data-dept]')!;
    expect(dot.getAttribute('data-dept')).toBe('prod');
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Production', pressed: true })).toBeTruthy();
  });

  it('pressed chips use the selected tokens; on a phone the row scrolls sideways; Hindi chips may wrap', () => {
    expect(rule('FilterChips.module.css', ".chip[aria-pressed='true']")).toMatch(/background:\s*var\(--selected\)[\s\S]*color:\s*var\(--on-selected\)/);
    const { container } = render(<FilterChips label="Show" options={options} value="all" onChange={() => {}} scroll />);
    expect(container.querySelector('[role="group"]')!.hasAttribute('data-scroll')).toBe(true);
    expect(cssOf('FilterChips.module.css')).toMatch(/\.chip:lang\(hi\)[^{]*\{[^}]*white-space:\s*normal/);
  });

  it('the phone row keeps room for the focus ring: padded by --sp-1 and pulled back by the same', () => {
    const scrolling = rule('FilterChips.module.css', '.chips[data-scroll]');
    expect(scrolling).toMatch(/padding:\s*var\(--sp-1\)/);
    expect(scrolling).toMatch(/margin:\s*calc\(var\(--sp-1\) \* -1\)/);
  });

  it('on mount the pressed chip is scrolled into the row, sideways only', () => {
    const stubs = layOut(300, (el) => (el.getAttribute('aria-pressed') === 'true' ? [600, 120] : el.tagName === 'BUTTON' ? [0, 100] : undefined));
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<FilterChips label="Show" options={options} value="biz-se" onChange={() => {}} scroll />);
    expect(screen.getByRole('group', { name: 'Show' }).scrollLeft).toBe(424);
    expect(scrollIntoView).not.toHaveBeenCalled();
    for (const stub of stubs) stub.mockRestore();
  });

  it('a pressed chip already in view leaves the row where it is', () => {
    const stubs = layOut(300, (el) => (el.tagName === 'BUTTON' ? [40, 100] : undefined));
    render(<FilterChips label="Show" options={options} value="approve" onChange={() => {}} scroll />);
    expect(screen.getByRole('group', { name: 'Show' }).scrollLeft).toBe(0);
    for (const stub of stubs) stub.mockRestore();
  });

  it('says "locked" in Hindi', () => {
    render(<TextProvider language="hi"><FilterChips label="दिखाएँ" options={options} value="all" onChange={() => {}} /></TextProvider>);
    expect(screen.getByRole('button', { name: `Sitara Events, ${hi('filter.locked')} 1` })).toBeTruthy();
  });
});

describe('Segmented', () => {
  it('buttons mode: a labelled group of toggle buttons with hidden department dots', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Segmented
        mode="buttons"
        label="Show departments"
        value="all"
        onChange={onChange}
        options={[{ id: 'all', label: 'All departments', icon: 'layout-grid' }, { id: 'prod', label: 'Production', dept: 'prod' }]}
      />,
    );
    const group = screen.getByRole('group', { name: 'Show departments' });
    const [all, prod] = within(group).getAllByRole('button');
    expect(all!.getAttribute('aria-pressed')).toBe('true');
    expect(prod!.getAttribute('aria-pressed')).toBe('false');
    expect(all!.querySelector('svg')!.innerHTML).toBe(iconMarkup('layout-grid'));
    const dot = prod!.querySelector('[data-dept]')!;
    expect(dot.getAttribute('data-dept')).toBe('prod');
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(prod!);
    expect(onChange).toHaveBeenCalledWith('prod');
    assertNoInlineStyles(container);
  });

  it('links mode: a labelled nav of links, the current one marked as the page, counts as Counts', () => {
    const { container } = render(
      <Segmented
        mode="links"
        label="Clients views"
        value="pipeline"
        options={[
          { id: 'clients', label: 'Clients', href: '#/clients', count: 7 },
          { id: 'pipeline', label: 'Pipeline', href: '#/clients/pipeline', count: 19 },
        ]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Clients views' });
    const [clients, pipeline] = within(nav).getAllByRole('link');
    expect(clients!.getAttribute('href')).toBe('#/clients');
    expect(clients!.hasAttribute('aria-current')).toBe(false);
    expect(pipeline!.getAttribute('aria-current')).toBe('page');
    expect([...container.querySelectorAll('[data-count]')].map((c) => c.textContent)).toEqual(['7', '19']);
    expect(container.querySelector('[data-ui-number]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Pipeline 19' })).toBe(pipeline);
  });

  it('the selected segment uses the selected tokens, in both modes', () => {
    expect(rule('Segmented.module.css', ".item[aria-pressed='true']")).toMatch(/background:\s*var\(--selected\)[\s\S]*color:\s*var\(--on-selected\)/);
    expect(rule('Segmented.module.css', ".item[aria-current='page']")).toMatch(/background:\s*var\(--selected\)[\s\S]*color:\s*var\(--on-selected\)/);
  });

  it('counts read at 4.5:1 on the hover wash too: --mute, never --dim (4.34 to 4.47 on --wash)', () => {
    expect(rule('Segmented.module.css', '.count')).toMatch(/color:\s*var\(--mute\)/);
    expect(cssOf('Segmented.module.css')).not.toMatch(/var\(--dim\)/);
  });

  it('links mode needs an address on every option', () => {
    // @ts-expect-error a link segment without an href goes nowhere
    void (<Segmented mode="links" label="Views" value="a" options={[{ id: 'a', label: 'A' }]} />);
    expect(true).toBe(true);
  });

  it('on mount the current segment is scrolled into the row, in both modes', () => {
    const current = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-current') === 'page';
    const stubs = layOut(300, (el) => (current(el) ? [500, 140] : undefined));
    const { unmount } = render(<Segmented mode="buttons" label="Show departments" value="ops" onChange={() => {}} options={departmentChoices(en)} />);
    expect(screen.getByRole('group', { name: 'Show departments' }).scrollLeft).toBe(344);
    unmount();
    render(<Segmented mode="links" label="Views" value="b" options={[{ id: 'a', label: 'A', href: '#/a' }, { id: 'b', label: 'B', href: '#/b' }]} />);
    expect(screen.getByRole('navigation', { name: 'Views' }).scrollLeft).toBe(344);
    for (const stub of stubs) stub.mockRestore();
  });

  it('a row wider than its place says which edges hide more (data-more), as it scrolls; a row that fits says nothing', () => {
    let full = 800;
    const stubs = [...layOut(300, () => undefined), vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(() => full)];
    const links = ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase(), href: `#/${id}` }));
    const { unmount } = render(<Segmented mode="links" label="Views" value="a" options={links} />);
    const row = screen.getByRole('navigation', { name: 'Views' });
    expect(row.getAttribute('data-more')).toBe('end');
    row.scrollLeft = 200;
    fireEvent.scroll(row);
    expect(row.getAttribute('data-more')).toBe('both');
    row.scrollLeft = 500;
    fireEvent.scroll(row);
    expect(row.getAttribute('data-more')).toBe('start');
    unmount();
    full = 300;
    render(<Segmented mode="links" label="Views" value="a" options={links} />);
    expect(screen.getByRole('navigation', { name: 'Views' }).hasAttribute('data-more')).toBe(false);
    for (const stub of stubs) stub.mockRestore();
  });

  it('when the row narrows (a sheet opens beside the page) the current segment is brought back into view', () => {
    let width = 1000;
    let resized: (() => void) | undefined;
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(callback: () => void) { resized = callback; } observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    const stubs = [
      vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('aria-current') === 'page' ? 500 : 0; }),
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('aria-current') === 'page' ? 140 : width; }),
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width),
    ];
    render(<Segmented mode="links" label="Views" value="b" options={[{ id: 'a', label: 'A', href: '#/a' }, { id: 'b', label: 'B', href: '#/b' }]} />);
    const row = screen.getByRole('navigation', { name: 'Views' });
    expect(row.scrollLeft).toBe(0);
    width = 300;
    act(() => resized!());
    expect(row.scrollLeft).toBe(344);
    for (const stub of stubs) stub.mockRestore();
    globalThis.ResizeObserver = original;
  });

  it('a segment reached by Tab is scrolled into the row, so it never sits under the faded edge', () => {
    const stubs = layOut(300, (el) => (el.textContent === 'C' ? [600, 120] : undefined));
    const links = ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase(), href: `#/${id}` }));
    render(<Segmented mode="links" label="Views" value="a" options={links} />);
    const row = screen.getByRole('navigation', { name: 'Views' });
    expect(row.scrollLeft).toBe(0);
    fireEvent.focus(screen.getByRole('link', { name: 'C' }));
    expect(row.scrollLeft).toBe(424);
    for (const stub of stubs) stub.mockRestore();
  });

  it('the edge that hides more fades out (a mask in tokens, no colour of its own)', () => {
    for (const edge of ['start', 'end', 'both']) expect(rule('Segmented.module.css', `.seg[data-more='${edge}']`)).toMatch(/mask-image:\s*linear-gradient\([^;]*var\(--sp-\d\)/);
    expect(cssOf('Segmented.module.css')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it('one department dot serves the toggle and the chips: the same DeptDot part in both, its colours in one place', () => {
    const { container: alone } = render(<DeptDot dept="prod" />);
    const reference = alone.firstElementChild!;
    expect(reference.getAttribute('aria-hidden')).toBe('true');
    expect(reference.getAttribute('data-dept')).toBe('prod');
    const { container: seg } = render(<Segmented mode="buttons" label="S" value="all" onChange={() => {}} options={departmentChoices(en)} />);
    const { container: chips } = render(<FilterChips label="F" value="all" onChange={() => {}} options={departmentChoices(en)} />);
    for (const dot of [seg.querySelector('[data-dept="prod"]')!, chips.querySelector('[data-dept="prod"]')!]) {
      expect(dot.className).toBe(reference.className);
    }
    for (const file of ['Segmented.module.css', 'FilterChips.module.css']) expect(cssOf(file)).not.toMatch(/data-dept/);
    for (const dept of DEPT_IDS) expect(rule('Chip.module.css', `.deptDot[data-dept='${dept}']`)).toMatch(new RegExp(`background:\\s*var\\(--${dept}\\)`));
  });

  it('departmentChoices is "All departments" then the five departments in order, each with its dot', () => {
    const choices = departmentChoices(en);
    expect(choices.map((c) => c.id)).toEqual(['all', ...DEPT_IDS]);
    expect(choices.map((c) => c.label)).toEqual(['All departments', 'Sales and clients', 'Marketing', 'Production', 'Money', 'Operations']);
    expect(choices[0]!.icon).toBe('layout-grid');
    expect(choices.slice(1).map((c) => c.dept)).toEqual([...DEPT_IDS]);
    const { container } = render(<Segmented mode="buttons" label={en('dept.show')} value="all" onChange={() => {}} options={choices} />);
    expect(screen.getByRole('group', { name: 'Show departments' })).toBeTruthy();
    expect(container.querySelectorAll('[data-dept]')).toHaveLength(5);
    const hiChoices = departmentChoices((key) => hi(key));
    expect(hiChoices.map((c) => c.label)).toEqual(['all', ...DEPT_IDS].map((id) => hi(`dept.${id}`)));
  });
});

describe('StatTile', () => {
  it('is a card with a label and its icon, a figure with its receipt, a sub line and a side slot', () => {
    const { container } = render(
      <StatTile label="AI spend this month" icon="indian-rupee" figure={{ value: '₹78.80', receiptId: 'R-0402' }} sub="Your own key, billed by the provider" side={<span data-testid="side">bars</span>} span={3} />,
    );
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.hasAttribute('data-card')).toBe(true);
    expect(tile.dataset.span).toBe('3');
    expect(screen.getByText('AI spend this month').querySelector('svg')!.innerHTML).toBe(iconMarkup('indian-rupee'));
    expect(screen.getByRole('button', { name: receiptMark('R-0402') })).toBeTruthy();
    expect(assertFiguresProved(container)).toHaveLength(1);
    // The figure takes the tile's value size (so a phone can shrink it), not a fixed Figure size.
    const figure = container.querySelector('[data-figure]')!;
    expect(figure.hasAttribute('data-size')).toBe(false);
    expect(hasClass(figure, 'value')).toBe(true);
    expect(rule('StatTile.module.css', '.value')).toMatch(/font-size:\s*var\(--fig-stat\)/);
    expect(screen.getByText('Your own key, billed by the provider')).toBeTruthy();
    expect(screen.getByTestId('side')).toBeTruthy();
    assertInkRules(container);
  });

  it('a count needs no proof; tone wait colours it amber; a state dot can stand in for the icon', () => {
    const { container } = render(<StatTile label="Waiting on you" dot="wait" count={1} tone="wait" sub="Producer, about the sponsor preview" />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.dataset.tone).toBe('wait');
    expect(tile.querySelector('[data-count]')!.textContent).toBe('1');
    expect(tile.querySelector('[data-ui-number]')).toBeNull();
    const dot = tile.querySelector('[data-dot]')!;
    expect(dot.getAttribute('data-dot')).toBe('wait');
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    expect(rule('StatTile.module.css', ".stat[data-tone='wait'] .value")).toMatch(/color:\s*var\(--wait\)/);
    expect(rule('StatTile.module.css', ".stat[data-tone='wait'] [data-ui-number]")).toMatch(/color:\s*var\(--wait\)/);
    assertInkRules(container);
  });

  it('on a phone the value steps down to the hero size, and the side slot may drop under it', () => {
    expect(rule('StatTile.module.css', '.value', '(max-width: 759px)')).toMatch(/font-size:\s*var\(--fig-hero\)/);
    expect(rule('StatTile.module.css', '.row')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('the sub line wraps rather than cutting words or a figure in it, in any language', () => {
    const { container } = render(
      <TextProvider language="hi">
        <StatTile label="AI" count={2} sub={<>प्लस <Figure value="₹18.00" receiptId="R-0403" /> चल रहे काम के लिए रोका गया</>} />
      </TextProvider>,
    );
    expect(assertFiguresProved(container)).toHaveLength(1);
    const sub = rule('StatTile.module.css', '.sub');
    expect(sub).not.toMatch(/text-overflow|nowrap|line-clamp/);
    expect(cssOf('StatTile.module.css')).not.toMatch(/ellipsis/);
  });

  it('takes a figure or a count, never both and never neither', () => {
    // @ts-expect-error a stat tile shows one value: a figure or a count, not both
    void (<StatTile label="x" count={1} figure={{ value: '₹1', receiptId: 'R-1' }} />);
    // @ts-expect-error and not neither
    void (<StatTile label="x" />);
    expect(true).toBe(true);
  });
});

describe('revealInRow', () => {
  const row = (scrollLeft: number) => ({ scrollLeft, clientWidth: 300 }) as unknown as HTMLElement;
  const item = (offsetLeft: number, offsetWidth: number) => ({ offsetLeft, offsetWidth }) as unknown as HTMLElement;

  it('scrolls a row only as far as it must to show the item and the 4 px its focus ring reaches, only sideways', () => {
    const past = row(0);
    revealInRow(past, item(600, 120));
    expect(past.scrollLeft).toBe(424);
    const before = row(500);
    revealInRow(before, item(100, 80));
    expect(before.scrollLeft).toBe(96);
    const first = row(200);
    revealInRow(first, item(2, 80));
    expect(first.scrollLeft).toBe(0);
    const inView = row(50);
    revealInRow(inView, item(100, 80));
    expect(inView.scrollLeft).toBe(50);
  });
});

describe('axe on the parts together', () => {
  it('finds nothing to fix', async () => {
    const { default: axe } = await import('axe-core');
    const { container } = render(
      <main>
        <Segmented mode="buttons" label="Show departments" value="all" onChange={() => {}} options={departmentChoices(en)} />
        <Segmented mode="links" label="Clients views" value="clients" options={[{ id: 'clients', label: 'Clients', href: '#/clients', count: 7 }]} />
        <Bento as="section" label="Team at a glance">
          <StatTile span={3} label="Waiting on you" dot="wait" count={1} tone="wait" sub="Producer" />
          <StatTile span={3} label="AI spend this month" icon="indian-rupee" figure={{ value: '₹78.80', receiptId: 'R-0402' }} />
          <Tile as="section" span={6} label="Plain tile"><TileHead title="Team at work" meta="3 working" more={{ href: '#/team', label: 'See team' }} /></Tile>
          <Tile span={6}>An unnamed tile</Tile>
          <Panel dept="prod" span={12} as="article" label="Production">
            <Lift as="article" label="Editor"><PostureChip posture="approve-each" /><DeptChip dept="prod" /></Lift>
          </Panel>
        </Bento>
        <SectionHead title="Needs you" count={12} countLabel="12 need you" />
        <FilterChips label="Show" value="all" onChange={() => {}} options={[{ id: 'all', label: 'All', count: 12 }, { id: 'se', label: 'Sitara Events', business: true, locked: true, separatorBefore: true }]} />
        <Inner><StateChip kind="run" value="active" /><KindChip kind="price" /><KindChip kind="question" iconOnly /><CountChip value={3} label="3 people" /><Chip tone="line">3 checks passed</Chip></Inner>
      </main>,
    );
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
    expect(result.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${v.help} at ${n.target.join(' ')}`))).toEqual([]);
  });
});

describe('the new strings', () => {
  it('every key these parts use is in both catalogues under the package prefixes', () => {
    const keys = ['dept.sales', 'dept.mkt', 'dept.prod', 'dept.money', 'dept.ops', 'dept.all', 'dept.show', 'filter.locked'];
    for (const key of keys) {
      expect(CATALOGUES.en[key], key).toBeDefined();
      expect(CATALOGUES.hi[key], key).toBeDefined();
    }
  });
});
