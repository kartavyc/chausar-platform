// Chausar venture launcher, core: the unit an offer is priced in (seen in the real app, 15 Nov 2026: a monthly plan, a
// yearly maintenance contract, mug sets and subtitles were all "per project"; a translation offer then got "per piece",
// so a word and a page are units too). An offer has a way of charging (the three
// pricing models: per month, per project, per hour, which the plan's words, blocks and playbooks are built on) and a
// unit, the thing one price buys. Until now the unit was only the model's own word. The unit is now one of a fixed list
// the engine understands, and the model follows from it: a month is charged monthly, an hour hourly, and every other
// unit is a one-off charge counted in that unit, as per project always was (a price for one, times the quantity on the
// order). Nothing else changes in the calculator: money stays BigInt minor units, quantity times unit price.
//
// Who sets it: the owner, always (the plan card, Settings, Prices). The owner's AI may suggest the unit for an offer it
// proposes, never a price; code checks the suggestion against this list and an unknown one is per project.
// This file imports nothing of the engine, so the app's fake engine and the screens use the same list.

/** The units an offer can be priced in, in the order the screens list them. */
export const OFFER_UNITS = Object.freeze(['project', 'month', 'year', 'hour', 'visit', 'piece', 'set', 'minute', 'word', 'page'] as const);
export type OfferUnit = typeof OFFER_UNITS[number];
/** The unit of an offer whose unit nobody chose: one price for one piece of work. */
export const DEFAULT_OFFER_UNIT: OfferUnit = 'project';

/** The three ways of charging the plan is built on (contracts.ts PricingModel), named here so this file needs no engine import. */
type ChargeModel = 'monthly' | 'project' | 'hourly';
/** The way of charging each unit belongs to. Only a month repeats monthly and only an hour is hourly. */
const MODEL_OF: Readonly<Record<OfferUnit, ChargeModel>> = Object.freeze({
  project: 'project', month: 'monthly', year: 'project', hour: 'hourly', visit: 'project', piece: 'project', set: 'project', minute: 'project',
  word: 'project', page: 'project',
});
/** The unit each way of charging starts with (core/interview.ts UNIT_OF says the same; a test holds them equal). */
const UNIT_OF_MODEL: Readonly<Record<ChargeModel, OfferUnit>> = Object.freeze({ monthly: 'month', project: 'project', hourly: 'hour' });
/** How a price in each unit is said: "per piece". */
export const UNIT_WORDS: Readonly<Record<OfferUnit, string>> = Object.freeze({
  project: 'per project', month: 'per month', year: 'per year', hour: 'per hour', visit: 'per visit', piece: 'per piece', set: 'per set', minute: 'per minute',
  word: 'per word', page: 'per page',
});
export const UNIT_CHOICE_LINE = `Choose ${OFFER_UNITS.slice(0, -1).map(unit => UNIT_WORDS[unit]).join(', ')} or ${UNIT_WORDS[OFFER_UNITS.at(-1)!]}.`;

export function isOfferUnit(value: unknown): value is OfferUnit {
  return typeof value === 'string' && (OFFER_UNITS as readonly string[]).includes(value);
}

/** A suggested unit as it is kept: one of the list, else per project. Never a refusal: the owner changes it on the card. */
export function keptOfferUnit(value: unknown): OfferUnit {
  return isOfferUnit(value) ? value : DEFAULT_OFFER_UNIT;
}

/** A unit as an offer carries it: nothing for per project (an offer with no unit is per project), else the unit. */
export function unitPart(unit: OfferUnit | undefined): { unit?: OfferUnit } {
  return unit && unit !== DEFAULT_OFFER_UNIT ? { unit } : {};
}

/** The way of charging a unit belongs to. */
export function modelOfUnit(unit: OfferUnit): ChargeModel {
  return MODEL_OF[unit];
}

/** The unit a way of charging starts with: the unit of every offer made before units could be chosen. */
export function unitOfModel(model: ChargeModel): OfferUnit {
  return UNIT_OF_MODEL[model];
}

/**
 * A unit said in a message ("per piece", "by the minute", "monthly", "a year"): then the owner is speaking of how an
 * offer is charged. A word or a page is a unit only after "per" or "by the": "a page" and "every word" are said of
 * many other things.
 */
const UNIT_SAID = /\b(?:per|by\s+the|each|every|a)\s+(?:project|job|month|year|hour|visit|piece|item|set|minute)s?\b|\b(?:per|by\s+the)\s+(?:word|page)s?\b|\b(?:monthly|yearly|annual(?:ly)?|hourly)\b/i;
export function speaksOfUnit(said: string): boolean {
  return UNIT_SAID.test(said);
}
