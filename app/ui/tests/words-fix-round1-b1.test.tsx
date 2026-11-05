// B1 fix round 1 (B1-review-1.md spec findings 3 to 8): the words the spec review found still wrong after B1. Word-only
// changes are pinned from the catalogue; the two that change what a screen shows are rendered.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { App } from '../src/shell/App';
import { FakeEngine, createFakeClient } from '../src/engine/fake';
import { CATALOGUES } from '../src/text';
import { KeeperSummary } from '../src/places/team/KeeperCard';

const words = CATALOGUES.en;
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
afterEach(() => cleanup());

describe('spec 3: the cancel buttons, the step owner line and the Keeper with nothing run', () => {
  it('a button that only closes an ask says Cancel', () => {
    for (const key of ['approval.cancel', 'business.cancel', 'connections.ai.cancel', 'team.chat.consent.cancel', 'chats.consent.notNow', 'business.voice.notNow',
      'business.knowledge.notNow', 'team.persona.notNow', 'chats.talk.notNow', 'kit-report.share.close', 'onboarding.ways.notNow', 'apps.allow.notNow']) expect(words[key], key).toBe('Cancel');
  });

  it('a step you do now says so, for now (the word budget holds it to three words)', async () => {
    window.location.hash = '#/business/plan';
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    await settle();
    expect((await screen.findAllByText('You, for now')).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/agent planned/);
  });

  it('with no job run yet the Keeper says so, never that every job went fine', () => {
    const { container, rerender } = render(<KeeperSummary jobs={[]} />);
    expect(container.textContent).toBe('No jobs yet.');
    rerender(<KeeperSummary jobs={[{ id: 'backups', name: 'Backups', lastRun: null, note: null }] as never} />);
    expect(container.textContent).toBe('No jobs yet.');
    rerender(<KeeperSummary jobs={[{ id: 'backups', name: 'Backups', lastRun: { at: '2026-11-05T08:00:00.000Z', outcome: 'ok', line: 'Saved.' }, note: null }] as never} />);
    expect(container.textContent).toBe('Every job that ran went fine.');
  });
});

describe('spec 4: statements that are not true, grammar and jargon', () => {
  it('a second ask never says it cannot be undone', () => {
    expect(words['approval.secondAsk']).toBe('{action}? Check it once more.');
  });

  it('a plan from templates says so without claiming no AI', () => {
    expect(words['business.fromTemplates']).toBe('From ready-made templates.');
  });

  it('a refused order says the refusal on its own', () => {
    expect(words['work.form.failed']).toBe('{message}');
  });

  it('a mail export is named for an owner', () => {
    expect([words['clients.network.kind.mail-headers'], words['connections.network.kind.mail-headers']]).toEqual(['Email export', 'Email export']);
    expect(words['clients.import.kind.mail-headers']).toBe('Email export: who and when, never the text');
    expect(Object.values(words).some((value) => /mail headers/i.test(JSON.stringify(value)))).toBe(false);
  });
});

describe('spec 5 to 8: role line, labels, consent and first run', () => {
  it('Chausar\'s chat answers carry no job title', async () => {
    expect(words['chats.chief.role']).toBeUndefined();
    expect(Object.values(words).some((value) => /chief of staff/i.test(JSON.stringify(value)))).toBe(false);
  });

  it('what a way pays and the SEO pack read plainly', () => {
    expect(words['gallery.pay']).toBe('Usual pay');
    expect(words['gallery.payPer']).toBe('Usual pay ({per})');
    expect(words['playbook-labels.seo-visibility']).toBe('Get found on Google and AI search');
  });

  it('the network search consent says the question goes as typed', () => {
    expect(words['consent.searchLine']).toBe("Your question goes as you typed it; people's names, emails and phone numbers in your contacts and notes are masked.");
  });

  it('first run keeps the price and plan-limits meaning', () => {
    expect(words['first-run.ai.limits']).toBe('Chausar sends your idea, answers and plan to the AI you pick, never your books, keys or client details. It runs on your plan and its limits. Anything that sends, posts, pays or changes a price waits for your tap.');
  });
});

describe('quality 7: no consent card without the words agreed to', () => {
  it('a chat consent with no text shows no empty fold and no Agree, only why and Cancel', async () => {
    const { ChatConsent } = await import('../src/places/team/ChatConsent');
    render(<ChatConsent view={{ state: 'needed', text: null, digest: null, at: null } as never} onAgree={async () => {}} onCancel={() => {}} />);
    expect(document.querySelector('details')).toBeNull();
    expect(screen.queryByRole('button', { name: words['team.chat.consent.accept'] as string })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(words['team.chat.consent.missing']);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});
