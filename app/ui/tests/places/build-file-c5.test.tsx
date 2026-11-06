// C5 task 35: Build your website: each builder says how the brief travels, by link or by file, and one quiet line says
// a direct hand-off waits on the builders' own connection. No step is faked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { BuildStatusView, EngineClient } from '../../src/engine/types';

const DIRECT = "A direct hand-off needs Lovable's or Replit's own connection. Until then the brief goes by link or file.";

function start(change: (client: EngineClient) => void = () => {}) {
  window.location.hash = '#/business/build';
  const engine = new FakeEngine();
  const client = createFakeClient(engine);
  change(client);
  render(<App client={client} language="en" />);
  return { engine, client };
}

const tile = () => screen.findByRole('region', { name: 'Builders' });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Build your website: by link or by file', () => {
  it('says how the brief travels for each builder, and that a direct hand-off is not here', async () => {
    start();
    const builders = await tile();
    expect(builders.textContent).toContain('Opens Lovable with your brief.');
    expect(builders.textContent).toContain('Opens Replit with your brief as soon as its page opens.');
    expect(builders.textContent).toContain(DIRECT);
    expect(within(builders).getByRole('button', { name: 'Open in Lovable' })).toBeTruthy();
    expect(within(builders).getByRole('button', { name: 'Save as a file for Replit' })).toBeTruthy();
  });

  it('a brief too long for a link says to save it as a file', async () => {
    start((client) => {
      const request = client.request.bind(client);
      client.request = (async (method: string, params?: unknown) => {
        const reply = await request(method as never, params as never);
        return method === 'venture.build.status' ? { ...(reply as BuildStatusView), linkFits: { lovable: true, replit: false } } : reply;
      }) as typeof client.request;
    });
    const builders = await tile();
    expect(builders.textContent).toContain('Too long for a link. Save the brief as a file to add in Replit.');
    expect(builders.textContent).toContain('Opens Lovable with your brief.');
  });

  it('desktop: the save goes through main, which names both files', async () => {
    const saveBriefFile = vi.fn(async () => ({ saved: true as const, name: 'website-brief.md', companion: 'replit.md' }));
    start((client) => { Object.assign(client, { saveBriefFile }); });
    const builders = await tile();
    await act(async () => { fireEvent.click(within(builders).getByRole('button', { name: 'Save as a file for Replit' })); });
    expect(saveBriefFile).toHaveBeenCalledWith('replit');
    await waitFor(() => expect(builders.textContent).toContain('Saved website-brief.md and replit.md. Add both to your Replit project.'));
  });

  it('desktop: cancelling the save says nothing', async () => {
    const saveBriefFile = vi.fn(async () => null);
    start((client) => { Object.assign(client, { saveBriefFile }); });
    const builders = await tile();
    await act(async () => { fireEvent.click(within(builders).getByRole('button', { name: 'Save as a file for Lovable' })); });
    await waitFor(() => expect(saveBriefFile).toHaveBeenCalled());
    expect(builders.textContent).not.toContain('Saved');
  });

  it('web: downloads the brief, offers the note file beside it, and marks the hand-off', async () => {
    const urls: string[] = [];
    URL.createObjectURL = vi.fn(() => { urls.push('blob:x'); return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { clicked.push(this.download); });
    const { engine } = start();
    const builders = await tile();
    await act(async () => { fireEvent.click(within(builders).getByRole('button', { name: 'Save as a file for Lovable' })); });
    await waitFor(() => expect(clicked).toEqual(['website-brief.md']));
    const second = await within(builders).findByRole('button', { name: 'Save AGENTS.md' });
    await act(async () => { fireEvent.click(second); });
    expect(clicked).toEqual(['website-brief.md', 'AGENTS.md']);
    const status = (await engine.request('venture.build.status', {})) as BuildStatusView;
    expect(status.handoffs[0]!.mode).toBe('file');
    expect(status.handoffs[0]!.openedAt).not.toBeNull();
    await waitFor(() => expect(builders.textContent).toContain('Lovable, brief saved as a file'));
  });
});
