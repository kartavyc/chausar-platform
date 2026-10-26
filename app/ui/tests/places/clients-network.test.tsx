import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient, type NetworkSearchView } from '../../src/engine/types';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { NeverContactLost } from '../../src/places/clients/NeverContactLost';
import { assertInkRules } from '../helpers/ink-rules';

// The Network tab of Clients (Ink v2 wave 4, package 4D4; the direction D board D-Network): search your own network in
// plain words, the results with how you know them and their warm paths, the import sheet, and the side tiles (where
// your network comes from, how well you know them, private to you). Everything shown comes from the fake engine, which
// answers as the engine's 4D1 to 4D3 do, or from answers written here.

type Fake = ReturnType<typeof createFakeClient>;
type Override = (client: Fake) => void;

async function start(hash = '#/clients/network', options: { override?: Override; client?: (client: Fake) => EngineClient; language?: 'en' | 'hi'; prepare?: (client: Fake) => Promise<void> } = {}) {
  window.location.hash = hash;
  const fake = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
  await options.prepare?.(fake);
  options.override?.(fake);
  const spy = vi.spyOn(fake, 'request');
  const client = options.client ? options.client(fake) : fake;
  const view = render(<App client={client} language={options.language ?? 'en'} />);
  return { client: fake, spy, ...view };
}

/** Clicks something that may change the address, then lets the shell see the new hash. */
async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}

/** Lets the engine's answers land. */
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

/** The engine answers one method with this function instead (it may throw an EngineError). */
function answer(method: string, reply: (params: Record<string, unknown>, base: (m: string, p?: unknown) => Promise<unknown>) => unknown | Promise<unknown>): Override {
  return (client) => {
    const base = client.request.bind(client) as (m: string, p?: unknown) => Promise<unknown>;
    client.request = (async (m: string, params?: unknown) => (m === method ? reply((params ?? {}) as Record<string, unknown>, base) : base(m, params))) as EngineClient['request'];
  };
}
const refuse = (method: string, code: string, message: string) => answer(method, () => { throw new EngineError(code, message); });
const both = (...overrides: Override[]): Override => (client) => { for (const override of overrides) override(client); };

const tabs = () => screen.getByRole('navigation', { name: 'Clients views' });
const searchBox = () => screen.getByRole('searchbox', { name: 'Who are you looking for?' });
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method) as [string, unknown][];

async function search(text: string) {
  fireEvent.change(searchBox(), { target: { value: text } });
  await click(screen.getByRole('button', { name: 'Search' }));
  await settle();
}
const result = (name: string) => screen.getByRole('heading', { level: 3, name }).closest('article') as HTMLElement;

