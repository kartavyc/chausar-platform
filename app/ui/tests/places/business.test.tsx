import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type BlueprintViewLite, type BuildStatusView, type QueueList } from '../../src/engine/types';
import { lineDiff } from '../../src/places/business/SiteEdits';
import { receiptMark } from '../helpers/ink-rules';

type Bridged = Window & { chausar?: unknown };

function start(hash: string, engine = new FakeEngine(), language: 'en' | 'hi' = 'en') {
  window.location.hash = hash;
  const client = createFakeClient(engine);
  render(<App client={client} language={language} />);
  return { client, engine };
}
async function ledgerline() {
  const engine = new FakeEngine();
  await engine.request('workspace.open', { folder: 'ledgerline' });
  return engine;
}
function desktop() {
  const openExternal = vi.fn(async (_url: string) => {});
  (window as Bridged).chausar = { request: vi.fn(), openExternal };
  return openExternal;
}
const plan = async (engine: FakeEngine) => (await engine.request('venture.blueprint.get', {})) as BlueprintViewLite;
const offerRow = async (name: string) => (await screen.findByText(name, { selector: '[data-offer-name]' })).closest('li')!;
/**
 * A region found by its heading's words, then checked to be named by that heading (connections-v2's pattern). Role
 * queries over the whole page are slow in jsdom, so a wait polls a cheap text query and the name is checked once.
 */
async function region(title: string): Promise<HTMLElement> {
  const heading = await screen.findByText(title, { selector: 'h2' });
  const section = heading.closest('section') as HTMLElement;
  expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
  return section;
}

afterEach(() => { delete (window as Bridged).chausar; vi.unstubAllGlobals(); });

