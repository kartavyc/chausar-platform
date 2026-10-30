import type { State } from '../../contracts.ts';
import type { ModelPresetId, SpendRate } from '../contracts.ts';
import { listRateOfTable, resolveRate, spendRatesOf, SpendRefusal, type SpendSubject } from '../money/spend.ts';
import { presetSpec } from './presets.ts';

/** A configured model cannot inherit the price of a differently named model. */
export function exactModelRate(state: State, ventureId: string, presetId: ModelPresetId, model: string, subject: SpendSubject): SpendRate {
  const spec = presetSpec(presetId), item = `model:${presetId}`;
  const own = spendRatesOf(state, ventureId).find(rate => rate.item === item);
  const matches = (rate: SpendRate) => rate.model ? rate.model === model : presetId !== 'openrouter' && model === spec.model;
  if (own && !matches(own)) throw new SpendRefusal('SPEND_UNPRICED', 'The saved price names a different model. Add the exact selected model and its price before starting.', subject, null);
  const rate = resolveRate({ item, owner: own ? [own] : [], list: model === spec.model && presetId !== 'openrouter' ? listRateOfTable(item, spec.priceTable) : null, subject });
  if (rate.unit !== 'per-million-tokens') throw new SpendRefusal('SPEND_UNPRICED', 'Add input and output token prices for this exact model before starting.', subject, null);
  return { ...rate, model };
}
