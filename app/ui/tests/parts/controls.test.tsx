import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
    const toggle = screen.getByRole('switch', { name: 'Cut the episode: runs without asking' });
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
