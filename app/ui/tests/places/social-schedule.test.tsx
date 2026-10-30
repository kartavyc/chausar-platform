// S12 approval UI integration with the real fake desk and exact viewed digest.
import { it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SocialSchedule } from '../../src/places/work/desks/SocialSchedule';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { fakeSocialScheduledKind } from '../../src/engine/fake-social-scheduled';
import type { W4DeskHost } from '../../src/engine/fake-w4';
import { assertInkRules } from '../helpers/ink-rules';
function setup() {
    let postId = 'post_one', state: 'described' | 'approved' | 'rejected' | 'applied' = 'described', changed = false;
    let approvals = 0;
    const host: W4DeskHost = { current: () => 'main', now: () => '2026-10-27T12:00:00.000Z', hosted: () => false, emit: () => { }, rows: () => [], setRows: () => { }, digest: JSON.stringify, ask: () => [], scheduledPost: id => id === postId ? { id, connectorId: 'x', draftId: 'draft_one', text: 'Fresh idli until noon.', account: '@cafe', mode: 'owner-browser-session', digest: 'post-hash', filesDigest: 'files-hash', state, scheduled: id !== 'post_one' } : null, moveScheduledPost: () => { postId = 'post_scheduled'; return host.scheduledPost!(postId)!; }, decideScheduledPost: (_id, next) => { state = next; } };
    const desk = fakeSocialScheduledKind(host);
    const client = createFakeClient(new FakeEngine()), request = client.request.bind(client);
    client.request = (async (method: any, p: any) => { if (method === 'venture.queue.list')
        return { rows: [{ id: 'post_one', kind: 'connector', title: 'Post to X', businessId: 'main' }], summary: '', needsYou: 1, businesses: 1 }; if (method.startsWith('venture.desk.') && p.kind === 'scheduled') {
        const action = method.split('.').at(-1) as 'list' | 'get' | 'act';
        if (action === 'act' && p.action === 'approve')
            approvals++;
        const result: any = desk[action]!(p);
        return changed && action === 'get' ? { ...result, item: { ...result.item, text: 'Unseen changed words.' } } : result;
    } return request(method, p); }) as typeof client.request;
    render(<TextProvider language="en"><EngineProvider client={client}><SocialSchedule /></EngineProvider></TextProvider>);
    return { change: () => { changed = true; }, approvals: () => approvals };
}
async function create() { fireEvent.click(await screen.findByRole('button', { name: 'New scheduled slot' })); fireEvent.change(screen.getByLabelText('Waiting post'), { target: { value: 'post_one' } }); fireEvent.change(screen.getByLabelText('Time on this device'), { target: { value: '2026-10-28T12:00' } }); fireEvent.click(screen.getByRole('button', { name: 'Review slot' })); return screen.findByRole('button', { name: 'Approve this exact slot' }); }
it('shows the exact text, account, mode, time window and risk before approving', async () => { const env = setup(); const approve = await create(); expect(screen.getByText('Fresh idli until noon.')).toBeTruthy(); expect(screen.getByText('@cafe')).toBeTruthy(); expect(screen.getByText('Your signed-in browser')).toBeTruthy(); expect(screen.getByText('The platform may restrict this account.')).toBeTruthy(); expect(screen.getByText(/Post no later than/)).toBeTruthy(); fireEvent.click(approve); await waitFor(() => expect(env.approvals()).toBe(1)); expect(await screen.findByText('Approved for this session')).toBeTruthy(); assertInkRules(); });
it('does not approve changed words fetched after the displayed review', async () => { const env = setup(); const approve = await create(); env.change(); fireEvent.click(approve); expect((await screen.findByRole('alert')).textContent).toContain('This slot changed. Review it again.'); expect(env.approvals()).toBe(0); });
