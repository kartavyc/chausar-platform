// Generated native catalogue cards. This adds setup paths, never a connected account or provider result.
import rows from './fixtures-seller-connectors.json';
import type {ConnectorCardLite} from './types';
export function withSellerCards(cards:ConnectorCardLite[]):ConnectorCardLite[]{const owned=rows as ConnectorCardLite[],ids=new Set(owned.map(c=>c.id));return [...cards.filter(c=>!ids.has(c.id)),...structuredClone(owned)];}
