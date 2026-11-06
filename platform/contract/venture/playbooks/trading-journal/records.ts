// Canonical browser-safe types, shared by the engine and renderer.
import type { BrokerId } from '../../../../shared/venture/playbooks/trading-journal/rates.ts';
import type { TradeRow } from '../../../../shared/venture/playbooks/trading-journal/brokers.ts';
import type { OpeningLot } from '../../../../shared/venture/playbooks/trading-journal/journal.ts';
import type { TaxPack } from '../../../../shared/venture/playbooks/trading-journal/tax-pack.ts';

export type TradeJournalEntry =
  | { kind: 'import'; broker: BrokerId; name: string; sourceDigest: string; formatChecked: boolean; trades: TradeRow[]; receiptId: string }
  | { kind: 'opening'; lot: OpeningLot; receiptId: string }
  | { kind: 'pack'; yearId: TaxPack['yearId']; pack: TaxPack; sourceDigest: string; receiptId: string };
