// Chausar playbook: trading journal (wave 6, 6E7 / D49). The body of its one record kind, venture-trade-journal:
// an imported tradebook, an opening holding the owner entered, or a saved tax pack. The journal holds only the owner's
// own trades; it keeps no client data. Types only. Written for Chausar.
import type { TradeRow } from './brokers.ts';
import type { OpeningLot } from './journal.ts';
import type { TaxPack } from './tax-pack.ts';
import type { BrokerId } from './rates.ts';

export type TradeJournalEntry =
  | { kind: 'import'; broker: BrokerId; name: string; sourceDigest: string; formatChecked: boolean; trades: TradeRow[]; receiptId: string }
  | { kind: 'opening'; lot: OpeningLot; receiptId: string }
  | { kind: 'pack'; yearId: TaxPack['yearId']; pack: TaxPack; sourceDigest: string; receiptId: string };
export type TradeJournalBody = { entry: TradeJournalEntry };
