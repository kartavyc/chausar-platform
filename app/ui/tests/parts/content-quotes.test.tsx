import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PreviewFrame } from '../../src/parts/PreviewFrame';
import { ChatThread } from '../../src/parts/ChatThread';
import { DiffCard } from '../../src/parts/DiffCard';
import { Provenance } from '../../src/parts/Provenance';
import { ApprovalRow } from '../../src/parts/ApprovalRow';
import type { QueueRow } from '../../src/engine/types';
import { assertFiguresProved } from '../helpers/ink-rules';

/**
 * Quoted words are not figures Chausar states: each part that shows someone's own words (a draft, a post, a title
 * option, a message, an instruction line, a quoted client) marks that text `data-content`, so an amount inside the
 * words passes the money rule (tests/helpers/ink-rules.ts) while Chausar's own lines around it are still checked.
 */
const QUOTE = 'The ₹2,000 mic that beat my ₹20,000 one';

describe('parts mark the quoted words they show as [data-content]', () => {
  // The text variant is not marked: its lines can be Chausar's own figures (a GST working's tax), so the caller
  // proves them with a receipt or "model estimate" (tests/parts/feed.test.tsx holds that).
  it('PreviewFrame: a video title, the options of a choice and a post', () => {
    render(
      <>
        <PreviewFrame variant="video" title={QUOTE} onOpen={() => {}} />
        <PreviewFrame variant="choice" label="Title for episode 15" options={[{ id: 'a', label: 'I tried every budget mic' }, { id: 'b', label: QUOTE }]} />
        <PreviewFrame variant="post" account="Lumen Studio" platform="LinkedIn" text="Classes at ₹499 this month" />
      </>,
    );
    expect(() => assertFiguresProved()).not.toThrow();
  });

  it('ChatThread: the owner\'s message and the agent\'s reply', () => {
    render(
      <ChatThread
        agent={{ name: 'Editor' }}
        now={new Date('2026-10-23T19:05:00+05:30')}
        entries={[
          { kind: 'owner', id: 'm1', at: '2026-10-23T18:00:00+05:30', text: 'Keep the ₹499 offer in the caption' },
          { kind: 'agent', id: 'm2', at: '2026-10-23T18:01:00+05:30', text: 'Done: the caption says "Classes at ₹499".' },
        ]}
      />,
    );
    expect(() => assertFiguresProved()).not.toThrow();
  });

  it('DiffCard: the instruction lines, unchanged, added and removed', () => {
    render(
      <DiffCard
        agent="Producer"
        appliesTo="Applies to every quote from now on"
        lines={[{ kind: 'same', text: 'Quote the monthly plan first.' }, { kind: 'removed', text: 'Never go below ₹10,000.' }, { kind: 'added', text: 'Never go below ₹12,000.' }]}
        fromVersion={4}
        toVersion={5}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onUndo={vi.fn(async () => {})}
      />,
    );
    expect(() => assertFiguresProved()).not.toThrow();
  });

  it('Provenance: quoted words', () => {
    render(<p>The client wrote <Provenance quoted source="Mail from Iyer & Co">We can pay ₹12,000 a month</Provenance></p>);
    expect(() => assertFiguresProved()).not.toThrow();
  });

  describe('ApprovalRow: a question\'s line is the agent\'s own words; every other line is Chausar\'s and stays checked', () => {
    const question: QueueRow = {
      id: 'q-question', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Researcher', kind: 'question', digest: 'd1',
      createdAt: '2026-10-21T09:45:00.000Z', title: 'Which title for episode 15?', line: `A: "I tried every budget mic". B: "${QUOTE}".`,
      actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'answer', label: 'Answer', primary: true }],
    };
    const draft: QueueRow = { ...question, id: 'q-draft', kind: 'draft', title: 'Episode 15 is cut', line: 'Costs ₹40 to render.' };
    const decide = vi.fn();

    it('in a list row', () => {
      render(<ul><ApprovalRow row={question} onDecide={decide} /></ul>);
      expect(() => assertFiguresProved()).not.toThrow();
    });

    it('in a card', () => {
      render(<ApprovalRow row={question} onDecide={decide} layout="card" />);
      expect(() => assertFiguresProved()).not.toThrow();
    });

    // Coordinator, 23 Oct: a row's line is the engine's own sentence (`data-engine-line`). An amount the engine
    // composed there passes until W4 4J1 moves it into receipted row meta; a place's own words with it still fail.
    it('a draft row\'s line is not a quote but the engine\'s line: its amount passes until W4 4J1, a place\'s own words still fail', () => {
      const { unmount } = render(<><ul><ApprovalRow row={draft} onDecide={decide} /></ul><ApprovalRow row={{ ...draft, id: 'q-draft-card' }} onDecide={decide} layout="card" /></>);
      expect(document.querySelectorAll('[data-engine-line]:not([data-content])')).toHaveLength(2);
      expect(() => assertFiguresProved()).not.toThrow();
      unmount();
      render(<p>Costs ₹40 to render.</p>);
      expect(() => assertFiguresProved()).toThrow(/Costs ₹40 to render/);
    });
  });
});
