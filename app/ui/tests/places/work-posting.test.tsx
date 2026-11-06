import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type DeliveryLite, type DraftPostLite, type MethodName, type ShareLink } from '../../src/engine/types';

// Work, Ink v2 wave 2 package 2B1: the client's answer the owner records on this computer (venture.share.recordAnswer)
// and posting a checked, approved draft's LinkedIn or X line (venture.posting.propose). The engine decides; the screen
// shows its words.

type Call = { method: string; params: unknown };
interface StartOptions { language?: 'en' | 'hi'; intercept?: Partial<Record<MethodName, (params: unknown) => unknown>> }

async function start(hash: string, options: StartOptions = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine();
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = options.intercept?.[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  const view = render(<App client={client} language={options.language ?? 'en'} />);
  return { engine, client, calls, ...view };
}
const rowOf = async (text: string, scope: HTMLElement = document.body) => (await within(scope).findByText(text)).closest('li')!;

const SOCIAL: DeliveryLite = {
  id: 'd-social', at: '2026-10-21T09:00:00.000Z', orderId: 'o-boat-14', status: 'accepted', practice: false,
  deliverable: { title: 'Posts for October' }, verdict: { choice: 'accepted', at: '2026-10-21T09:10:00.000Z' },
};
const POSTS: DraftPostLite[] = [
  { draftId: 'd-social.post-1', channel: 'linkedin', name: 'LinkedIn', connectorId: 'linkedin', text: 'Our cafe opens at 8 every weekday.' },
  { draftId: 'd-social.post-2', channel: 'instagram', name: 'Instagram', connectorId: 'instagram', text: 'Fresh pastries at 8.' },
  { draftId: 'd-social.post-3', channel: 'threads', name: 'Threads', connectorId: null, text: 'Filter coffee all day.' },
];
const link = (answer?: ShareLink['answer']): ShareLink => ({
  id: 'share-1', url: null, reason: 'Share links open only on the hosted Chausar with a public address.', expiresAt: '2026-10-28T09:00:00.000Z', ...(answer ? { answer } : {}),
});
const approved: ShareLink['answer'] = { draftId: 'd-social', decision: 'approved', comment: null, at: '2026-10-21T11:00:00.000Z', via: 'owner-recorded' };
/** The engine's list for one draft: its links, its posts, whether the client must approve, and the answer it counts. */
const shareList = (answer?: ShareLink['answer']) => () => ({ links: [link(answer)], shares: [link(answer)], posts: POSTS, clientApproval: true, answer: answer ?? null });
const deliveries = () => [SOCIAL];

describe("Work: the client's answer, recorded on this computer", () => {
  it('after sharing, the owner records what the client said, with a comment, and the line then shows it', async () => {
    const { calls } = await start('#/work?order=o-boat-14');
    const share = await screen.findByRole('region', { name: 'Preview for the client' });
    const line = await rowOf('Sponsor script for episode 14', share);
    expect(within(line).queryByRole('group', { name: "Your client's answer" })).toBeNull();
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Share with client' })); });
    const answer = await within(line).findByRole('group', { name: "Your client's answer" });
    fireEvent.change(within(answer).getByLabelText('What your client said (optional)'), { target: { value: 'Say the price once, not twice.' } });
    await act(async () => { fireEvent.click(within(answer).getByRole('button', { name: 'Asked for changes' })); });
    expect(calls.find((c) => c.method === 'venture.share.recordAnswer')?.params).toEqual({ draftId: 'd-ep14-script', answer: 'changes', comment: 'Say the price once, not twice.' });
    await waitFor(() => expect(within(line).getByText("Your client's answer: Asked for changes. Say the price once, not twice.")).toBeTruthy());
    expect(within(line).queryByRole('button', { name: 'Approved' })).toBeNull();
  });

  it('an answer the engine already holds is shown, with no buttons', async () => {
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': deliveries, 'venture.share.list': shareList(approved) } });
    const share = await screen.findByRole('region', { name: 'Preview for the client' });
    const line = await rowOf('Posts for October', share);
    await waitFor(() => expect(within(line).getByText("Your client's answer: Approved")).toBeTruthy());
    expect(within(line).queryByRole('button', { name: 'Approved' })).toBeNull();
  });

  it("a refusal to record is said in the engine's words", async () => {
    await start('#/work?order=o-boat-14', {
      intercept: {
        'venture.delivery.list': deliveries, 'venture.share.list': shareList(),
        'venture.share.recordAnswer': () => { throw new EngineError('APPROVAL_STALE', 'This draft changed since the link was made.'); },
      },
    });
    const line = await rowOf('Posts for October', await screen.findByRole('region', { name: 'Preview for the client' }));
    const group = await within(line).findByRole('group', { name: "Your client's answer" });
    await act(async () => { fireEvent.click(within(group).getByRole('button', { name: 'Approved' })); });
    await waitFor(() => expect(within(line).getByRole('alert').textContent).toBe("Couldn't record the answer: This draft changed since the link was made."));
  });
});

describe('Work: posting an approved draft', () => {
  it("shows Post to LinkedIn for each line a browser can post, only once the client approved; the line then waits on Today", async () => {
    const { calls } = await start('#/work?order=o-boat-14', {
      intercept: {
        'venture.delivery.list': deliveries, 'venture.share.list': shareList(approved),
        'venture.posting.propose': () => ({
          postId: 'post_1', connectorId: 'linkedin', draftId: 'd-social.post-1', part: 1, state: 'described', line: 'Waiting on Today for your approval.',
          warnings: ['This post is 61% the same as one of the last 5 posts on LinkedIn. Platforms may show near repeats to fewer people. (rule house-near-duplicate-warn)'],
        }),
      },
    });
    const posting = await screen.findByRole('region', { name: 'Post' });
    const line = await rowOf('Our cafe opens at 8 every weekday.', posting);
    // Instagram (pictures not built) and Threads (no connector) get no button.
    expect(within(posting).queryByText('Fresh pastries at 8.')).toBeNull();
    expect(within(posting).queryByText('Filter coffee all day.')).toBeNull();
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Post to LinkedIn' })); });
    expect(calls.find((c) => c.method === 'venture.posting.propose')?.params).toEqual({ draftId: 'd-social.post-1' });
    await waitFor(() => expect(within(line).getByText('Waiting on Today')).toBeTruthy());
    expect(line.textContent).toContain('61% the same');
    expect(within(line).queryByRole('button', { name: 'Post to LinkedIn' })).toBeNull();
  });

  it("says the engine's refusal in its words", async () => {
    await start('#/work?order=o-boat-14', {
      intercept: {
        'venture.delivery.list': deliveries, 'venture.share.list': shareList(approved),
        'venture.posting.propose': () => { throw new EngineError('POST_RISK_BLOCKED', 'The last post on LinkedIn went out 5 minutes ago; Chausar waits at least 60 minutes between posts on one channel. (rule house-post-min-gap)'); },
      },
    });
    const line = await rowOf('Our cafe opens at 8 every weekday.', await screen.findByRole('region', { name: 'Post' }));
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Post to LinkedIn' })); });
    await waitFor(() => expect(within(line).getByRole('alert').textContent).toBe("Couldn't propose this post: The last post on LinkedIn went out 5 minutes ago; Chausar waits at least 60 minutes between posts on one channel. (rule house-post-min-gap)"));
  });

  it('no Post button before the client approved', async () => {
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': deliveries, 'venture.share.list': shareList({ ...approved!, decision: 'changes', comment: 'Shorter.' }) } });
    await screen.findByText("Your client's answer: Asked for changes. Shorter.");
    expect(screen.queryByRole('region', { name: 'Post' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Post to LinkedIn' })).toBeNull();
  });

  it('no Post button for a draft the owner has not accepted', async () => {
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': () => [{ ...SOCIAL, status: 'ready-for-review', verdict: null }], 'venture.share.list': shareList(approved) } });
    await screen.findByText("Your client's answer: Approved");
    expect(screen.queryByRole('region', { name: 'Post' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Post to LinkedIn' })).toBeNull();
  });

  it('in Hindi too', async () => {
    await start('#/work?order=o-boat-14', { language: 'hi', intercept: { 'venture.delivery.list': deliveries, 'venture.share.list': shareList(approved) } });
    const line = (await screen.findByText('Our cafe opens at 8 every weekday.')).closest('li')!;
    expect(within(line).getByRole('button').textContent).not.toBe('Post to LinkedIn');
  });
});

describe('the fake engine posts by the engine rules', () => {
  it('records an answer once, only on a shared draft, and proposes only a post it knows', async () => {
    const engine = new FakeEngine();
    await expect(engine.request('venture.share.recordAnswer', { draftId: 'd-ep14-script', answer: 'approved' })).rejects.toMatchObject({ code: 'SHARE_NOT_FOUND' });
    await engine.request('venture.share.create', { deliveryId: 'd-ep14-script' });
    const recorded = await engine.request('venture.share.recordAnswer', { draftId: 'd-ep14-script', answer: 'approved' }) as { answer: { decision: string; via: string } };
    expect(recorded.answer).toMatchObject({ decision: 'approved', via: 'owner-recorded' });
    await expect(engine.request('venture.share.recordAnswer', { draftId: 'd-ep14-script', answer: 'changes' })).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
    await expect(engine.request('venture.share.recordAnswer', { draftId: 'd-ep14-script', answer: 'maybe' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(engine.request('venture.posting.propose', { draftId: 'not a post' })).rejects.toMatchObject({ code: 'POST_NOT_A_POST' });
    await expect(engine.request('venture.posting.propose', { draftId: 'd-ep14-script.post-1' })).rejects.toMatchObject({ code: 'POST_NOT_A_POST' });
  });
});

describe('Work: posting a draft that needs no client approval', () => {
  it("shows Post to LinkedIn once the owner accepted the draft, when the engine says the client's approval is not needed", async () => {
    await start('#/work?order=o-boat-14', {
      intercept: { 'venture.delivery.list': deliveries, 'venture.share.list': () => ({ links: [], shares: [], posts: POSTS, clientApproval: false }) },
    });
    const line = await rowOf('Our cafe opens at 8 every weekday.', await screen.findByRole('region', { name: 'Post' }));
    expect(within(line).getByRole('button', { name: 'Post to LinkedIn' })).toBeTruthy();
  });

  it('still waits for the client where the engine says the client must approve', async () => {
    await start('#/work?order=o-boat-14', {
      intercept: { 'venture.delivery.list': deliveries, 'venture.share.list': () => ({ links: [], shares: [], posts: POSTS, clientApproval: true }) },
    });
    await screen.findAllByText('Posts for October');
    expect(screen.queryByRole('button', { name: 'Post to LinkedIn' })).toBeNull();
  });
});

describe('Work: the answer the engine counts is the one the screen shows', () => {
  it('approved on a link the owner later took back still counts: Post shows, and no record control is offered', async () => {
    const gone = { ...link(), id: 'share-gone', revoked: true as const, reason: 'You took this link back. It no longer opens.' };
    await start('#/work?order=o-boat-14', {
      intercept: { 'venture.delivery.list': deliveries, 'venture.share.list': () => ({ links: [gone], shares: [gone], posts: POSTS, clientApproval: true, answer: { ...approved!, via: 'share-link' } }) },
    });
    const line = await rowOf('Posts for October', await screen.findByRole('region', { name: 'Preview for the client' }));
    await waitFor(() => expect(within(line).getByText("Your client's answer: Approved")).toBeTruthy());
    expect(within(line).queryByRole('group', { name: "Your client's answer" })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Post to LinkedIn' })).toBeTruthy();
  });

  it('an answer on a link the engine no longer counts (the draft changed) is not shown: the record control is', async () => {
    await start('#/work?order=o-boat-14', {
      intercept: { 'venture.delivery.list': deliveries, 'venture.share.list': () => ({ links: [link(approved)], shares: [link(approved)], posts: POSTS, clientApproval: true, answer: null }) },
    });
    const line = await rowOf('Posts for October', await screen.findByRole('region', { name: 'Preview for the client' }));
    await within(line).findByRole('group', { name: "Your client's answer" });
    expect(within(line).queryByText("Your client's answer: Approved")).toBeNull();
    expect(screen.queryByRole('button', { name: 'Post to LinkedIn' })).toBeNull();
  });

  it('recording "Approved" makes Post appear at once, with no reload', async () => {
    let answer: ShareLink['answer'] | null = null;
    await start('#/work?order=o-boat-14', {
      intercept: {
        'venture.delivery.list': deliveries,
        'venture.share.list': () => ({ links: [link()], shares: [link()], posts: POSTS, clientApproval: true, answer }),
        'venture.share.recordAnswer': () => { answer = approved!; return { answer }; },
      },
    });
    const line = await rowOf('Posts for October', await screen.findByRole('region', { name: 'Preview for the client' }));
    expect(screen.queryByRole('button', { name: 'Post to LinkedIn' })).toBeNull();
    const group = await within(line).findByRole('group', { name: "Your client's answer" });
    await act(async () => { fireEvent.click(within(group).getByRole('button', { name: 'Approved' })); });
    expect(await screen.findByRole('button', { name: 'Post to LinkedIn' })).toBeTruthy();
  });
});
