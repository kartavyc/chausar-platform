import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { BlueprintViewLite, BuildStatusView, QueueList } from '../../src/engine/types';

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
    expect(within(sponsor).getByRole('button', { name: 'Receipt R-0408' })).toBeTruthy();
    const shorts = await offerRow('Shorts from your long video');
    expect(shorts.textContent).toContain('Price not set');
    expect(within(shorts).getByRole('link', { name: 'Set price' }).getAttribute('href')).toBe('#/business/prices');
    expect(screen.getByText('Draft the sponsor script')).toBeTruthy();
    expect(screen.getByText('Anything posted in your name')).toBeTruthy();
    expect(screen.getAllByText('assumption').length).toBeGreaterThan(0);
    const nav = screen.getByRole('navigation', { name: 'Business pages' });
    expect(within(nav).getByRole('link', { name: 'Plan and playbook' }).getAttribute('aria-current')).toBe('page');
  });

  it('the bare business address shows the plan', async () => {
    start('#/business');
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan and playbook' })).toBeTruthy();
  });

  it("accepts a draft plan through its row on Today's queue", async () => {
    const engine = await ledgerline();
    start('#/business/plan', engine);
    const waiting = await screen.findByRole('region', { name: 'Waiting on you' });
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
    const waiting = screen.getByRole('region', { name: 'Waiting on you' });
    expect(within(waiting).getByText('Your plan changed. Read it, then accept it.')).toBeTruthy();
    const queue = (await engine.request('venture.queue.list', { scope: 'current' })) as QueueList;
    expect(queue.rows.some((r) => r.viewRef?.kind === 'plan' && r.viewRef.id === 'bp-lumen-3')).toBe(true);
    // A new version has no receipts of its own until it is priced, so the page asks the engine again.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Receipt R-0/ }).length).toBeGreaterThan(0));
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

describe('Business: prices', () => {
  it('shows each figure of the receipt as the engine wrote it; Work out the price asks the engine for a new receipt', async () => {
    const engine = await ledgerline();
    start('#/business/prices', engine);
    const books = await offerRow('Monthly books');
    for (const text of ['₹16,000.00', 'CGST at 9%', '₹1,440.00', '₹18,880.00']) expect(books.textContent).toContain(text);
    const gst = await offerRow('GST working');
    await act(async () => { fireEvent.click(within(gst).getByRole('button', { name: 'Work out the price' })); });
    await waitFor(() => expect(gst.textContent).toContain('₹5,000.00'));
    expect(within(gst).getByRole('button', { name: /^Receipt R-0\d{3}$/ })).toBeTruthy();
  });

  it('sets a price as typed; the engine prices it with a receipt and the change waits on Today, asking twice', async () => {
    const { engine } = start('#/business/prices');
    const shorts = await offerRow('Shorts from your long video');
    fireEvent.change(within(shorts).getByLabelText('New price for Shorts from your long video, in INR'), { target: { value: '12000' } });
    await act(async () => { fireEvent.click(within(shorts).getByRole('button', { name: 'Save price' })); });
    await waitFor(async () => expect((await offerRow('Shorts from your long video')).textContent).toContain('₹12,000.00'));
    const waiting = screen.getByRole('region', { name: 'Waiting on you' });
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
    await waitFor(() => expect(button.textContent).toContain('YouTube channel · switch'));
    fireEvent.click(button);
    const menu = await screen.findByRole('group', { name: 'Business menu for Lumen Studio' });
    const current = await within(menu).findByRole('button', { name: /Lumen Studio/ });
    expect(current.textContent).toContain('YouTube channel');
    const ledgerline = await within(menu).findByRole('button', { name: /Ledgerline/ });
    await act(async () => { fireEvent.click(ledgerline); });
    await waitFor(() => expect(within(rail).getByRole('button', { name: /Ledgerline/ }).textContent).toContain('AI-native CA firm · switch'));
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
    await waitFor(() => expect(within(rail).getByRole('button', { name: /Lumen Studio/ }).textContent).toContain('Content shop · switch'));
  });
});

describe('Business menu', () => {
  it("a business that opens with its passphrase says so, and that this screen can't ask for it yet", async () => {
    const { engine } = start('#/today');
    const spy = vi.spyOn(engine, 'request');
    fireEvent.click(await screen.findByRole('button', { name: /Lumen Studio/ }));
    const menu = await screen.findByRole('group', { name: 'Business menu for Lumen Studio' });
    { const target = await within(menu).findByRole('button', { name: /Sitara Events/ }); await act(async () => { fireEvent.click(target); }); }
    expect(within(menu).getByText("Sitara Events opens with its passphrase. Asking for it here isn't built yet.")).toBeTruthy();
    expect(spy.mock.calls.some(([method]) => method === 'workspace.open')).toBe(false);
  });

  it('leads to plan and playbook, prices, website build and a new business', async () => {
    start('#/today');
    fireEvent.click(await screen.findByRole('button', { name: /Lumen Studio/ }));
    const menu = await screen.findByRole('group', { name: 'Business menu for Lumen Studio' });
    const hrefs = within(menu).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]);
    expect(hrefs).toEqual([['Plan and playbook', '#/business/plan'], ['Prices', '#/business/prices'], ['Website build', '#/business/build'], ['Keep this business', '#/business/keep'], ['New business', '#/onboarding']]);
  });

  it('speaks Hindi on the business pages', async () => {
    start('#/business/plan', new FakeEngine(), 'hi');
    expect(await screen.findByRole('heading', { level: 1, name: 'प्लान और प्लेबुक' })).toBeTruthy();
  });
});
