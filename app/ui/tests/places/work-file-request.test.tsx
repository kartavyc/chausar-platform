import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../../src/engine/fake';
import type { EngineClient, ShareLink } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * A Work order's file request and its share links' states (W4 4J21, from 4J7: K9 and O20). "Ask the client for a file"
 * makes a single-use upload link that lasts 15 minutes (venture.share.request), with the page's own words; on this
 * computer there is no public address, and it says so. The preview links show when the client first opened them and
 * the client's comments on each post.
 */

type Edit = (method: string, answer: unknown, params: unknown) => unknown;

/** A moment as this computer's clock writes it, as the screen does: "21 Oct" and "10:42". */
const dayOf = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(iso));
const timeOf = (iso: string) => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

function start(options: FakeOptions = {}, edit?: Edit) {
  window.location.hash = '#/work?order=o-boat-14';
  const fake = createFakeClient(new FakeEngine({ now: () => '2026-10-26T10:42:00.000Z', ...options }));
  const calls: { method: string; params: unknown }[] = [];
  const client: EngineClient = {
    ...fake,
    // The hosted fake answers as the hosted server, so the page runs as the hosted page.
    ...(options.hosted || options.trial ? { transport: 'hosted' as const } : {}),
    request: (async (method: string, params?: unknown) => {
      calls.push({ method, params });
      const answer = await fake.request(method as never, params as never);
      return edit ? edit(method, answer, params) : answer;
    }) as EngineClient['request'],
  };
  render(<App client={client} language="en" />);
  return { calls };
}

describe('Work: ask the client for a file', () => {
  it('on this computer: nothing is made; Ask is locked and says links open only on the hosted Chausar', async () => {
    const { calls } = start();
    const tile = await screen.findByRole('region', { name: 'A file from your client' });
    const ask = within(tile).getByRole('button', { name: /Ask the client for a file/ });
    expect(ask.getAttribute('aria-disabled')).toBe('true');
    expect(tile.querySelector('[data-request-reason]')?.textContent).toBe('File request links open only on the hosted Chausar with a public address. Ask your client to send the file, and add it to the order yourself.');
    await act(async () => { fireEvent.click(ask); });
    expect(calls.some((call) => call.method === 'venture.share.request')).toBe(false);
    assertInkRules();
  });

  it('on a hosted server with no public address, the engine says so in its words, and no link shows', async () => {
    start({ hosted: true }, (method, answer) => (method === 'venture.share.request' ? { ...(answer as object), url: null, reason: 'File request links open only on the hosted Chausar with a public address. Ask your client to send the file, and add it to the order yourself.' } : answer));
    const tile = await screen.findByRole('region', { name: 'A file from your client' });
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: 'Ask the client for a file' })); });
    await waitFor(() => expect(tile.querySelector('[data-request-reason]')?.textContent).toMatch(/^File request links open only/));
    expect(tile.textContent).not.toMatch(/https?:/);
  });

  it('on the hosted app: the link with Copy, when it ends, and that the file never passes through the model', async () => {
    start({ hosted: true });
    const tile = await screen.findByRole('region', { name: 'A file from your client' });
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: 'Ask the client for a file' })); });
    const link = await within(tile).findByText(/https:\/\/chausar\.test\/share\/.+\/upload/);
    expect(link.closest('[data-request]')!.textContent).toContain(`Works once, until ${timeOf('2026-10-26T10:57:00.000Z')}`);
    expect(within(tile).getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(tile.textContent).toContain("The file goes straight to this server and is kept with this order. It never passes through the model's context.");
  });

  it('a temporary business is refused in the engine\'s words', async () => {
    start({ trial: 'temporary' });
    const tile = await screen.findByRole('region', { name: 'A file from your client' });
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: 'Ask the client for a file' })); });
    expect((await within(tile).findByRole('alert')).textContent).toBe("A temporary business can't share links or send alerts from this server. Add your email to keep this business, then you can.");
  });
});

describe('Work: what the client did with a link', () => {
  const VIEWED: ShareLink = {
    // As the engine lists it (build/share-links.ts shareView): no address after the link was made, its reason instead.
    id: 'share-9', url: null, reason: 'The link was shown once, when it was made.', expiresAt: '2026-11-02T10:00:00.000Z', viewedAt: '2026-10-21T05:12:00.000Z',
    comments: [
      { item: 'r-ep14.post-1', text: 'Can the first line say "this week"?', at: '2026-10-21T05:20:00.000Z', recordedFor: 'client-boat' },
      { item: 'draft', text: 'Looks good otherwise.', at: '2026-10-21T05:21:00.000Z', recordedFor: 'client-boat' },
    ],
  };
  it('a link the client opened says when, and lists the comments per item in the client\'s own words', async () => {
    start({ hosted: true }, (method, answer) => (method === 'venture.share.list' ? { links: [VIEWED], shares: [VIEWED] } : answer));
    const share = await screen.findByRole('region', { name: 'Preview for the client' });
    const links = await within(share).findByRole('list', { name: 'Links for Sponsor script for episode 14' });
    const link = within(links).getAllByRole('listitem')[0]!;
    expect(link.querySelector('[data-viewed]')?.textContent).toBe(`Viewed ${dayOf(VIEWED.viewedAt!)}, ${timeOf(VIEWED.viewedAt!)}`);
    expect(link.textContent).toContain('The link was shown once, when it was made.');
    expect(within(link).queryByRole('button', { name: 'Copy' })).toBeNull();
    const comments = within(share).getByRole('list', { name: 'What the client said' });
    const items = within(comments).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('[data-comment-item]')?.textContent)).toEqual(['Post 1', 'The whole draft']);
    expect(items[0]!.querySelector('[data-content]')?.textContent).toBe('Can the first line say "this week"?');
    assertInkRules();
  });

  it('a link just made says it is not opened yet; once listed again (no address, as the engine lists it) it keeps it', async () => {
    const engine = new FakeEngine({ hosted: true, now: () => '2026-10-26T10:42:00.000Z' });
    const listed = (await engine.request('venture.share.list', { deliveryId: 'd-ep14-script' })) as { links: ShareLink[] };
    expect(listed.links).toEqual([]);
    const made = (await engine.request('venture.share.create', { deliveryId: 'd-ep14-script' })) as ShareLink;
    expect(made.url).toMatch(/^https:/);
    // The engine never lists an address again: the fake does the same.
    const again = (await engine.request('venture.share.list', { deliveryId: 'd-ep14-script' })) as { links: ShareLink[] };
    expect(again.links.map((link) => [link.url, link.reason])).toEqual([[null, 'The link was shown once, when it was made.']]);
    start({ hosted: true });
    const share = await screen.findByRole('region', { name: 'Preview for the client' });
    const row = (await within(share).findByText('Sponsor script for episode 14')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Share with client' }));
    const links = await within(share).findByRole('list', { name: 'Links for Sponsor script for episode 14' });
    await waitFor(() => expect(within(links).getAllByRole('listitem')[0]!.querySelector('[data-viewed]')?.textContent).toBe('Not opened yet'));
    expect(within(links).getAllByRole('listitem')[0]!.textContent).toMatch(/https:\/\/share\.chausar\.test\/s\//);
    expect(within(share).queryByRole('list', { name: 'What the client said' })).toBeNull();
  });
});