describe('Business: plan and playbook', () => {
  it("shows the plan with the playbook's kind, offers priced only by receipt, steps and what you approve", async () => {
    start('#/business/plan');
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan and playbook' })).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole('main')).getByText(/YouTube channel/)).toBeTruthy());
    expect(screen.getByText(/Version 2, accepted/)).toBeTruthy();
    expect(screen.getByText('Weekly audio gear reviews on YouTube, cut into shorts, with sponsor slots.')).toBeTruthy();
    const sponsor = await offerRow('Sponsor slot');
    expect(sponsor.textContent).toContain('₹15,000.00');
    expect(within(sponsor).getByRole('button', { name: receiptMark('R-0408') })).toBeTruthy();
    const shorts = await offerRow('Shorts from your long video');
    expect(shorts.textContent).toContain('Price not set');
    expect(within(shorts).getByRole('link', { name: 'Set price' }).getAttribute('href')).toBe('#/business/prices');
    expect(screen.getByText('Draft the sponsor script')).toBeTruthy();
    expect(screen.getByText('Anything posted in your name')).toBeTruthy();
    expect(screen.getAllByText('assumption').length).toBeGreaterThan(0);
    const nav = screen.getByRole('navigation', { name: 'Business pages' });
    expect(within(nav).getByRole('link', { name: 'Plan and playbook' }).getAttribute('aria-current')).toBe('page');
  });

  it("lists a flagship playbook's own steps with who does each, in place of the template steps", async () => {
    const engine = new FakeEngine();
    const view = await plan(engine);
    const step = (id: string, title: string, doneBy: 'you' | 'agent' | 'code' | 'person', who: string) => ({ id, title: { value: title, label: 'assumption' as const, by: 'engine' as const }, doneBy, who });
    const flagshipSteps = [
      step('intake', "Read the order and the client's files, and record the rights to the footage", 'agent', 'Intake clerk'),
      step('probe', 'Read the transcript timings, the silences and the likely drop points', 'code', 'Chausar'),
      step('review', 'You watch the cut and read the package', 'you', 'You'),
      step('ca-signoff', 'The CA of record signs off the regulated papers', 'person', 'CA of record'),
    ];
    const client = createFakeClient(engine);
    const request = client.request.bind(client);
    client.request = ((method: string, params?: unknown) => (method === 'venture.blueprint.get'
      ? Promise.resolve({ ...view, blueprint: { ...view.blueprint, flagshipSteps } })
      : request(method as never, params as never))) as typeof client.request;
    window.location.hash = '#/business/plan';
    render(<App client={client} language="en" />);
    const steps = await screen.findByRole('region', { name: 'Steps' });
    await waitFor(() => expect(within(steps).getAllByRole('listitem')).toHaveLength(4));
    expect(within(steps).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      "Read the order and the client's files, and record the rights to the footageIntake clerk, an agent",
      'Read the transcript timings, the silences and the likely drop pointsChausar, code with no AI',
      'You watch the cut and read the packageYou',
      'The CA of record signs off the regulated papersCA of record',
    ]);
    expect(within(steps).queryByText('Draft the sponsor script')).toBeNull();
    expect(within(steps).queryByText('How each step works')).toBeNull();
  });

  it('the bare business address shows the plan', async () => {
    start('#/business');
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan and playbook' })).toBeTruthy();
  });

  it("accepts a draft plan through its row on Today's queue", async () => {
    const engine = await ledgerline();
    start('#/business/plan', engine);
    const waiting = await region('Waiting on you');
    const row = (await within(waiting).findByText('Your plan is ready. Read it.')).closest('li')!;
    const accept = within(row).getByRole('button', { name: 'Accept' }) as HTMLButtonElement;
    expect(accept.disabled).toBe(false);
    await act(async () => { fireEvent.click(accept); });
    await waitFor(() => expect((screen.getByText(/Version 1, accepted/))).toBeTruthy());
    expect((await plan(engine)).blueprint.status).toBe('accepted');
  });

  it('changing the plan makes a new draft version, which waits on Today until you accept it', async () => {
    const { engine } = start('#/business/plan');
    fireEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
    const line = screen.getByLabelText('One line') as HTMLInputElement;
    expect(line.value).toBe('Weekly audio gear reviews on YouTube, cut into shorts, with sponsor slots.');
    fireEvent.change(line, { target: { value: 'Audio gear reviews every Friday, with sponsor slots.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    await waitFor(() => expect(screen.getByText(/Version 3, not accepted yet/)).toBeTruthy());
    const waiting = await region('Waiting on you');
    expect(within(waiting).getByText('Your plan changed. Read it, then accept it.')).toBeTruthy();
    const queue = (await engine.request('venture.queue.list', { scope: 'current' })) as QueueList;
    expect(queue.rows.some((r) => r.viewRef?.kind === 'plan' && r.viewRef.id === 'bp-lumen-3')).toBe(true);
    // A new version has no receipts of its own until it is priced, so the page asks the engine again.
    await waitFor(() => expect(screen.getAllByRole('button', { name: receiptMark(/^R-0/) }).length).toBeGreaterThan(0));
  });

  it('refuses an empty change in words, without asking the engine', async () => {
    const { engine } = start('#/business/plan');
    const spy = vi.spyOn(engine, 'request');
    fireEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    expect(screen.getByText('Nothing changed yet.')).toBeTruthy();
    expect(spy.mock.calls.some(([method]) => method === 'venture.blueprint.update')).toBe(false);
  });
});

describe('Business: platform rules (2H)', () => {
  it("the fake answers like the engine: a social agency's real rules, counted apart, with no empty list", async () => {
    const { rulesListFor } = await import('../../src/engine/fixtures-rules');
    const social = rulesListFor({ id: 'social-agency', label: 'Social media agency' }, '2026-10-23');
    expect(social.playbook).toEqual({ id: 'social-agency', label: 'Social media agency', riskLevel: 'medium', lastReviewed: '2026-10-23' });
    expect(social.rules.length).toBeGreaterThan(40);
    expect(social.rules.find((rule) => rule.id === 'linkedin-3000')?.usedBy).toContain('publish');
    expect(social.summary).toMatch(/^\d+ current, 0 to recheck, \d+ not confirmed against a source yet\.$/);
    const later = rulesListFor({ id: 'social-agency', label: 'Social media agency' }, '2027-01-25');
    expect(later.summary).toBe(`0 current, ${later.rules.length} to recheck.`);
    expect(later.rules[0]!.line).toMatch(/was checked 96 days ago, on 2026-10-21/);
    for (const id of ['social-agency', 'youtube']) expect(rulesListFor({ id, label: id }, '2026-10-23').summary).not.toMatch(/rests on no dated platform rules/);
  });

  it("shows the playbook's dated rules: how many to recheck, each stale rule's line and its source link", async () => {
    start('#/business/plan', new FakeEngine({ now: () => '2027-01-25T09:00:00.000Z' }));
    const rules = await screen.findByRole('region', { name: 'Platform rules' });
    await waitFor(() => expect(within(rules).getByText('0 current, 8 to recheck.')).toBeTruthy());
    expect(within(rules).getByText("Medium risk · Chausar's build last reviewed these rules on 23 Oct 2026")).toBeTruthy();
    const stale = within(rules).getByRole('list', { name: 'To recheck' });
    expect(within(stale).getAllByRole('listitem')).toHaveLength(8);
    const chapters = within(stale).getByText(/^Video chapters added by hand was checked 96 days ago, on 2026-10-21\./).closest('li')!;
    const link = within(chapters).getByRole('link', { name: 'Video Chapters, YouTube Help' });
    expect(link.getAttribute('href')).toBe('https://support.google.com/youtube/answer/9884579');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('inside the window every rule is current, with what it does not cover; a business with no playbook shows none', async () => {
    start('#/business/plan', new FakeEngine({ now: () => '2026-10-23T09:00:00.000Z' }));
    const rules = await screen.findByRole('region', { name: 'Platform rules' });
    await waitFor(() => expect(within(rules).getByText('8 current, 0 to recheck.')).toBeTruthy());
    expect(within(rules).queryByRole('list', { name: 'To recheck' })).toBeNull();
    const current = within(rules).getByRole('list', { name: 'Current rules' });
    const chapters = within(current).getByText(/^Video chapters added by hand: The first timestamp/).closest('li')!;
    expect(within(chapters).getByText('The check reads the chapters written in the description; automatic chapters YouTube may add are not read.')).toBeTruthy();
    expect(within(chapters).getByRole('link', { name: 'Video Chapters, YouTube Help' })).toBeTruthy();
  });

  it('a business with no flagship playbook shows no rules; a refusal shows the engine\'s words', async () => {
    const engine = new FakeEngine();
    const client = createFakeClient(engine);
    const request = client.request.bind(client);
    let asked = 0;
    let answer: () => Promise<unknown> = () => Promise.resolve({ playbook: null, rules: [], summary: 'This business follows no playbook with dated platform rules.' });
    client.request = ((method: string, params?: unknown) => {
      if (method !== 'venture.rules.list') return request(method as never, params as never);
      asked += 1;
      return answer();
    }) as typeof client.request;
    window.location.hash = '#/business/plan';
    const { unmount } = render(<App client={client} language="en" />);
    await screen.findByRole('region', { name: 'Steps' });
    await waitFor(() => expect(asked).toBeGreaterThan(0));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('region', { name: 'Platform rules' })).toBeNull();
    expect(screen.queryByText('This business follows no playbook with dated platform rules.')).toBeNull();
    unmount();

    answer = () => Promise.reject(new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'));
    render(<App client={client} language="en" />);
    const rules = await screen.findByRole('region', { name: 'Platform rules' });
    expect((await within(rules).findByRole('alert')).textContent).toContain('This part of Chausar is not built yet.');
  });
});

describe('Business: prices', () => {
  it('shows each figure of the receipt as the engine wrote it; Work out the price asks the engine for a new receipt', async () => {
    const engine = await ledgerline();
    start('#/business/prices', engine);
    const books = await offerRow('Monthly books');
    for (const text of ['₹16,000.00', 'CGST at 9%', '₹1,440.00', '₹18,880.00']) expect(books.textContent).toContain(text);
    const gst = await offerRow('GST working');
    await act(async () => { fireEvent.click(within(gst).getByRole('button', { name: 'Work out the price' })); });
    await waitFor(() => expect(gst.textContent).toContain('₹5,000.00'));
    expect(within(gst).getByRole('button', { name: receiptMark(/^R-0\d{3}$/) })).toBeTruthy();
  });

  it('sets a price as typed; the engine prices it with a receipt and the change waits on Today, asking twice', async () => {
    const { engine } = start('#/business/prices');
    const shorts = await offerRow('Shorts from your long video');
    fireEvent.change(within(shorts).getByLabelText('New price for Shorts from your long video, in INR'), { target: { value: '12000' } });
    await act(async () => { fireEvent.click(within(shorts).getByRole('button', { name: 'Save price' })); });
    await waitFor(async () => expect((await offerRow('Shorts from your long video')).textContent).toContain('₹12,000.00'));
    const waiting = await region('Waiting on you');
    const row = within(waiting).getByText('New price for Shorts from your long video').closest('li')!;
    expect(row.textContent).toContain('Not set');
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Accept' })); });
    expect(within(row).getByText(/This can't be undone/)).toBeTruthy();
    await act(async () => { fireEvent.click(within(row).getAllByRole('button', { name: 'Accept' }).at(-1)!); });
    await waitFor(async () => expect((await plan(engine)).blueprint.status).toBe('accepted'));
  });

  it('an offer with no price says so and the engine refuses to price it', async () => {
    start('#/business/prices');
    const shorts = await offerRow('Shorts from your long video');
    expect(shorts.textContent).toContain('Price not set');
    expect(within(shorts).queryByRole('button', { name: 'Work out the price' })).toBeNull();
  });
});

describe('Business: website build', () => {
  it('shows the brief, opens Lovable through the engine link, and says where the build is in plain words', async () => {
    const openExternal = desktop();
    const { engine } = start('#/business/build');
    await waitFor(() => expect(screen.getByText(/checks passed/)).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open in Lovable' })); });
    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    expect(openExternal.mock.calls[0]![0]).toMatch(/^https:\/\/lovable\.dev\/#prompt=/);
    await waitFor(() => expect(screen.getByText('Lovable opened in your browser.')).toBeTruthy());
    expect(screen.getByText('Lovable keeps your brief in this browser until you press send.')).toBeTruthy();
    expect(((await engine.request('venture.build.status', {})) as BuildStatusView).handoffs[0]!.openedAt).not.toBeNull();
    expect(screen.getByText('The builder is making changes')).toBeTruthy();
    expect(screen.getByText('lumenstudio/site')).toBeTruthy();
    const address = screen.getByText('https://lumenstudio.lovable.app');
    expect(address.closest('a')).toBeNull();
    expect(screen.getByText(/synthetic recording of GitHub/)).toBeTruthy();
  });

  it('on the web, the tab opens inside the click and the link goes to it once the engine answers', async () => {
    const replace = vi.fn();
    const tab = { location: { replace }, close: vi.fn(), opener: {} as unknown };
    vi.stubGlobal('open', vi.fn(() => tab));
    start('#/business/build');
    { const target = await screen.findByRole('button', { name: 'Open in Replit' }); await act(async () => { fireEvent.click(target); }); }
    expect(window.open).toHaveBeenCalledWith('', '_blank');
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace.mock.calls[0]![0]).toMatch(/^https:\/\/replit\.com\//);
    expect(tab.opener).toBeNull();
  });

  it('a business without an accepted plan has no brief yet; the engine says why', async () => {
    const engine = await ledgerline();
    start('#/business/build', engine);
    { const target = await screen.findByRole('button', { name: 'Write the brief' }); await act(async () => { fireEvent.click(target); }); }
    await waitFor(() => expect(screen.getByText('Accept your plan first. The brief is written from the accepted plan.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Open in Lovable' })).toBeNull();
  });

  it('follows a repo: the read-only key is sent once, cleared, and never shown', async () => {
    const engine = await ledgerline();
    const spy = vi.spyOn(engine, 'request');
    start('#/business/build', engine);
    fireEvent.change(await screen.findByLabelText('Your app repo on GitHub'), { target: { value: 'ledgerline/site' } });
    const key = screen.getByLabelText('Read-only key, for a private repo') as HTMLInputElement;
    expect(key.type).toBe('password');
    fireEvent.change(key, { target: { value: 'github_pat_secret' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Follow' })); });
    await waitFor(() => expect(screen.getByText('Repo connected')).toBeTruthy());
    expect(spy.mock.calls.find(([method]) => method === 'venture.build.link')![1]).toEqual({ repo: 'ledgerline/site', token: 'github_pat_secret' });
    expect(document.body.textContent).not.toContain('github_pat_secret');
    expect(screen.queryByLabelText('Read-only key, for a private repo')).toBeNull();
  });

  it('links to the engine\'s page for making a read-only GitHub key', async () => {
    const engine = await ledgerline();
    start('#/business/build', engine);
    const link = await screen.findByRole('link', { name: /Create a read-only key/ });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/github\.com\/settings\/personal-access-tokens\/new\?/);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('Business: the addresses other places link to', () => {
  // Today's setup rows lead to #/business/prices ("Set prices") and #/business/keep ("Keep it"); Team's empty state to #/business/plan.
  for (const [hash, title] of [['#/business/prices', 'Prices'], ['#/business/keep', 'Keep this business'], ['#/business/plan', 'Plan and playbook']] as const) {
    it(`${hash} opens ${title}`, async () => {
      start(hash);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
      const nav = screen.getByRole('navigation', { name: 'Business pages' });
      expect(within(nav).getByRole('link', { name: title }).getAttribute('aria-current')).toBe('page');
    });
  }
  it('an address it does not know shows the plan', async () => {
    start('#/business/nowhere');
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan and playbook' })).toBeTruthy();
  });
});

describe('Business: keep this business', () => {
  /** A business just started on this computer: kept by this computer's key, no recovery code yet, so Today asks to keep it. */
  async function newBusiness() {
    const engine = new FakeEngine({ fresh: true });
    await engine.request('workspace.create', { name: 'Kite Studio', pack: 'services' });
    await engine.request('venture.create', { idea: 'Bookkeeping for small shops in Pune', countryCode: 'IN' });
    for (const [questionId, answer] of [['q_1', { skipped: true }], ['q_pricing_model', { choiceId: 'monthly' }], ['q_price', { skipped: true }], ['q_tax', { yes: false }]] as const) {
      await engine.request('venture.interview.answer', { questionId, answer });
    }
    await engine.request('venture.blueprint.draft', {});
    return engine;
  }
  const keepRows = async (engine: FakeEngine) => ((await engine.request('venture.queue.list', { scope: 'current' })) as QueueList).rows.filter((r) => r.actions.some((a) => a.id === 'keep'));

  it("says this computer keeps the key, and making the recovery code shows it once and takes Today's row away", async () => {
    const engine = await newBusiness();
    expect(await keepRows(engine)).toHaveLength(1);
    start('#/business/keep', engine);
    expect(await screen.findByText('Windows keeps the key for your login on this computer.')).toBeTruthy();
    expect(screen.getByText(/Not made yet/)).toBeTruthy();
    expect(screen.getByLabelText('Passphrase').closest('details')!.open).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make a recovery code' })); });
    const code = await screen.findByRole('group', { name: 'Recovery code' });
    expect(code.textContent).toBe('R4KD9QXM2HTW7PLB3NCF6YJV');
    const done = screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: "I've saved it somewhere safe" }));
    fireEvent.click(done);
    expect(screen.queryByRole('group', { name: 'Recovery code' })).toBeNull();
    expect(document.body.textContent).not.toContain('R4KD9QXM2HTW7PLB3NCF6YJV');
    await waitFor(() => expect(screen.getByText(/^Made\./)).toBeTruthy());
    expect(await keepRows(engine)).toHaveLength(0);
  });

  it('the passphrase is optional, behind a fold; it needs 12 characters typed twice, and is never kept on screen', async () => {
    const engine = await newBusiness();
    const spy = vi.spyOn(engine, 'request');
    start('#/business/keep', engine);
    const fold = (await screen.findByText('Lock it with a passphrase instead')).closest('details')!;
    expect(fold.open).toBe(false);
    fireEvent.click(within(fold).getByText('Lock it with a passphrase instead'));
    const first = within(fold).getByLabelText('Passphrase') as HTMLInputElement;
    const again = within(fold).getByLabelText('Type it again') as HTMLInputElement;
    expect(first.type).toBe('password');
    fireEvent.change(first, { target: { value: 'short' } });
    fireEvent.change(again, { target: { value: 'short' } });
    await act(async () => { fireEvent.click(within(fold).getByRole('button', { name: 'Lock with this passphrase' })); });
    expect(within(fold).getByText('Use a passphrase of at least 12 characters.')).toBeTruthy();
    expect(spy.mock.calls.some(([method]) => method === 'workspace.custody.passphraseOn')).toBe(false);
    fireEvent.change(first, { target: { value: 'kite studio keeps books' } });
    fireEvent.change(again, { target: { value: 'kite studio keeps books' } });
    await act(async () => { fireEvent.click(within(fold).getByRole('button', { name: 'Lock with this passphrase' })); });
    expect(await screen.findByRole('group', { name: 'Recovery code' })).toBeTruthy();
    expect(first.value).toBe('');
    expect(document.body.textContent).not.toContain('kite studio keeps books');
    fireEvent.click(screen.getByRole('checkbox', { name: "I've saved it somewhere safe" }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByText('Your passphrase opens it; this computer keeps no key for it.')).toBeTruthy());
  });

  it('backs up now, and says when the last backup was', async () => {
    const engine = await newBusiness();
    start('#/business/keep', engine);
    { const target = await screen.findByRole('button', { name: 'Back up now' }); await act(async () => { fireEvent.click(target); }); }
    const backups = (await engine.request('workspace.backups.list', {})) as { backups: { kind: string }[] };
    expect(backups.backups[0]!.kind).toBe('manual');
    expect(screen.getByText(/^Last backup:/)).toBeTruthy();
  });
});

describe('Business menu: the playbook label', () => {
  it("shows the playbook's own label under the business name, in the rail button and in the menu", async () => {
    start('#/today');
    const rail = screen.getByRole('navigation', { name: 'Places' });
    const button = await within(rail).findByRole('button', { name: /Lumen Studio/ });
    await waitFor(() => expect(button.textContent).toContain('YouTube channel'));
    fireEvent.click(button);
    const menu = await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' });
    const current = await within(menu).findByRole('button', { name: /Lumen Studio/ });
    expect(current.textContent).toContain('YouTube channel');
    const ledgerline = await within(menu).findByRole('button', { name: /Ledgerline/ });
    await act(async () => { fireEvent.click(ledgerline); });
    // Switching reads the whole app again for the other business, so the rail is a new one.
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Places' })).getByRole('button', { name: /Ledgerline/ }).textContent).toContain('AI-native CA firm'));
  });

  it("falls back to the service type's label when the engine sends no playbook", async () => {
    const engine = new FakeEngine();
    const client = createFakeClient(engine);
    const plain = { ...client, request: (async (method: string, params?: unknown) => {
      const reply = await client.request(method as 'venture.get', params as Record<string, never>);
      if (method === 'venture.get' && reply) { const { playbook: _dropped, ...rest } = reply; return rest; }
      return reply;
    }) as typeof client.request };
    window.location.hash = '#/today';
    render(<App client={plain} language="en" />);
    const rail = screen.getByRole('navigation', { name: 'Places' });
    await waitFor(() => expect(within(rail).getByRole('button', { name: /Lumen Studio/ }).textContent).toContain('Content shop'));
  });
});

describe('Business menu', () => {
  it('a business that opens with its passphrase says so; Continue closes this one and asks for it on Welcome back', async () => {
    const { engine } = start('#/today');
    const spy = vi.spyOn(engine, 'request');
    fireEvent.click(await within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ }));
    const menu = await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' });
    { const target = await within(menu).findByRole('button', { name: /Sitara Events/ }); await act(async () => { fireEvent.click(target); }); }
    expect(within(menu).getByText('Sitara Events opens with its passphrase. Chausar closes this business first.')).toBeTruthy();
    expect(spy.mock.calls.some(([method]) => method === 'workspace.open' || method === 'workspace.lock')).toBe(false);
    await act(async () => { fireEvent.click(within(menu).getByRole('button', { name: 'Continue' })); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy();
    expect(spy.mock.calls.filter(([method]) => method === 'workspace.lock')).toHaveLength(1);
    expect(spy.mock.calls.some(([method]) => method === 'workspace.open')).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText('Passphrase for Sitara Events'));
  });

  it("a business whose key is missing goes to its recovery code on Welcome back, after this one closes", async () => {
    start('#/today', new FakeEngine({ keyMissing: ['ledgerline'] }));
    fireEvent.click(await within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ }));
    const menu = await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' });
    { const target = await within(menu).findByRole('button', { name: /Ledgerline/ }); await act(async () => { fireEvent.click(target); }); }
    expect(within(menu).getByText("Ledgerline can't open with this computer's key. Your recovery code opens it. Chausar closes this business first.")).toBeTruthy();
    await act(async () => { fireEvent.click(within(menu).getByRole('button', { name: 'Continue' })); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Use your recovery code' })).toBeTruthy();
    expect((screen.getByLabelText('Business') as HTMLSelectElement).value).toBe('ledgerline');
  });

  it('switching closes the open business first, as the engine keeps one open, then opens the other', async () => {
    const { engine } = start('#/today');
    const spy = vi.spyOn(engine, 'request');
    fireEvent.click(await within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ }));
    const menu = await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' });
    { const target = await within(menu).findByRole('button', { name: /Ledgerline/ }); await act(async () => { fireEvent.click(target); }); }
    const order = spy.mock.calls.map(([method]) => method).filter((method) => method === 'workspace.lock' || method === 'workspace.open');
    expect(order).toEqual(['workspace.lock', 'workspace.open']);
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Places' })).getByRole('button', { name: /Ledgerline/ })).toBeTruthy());
  });

  it('leads to plan and playbook, prices, goals, website build, practice, notifications and a new business', async () => {
    start('#/today');
    fireEvent.click(await within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ }));
    const menu = await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' });
    const hrefs = within(menu).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]);
    // W4 4J20: last, after Away, "Invite your accountant" opens Money's accountant sheet (a read-only month of books).
    // W5 5A2: Go or no go, after Goals.
    expect(hrefs).toEqual([['Plan and playbook', '#/business/plan'], ['Prices', '#/business/prices'], ['Goals', '#/business/goals'], ['Go or no go', '#/business/go-no-go'], ['Website build', '#/business/build'], ['Practice and improve', '#/business/practice'], ['Notifications', '#/business/notifications'], ['Keep this business', '#/business/keep'], ['New business', '#/onboarding'], ['Away', '#/business/away'], ['Invite your accountant', '#/money?sheet=accountant:books']]);
    expect(hrefs).toHaveLength(11);
    expect(within(menu).getByRole('link', { name: 'Invite your accountant' }).getAttribute('href')).toBe('#/money?sheet=accountant:books');
  });

  it('speaks Hindi on the business pages', async () => {
    start('#/business/plan', new FakeEngine(), 'hi');
    expect(await screen.findByRole('heading', { level: 1, name: 'प्लान और प्लेबुक' })).toBeTruthy();
  });
});

describe('Business: your CA (CA firm playbook)', () => {
  it('shows the CA of record, the rate tables waiting with their citations, and the sign-offs, with a link in the pages', async () => {
    start('#/business/ca', await ledgerline());
    expect(await screen.findByRole('heading', { level: 1, name: 'Your CA' })).toBeTruthy();
    expect(await screen.findByText('Meera Joshi')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Business pages' });
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'Your CA' }).getAttribute('aria-current')).toBe('page'));
    expect(screen.getByText('412345')).toBeTruthy();
    expect(screen.getByText(/Agents never file or sign/)).toBeTruthy();
    const rates = screen.getByRole('region', { name: 'Rate tables to confirm' });
    expect(within(rates).getByRole('checkbox', { name: 'GST rates for services' })).toBeTruthy();
    expect(rates.textContent).toContain('Version 3');
    expect(rates.textContent).toContain('no end date');
    expect(rates.textContent).toContain('CBIC rate notification for services, September 2025');
    const requests = screen.getByRole('region', { name: 'Sign-off requests' });
    const signed = within(requests).getByText('TDS working, July to September').closest('li')!;
    expect(signed.textContent).toContain('Signed');
    expect(within(signed).queryByRole('button', { name: 'Record sign-off' })).toBeNull();
  });

  it("confirms chosen rate tables with the CA's own number; another number is refused in the engine's words", async () => {
    start('#/business/ca', await ledgerline());
    const rates = await screen.findByRole('region', { name: 'Rate tables to confirm' });
    fireEvent.click(within(rates).getByRole('checkbox', { name: 'GST rates for services' }));
    fireEvent.change(within(rates).getByLabelText("Your CA's membership number"), { target: { value: '999999' } });
    await act(async () => { fireEvent.click(within(rates).getByRole('button', { name: 'Confirm chosen tables' })); });
    await waitFor(() => expect(within(rates).getByRole('alert').textContent).toBe("That is not Meera Joshi's membership number. Only your CA of record signs."));
    fireEvent.change(within(rates).getByLabelText("Your CA's membership number"), { target: { value: '412345' } });
    await act(async () => { fireEvent.click(within(rates).getByRole('button', { name: 'Confirm chosen tables' })); });
    await waitFor(() => expect(within(rates).getByText('Confirmed 1 rate table.')).toBeTruthy());
    await waitFor(() => expect(within(rates).queryByRole('checkbox', { name: 'GST rates for services' })).toBeNull());
    expect(within(rates).getByRole('checkbox', { name: 'TDS rates, 2026-27' })).toBeTruthy();
  });

  it('asks for a rate table before confirming, without asking the engine', async () => {
    const engine = await ledgerline();
    const spy = vi.spyOn(engine, 'request');
    start('#/business/ca', engine);
    const rates = await screen.findByRole('region', { name: 'Rate tables to confirm' });
    await act(async () => { fireEvent.click(within(rates).getByRole('button', { name: 'Confirm chosen tables' })); });
    expect(within(rates).getByRole('alert').textContent).toBe('Choose a rate table first.');
    expect(spy.mock.calls.some(([method]) => method === 'venture.ca.confirmRates')).toBe(false);
  });

  it('changes the CA of record; a bad membership number is refused in words', async () => {
    const engine = await ledgerline();
    start('#/business/ca', engine);
    const of = await screen.findByRole('region', { name: 'CA of record' });
    fireEvent.click(await within(of).findByRole('button', { name: 'Change' }));
    fireEvent.change(within(of).getByLabelText('Name'), { target: { value: 'Arjun Kulkarni' } });
    fireEvent.change(within(of).getByLabelText('ICAI membership number'), { target: { value: '12' } });
    await act(async () => { fireEvent.click(within(of).getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(within(of).getByRole('alert').textContent).toBe('An ICAI membership number is six digits.'));
    fireEvent.change(within(of).getByLabelText('ICAI membership number'), { target: { value: '523456' } });
    await act(async () => { fireEvent.click(within(of).getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(within(of).getByText('Arjun Kulkarni')).toBeTruthy());
    expect(within(of).getByText('523456')).toBeTruthy();
    expect(((await engine.request('venture.ca.get', {})) as { ca: { name: string } }).ca.name).toBe('Arjun Kulkarni');
  });

  it("papers sent to the CA from Today wait here, and the CA's sign-off is recorded with their number", async () => {
    const engine = await ledgerline();
    const queue = (await engine.request('venture.queue.list', { scope: 'current' })) as QueueList;
    const row = queue.rows.find((r) => r.kind === 'signoff')!;
    await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'send-to-ca', viewed: true });
    start('#/business/ca', engine);
    const requests = await screen.findByRole('region', { name: 'Sign-off requests' });
    const sent = (await within(requests).findByText('GST working for September')).closest('li')!;
    expect(sent.textContent).toContain('With your CA');
    fireEvent.click(within(sent).getByRole('button', { name: 'Record sign-off' }));
    fireEvent.change(within(sent).getByLabelText("Your CA's membership number"), { target: { value: '412345' } });
    fireEvent.change(within(sent).getByLabelText('Note, optional'), { target: { value: 'Checked against the sales register.' } });
    const spy = vi.spyOn(engine, 'request');
    await act(async () => { fireEvent.click(within(sent).getByRole('button', { name: 'Record' })); });
    expect(spy.mock.calls.find(([method]) => method === 'venture.ca.recordSignoff')![1]).toEqual({ requestId: 'ca-req-gst-sep', membershipNo: '412345', note: 'Checked against the sales register.' });
    await waitFor(() => expect(within(requests).getByText('GST working for September').closest('li')!.textContent).toContain('Signed'));
  });

  it("lists the latest regulated papers' receipts, each worked again by the engine: same, or the line that differs (2A2)", async () => {
    const engine = await ledgerline();
    const spy = vi.spyOn(engine, 'request');
    start('#/business/ca', engine);
    const receipts = await screen.findByRole('region', { name: 'Receipts of the latest papers' });
    expect(await within(receipts).findByText('GST working papers for Mehta Traders')).toBeTruthy();
    const gst = (await within(receipts).findByText('GST working')).closest('li')!;
    await waitFor(() => expect(gst.textContent).toContain('Recomputed: same'));
    const portal = (await within(receipts).findByText("The portal's figures against the receipts")).closest('li')!;
    // The engine's own words for a stored portal diff whose figure was changed after it was made.
    await waitFor(() => expect(portal.textContent).toContain('Recomputed: differs. Net payable: the portal less ours: the stored receipt has INR 80.00; worked again it is INR 75.00.'));
    expect(spy.mock.calls.filter(([method]) => method === 'venture.ca.receipt').map(([, params]) => params)).toEqual([{ id: 'w-gst-sep' }, { id: 'w-portal-sep' }]);
  });

  it("explains a portal difference with the CA's own number; the engine's refusal shows in its words, and the explanation then stands (2A2)", async () => {
    const engine = await ledgerline();
    start('#/business/ca', engine);
    const receipts = await screen.findByRole('region', { name: 'Receipts of the latest papers' });
    const row = (await within(receipts).findByText('Net payable: ours INR 2,825.00, the portal INR 2,900.00')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Explain' }));
    const note = 'The portal rounds the payable; the CA accepts the portal figure.';
    fireEvent.change(within(row).getByLabelText("Your CA's explanation"), { target: { value: note } });
    fireEvent.change(within(row).getByLabelText("Your CA's membership number"), { target: { value: '999999' } });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Record explanation' })); });
    await waitFor(() => expect(within(row).getByRole('alert').textContent).toBe('That is not the ICAI membership number of Meera Joshi, your CA of record. Only they explain a difference.'));
    fireEvent.change(within(row).getByLabelText("Your CA's membership number"), { target: { value: '412345' } });
    const spy = vi.spyOn(engine, 'request');
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Record explanation' })); });
    expect(spy.mock.calls.find(([method]) => method === 'venture.ca.explainDiff')![1]).toEqual({ receiptId: 'w-portal-sep', key: 'net-payable', note, membershipNo: '412345' });
    await waitFor(() => expect(within(receipts).getByText(`Your CA's explanation: ${note}`)).toBeTruthy());
    expect(within(receipts).queryByRole('button', { name: 'Explain' })).toBeNull();
    // Recorded once: the engine refuses a second explanation of the same difference.
    await expect(engine.request('venture.ca.explainDiff', { receiptId: 'w-portal-sep', key: 'net-payable', note: 'Another note.', membershipNo: '412345' })).rejects.toMatchObject({ code: 'CA_DIFF_EXPLAINED' });
  });

  it('explains in Hindi too', async () => {
    start('#/business/ca', await ledgerline(), 'hi');
    expect(await screen.findByRole('button', { name: 'समझाएं' })).toBeTruthy();
  });

  it('says so when no regulated papers carry calculator receipts yet', async () => {
    const engine = await ledgerline();
    const real = engine.request.bind(engine);
    vi.spyOn(engine, 'request').mockImplementation(async (method: string, params?: unknown) => {
      const answer = await real(method as never, params as never);
      return method === 'venture.ca.get' ? { ...(answer as object), latestPapers: null } : answer;
    });
    start('#/business/ca', engine);
    const receipts = await screen.findByRole('region', { name: 'Receipts of the latest papers' });
    expect(await within(receipts).findByText('No regulated papers have receipts from the calculator yet.')).toBeTruthy();
  });

  it('a business that is not a CA firm says so in one line, and its pages have no CA', async () => {
    start('#/business/ca');
    expect(await screen.findByText('Only a CA firm has a CA of record.')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Business pages' });
    expect(within(nav).queryByRole('link', { name: 'Your CA' })).toBeNull();
  });

  it('the business menu of a CA firm leads to Your CA', async () => {
    start('#/today', await ledgerline());
    fireEvent.click(await within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Ledgerline/ }));
    const menu = await screen.findByRole('dialog', { name: 'Business menu for Ledgerline' });
    await waitFor(() => expect(within(menu).getByRole('link', { name: 'Your CA' }).getAttribute('href')).toBe('#/business/ca'));
    const hrefs = within(menu).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#/business/plan', '#/business/prices', '#/business/goals', '#/business/go-no-go', '#/business/build', '#/business/practice', '#/business/ca', '#/business/notifications', '#/business/keep', '#/onboarding', '#/business/away', '#/money?sheet=accountant:books']);
    expect(hrefs).toHaveLength(12);
    expect(within(menu).getByRole('link', { name: 'Invite your accountant' }).getAttribute('href')).toBe('#/money?sheet=accountant:books');
  });
});

describe('Business: edits to the website', () => {
  it('reads a change as lines: what went is struck, what came is added, the rest stays', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'same', text: 'a' }, { kind: 'removed', text: 'b' }, { kind: 'added', text: 'B' }, { kind: 'same', text: 'c' }, { kind: 'added', text: 'd' },
    ]);
    expect(lineDiff('', 'new')).toEqual([{ kind: 'added', text: 'new' }]);
  });

  /** Opens the stage form and stages one edit, returning the section. */
  async function stage(file: string, summary: string, text: string) {
    const section = await screen.findByRole('region', { name: 'Edits to your site' });
    fireEvent.click(within(section).getByRole('button', { name: 'Stage an edit' }));
    fireEvent.change(within(section).getByLabelText('File'), { target: { value: file } });
    fireEvent.change(within(section).getByLabelText('What it changes'), { target: { value: summary } });
    fireEvent.change(within(section).getByLabelText('New text'), { target: { value: text } });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: 'Stage it' })); });
    return section;
  }

  it('stages an edit, shows the diff, applies only after a second ask with the reviewed hash, then reverts the same way', async () => {
    const { engine } = start('#/business/build');
    const section = await stage('index.html', 'New episode day', '<h1>Lumen Studio</h1>\n<p>Budget gear, tested honestly.</p>\n<p>New episodes every Monday.</p>');
    const edit = (await within(section).findByText('New episode day')).closest('li')!;
    expect(edit.textContent).toContain('Staged, not written');
    expect(edit.hasAttribute('data-second-ask')).toBe(true);
    expect(edit.querySelector('del')?.textContent).toBe('Removed: <p>New episodes every Friday.</p>');
    expect(edit.querySelector('ins')?.textContent).toBe('Added: <p>New episodes every Monday.</p>');
    const spy = vi.spyOn(engine, 'request');
    fireEvent.click(within(edit).getByRole('button', { name: 'Apply' }));
    expect(within(edit).getByText('Write this to index.html? You can put it back after.')).toBeTruthy();
    expect(spy.mock.calls.some(([method]) => method === 'venture.site.apply')).toBe(false);
    await act(async () => { fireEvent.click(within(edit).getByRole('button', { name: 'Write it' })); });
    expect(spy.mock.calls.find(([method]) => method === 'venture.site.apply')![1]).toEqual({ editId: 'edit-lumen-1', reviewedHash: 'p0000001' });
    await waitFor(() => expect(edit.textContent).toContain('Applied'));
    expect(within(edit).getByText('Read index.html back: it matches what you reviewed.')).toBeTruthy();
    fireEvent.click(within(edit).getByRole('button', { name: 'Revert' }));
    await act(async () => { fireEvent.click(within(edit).getByRole('button', { name: 'Put it back' })); });
    await waitFor(() => expect(edit.textContent).toContain('Put back'));
    expect(within(edit).queryByRole('button', { name: 'Revert' })).toBeNull();
  });

  it("a refusal shows the engine's words: an edit that changed since it was reviewed is not written", async () => {
    const fake = createFakeClient(new FakeEngine());
    const client = { ...fake, request: ((method: string, params?: unknown) => (method === 'venture.site.apply'
      ? Promise.reject(new EngineError('APPROVAL_STALE', 'This edit changed after you reviewed it. Review it again.'))
      : fake.request(method as never, params as never))) as typeof fake.request };
    window.location.hash = '#/business/build';
    render(<App client={client} language="en" />);
    const section = await stage('faq.html', 'Add a FAQ page', '<h1>Questions</h1>');
    const edit = (await within(section).findByText('Add a FAQ page')).closest('li')!;
    fireEvent.click(within(edit).getByRole('button', { name: 'Apply' }));
    await act(async () => { fireEvent.click(within(edit).getByRole('button', { name: 'Write it' })); });
    await waitFor(() => expect(within(edit).getByRole('alert').textContent).toBe('This edit changed after you reviewed it. Review it again.'));
    expect(edit.textContent).toContain('Staged, not written');
  });

  it("staging the same text as the file is refused in the engine's words", async () => {
    start('#/business/build');
    const section = await stage('sponsor.html', 'Nothing new', '<h1>Sponsor with us</h1>\n<p>Two mentions per episode.</p>\n<p>Write to partners@lumenstudio.in</p>');
    await waitFor(() => expect(within(section).getByRole('alert').textContent).toBe('The new text is the same as the file now.'));
  });
});
