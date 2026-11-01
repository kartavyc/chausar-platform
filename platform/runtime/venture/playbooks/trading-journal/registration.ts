// Chausar playbook: trading journal (wave 6, 6E7 / D49). Browser-safe registration only.
import type { PlaybookRegistration } from '../registry.ts';

export const TRADING_JOURNAL_ID = 'trading-journal';
export const TRADING_JOURNAL_REGISTRATION: PlaybookRegistration = Object.freeze({ id: TRADING_JOURNAL_ID, label: 'Trading journal', serviceType: 'bookkeeping',
  picks: Object.freeze(['trading journal', 'trade journal', 'stock trader', 'options trader', 'intraday trader', 'f&o trader', 'trader tax pack', 'tradebook']),
  summary: 'Code works your trading charges, profit or loss and a tax pack for your CA. No trade advice.',
  riskLevel: 'high', lastReviewed: '2026-11-01' });
