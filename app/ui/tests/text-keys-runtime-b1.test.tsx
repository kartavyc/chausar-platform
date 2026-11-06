// B1 fix round 1 (spec finding 2; PLAN batch 12, SCREENS P1): every key a screen builds at run time exists. The static
// scan (text-keys.test.ts) checks t('a.b') and that t(`a.${x}`) has some key under its prefix; this renders the places
// with the fake engine and fails on any key asked for that the catalogue lacks (the business.practice.inUse.owner case).
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { App } from '../src/shell/App';
import { FakeEngine, createFakeClient } from '../src/engine/fake';
import { CATALOGUES, format, onMissingKey } from '../src/text';

const PLACES = [
  '#/today', '#/team', '#/team?dept=ops', '#/work', '#/work?order=o-boat-14', '#/work?state=failed', '#/chats', '#/clients', '#/clients/pipeline', '#/clients/network',
  '#/money', '#/business', '#/business/practice', '#/business/decisions', '#/business/notifications', '#/business/reports', '#/connections',
];

afterEach(() => { onMissingKey(null); cleanup(); });

describe('every key a screen builds at run time exists', () => {
  it('the hook hears a key the catalogue lacks', () => {
    const missing: string[] = [];
    onMissingKey((key) => missing.push(key));
    expect(format(CATALOGUES.en, 'en', 'business.practice.inUse.nobody')).toBe('business.practice.inUse.nobody');
    expect(missing).toEqual(['business.practice.inUse.nobody']);
  });
  it.each(PLACES)('%s asks only for keys in the catalogue', async (hash) => {
    const missing = new Set<string>();
    onMissingKey((key) => missing.add(key));
    window.location.hash = hash;
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    await screen.findByRole('main');
    await act(async () => { await new Promise((done) => setTimeout(done, 400)); });
    expect([...missing]).toEqual([]);
  });
});
