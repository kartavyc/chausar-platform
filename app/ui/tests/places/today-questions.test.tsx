import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { QuestionCard, QueueRow } from '../../src/engine/types';
import { CATALOGUES, format, type Language } from '../../src/text';
import { readReply, restated } from '../../src/places/today/reply';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * W4 4J22b on Today: an agent's questions as a card in rounds (4J17, catalogue A14). Each question carries the agent's
 * best guess, each answer what it gains and what it costs with the recommended one first; one short line answers the
 * round ("1 yes, 2 no", "ok" for every guess), free words stay open, and the send button restates the answer before
 * it goes. An approval never rides inside the questions: the card has no Approve. The reply is read the way the
 * engine's agents/questions.ts reads it (parseReply, submitLabel); a differential test runs both on the same replies.
 */

type Seed = Omit<QueueRow, 'digest'>;
type Fake = ReturnType<typeof createFakeClient>;
const NOW = '2026-10-21T12:00:00.000Z';

const ROUND: Seed = {
  id: 'q-round', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'question', createdAt: '2026-10-21T09:45:00.000Z',
  title: 'Two questions before I cut episode 15', line: 'Answer in one line.',
  actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'answer', label: 'Answer', primary: true }],
  preview: {
    kind: 'choice', question: { text: 'Two questions before I cut episode 15' }, options: [],
    card: {
      round: 2, lead: 'Two quick ones before I cut.', freeText: true, escape: 'None of these: I will write my own answer.', example: '1 A, 2 ok',
      items: [
        {
          number: 1, text: 'Keep the long intro?', guess: 'Cut it short', options: [
            { label: 'A', text: 'Cut it short', gains: 'Viewers reach the topic sooner', costs: 'Less of the host', recommended: true },
            { label: 'B', text: 'Keep it whole', gains: 'The host as recorded', costs: 'A slower start', recommended: false },
          ],
        },
        { number: 2, text: 'Add chapters?', guess: 'Yes', options: [] },
      ],
    },
  },
};

function start({ queue = [ROUND], language = 'en' }: { queue?: Seed[]; language?: Language } = {}) {
  window.location.hash = '#/today';
  const client = createFakeClient(new FakeEngine({ now: () => NOW, queue }));
  const request = client.request.bind(client);
  const spy = vi.fn(async (method: string, params?: unknown) => request(method as never, params as never));
  client.request = spy as unknown as Fake['request'];
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language={language} /></ClockProvider>);
  return { spy };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); await settle(); };
const type = async (element: HTMLElement, value: string) => { await act(async () => { fireEvent.change(element, { target: { value } }); }); };
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);
const card = async () => (await screen.findByRole('heading', { level: 3, name: 'Two questions before I cut episode 15' })).closest('article') as HTMLElement;

afterEach(() => { window.location.hash = ''; });

describe('Today: question cards in rounds (W4 4J22b, from 4J17)', () => {
  it('shows the round, each question with its best guess, each answer with what it gains and costs, the recommended first, and no Approve', async () => {
    start();
    const article = await card();
    const question = article.querySelector<HTMLElement>('[data-question-card]')!;
    expect(question.textContent).toContain('Round 2');
    expect(question.textContent).toContain('Two quick ones before I cut.');
    expect(question.textContent).toContain('Best guess: Cut it short');
    expect(question.textContent).toContain('Best guess: Yes');
    const first = question.querySelectorAll('li li')[0]!;
    expect(first.hasAttribute('data-recommended')).toBe(true);
    expect(first.textContent).toContain('Gains: Viewers reach the topic sooner');
    expect(first.textContent).toContain('Costs: Less of the host');
    // An approval never rides inside the questions: the card offers Answer and Later, nothing that approves.
    expect(within(article).queryByRole('button', { name: /approve/i })).toBeNull();
    expect(question.textContent).toContain('Or write your own answer, for example: 1 A, 2 ok');
    expect(question.textContent).toContain('None of these: I will write my own answer.');
    assertInkRules(document.body);
  });

  it('takes "1 yes, 2 no" in one line, and the send button says the answer back before it goes', async () => {
    const { spy } = start();
    const article = await card();
    await press(within(article).getByRole('button', { name: 'Answer' }));
    const box = within(article).getByRole('textbox', { name: 'Your answer' });
    await type(box, '1 yes, 2 no');
    const send = within(article).getByRole('button', { name: 'Send: 1 yes, 2 no' });
    await press(send);
    expect(calls(spy, 'venture.queue.decide')).toEqual([expect.objectContaining({ id: 'q-round', action: 'answer', answer: '1 yes, 2 no' })]);
  });

  it('restates a letter as its answer, "ok" as every best guess, and free words as the owner\'s own answer', async () => {
    start();
    const article = await card();
    await press(within(article).getByRole('button', { name: 'Answer' }));
    const box = within(article).getByRole('textbox', { name: 'Your answer' });
    await type(box, '1 B, 2 ok');
    expect(within(article).getByRole('button', { name: 'Send: 1 Keep it whole, 2 Yes' })).toBeTruthy();
    await type(box, 'ok');
    expect(within(article).getByRole('button', { name: 'Send: 1 Cut it short, 2 Yes' })).toBeTruthy();
    await type(box, 'Ask me after lunch');
    expect(within(article).getByRole('button', { name: 'Send your answer' })).toBeTruthy();
    await type(box, '1 a, 2 no; and call me');
    expect(within(article).getByRole('button', { name: 'Send: 1 Cut it short, 2 no, and your note' })).toBeTruthy();
  });

  it('Use on an answer fills the box with its short form, which the button reads back; nothing is sent', async () => {
    const { spy } = start();
    const article = await card();
    await press(within(article).getByRole('button', { name: 'Use 1 B' }));
    expect((within(article).getByRole('textbox', { name: 'Your answer' }) as HTMLInputElement).value).toBe('1 B');
    expect(within(article).getByRole('button', { name: 'Send: 1 Keep it whole' })).toBeTruthy();
    expect(calls(spy, 'venture.queue.decide')).toEqual([]);
  });

  it('says the answer back in Hindi too', async () => {
    start({ language: 'hi' });
    const article = (await screen.findByRole('heading', { level: 3, name: 'Two questions before I cut episode 15' })).closest('article') as HTMLElement;
    // 4Z2: the engine's "Answer" is worded in Hindi on a Hindi screen.
    await press(within(article).getByRole('button', { name: 'जवाब दें' }));
    await type(within(article).getByRole('textbox', { name: 'आपका जवाब' }), '1 yes, 2 no');
    expect(within(article).getByRole('button', { name: 'भेजें: 1 yes, 2 no' })).toBeTruthy();
  });

  it('a question with no card keeps the plain Send answer', async () => {
    const plain: Seed = { ...ROUND, id: 'q-plain', preview: undefined, title: 'Two questions before I cut episode 15' };
    start({ queue: [plain] });
    const article = await card();
    await press(within(article).getByRole('button', { name: 'Answer' }));
    await type(within(article).getByRole('textbox', { name: 'Your answer' }), '1 yes, 2 no');
    expect(within(article).getByRole('button', { name: 'Send answer' })).toBeTruthy();
  });
});

