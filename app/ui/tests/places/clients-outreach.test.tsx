import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

// Drafts and handoffs on screen (Ink v2 wave 4, package 4E4, from the engine's 4E2): "Write to them" on the card
// sheet, the draft sheet (to and connector, the note, the note a connector can forward, a connection note's counter,
// the footer only on a cold email, the warnings, Send it yourself from Mail, LinkedIn or WhatsApp, I sent it, and the
// line that Chausar never sends), and Draft intro and WhatsApp on a network result. Founder decisions: LinkedIn and
// CRM are find, draft and the owner sends; WhatsApp is a wa.me handoff only; the footer goes on cold outreach only.

type Fake = ReturnType<typeof createFakeClient>;
const FRIDAY = '2026-10-23T10:00:00.000Z';

async function start(hash: string, options: { prepare?: (client: Fake) => Promise<void>; override?: (client: Fake) => void } = {}) {
  window.location.hash = hash;
  const fake = createFakeClient(new FakeEngine({ now: () => FRIDAY }));
  await options.prepare?.(fake);
  options.override?.(fake);
  const spy = vi.spyOn(fake, 'request');
  const view = render(<ClockProvider now={() => new Date(FRIDAY)}><App client={fake} language="en" /></ClockProvider>);
  return { client: fake, spy, ...view };
}

async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method) as [string, unknown][];