describe('Clients: three tabs (founder decision: Clients, Pipeline, Network)', () => {
  it('the tabs are Clients, Pipeline and Network, each a link with its count', async () => {
    await start('#/clients');
    await screen.findByRole('list', { name: 'Clients' });
    const links = within(tabs()).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#/clients', '#/clients/pipeline', '#/clients/network']);
    const network = within(tabs()).getByRole('link', { name: /^Network/ });
    await waitFor(() => expect(network.querySelector('[data-count]')?.textContent).toBe('9'));
    expect(network.getAttribute('aria-current')).toBeNull();
  });

  it('the count asks the engine for the number alone, never 500 summaries', async () => {
    const { spy } = await start('#/clients');
    await screen.findByRole('list', { name: 'Clients' });
    await waitFor(() => expect(calls(spy, 'venture.network.people').some(([, params]) => (params as { limit?: number }).limit === 0)).toBe(true));
    expect(calls(spy, 'venture.network.people').every(([, params]) => (params as { limit?: number }).limit !== undefined)).toBe(true);
  });

  it('#/clients/network is the Network tab, with its line and Import a file', async () => {
    await start();
    await screen.findByRole('searchbox', { name: 'Who are you looking for?' });
    expect(within(tabs()).getByRole('link', { name: /^Network/ }).getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(screen.getByText(/people from your own files, each counted once\. Only you can search them\./)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Import a file' })).toBeTruthy();
    assertInkRules();
  });
});

describe('Network: the search box', () => {
  it('offers starters that fill the box and never send, and the web choice with its line', async () => {
    const { spy } = await start();
    await screen.findByRole('searchbox', { name: 'Who are you looking for?' });
    for (const label of ['Clients quiet for 6 months', 'An intro to Zomato', 'Paste a client brief']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    await click(screen.getByRole('button', { name: 'An intro to Zomato' }));
    expect((searchBox() as HTMLInputElement).value).toBe('An intro to Zomato');
    expect(calls(spy, 'venture.network.search')).toHaveLength(0);
  });

  it('with no web search set up here, a line stands in place of the web choice', async () => {
    await start();
    await screen.findByRole('searchbox');
    await waitFor(() => expect(screen.getByText('Web search is not set up here, so a search covers only your network.')).toBeTruthy());
    expect(screen.queryByRole('checkbox', { name: 'Also look outside my network' })).toBeNull();
  });

  it('in Hindi the starters are the Hindi set', async () => {
    await start('#/clients/network', { language: 'hi' });
    await screen.findByRole('searchbox');
    expect(screen.getByRole('button', { name: '6 महीने से चुप क्लाइंट' })).toBeTruthy();
  });

  it('a search shows the engine\'s summary, the traits looked for, and each result with how you know them', async () => {
    const { spy } = await start();
    await screen.findByRole('searchbox');
    await search('founders in Pune');
    expect(calls(spy, 'venture.network.search').at(-1)![1]).toEqual({ text: 'founders in Pune', web: false });
    expect(screen.getByRole('heading', { level: 2, name: '6 people fit' })).toBeTruthy();
    expect(screen.getByText('Asked your AI 2 times · 0 you know well · fit first, then path')).toBeTruthy();
    const looked = screen.getByRole('list', { name: 'Looked for' });
    expect(within(looked).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['1Founder or owner', '2Based in Pune']);
    const dev = result('Dev Malhotra');
    expect(within(dev).getByText('1st')).toBeTruthy();
    expect(within(dev).getByText('Founder at Saffron Leaf Organics')).toBeTruthy();
    // The receipt chip sits beside the dots; the dots open the same tie receipt.
    const chip = within(dev).getByRole('button', { name: /receipt/i });
    expect(chip.getAttribute('data-receipt')).toBe('tie_person_dev');
    await click(within(dev).getByRole('button', { name: /cold, 1 of 5/i }));
    expect(decodeURIComponent(window.location.hash)).toContain('sheet=receipt:tie_person_dev');
    // Open in LinkedIn is an outlined button with its icon, to the address the file holds.
    const linkedin = within(dev).getByRole('link', { name: 'Open in LinkedIn' });
    expect(linkedin.getAttribute('href')).toBe('https://www.linkedin.com/in/dev-malhotra-saffron');
    expect(linkedin.getAttribute('data-variant')).toBe('secondary');
    expect(linkedin.querySelector('svg')).toBeTruthy();
    // The quoted facts are the owner's own file words.
    const quotes = [...dev.querySelectorAll('[data-why] [data-content]')].map((node) => node.textContent);
    expect(quotes).toEqual(['"Founder"', '"Pune"']);
    // The checks wait behind a disclosure, each in words.
    const checks = within(dev).getByText('What was checked').closest('details') as HTMLDetailsElement;
    expect(checks.open).toBe(false);
    expect(within(checks).getByText(/Founder or owner: Yes/)).toBeTruthy();
    expect(dev.querySelector('[data-path]')).toBeTruthy();
    assertInkRules();
  });

  it('a result\'s checks say partly and not supported in words', async () => {
    await start('#/clients/network', {
      override: answer('venture.network.search', async (params, base) => {
        const view = (await base('venture.network.search', params)) as NetworkSearchView;
        const first = view.results[0]!;
        return { ...view, results: [{ ...first, checks: [{ ...first.checks[0]!, check: 'partly' }, { trait: 'Sells online', check: 'not-supported', quote: null, source: null }] }] };
      }),
    });
    await screen.findByRole('searchbox');
    await search('founders in Pune');
    expect(screen.getByText(/Founder or owner: Partly/)).toBeTruthy();
    expect(screen.getByText(/Sells online: Not supported/)).toBeTruthy();
  });

  it('a warm path Chausar cannot confirm says so in words on the line', async () => {
    await start('#/clients/network', {
      override: answer('venture.network.search', async (params, base) => {
        const view = (await base('venture.network.search', params)) as NetworkSearchView;
        const first = view.results[0]!;
        return { ...view, results: [{ ...first, path: { kind: 'same-company', via: { id: 'person_arjun', name: 'Arjun Kulkarni' }, confirmed: false, strength: 'cold', line: 'Possible path, not confirmed: Arjun Kulkarni also works there.' } }] };
      }),
    });
    await screen.findByRole('searchbox');
    await search('founders in Pune');
    const card = result('Dev Malhotra');
    expect(within(card).getByText('possible path, not confirmed')).toBeTruthy();
    expect(within(card).getByText('Possible path, not confirmed: Arjun Kulkarni also works there.')).toBeTruthy();
  });

  it('Add to pipeline sends the search as the trigger, then the card says it is in the pipeline at Found', async () => {
    const { spy } = await start();
    await screen.findByRole('searchbox');
    await search('founders in Pune');
    await click(within(result('Dev Malhotra')).getByRole('button', { name: 'Add to pipeline' }));
    await settle();
    expect(calls(spy, 'venture.pipeline.add').at(-1)![1]).toEqual({ personId: 'person_dev', trigger: { kind: 'search', ref: expect.stringMatching(/^netsearch_/) } });
    expect(within(result('Dev Malhotra')).getByText('In pipeline, Found')).toBeTruthy();
  });

  it('where a web search is set up, the web choice shows with its line, and a search asks it', async () => {
    const { spy } = await start('#/clients/network', {
      override: answer('venture.network.sources', async (params, base) => ({ ...((await base('venture.network.sources', params)) as object), webSearch: 'set-up' })),
    });
    await screen.findByRole('searchbox');
    const web = await screen.findByRole('checkbox', { name: 'Also look outside my network' });
    expect(screen.getByText('Web results start cold and need a source page')).toBeTruthy();
    fireEvent.click(web);
    await search('founders in Pune');
    expect(calls(spy, 'venture.network.search').at(-1)![1]).toEqual({ text: 'founders in Pune', web: true });
  });

  it('a protected trait is refused before any search, in the UI\'s words', async () => {
    await start();
    await screen.findByRole('searchbox');
    await search('founders by religion');
    // A quiet note, not a red alert: the owner did nothing wrong, the search is simply not made.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('status').some((node) => (node.textContent ?? '').includes('Chausar does not search people by religion, caste, health, age, gender, sexual orientation or family role.'))).toBe(true);
    expect(screen.queryByRole('heading', { level: 2, name: /fit/ })).toBeNull();
  });

  it('with no AI connected it says so and links to Your AI', async () => {
    await start('#/clients/network', { override: refuse('venture.network.search', 'NO_MODEL_CONNECTED', 'Searching in plain words needs your AI.') });
    await screen.findByRole('searchbox');
    await search('founders in Pune');
    expect(screen.getByRole('link', { name: 'Connect your AI' }).getAttribute('href')).toBe('#/connections/ai');
  });

  it('a search refused for consent shows the consent text the people view carries, and Agree sends that same digest', async () => {
    let agreed = false;
    let version = 0;
    const TEXT = 'Chats send your question as you typed it to Claude Sonnet 5.5 with your key.';
    const { spy } = await start('#/clients/network', {
      override: both(
        answer('venture.network.search', (params, base) => {
          if (!agreed) throw new EngineError('CHAT_CONSENT_STALE', `Your AI connection changed since you agreed, so chats wait until you agree again. ${TEXT}`);
          return base('venture.network.search', params);
        }),
        // Each read of the people view after the first would carry a newer digest: Agree must send the one the owner read.
        answer('venture.network.people', async (params, base) => {
          const view = (await base('venture.network.people', params)) as object;
          version += 1;
          return { ...view, consent: agreed ? null : { state: 'stale', text: TEXT, digest: String(version % 10).repeat(64), at: null } };
        }),
        answer('venture.chats.consent', () => { agreed = true; return { state: 'given', text: TEXT, digest: 'x', at: '2026-10-23T10:00:00.000Z' }; }),
      ),
    });
    await screen.findByRole('searchbox');
    await search('founders in Pune');
    const read = calls(spy, 'venture.network.people').length;
    const shown = String(version % 10).repeat(64);
    expect(screen.getByText(TEXT)).toBeTruthy();
    expect(screen.queryByText(/Your AI connection changed/)).toBeNull();
    await click(screen.getByRole('button', { name: 'Agree and search' }));
    await settle();
    expect(calls(spy, 'venture.chats.consent').at(-1)![1]).toEqual({ digest: shown });
    expect(calls(spy, 'venture.network.people').length, 'no second read at the click').toBe(read);
    expect(calls(spy, 'venture.agents.thread.list')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2, name: '6 people fit' })).toBeTruthy();
  });

  it('Forget from a result drops them from the results, and the counts and sources read again', async () => {
    const { spy } = await start();
    await screen.findByRole('searchbox');
    await search('founders in Pune');
    await click(within(result('Dev Malhotra')).getByRole('button', { name: 'How you know Dev Malhotra' }));
    await screen.findByRole('heading', { level: 2, name: 'Dev Malhotra' });
    const sourcesBefore = calls(spy, 'venture.network.sources').length;
    await click(screen.getByRole('button', { name: 'Forget' }));
    await click(screen.getByRole('button', { name: 'Forget Dev Malhotra' }));
    await settle();
    expect(screen.queryByRole('heading', { level: 3, name: 'Dev Malhotra' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Forgotten' })).toBeTruthy();
    await waitFor(() => expect(within(tabs()).getByRole('link', { name: /^Network/ }).querySelector('[data-count]')?.textContent).toBe('8'));
    expect(calls(spy, 'venture.network.sources').length).toBeGreaterThan(sourcesBefore);
  });

  it('opens on the search; Browse everyone is one step away, a page at a time, with a filter that waits for the typing to stop', async () => {
    const { spy } = await start();
    await screen.findByRole('searchbox');
    expect(screen.queryByRole('heading', { level: 2, name: 'Everyone' })).toBeNull();
    await click(await screen.findByRole('button', { name: 'Browse everyone (9)' }, { timeout: 3000 }));
    const tile = (await screen.findByRole('heading', { level: 2, name: 'Everyone' })).closest('section') as HTMLElement;
    await waitFor(() => expect(within(tile).getAllByRole('listitem').length).toBe(8), { timeout: 3000 });
    await click(within(tile).getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(within(tile).getAllByRole('listitem').length).toBe(9), { timeout: 3000 });
    const before = calls(spy, 'venture.network.people').length;
    const filter = within(tile).getByRole('textbox', { name: 'Find by name or company' });
    fireEvent.change(filter, { target: { value: 'k' } });
    fireEvent.change(filter, { target: { value: 'ke' } });
    fireEvent.change(filter, { target: { value: 'kettle' } });
    expect(calls(spy, 'venture.network.people').length, 'nothing asked while typing').toBe(before);
    await waitFor(() => expect(within(tile).getAllByRole('listitem').map((row) => row.querySelector('[data-open]')?.textContent)).toEqual(['Kabir Sethi', 'Tara Iyer']), { timeout: 3000 });
    expect(calls(spy, 'venture.network.people').filter(([, params]) => (params as { query?: string }).query === 'kettle')).toHaveLength(1);
    expect(calls(spy, 'venture.network.people').filter(([, params]) => ['k', 'ke'].includes((params as { query?: string }).query ?? ''))).toHaveLength(0);
  });

  it('Find more asks for the next people, leaving out those shown', async () => {
    const { spy } = await start('#/clients/network', {
      override: answer('venture.network.search', async (params, base) => ({ ...((await base('venture.network.search', params)) as NetworkSearchView), more: true })),
    });
    await screen.findByRole('searchbox');
    await search('founders in Pune');
    await click(screen.getByRole('button', { name: 'Find more' }));
    await settle();
    expect(calls(spy, 'venture.network.searchMore')).toHaveLength(1);
  });

  it('Save search keeps it by a name', async () => {
    const { spy } = await start();
    await screen.findByRole('searchbox');
    await search('founders in Pune');
    await click(screen.getByRole('button', { name: 'Save search' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name this search' }), { target: { value: 'Pune founders' } });
    await click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    expect(calls(spy, 'venture.network.saveSearch').at(-1)![1]).toMatchObject({ name: 'Pune founders' });
    expect(screen.getByText('Saved as Pune founders. Chausar checks it again after each import.')).toBeTruthy();
  });
});

describe('Network: never-contact list lost (NOTES item 44): the part 4E4 wires where drafts are refused', () => {
  it('says so plainly, and Start a new list asks for the business name, then shows the engine\'s line', async () => {
    const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
    answer('workspace.custody.neverContactReset', () => ({ line: 'Chausar started a new never-contact list on this computer.' }))(client);
    const spy = vi.spyOn(client, 'request');
    render(<EngineProvider client={client}><TextProvider language="en"><NeverContactLost /></TextProvider></EngineProvider>);
    expect(screen.getByText('Chausar can no longer check the never-contact list on this computer, so it drafts nothing.')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Start a new list' }));
    expect(screen.getByText(/Each business adds its own blocklist again when you next open it\./)).toBeTruthy();
    const field = await screen.findByRole('textbox', { name: 'Type Lumen Studio to start a new list' });
    const go = screen.getByRole('button', { name: 'Start the new list' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'Lumen Studio' } });
    await click(go);
    await settle();
    expect(calls(spy, 'workspace.custody.neverContactReset').at(-1)![1]).toEqual({ confirmation: 'Lumen Studio' });
    expect(screen.getByText('Chausar started a new never-contact list on this computer.')).toBeTruthy();
  });
});

describe('Network: the side tiles', () => {
  it('Where your network comes from: each file with its line, kept and left out, the old-file line, and Import a newer file', async () => {
    await start();
    const tile = (await screen.findByRole('heading', { level: 2, name: 'Where your network comes from' })).closest('section') as HTMLElement;
    await waitFor(() => expect(within(tile).getByText('4 people, imported 10 Aug 2026.')).toBeTruthy());
    expect(within(tile).getByText('Imported 2 months ago. Export a new copy to catch new contacts.')).toBeTruthy();
    expect(within(tile).getByText('contacts.vcf')).toBeTruthy();
    expect(within(tile).getAllByText(/left out/).length).toBeGreaterThan(0);
    await click(within(tile).getAllByRole('button', { name: /^Import a newer file/ })[0]!);
    expect(window.location.hash).toContain('sheet=network-import');
  });

  it('How well you know them: the five bands with their counts and the count receipt', async () => {
    await start();
    const tile = (await screen.findByRole('heading', { level: 2, name: 'How well you know them' })).closest('section') as HTMLElement;
    await waitFor(() => expect(tile.querySelectorAll('[data-chart] [data-key]').length).toBe(5));
    // Each bar is the engine's own share per mille; the browser never divides.
    expect([...tile.querySelectorAll<HTMLMeterElement>('[data-chart] meter')].map((bar) => bar.value)).toEqual([111, 111, 222, 222, 333]);
    expect(within(tile).getByText('View chart data')).toBeTruthy();
    expect(within(tile).getByRole('button', { name: /receipt/i })).toBeTruthy();
  });

  it('Private to you, with What Chausar keeps behind a disclosure', async () => {
    await start();
    const tile = (await screen.findByRole('heading', { level: 2, name: 'Private to you' })).closest('section') as HTMLElement;
    const keeps = within(tile).getByText('What Chausar keeps').closest('details') as HTMLDetailsElement;
    expect(keeps.open).toBe(false);
    expect(within(keeps).getByText(/Left out: message text, mail bodies/)).toBeTruthy();
  });

  it('a business with no network yet says so, with Import a file as its one way forward', async () => {
    await start('#/clients/network', { prepare: (client) => client.request('workspace.open', { folder: 'ledgerline' }).then(() => undefined) });
    expect(await screen.findByText('Your network is empty.')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Import a file' }).length).toBeGreaterThan(0);
  });
});

describe('Network: the import sheet', () => {
  const FILE = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On', 'Riya,Shetty,https://www.linkedin.com/in/riya-shetty,,Fern Audio,Founder,12 Oct 2026'].join('\n');
  const pick = (text: string, name = 'Connections.csv') => {
    const input = screen.getByLabelText('Choose the file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([text], name, { type: 'text/csv' })] } });
  };

  it('choose the kind, pick the file, Check shows what it keeps and leaves out, Import, then Undo asks once more', async () => {
    const { spy } = await start('#/clients/network?sheet=network-import:new');
    await screen.findByRole('heading', { name: 'Import a file' });
    fireEvent.click(screen.getByRole('radio', { name: /LinkedIn connections/ }));
    pick(FILE);
    await waitFor(() => expect(calls(spy, 'venture.network.import').length).toBe(1));
    await settle();
    expect(calls(spy, 'venture.network.import')[0]![1]).toMatchObject({ kind: 'linkedin-connections', name: 'Connections.csv', check: true });
    expect(screen.getByText(/Chausar would keep 1 person from Connections\.csv/)).toBeTruthy();
    expect(screen.getByText('Riya Shetty')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Import' }));
    await settle();
    expect(calls(spy, 'venture.network.import').at(-1)![1]).toEqual({ kind: 'linkedin-connections', name: 'Connections.csv', text: FILE });
    expect(screen.getByText(/Imported 1 person from Connections\.csv/)).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Undo this import' }));
    await settle();
    expect(screen.getByText(/Undo would remove 1 person this import brought in/)).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Yes, undo it' }));
    await settle();
    expect(screen.getByText(/Undid Connections\.csv/)).toBeTruthy();
  });

  it('a refusal shows the engine\'s words: the size, or the line it could not read', async () => {
    await start('#/clients/network?sheet=network-import:linkedin-connections', {
      override: refuse('venture.network.import', 'NETWORK_FILE_TOO_LARGE', 'This file is 6.2 MB; Chausar reads at most 4 MB at once. Export a smaller part and import each one.'),
    });
    await screen.findByRole('heading', { name: 'Import a file' });
    expect((screen.getByRole('radio', { name: /LinkedIn connections/ }) as HTMLInputElement).checked).toBe(true);
    pick('x');
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('This file is 6.2 MB; Chausar reads at most 4 MB at once. Export a smaller part and import each one.');
  });

  it('on the web, mail headers wait for the desktop app; on the desktop the file is picked there, with the addresses you send from', async () => {
    await start('#/clients/network?sheet=network-import:mail-headers');
    await screen.findByRole('heading', { name: 'Import a file' });
    expect(screen.getByText('Mail comes in only through the desktop app, which reads your mail export on this computer.')).toBeTruthy();
    expect(screen.queryByLabelText('Choose the file')).toBeNull();
  });

  it('on the desktop, Choose the file asks the desktop to read it on this computer', async () => {
    const picked = vi.fn(async () => ({ kind: 'mail-headers', name: 'takeout.mbox', text: '{"format":1}', rows: 3, people: 2, dropped: [], line: 'Read.' }));
    const { spy } = await start('#/clients/network?sheet=network-import:mail-headers', { client: (fake) => ({ ...fake, transport: 'desktop', pickNetworkFile: picked }) });
    await screen.findByRole('heading', { name: 'Import a file' });
    fireEvent.change(screen.getByRole('textbox', { name: 'The addresses you send from' }), { target: { value: 'me@lumen.example, studio@lumen.example' } });
    await click(screen.getByRole('button', { name: 'Choose the file' }));
    await settle();
    expect(picked).toHaveBeenCalledWith('mail-headers', { ownerAddresses: ['me@lumen.example', 'studio@lumen.example'] });
    expect(calls(spy, 'venture.network.import')[0]![1]).toEqual({ kind: 'mail-headers', name: 'takeout.mbox', text: '{"format":1}', check: true });
  });

  it('on the hosted app it says to import in the desktop app, and offers no file', async () => {
    await start('#/clients/network?sheet=network-import:new', { client: (fake) => ({ ...fake, transport: 'hosted' }) });
    await screen.findByRole('heading', { name: 'Import a file' });
    expect(screen.getByText('Import your network in the desktop app. It reads the file on your computer.')).toBeTruthy();
    expect(screen.queryByLabelText('Choose the file')).toBeNull();
  });
});