/**
 * The engine's own reader, loaded from platform/ at run time and run beside the screen's on the same replies (a
 * differential test, not a copy). Loaded by address, not by a static import, so the UI's typecheck does not take in the
 * whole engine (the UI's stricter settings refuse engine files); the two functions are typed here as the engine has them.
 */
type EngineReader = {
  parseReply: (card: QuestionCard, reply: string) => { answers: { number: number; answer: string; by: string }[]; free: string | null };
  submitLabel: (card: QuestionCard, reply: string) => string;
};
const QUESTIONS_TS = pathToFileURL(join(import.meta.dirname, '../../../../platform/runtime/venture/agents/questions.ts')).href;

describe('the reply reader, run beside the engine\'s own (agents/questions.ts parseReply and submitLabel)', () => {
  let parseReply: EngineReader['parseReply'];
  let submitLabel: EngineReader['submitLabel'];
  beforeAll(async () => {
    ({ parseReply, submitLabel } = (await import(/* @vite-ignore */ QUESTIONS_TS)) as EngineReader);
  });
  const round = (ROUND.preview as Extract<QueueRow['preview'], { kind: 'choice' }>).card!;
  const single: QuestionCard = { ...round, items: [round.items[0]!], lead: '', example: '1 A' };
  const dash = String.fromCharCode(0x2014);
  /** Commas, semicolons, new lines, one question, trailing stops, Hindi words and digits, long answers, free words. */
  const REPLIES = [
    '1 yes, 2 no', '1 B; 2 ok', '1 a\n2 no', '1. B, 2) no', '2 no, 1 B', '1 B 1 A', '1a 2b', '1 B, 2 no, and call me', '1 a, 2 no; call me',
    'ok', 'OK.', 'all good', 'sab theek', 'सब ठीक है', '1 ठीक, 2 B', '1 B.', '1 b!', '3 maybe', 'Ask me later', '', '   ',
    '१ हाँ, २ नहीं', `1 ${'a long answer that runs well past forty characters in all'}, 2 no`, `1 ${dash} B`, `1 B ${dash} 2 no`,
    'B', 'b.', 'fine', 'whatever you think', '1 A',
  ];
  /** The screen's send words for a reply, in English, as the card's button says them. */
  const screenWords = (card: QuestionCard, reply: string) => {
    const read = readReply(card, reply);
    return read.answers.length
      ? format(CATALOGUES.en, 'en', read.free ? 'today.questions.sendNote' : 'today.questions.send', { answers: restated(read) })
      : format(CATALOGUES.en, 'en', 'today.questions.sendOwn');
  };

  for (const [name, card] of [['a round of two', round], ['one question', single]] as const) {
    it(`gives the engine's answers and the engine's send words for every reply, on ${name}`, () => {
      for (const reply of REPLIES) {
        const engine = parseReply(card, reply);
        expect(readReply(card, reply), JSON.stringify(reply)).toEqual({ answers: engine.answers.map(({ number, answer }) => ({ number, answer })), free: engine.free });
        expect(screenWords(card, reply), JSON.stringify(reply)).toBe(submitLabel(card, reply));
      }
    });
  }
});