function desktopOpen() {
  const open = vi.fn(async (_url: string) => {});
  (window as Window & { chausar?: unknown }).chausar = { openExternal: open };
  return open;
}
function clipboard() {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}
afterEach(() => {
  delete (window as Window & { chausar?: unknown }).chausar;
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

/** Arjun Kulkarni (Know, with an email and a phone in his files) put on the pipeline by the owner. */
const addArjun = async (client: Fake) => { await client.request('venture.pipeline.add', { personId: 'person_arjun', trigger: { kind: 'owner' } }); };

/** Opens a card's sheet, picks what to draft and the channel, and drafts it. */
async function draftOn(cardId: string, name: string, choose: { kind?: string; channel?: string; basis?: string } = {}) {
  const started = await start(`#/clients/pipeline?sheet=card:${cardId}`, { prepare: cardId.startsWith('opp_seed') ? undefined : addArjun });
  const sheet = await screen.findByRole('complementary', { name });
  await click(await waitFor(() => within(sheet).getByRole('button', { name: 'Write a draft' })));
  const kind = within(sheet).getByLabelText('What to draft') as HTMLSelectElement;
  if (choose.kind) fireEvent.change(kind, { target: { value: choose.kind } });
  if (choose.channel) await click(within(within(sheet).getByRole('group', { name: 'Send it from' })).getByRole('button', { name: choose.channel }));
  if (choose.basis) fireEvent.change(within(sheet).getByLabelText('Why you may write to them'), { target: { value: choose.basis } });
  await click(within(sheet).getByRole('button', { name: 'Draft it' }));
  await settle();
  return { ...started, sheet };
}

const draftSheet = () => screen.findByRole('complementary', { name: /^(Intro request|Double opt-in intro|A note|Connection note|Cold email|Reply)$/ });

describe('the draft sheet', () => {
  it('an intro request shows who it goes to, the note, the note they can forward and the line that Chausar never sends; no footer on a warm note', async () => {
    const { spy } = await draftOn('opp_seed_kabir', 'Kabir Sethi');
    expect(calls(spy, 'venture.outreach.draft').at(-1)![1]).toEqual({ opportunityId: 'opp_seed_kabir', kind: 'intro-request', channel: 'email', language: 'en' });
    expect(window.location.hash).toMatch(/sheet=outreach%3Aperson_kabir%3Aoutreach_/);
    const sheet = await draftSheet();
    expect(sheet.textContent).toContain('Tara Iyer, tara@kettleaudio.example');
    expect(sheet.querySelector('[data-note][data-content]')?.textContent).toMatch(/^Hi Tara, I hope you are well\. Would you be open to introducing me to Kabir Sethi/);
    expect(within(sheet).getByText('Note they can forward')).toBeTruthy();
    expect(within(sheet).getByText('5 sentences')).toBeTruthy();
    expect(sheet.querySelector('[data-footer]')).toBeNull();
    expect(sheet.querySelector('[data-never]')?.textContent).toBe('Chausar never sends. It opens your mail app with the text filled in, and counts only the notes you mark as sent.');
    expect(within(within(sheet).getByRole('region', { name: 'Send it yourself from' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mail', 'LinkedIn', 'WhatsApp', 'I sent it', 'I called them instead']);
    assertInkRules(document.body);
  }, 15_000); // The file's first render also loads the app's modules, which takes longer on a busy machine.

  it('Mail opens the owner\'s mail app with the draft (mailto), then I sent it records the send on its own channel', async () => {
    const open = desktopOpen();
    const { spy } = await draftOn('opp_seed_kabir', 'Kabir Sethi');
    const sheet = await draftSheet();
    await click(within(sheet).getByRole('button', { name: 'Mail' }));
    await settle();
    expect(calls(spy, 'venture.outreach.open')).toHaveLength(1);
    expect(open.mock.calls[0]![0]).toMatch(/^mailto:tara@kettleaudio\.example\?subject=An%20introduction%20to%20Kabir%20Sethi%3F&body=/);
    expect(within(sheet).getByText(/counts only the notes you mark as sent/, { selector: '[role="status"]' })).toBeTruthy();
    await click(within(sheet).getByRole('button', { name: 'I sent it' }));
    await settle();
    expect(calls(spy, 'venture.outreach.sent').at(-1)![1]).toEqual({ draftId: expect.stringMatching(/^outreach_/), at: FRIDAY, channel: 'own-mailbox' });
    expect(within(sheet).getByText('Recorded. Next follow-up 30 Oct.')).toBeTruthy();
    expect(within(sheet).getByText('You marked this as sent.')).toBeTruthy();
  });

  it('a connection note counts its characters against the owner\'s limit; LinkedIn copies the note, then opens the profile', async () => {
    const open = desktopOpen();
    const copy = clipboard();
    const { spy } = await draftOn('opp_seed_tara', 'Tara Iyer', { kind: 'connection-note' });
    expect(calls(spy, 'venture.outreach.draft').at(-1)![1]).toEqual({ opportunityId: 'opp_seed_tara', kind: 'connection-note', channel: 'linkedin', language: 'en', limit: 200 });
    const sheet = await draftSheet();
    expect(sheet.textContent).toMatch(/\d+ of 200 characters/);
    expect(sheet.querySelector('[data-rule="note-cap"]')?.textContent).toBe('Free accounts get only a few personal notes a month. LinkedIn has not said how many.');
    expect(within(within(sheet).getByRole('region', { name: 'Send it yourself from' })).queryByRole('button', { name: 'Mail' })).toBeNull();
    await click(within(sheet).getByRole('button', { name: 'LinkedIn' }));
    await settle();
    expect(copy).toHaveBeenCalledWith(expect.stringMatching(/^Hi Tara,/));
    expect(open).toHaveBeenCalledWith('https://www.linkedin.com/in/tara-iyer-kettle');
  });

  it('a cold email asks for its lawful basis, then for the postal address, and carries the footer', async () => {
    const { spy } = await start('#/clients/pipeline?sheet=card:opp_1', { prepare: addArjun });
    const sheet = await screen.findByRole('complementary', { name: 'Arjun Kulkarni' });
    await click(await waitFor(() => within(sheet).getByRole('button', { name: 'Write a draft' })));
    // A note by mail to Arjun, whom the owner knows, is warm: no basis asked.
    expect(within(sheet).queryByLabelText('Why you may write to them')).toBeNull();
    fireEvent.change(within(sheet).getByLabelText('What to draft'), { target: { value: 'cold-email' } });
    const draft = within(sheet).getByRole('button', { name: 'Draft it' }) as HTMLButtonElement;
    // Locked, not disabled: it stays in the Tab order and says why.
    expect([draft.disabled, draft.getAttribute('aria-disabled'), draft.title]).toEqual([false, 'true', 'Choose why you may write to them first.']);
    await click(draft);
    expect(calls(spy, 'venture.outreach.draft')).toHaveLength(0);
    fireEvent.change(within(sheet).getByLabelText('Why you may write to them'), { target: { value: 'public-business-contact' } });
    await click(draft);
    await settle();
    expect(within(sheet).getByRole('alert').textContent).toBe('Add your postal address. Every outreach email carries it.');
    fireEvent.change(within(sheet).getByLabelText('Your postal address'), { target: { value: '12 MG Road, Pune 411001' } });
    await click(within(sheet).getByRole('button', { name: 'Draft it' }));
    await settle();
    expect(calls(spy, 'venture.outreach.draft').at(-1)![1]).toEqual({ opportunityId: 'opp_1', kind: 'cold-email', channel: 'email', language: 'en', basis: 'public-business-contact', postalAddress: '12 MG Road, Pune 411001' });
    const cold = await draftSheet();
    const footer = cold.querySelector('[data-footer]')!;
    expect(footer.textContent).toContain('12 MG Road, Pune 411001');
    expect(footer.textContent).toContain('To stop these emails, reply with the word unsubscribe');
  });

  it('WhatsApp is a wa.me handoff with the text filled in', async () => {
    const open = desktopOpen();
    await draftOn('opp_1', 'Arjun Kulkarni', { channel: 'WhatsApp' });
    const sheet = await draftSheet();
    await click(within(sheet).getByRole('button', { name: 'WhatsApp' }));
    await settle();
    expect(open.mock.calls[0]![0]).toMatch(/^https:\/\/wa\.me\/919820012345\?text=Hi%20Arjun/);
  });

  it('a restricted account pauses the channel after a second ask, and the engine then refuses to open it', async () => {
    desktopOpen();
    clipboard();
    await draftOn('opp_seed_tara', 'Tara Iyer', { kind: 'connection-note' });
    const sheet = await draftSheet();
    await click(within(sheet).getByRole('button', { name: 'LinkedIn restricted my account' }));
    expect(within(sheet).getByText(/Chausar pauses this channel for 3 days/)).toBeTruthy();
    await click(within(sheet).getByRole('button', { name: 'Pause for 3 days' }));
    await settle();
    expect(within(sheet).getByText(/You said LinkedIn restricted your account\. Don't reconnect for 3 days\./)).toBeTruthy();
    await click(within(sheet).getByRole('button', { name: 'LinkedIn' }));
    await settle();
    expect(within(sheet).getAllByText(/You said LinkedIn restricted your account/).length).toBe(2);
  });

  it('a draft refused because the never-contact list is lost offers Start a new list', async () => {
    await start('#/clients/pipeline?sheet=card:opp_seed_kabir', {
      override: (client) => {
        const base = client.request.bind(client) as (m: string, p?: unknown) => Promise<unknown>;
        client.request = (async (m: string, p?: unknown) => {
          if (m === 'venture.outreach.draft') throw new EngineError('NEVER_CONTACT_LOST', 'Chausar can no longer check the never-contact list on this computer, so it drafts nothing.');
          return base(m, p);
        }) as EngineClient['request'];
      },
    });
    const sheet = await screen.findByRole('complementary', { name: 'Kabir Sethi' });
    await click(await waitFor(() => within(sheet).getByRole('button', { name: 'Write a draft' })));
    await click(within(sheet).getByRole('button', { name: 'Draft it' }));
    await settle();
    expect(sheet.querySelector('[data-never-contact-lost]')).not.toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Start a new list' })).toBeTruthy();
  });

  it('a draft opens again after a reload, read from the person sheet; the card sheet opens its waiting draft', async () => {
    await start('#/clients/pipeline?sheet=card:opp_seed_kabir');
    const card = await screen.findByRole('complementary', { name: 'Kabir Sethi' });
    await click(await waitFor(() => within(card).getByRole('button', { name: 'Open the draft' })));
    expect(window.location.hash).toBe('#/clients/pipeline?sheet=outreach%3Aperson_kabir%3Aoutreach_2');
    const sheet = await draftSheet();
    expect(sheet.textContent).toContain('Tara Iyer, tara@kettleaudio.example');
    expect(sheet.querySelector('[data-note][data-content]')?.textContent).toMatch(/^Hi Tara, I hope you are well./);
  });

  it('a draft no person lists offers its handoff only', async () => {
    const open = desktopOpen();
    await start('#/clients/pipeline?sheet=outreach:outreach_1');
    const sheet = await screen.findByRole('complementary', { name: 'Draft' });
    expect(sheet.textContent).toContain("Chausar can't show this draft's words here.");
    await click(within(sheet).getByRole('button', { name: 'Open it' }));
    await settle();
    expect(open.mock.calls[0]![0]).toMatch(/^mailto:tara@kettleaudio\.example/);
    expect(within(sheet).getByRole('button', { name: 'I sent it' })).toBeTruthy();
  });
});

describe('a network result drafts too (4D4 left the buttons to 4E4)', () => {
  it('Draft intro drafts the intro through the confirmed connector; WhatsApp names the connector', async () => {
    const { spy } = await start('#/clients/network');
    const box = await screen.findByRole('searchbox', { name: 'Who are you looking for?' });
    fireEvent.change(box, { target: { value: 'founders in audio' } });
    await click(screen.getByRole('button', { name: 'Search' }));
    await settle();
    const kabir = screen.getByRole('heading', { level: 3, name: 'Kabir Sethi' }).closest('article') as HTMLElement;
    expect(within(kabir).getByRole('button', { name: 'WhatsApp Tara' })).toBeTruthy();
    const draft = within(kabir).getByRole('button', { name: 'Draft intro' });
    expect(draft.dataset.variant).toBe('primary');
    await click(draft);
    await settle();
    expect(calls(spy, 'venture.outreach.draft').at(-1)![1]).toEqual({ opportunityId: 'opp_seed_kabir', kind: 'intro-request', channel: 'email' });
    expect((await draftSheet()).textContent).toContain('Tara Iyer, tara@kettleaudio.example');
  });
});

describe('drafting again on another channel (4E4 re-review)', () => {
  /** Writes a draft from the card sheet with the owner's own words, and returns the draft sheet. */
  async function writeWithWords(sheet: HTMLElement, kind: string, channel: string, about: string) {
    await click(await waitFor(() => within(sheet).getByRole('button', { name: 'Write a draft' })));
    fireEvent.change(within(sheet).getByLabelText('What to draft'), { target: { value: kind } });
    await click(within(within(sheet).getByRole('group', { name: 'Send it from' })).getByRole('button', { name: channel }));
    fireEvent.change(within(sheet).getByLabelText('What it is about'), { target: { value: about } });
    await click(within(sheet).getByRole('button', { name: 'Draft it' }));
    await settle();
    return draftSheet();
  }
  const sendFrom = (sheet: HTMLElement, channel: string) => within(within(sheet).getByRole('region', { name: 'Send it yourself from' })).getByRole('button', { name: channel });

  it("a warm draft again on Mail keeps the owner's words", async () => {
    desktopOpen();
    const { spy } = await start('#/clients/pipeline?sheet=card:opp_seed_tara');
    const drafted = await writeWithWords(await screen.findByRole('complementary', { name: 'Tara Iyer' }), 'follow-up', 'LinkedIn', 'the mic review');
    expect(calls(spy, 'venture.outreach.draft').at(-1)![1]).toMatchObject({ channel: 'linkedin', about: 'the mic review' });
    await click(sendFrom(drafted, 'Mail'));
    await settle();
    expect(calls(spy, 'venture.outreach.draft').at(-1)![1]).toEqual({ opportunityId: 'opp_seed_tara', kind: 'follow-up', channel: 'email', language: 'en', about: 'the mic review' });
  });

  it("a cold draft again on Mail goes back through the draft form, with the owner's words in it", async () => {
    let cardId = '';
    const prepare = async (client: Fake) => {
      const file = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On', 'Rohan,Das,https://www.linkedin.com/in/rohan-das,rohan@chaico.example,Chai Co,Owner,12 Oct 2026'].join('\n');
      await client.request('venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: file });
      const found = await client.request('venture.network.people', { query: 'Rohan' }) as { people: { id: string }[] };
      cardId = (await client.request('venture.pipeline.add', { personId: found.people[0]!.id, trigger: { kind: 'owner' } }) as { card: { id: string } }).card.id;
    };
    const clock = { now: '2026-10-23T10:00:00.000Z' };
    window.location.hash = '#/clients/pipeline';
    const fake = createFakeClient(new FakeEngine({ now: () => clock.now }));
    await prepare(fake);
    window.location.hash = `#/clients/pipeline?sheet=card:${cardId}`;
    const spy = vi.spyOn(fake, 'request');
    render(<ClockProvider now={() => new Date(clock.now)}><App client={fake} language="en" /></ClockProvider>);
    const drafted = await writeWithWords(await screen.findByRole('complementary', { name: 'Rohan Das' }), 'follow-up', 'LinkedIn', 'the festive reel');
    await click(sendFrom(drafted, 'Mail'));
    await settle();
    // Mail to Rohan is cold: nothing is drafted yet; the card sheet's form opens with the kind, the channel and the words.
    expect(calls(spy, 'venture.outreach.draft').filter(([, p]) => (p as { channel: string }).channel === 'email')).toHaveLength(0);
    expect(window.location.hash).toBe(`#/clients/pipeline?sheet=card%3A${cardId}&tab=write-follow-up-email`);
    const card = await screen.findByRole('complementary', { name: 'Rohan Das' });
    expect((within(card).getByLabelText('What to draft') as HTMLSelectElement).value).toBe('follow-up');
    expect(within(within(card).getByRole('group', { name: 'Send it from' })).getByRole('button', { name: 'Mail' }).getAttribute('aria-pressed')).toBe('true');
    expect((within(card).getByLabelText('What it is about') as HTMLInputElement).value).toBe('the festive reel');
    fireEvent.change(within(card).getByLabelText('Why you may write to them'), { target: { value: 'public-business-contact' } });
    await click(within(card).getByRole('button', { name: 'Draft it' }));
    await settle();
    expect(within(card).getByRole('alert').textContent).toBe('Add your postal address. Every outreach email carries it.');
    fireEvent.change(within(card).getByLabelText('Your postal address'), { target: { value: '12 MG Road, Pune 411001' } });
    await click(within(card).getByRole('button', { name: 'Draft it' }));
    await settle();
    expect(calls(spy, 'venture.outreach.draft').at(-1)![1]).toEqual({
      opportunityId: cardId, kind: 'follow-up', channel: 'email', language: 'en', basis: 'public-business-contact', about: 'the festive reel', postalAddress: '12 MG Road, Pune 411001',
    });
  });
});

describe('what the draft form offers (4E4 review)', () => {
  it('a double opt-in introduces someone the owner picks from the network', async () => {
    const { spy } = await start('#/clients/pipeline?sheet=card:opp_seed_tara');
    const sheet = await screen.findByRole('complementary', { name: 'Tara Iyer' });
    await click(await waitFor(() => within(sheet).getByRole('button', { name: 'Write a draft' })));
    fireEvent.change(within(sheet).getByLabelText('What to draft'), { target: { value: 'double-opt-in' } });
    await settle();
    const pick = within(sheet).getByLabelText('Who you introduce') as HTMLSelectElement;
    const draft = within(sheet).getByRole('button', { name: 'Draft it' }) as HTMLButtonElement;
    expect([draft.disabled, draft.getAttribute('aria-disabled'), draft.title]).toEqual([false, 'true', 'Choose who you introduce first.']);
    expect([...pick.options].map((option) => option.value)).not.toContain('person_tara');
    fireEvent.change(pick, { target: { value: 'person_leela' } });
    await click(draft);
    await settle();
    expect(calls(spy, 'venture.outreach.draft').at(-1)![1]).toEqual({ opportunityId: 'opp_seed_tara', kind: 'double-opt-in', channel: 'email', language: 'en', introduce: 'person_leela' });
    expect((await draftSheet()).textContent).toContain("I'd like to introduce you to Leela Menon");
  });

  it('a reply is offered only once the card has a thread, and the basis only when the engine says it is needed', async () => {
    await start('#/clients/pipeline?sheet=card:opp_seed_kabir');
    const kabir = await screen.findByRole('complementary', { name: 'Kabir Sethi' });
    await click(await waitFor(() => within(kabir).getByRole('button', { name: 'Write a draft' })));
    const kinds = () => [...(within(kabir).getByLabelText('What to draft') as HTMLSelectElement).options].map((option) => option.value);
    expect(kinds()).not.toContain('reply');
    expect(kinds()).toContain('double-opt-in');
    // An intro by mail through Tara, whom the owner knows well, is warm: no basis.
    expect(within(kabir).queryByLabelText('Why you may write to them')).toBeNull();
    // A note by mail to Kabir himself (met once) is cold and needs its basis.
    fireEvent.change(within(kabir).getByLabelText('What to draft'), { target: { value: 'follow-up' } });
    expect(within(kabir).getByLabelText('Why you may write to them')).toBeTruthy();
    window.location.hash = '#/clients/pipeline?sheet=card:opp_seed_vikram';
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const vikram = await screen.findByRole('complementary', { name: 'Vikram Bhat' });
    await click(await waitFor(() => within(vikram).getByRole('button', { name: 'Write a draft' })));
    expect([...(within(vikram).getByLabelText('What to draft') as HTMLSelectElement).options].map((option) => option.value)).toContain('reply');
  });
});
