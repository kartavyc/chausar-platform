import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ConsentWords } from '../../src/parts/ConsentWords';
import { CATALOGUES } from '../../src/text';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One-shot B1 (SCREENS P5, hands-on rows 5 and S3): one consent card. One line the owner reads at a glance, and the
 * engine's exact consent (the words whose digest they agree to) whole, behind a closed "What's sent" fold. Chats, agent
 * chat and the network search all use it, so the 95-word paragraph is never the card itself.
 */
const FULL = 'Chats send your message and what Chausar reads to answer it (run steps, file names) to Claude Sonnet 5.5 with your key. Keys, passphrases and bank or card numbers are never sent.';

describe('ConsentWords (B1)', () => {
  it('says the one line, and keeps the exact consent whole behind a closed fold', () => {
    render(<ConsentWords line={CATALOGUES.en['consent.chatLine'] as string} text={FULL} />);
    expect(screen.getByText('Chats go to your AI to answer. Keys, passphrases and bank or card numbers never do.')).toBeTruthy();
    const fold = screen.getByText("What's sent").closest('details')!;
    expect(fold.open).toBe(false);
    expect(within(fold).getByText(FULL)).toBeTruthy();
  });

  it('the three chat consents use it, never the bare paragraph', () => {
    const src = join(import.meta.dirname, '../../src');
    for (const file of ['places/chats/ChiefThread.tsx', 'places/team/ChatConsent.tsx', 'places/clients/NetworkTab.tsx']) {
      const text = readFileSync(join(src, file), 'utf8');
      expect(text, file).toContain('<ConsentWords');
      expect(text, file).not.toMatch(/className=\{[a-z]+\.consentText\}/);
    }
  });
});
