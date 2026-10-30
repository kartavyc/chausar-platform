import words from '../../text/en/connection-words.json';
import type { ConnectorCardLite } from '../../engine/types';
import { localizedSellerCard } from './SellerCardWords';

const copy: Readonly<Record<string, string>> = words;
const lines = new Map(Object.entries(copy).filter(([key]) => key.startsWith('connection-words.line.')).map(([key, value]) => [value, key]));

/** Match the whole known status, never a fragment of changed live evidence. */
export function connectionWords(t: (key: string) => string, current: string): string {
  const key = lines.get(current);
  return key ? t(key) : current;
}

/** Keep capability identity, state, qualification and live evidence unchanged. */
export function localizedConnectionCard(t: (key: string) => string, original: ConnectorCardLite): ConnectorCardLite {
  const card = localizedSellerCard(t, original);
  const translate = (field: string, current: string) => {
    const key = `connection-words.card.${card.id}.${field}`;
    return copy[key] === current ? t(key) : current;
  };
  return { ...card, note: translate('note', card.note), modes: card.modes.map(mode => ({ ...mode, what: translate(mode.mode, connectionWords(t, mode.what)) })) };
}
