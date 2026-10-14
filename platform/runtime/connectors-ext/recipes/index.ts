import { check } from '../../contracts.ts';
import { compileRecipe, runRecipe, type Decoder, type DecoderInput, type RunOptions, type SourceRecipe } from '../recipe.ts';
import { BUILT_IN_DECODERS } from '../decoders.ts';
import type { RecipeOutcome } from '../types.ts';
import * as books from './books.ts';
import * as marketplaces from './marketplaces.ts';
import * as operations from './operations.ts';
import * as marketing from './marketing.ts';
import * as work from './work.ts';
import * as gst from './gst.ts';
import * as incomeTax from './income-tax.ts';
import * as bank from './bank.ts';
import * as apiPayments from './api-payments.ts';
import * as apiCommerce from './api-commerce.ts';
import * as apiGoogle from './api-google.ts';
import * as apiCrm from './api-crm.ts';
import * as apiAccounting from './api-accounting.ts';

const families = [books, marketplaces, operations, marketing, work, gst, incomeTax, bank, apiPayments, apiCommerce, apiGoogle, apiCrm, apiAccounting];
const decoderMap = new Map<string, Decoder>();
for (const decoder of [...BUILT_IN_DECODERS, ...families.flatMap(family => family.DECODERS)]) {
  check(/^[a-z][a-z0-9-]{1,60}$/.test(decoder.id) && !decoderMap.has(decoder.id), 'DECODER_DUPLICATE', 'Decoder ids are unique.');
  decoderMap.set(decoder.id, Object.freeze(decoder));
}
export const DECODERS: ReadonlyMap<string, Decoder> = decoderMap;
const recipeMap = new Map<string, SourceRecipe>();
for (const recipe of families.flatMap(family => family.RECIPES)) {
  const compiled = compileRecipe(recipe, decoderMap);
  check(!recipeMap.has(compiled.id), 'RECIPE_DUPLICATE', 'Recipe ids are unique.');
  recipeMap.set(compiled.id, compiled);
}
/** Every registered recipe, compiled. A recipe without a source-total check never reaches this list. */
export const RECIPES: ReadonlyMap<string, SourceRecipe> = recipeMap;

export function recipe(id: string): SourceRecipe {
  check(typeof id === 'string' && recipeMap.has(id), 'RECIPE_NOT_FOUND', 'Choose a registered recipe.');
  return recipeMap.get(id)!;
}
export function runRegistered(id: string, input: DecoderInput, options: RunOptions = {}): RecipeOutcome {
  const selected = recipe(id), decoder = decoderMap.get(selected.decoder)!;
  check(decoder.accepts === 'text' ? typeof input.text === 'string' : decoder.accepts === 'rows' ? Array.isArray(input.rows) : Array.isArray(input.records),
    'RECIPE_INPUT_MISMATCH', 'This recipe reads a different kind of input.');
  return runRecipe(selected, decoder, input, options);
}
export function recipesFor(group: string): SourceRecipe[] { return [...recipeMap.values()].filter(item => item.group === group); }
