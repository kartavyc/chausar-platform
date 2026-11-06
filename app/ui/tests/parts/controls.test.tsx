import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextProvider } from '../../src/text';
import { Gate } from '../../src/parts/Gate';
import { Provenance } from '../../src/parts/Provenance';
import { ConnectorLabel, connectorLabelOf } from '../../src/parts/ConnectorLabel';
import { StatusLine } from '../../src/parts/StatusLine';
import { Row } from '../../src/parts/Row';
import { CONNECTORS } from '../../src/engine/fixtures';

describe('Gate', () => {
  it('switches between auto and hold', () => {
    const onChange = vi.fn();
    render(<Gate purpose="Cut the episode" gate="hold" floor={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Cut the episode: Auto runs without asking, Hold waits for you' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.textContent).toContain('Hold');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith('auto');
  });
  it('a floor step says "Always asks you" and has no switch', () => {
    render(<Gate purpose="Publish to YouTube" gate="hold" floor onChange={vi.fn()} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('Always asks you')).toBeTruthy();
  });
});

describe('Provenance', () => {
  it('underlines the value and shows its source on focus and on hover', () => {
    render(<Provenance source="GST portal lookup, 20 Oct 2026">27AAACM1234F1Z5</Provenance>);
    const value = screen.getByText('27AAACM1234F1Z5');
    const holder = value.closest('[tabindex]') as HTMLElement;
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(tip.hidden).toBe(true);
    expect(holder.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.focus(holder);
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe('Source: GST portal lookup, 20 Oct 2026');
    fireEvent.keyDown(holder, { key: 'Escape' });
    expect(tip.hidden).toBe(true);
    fireEvent.blur(holder);
    fireEvent.mouseEnter(holder);
    expect(tip.hidden).toBe(false);
    fireEvent.mouseLeave(holder);
    expect(tip.hidden).toBe(true);
  });
});

describe('ConnectorLabel', () => {
  it('names the four honest labels in words', () => {
    const labels = CONNECTORS.map(connectorLabelOf);
    expect(new Set(labels)).toEqual(new Set(['handoff', 'read', 'write', 'planned']));
    const { container } = render(<>{(['handoff', 'read', 'write', 'planned'] as const).map((l) => <ConnectorLabel key={l} label={l} />)}</>);
    expect(container.textContent).toBe('HandoffReadsWritesPlanned');
  });
  it('a posting connector shows its mode and the risk line', () => {
    const { container } = render(<ConnectorLabel label="write" mode="owner-browser-session" />);
    expect(container.textContent).toContain('Through your own browser session');
    expect(container.textContent).toContain('The platform may restrict this account.');
  });
});

describe('StatusLine', () => {
  it('stays empty while all is well', () => {
    const { container } = render(<StatusLine status={{ state: 'ok' }} transport="desktop" />);
    expect(container.textContent).toBe('');
  });
  it('one thin line for offline, session ended and engine errors', () => {
    const { rerender } = render(<StatusLine status={{ state: 'offline' }} transport="web" />);
    expect(screen.getByRole('alert').textContent).toContain("isn't answering");
    rerender(<StatusLine status={{ state: 'session-ended' }} transport="web" />);
    expect(screen.getByRole('alert').textContent).toContain('session ended');
    rerender(<StatusLine status={{ state: 'error', message: 'HTTP 500' }} transport="web" />);
    expect(screen.getByRole('alert').textContent).toContain('HTTP 500');
  });
  it('says the fake engine is sample data', () => {
    render(<StatusLine status={{ state: 'ok' }} transport="fake" />);
    expect(screen.getByRole('status').textContent).toBe('Sample data. Nothing here is real.');
  });
});

describe('Row', () => {
  it('is a list item with a hairline, a title that opens it, and room for actions', () => {
    const onOpen = vi.fn();
    const { container } = render(<ul><Row id="r1" eyebrow="Lumen Studio · Editor" title="Episode 14 is cut" line="11 min 42 s." onOpen={onOpen} actions={<button type="button">Watch</button>} /></ul>);
    const row = container.querySelector('li')!;
    expect(row.dataset.rowId).toBe('r1');
    expect(row.hasAttribute('data-row')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Episode 14 is cut' }));
    expect(onOpen).toHaveBeenCalled();
    expect(row.textContent).toBe('Lumen Studio · EditorEpisode 14 is cut11 min 42 s.Watch');
  });
});

/* Ink v2 (w3 plan, package 3B5b): the D look of the gate, provenance, connector labels and the status line. */

const partCss = (file: string) => readFileSync(join(import.meta.dirname, '../../src/parts', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The scoped CSS module class of an element, as the name written in the module ("_option_1a2b3c" gives "option"). */
const classOf = (el: Element) => /^_(\w+)_[0-9a-f]{6}$/.exec([...el.classList].find((c) => /^_\w+_[0-9a-f]{6}$/.test(c)) ?? '')?.[1];

describe('Gate (Ink v2): D\'s two-word gate', () => {
  it('shows both words, Auto and Hold, with the current one on; the words are hidden and the switch says the state', () => {
    const { rerender } = render(<Gate purpose="Cut the episode" gate="hold" floor={false} onChange={vi.fn()} />);
    const toggle = screen.getByRole('switch', { name: 'Cut the episode: Auto runs without asking, Hold waits for you' });
    const words = [...toggle.children] as HTMLElement[];
    expect(words.map((w) => w.textContent)).toEqual(['Auto', 'Hold']);
    expect(words.map((w) => w.dataset.value)).toEqual(['auto', 'hold']);
    for (const word of words) expect(word.getAttribute('aria-hidden')).toBe('true');
    expect(words.map((w) => w.hasAttribute('data-on'))).toEqual([false, true]);
    rerender(<Gate purpose="Cut the episode" gate="auto" floor={false} onChange={vi.fn()} />);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(words.map((w) => w.hasAttribute('data-on'))).toEqual([true, false]);
  });

  it('the name holds both visible words, in Hindi too (label in name)', () => {
    render(<TextProvider language="hi"><Gate purpose="एपिसोड काटें" gate="hold" floor={false} /></TextProvider>);
    const name = screen.getByRole('switch').getAttribute('aria-label')!;
    expect(name).toContain('अपने आप');
    expect(name).toContain('रोकें');
    expect(name.startsWith('एपिसोड काटें: ')).toBe(true);
  });

  it('clicking the word that is on changes nothing; clicking the other word sets it', () => {
    const onChange = vi.fn();
    render(<Gate purpose="Finishing check" gate="hold" floor={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch');
    const [auto, hold] = [...toggle.children] as HTMLElement[];
    fireEvent.click(hold!);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(auto!);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('auto');
  });

  it('on an Auto step, clicking Auto changes nothing and clicking Hold holds it', () => {
    const onChange = vi.fn();
    render(<Gate purpose="Cut the episode" gate="auto" floor={false} onChange={onChange} />);
    const [auto, hold] = [...screen.getByRole('switch').children] as HTMLElement[];
    fireEvent.click(auto!);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(hold!);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('hold');
  });

  it('Space and Enter still toggle: a click on the switch itself (not on a word) flips it', () => {
    const onChange = vi.fn();
    render(<Gate purpose="Cut the episode" gate="auto" floor={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('hold');
  });

  it('in forced colours the word that is on keeps a system highlight', () => {
    render(<Gate purpose="Finishing check" gate="hold" floor={false} />);
    const on = classOf(screen.getByRole('switch').querySelector('[data-on]')!);
    const css = partCss('Gate.module.css');
    const forced = /@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(forced).toMatch(new RegExp(`\\.${on}\\[data-on\\]\\s*\\{[^}]*forced-color-adjust:\\s*none[^}]*background:\\s*Highlight[^}]*color:\\s*HighlightText`));
  });

  it('the word that is on is filled with the selected ink', () => {
    render(<Gate purpose="Finishing check" gate="hold" floor={false} />);
    const on = screen.getByRole('switch').querySelector('[data-on]')!;
    const css = partCss('Gate.module.css');
    expect(css).toMatch(new RegExp(`\\.${classOf(on)}\\[data-on\\]\\s*\\{[^}]*background:\\s*var\\(--selected\\)[^}]*color:\\s*var\\(--on-selected\\)`));
  });

  it('a floor step shows the lock and "Always asks you" on the waiting ground, with no switch', () => {
    const { container } = render(<Gate purpose="Publish to YouTube" gate="auto" floor onChange={vi.fn()} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    const floor = container.firstElementChild!;
    expect(floor.textContent).toBe('Always asks you');
    expect(floor.querySelector('svg.lucide-lock')!.getAttribute('aria-hidden')).toBe('true');
    expect(partCss('Gate.module.css')).toMatch(new RegExp(`\\.${classOf(floor)}\\s*\\{[^}]*background:\\s*var\\(--wait-soft\\)[^}]*color:\\s*var\\(--wait\\)`));
  });
});

describe('Provenance (Ink v2): honesty lines (catalogue U17)', () => {
  it('quoted text says "Shown as written" on a line under it', () => {
    const { container } = render(<Provenance source="Mail from Boat Audio, 20 Oct" quoted>We need the cut by Friday, please.</Provenance>);
    const quote = container.querySelector('q')!;
    expect(quote.textContent).toBe('We need the cut by Friday, please.');
    const line = screen.getByText('Shown as written');
    expect(Boolean(quote.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(partCss('Provenance.module.css')).toMatch(new RegExp(`\\.${classOf(line)}\\s*\\{[^}]*display:\\s*block`));
    fireEvent.focus(quote.closest('[tabindex]')!);
    expect(screen.getByRole('tooltip').textContent).toBe('Source: Mail from Boat Audio, 20 Oct');
  });

  it('prose a model wrote says "model estimate" and offers no receipt', () => {
    const { container } = render(<Provenance estimate>About 18,000 views in the first month</Provenance>);
    expect(container.querySelector('[data-estimate]')!.textContent).toBe('model estimate');
    expect(container.textContent).toBe('About 18,000 views in the first monthmodel estimate');
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[tabindex]')).toBeNull();
    // @ts-expect-error quoted words are someone's own, never the model's: a value cannot be both
    const both = <Provenance quoted estimate>words</Provenance>;
    expect(both).toBeTruthy();
  });

  it('a value whose link has no address yet shows a disabled "link not ready yet"', () => {
    render(<Provenance source="Share link for episode 14" linkPending>Episode 14 review page</Provenance>);
    expect(screen.getByRole('button', { name: 'link not ready yet' })).toHaveProperty('disabled', true);
  });

  it('in Hindi too', () => {
    render(<TextProvider language="hi"><Provenance quoted linkPending>नमस्ते</Provenance></TextProvider>);
    expect(document.body.textContent).not.toMatch(/provenance\./);
  });
});

describe('ConnectorLabel (Ink v2): the honest labels stay unmistakable', () => {
  it('each label is a chip with its own icon beside its words', () => {
    const icons = { write: 'pencil', read: 'eye', handoff: 'arrow-left-right', planned: 'clock' } as const;
    for (const [label, icon] of Object.entries(icons)) {
      const { container, unmount } = render(<ConnectorLabel label={label as keyof typeof icons} />);
      const svg = container.querySelector(`svg.lucide-${icon}`);
      expect(svg, label).not.toBeNull();
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
      expect(container.querySelectorAll('svg')).toHaveLength(1);
      unmount();
    }
  });

  it('planned is drawn open and dashed, the labels that work are solid, and planned never offers a button', () => {
    const { container } = render(<><ConnectorLabel label="write" /><ConnectorLabel label="planned" /></>);
    expect(container.querySelector('button, a, [role="button"]')).toBeNull();
    const [write, planned] = [...container.querySelectorAll('[data-label]')];
    const chip = classOf(write!.firstElementChild!);
    expect(chip).toBe(classOf(planned!.firstElementChild!));
    const css = partCss('ConnectorLabel.module.css');
    expect(css).toMatch(new RegExp(`\\.${chip}\\s*\\{[^}]*background:\\s*var\\(--wash\\)`));
    expect(css).toMatch(new RegExp(`\\[data-label='planned'\\]\\s*\\.${chip}\\s*\\{[^}]*background:\\s*none[^}]*dashed var\\(--dash\\)[^}]*color:\\s*var\\(--mute\\)`));
  });

  it('the risk line carries a warning icon and stays in words', () => {
    const { container } = render(<ConnectorLabel label="write" mode="owner-browser-session" />);
    const risk = screen.getByText('The platform may restrict this account.');
    expect(risk.closest('[data-risk]')!.querySelector('svg.lucide-triangle-alert')!.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('[data-label] svg')).toHaveLength(2);
  });

  it('a planned connector says only "Planned": no mode and no risk line, so it never reads like a live channel', () => {
    const { container } = render(<ConnectorLabel label="planned" mode="owner-browser-session" risk="The platform may restrict this account." />);
    expect(container.textContent).toBe('Planned');
    expect(container.querySelector('[data-risk]')).toBeNull();
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});

describe('StatusLine (Ink v2)', () => {
  it('a problem line carries a warning icon on the failed ground; a wait carries a clock on the waiting ground', () => {
    const { rerender, container } = render(<StatusLine status={{ state: 'offline' }} transport="web" />);
    expect(screen.getByRole('alert').querySelector('svg.lucide-triangle-alert')!.getAttribute('aria-hidden')).toBe('true');
    rerender(<StatusLine status={{ state: 'starting' }} transport="web" />);
    expect(screen.getByRole('status').querySelector('svg.lucide-clock')).not.toBeNull();
    rerender(<StatusLine status={{ state: 'ok' }} transport="fake" />);
    expect(container.querySelector('svg')).toBeNull();
    const css = partCss('StatusLine.module.css');
    expect(css).toMatch(/\[data-state='offline'\][^{]*\{[^}]*background:\s*var\(--fail-soft\)[^}]*color:\s*var\(--fail\)/);
    expect(css).toMatch(/\[data-state='starting'\][^{]*\{[^}]*background:\s*var\(--wait-soft\)[^}]*color:\s*var\(--wait\)/);
  });
});
