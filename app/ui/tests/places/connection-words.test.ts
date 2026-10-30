import { expect, it } from 'vitest';
import { localizedConnectionCard, connectionWords } from '../../src/places/connections/ConnectionWords';
import { capabilityWords } from '../../src/places/team/CapabilityWords';
import en from '../../src/text/en/connection-words.json';
import hi from '../../src/text/hi/connection-words.json';
import type { ConnectorCardLite } from '../../src/engine/types';

const t = (key: string) => (hi as Record<string, string>)[key] ?? key;

it('translates exact static W5 notes and modes without changing capability evidence', () => {
  const card = { id: 'voice-provider', note: en['connection-words.card.voice-provider.note'], modes: [{ mode: 'write', status: 'planned', qualification: 'unqualified', what: en['connection-words.card.voice-provider.write'] }] } as ConnectorCardLite;
  const result = localizedConnectionCard(t, card);
  expect(result.note).toBe(hi['connection-words.card.voice-provider.note']);
  expect(result.modes[0]).toEqual({ ...card.modes[0], what: hi['connection-words.card.voice-provider.write'] });
  expect(card.note).toBe(en['connection-words.card.voice-provider.note']);
});

it('never overwrites changed connector evidence or newly supplied status text', () => {
  const card = { id: 'voice-provider', note: 'Current provider permission revoked', modes: [{ mode: 'write', status: 'planned', qualification: 'unqualified', what: 'Current adapter disabled' }] } as ConnectorCardLite;
  expect(localizedConnectionCard(t, card)).toEqual(card);
  expect(connectionWords(t, 'Current account permission revoked')).toBe('Current account permission revoked');
  expect(connectionWords(t, `${en['connection-words.line.templates']}; current permission revoked`)).toBe(`${en['connection-words.line.templates']}; current permission revoked`);
});

it('does not translate client step text even when it resembles a static capability description', () => {
  const line = "Can't move money or ask for it.";
  expect(capabilityWords(t, 'step:client-authored', line)).toBe(line);
  expect(capabilityWords(t, 'effect:money', `${line} Current permission changed.`)).toBe(`${line} Current permission changed.`);
});
