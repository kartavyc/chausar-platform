/** TR-08 Models: the four pages under Models, as rail sub-places of Trust and as links on the Models page. */
import type { MK } from './models-kit';

export const MODELS_MORE: readonly { sub: string; title: MK; note: MK }[] = [
  { sub: 'models-compare', title: 'compare.title', note: 'compare.lead' },
  { sub: 'models-prices', title: 'prices.title', note: 'prices.lead' },
  { sub: 'models-voice', title: 'voice.title', note: 'voice.lead' },
  { sub: 'models-allowance', title: 'allowance.title', note: 'allowance.lead' },
];
