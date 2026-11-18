// Chausar finding customers, for every business: the search brief. Who to look for, in which city, how many, and
// with which source, exactly as the owner approves it (customers/find-run.ts runs it; chief/gate.ts shows it).
// - Seeded from the way to earn the owner kept (core/way.ts: who pays, how they are reached). The owner edits it
//   before approving; nothing here decides for them.
// - The public map search needs a kind of place it lists (a cafe, a clinic, an office). Words that name none are not
//   forced into one: the brief then needs a lead tool the owner connected, and says so (LEAD_SOURCE_REQUIRED).
// - A connected tool is called once with exactly the inputs in the brief.
// Pure: no store, no network, and no Node imports, so the app's fake engine checks a brief with this same file.
import { check } from '../../portable.ts';
import type { Json } from '../../portable.ts';

export type FindSource = { kind: 'public-map' } | { kind: 'connected'; serverId: string; tool: string; arguments: Record<string, Json> };
export type FindBrief = { who: string; place: string; category: string; count: number; source: FindSource };
export const FIND_DEFAULT_COUNT = 10;
export const FIND_MAX_COUNT = 50;
/** The same shape customers/sources/osm.ts takes (OSM_TAG); kept here too so this file stays free of engine imports. */
const TAG = /^(?:(?:shop|amenity|craft|office|tourism|leisure)=[a-z_]{1,50}|building=(?:apartments|office|commercial)|landuse=residential)$/;

/**
 * The kinds of place the public map lists that a small business sells to, each with its OpenStreetMap tag, the words
 * the card uses and the plain words that mean it. Order only breaks a tie: the word that comes first in the owner's
 * sentence wins, so a kind with the more exact words stands before the one with the plainer word ("office building"
 * before "office"). misses: what a search of that kind will not find, said on its card.
 *
 * Added 15 Nov 2026, after a technician whose plan sells to offices and housing societies was offered "companies":
 * apartment blocks, housing areas, office and commercial buildings, and more shops and places an Indian small business
 * sells to. Each tag was checked on taginfo.openstreetmap.org that day, with its count of uses: building=apartments
 * 8.2 million, landuse=residential 10.8 million, building=commercial 1.5 million, building=office 316 thousand,
 * amenity=fast_food 672 thousand, amenity=bank 413 thousand, shop=car_repair 298 thousand, shop=hardware 108 thousand,
 * shop=mobile_phone 104 thousand, shop=electronics 84 thousand, shop=mall 79 thousand, tourism=hostel 63 thousand,
 * amenity=university 58 thousand, shop=confectionery 43 thousand.
 */
export const PLACE_KINDS: readonly { tag: string; label: string; words: readonly string[]; misses?: string }[] = Object.freeze([
  { tag: 'amenity=cafe', label: 'Cafes', words: ['cafe', 'café', 'coffee shop', 'coffee house', 'tea room'] },
  { tag: 'amenity=restaurant', label: 'Restaurants', words: ['restaurant', 'eatery', 'eateries', 'dhaba'] },
  { tag: 'amenity=fast_food', label: 'Fast food places', words: ['fast food', 'takeaway', 'food stall', 'food joint'] },
  { tag: 'shop=confectionery', label: 'Sweet shops', words: ['sweet shop', 'mithai shop', 'confectionery', 'confectioneries'] },
  { tag: 'shop=bakery', label: 'Bakeries', words: ['bakery', 'bakeries', 'cake shop'] },
  { tag: 'amenity=bar', label: 'Bars and pubs', words: ['bar', 'pub', 'brewery', 'breweries'] },
  { tag: 'tourism=hotel', label: 'Hotels', words: ['hotel', 'resort'] },
  { tag: 'tourism=guest_house', label: 'Guest houses', words: ['guest house', 'homestay', 'bed and breakfast'] },
  { tag: 'tourism=hostel', label: 'Hostels', words: ['hostel', 'paying guest'] },
  { tag: 'amenity=events_venue', label: 'Event venues', words: ['wedding venue', 'event venue', 'banquet hall', 'marriage hall'] },
  { tag: 'amenity=kindergarten', label: 'Preschools', words: ['kindergarten', 'preschool', 'playschool', 'play school', 'nursery school'] },
  { tag: 'amenity=school', label: 'Schools', words: ['school'] },
  { tag: 'amenity=college', label: 'Colleges', words: ['college', 'institute', 'coaching centre', 'coaching center'] },
  { tag: 'amenity=university', label: 'Universities', words: ['university', 'universities'] },
  { tag: 'amenity=dentist', label: 'Dentists', words: ['dentist', 'dental clinic'] },
  { tag: 'amenity=clinic', label: 'Clinics', words: ['clinic'] },
  { tag: 'amenity=doctors', label: 'Doctors', words: ['doctor'] },
  { tag: 'amenity=hospital', label: 'Hospitals', words: ['hospital', 'nursing home'] },
  { tag: 'amenity=pharmacy', label: 'Pharmacies', words: ['pharmacy', 'pharmacies', 'chemist', 'medical store'] },
  { tag: 'amenity=veterinary', label: 'Vets', words: ['vet', 'veterinary', 'pet clinic'] },
  { tag: 'leisure=fitness_centre', label: 'Gyms', words: ['gym', 'fitness centre', 'fitness center', 'fitness studio', 'yoga studio'] },
  { tag: 'shop=beauty', label: 'Beauty parlours', words: ['beauty parlour', 'beauty parlor', 'beauty salon', 'spa'] },
  { tag: 'shop=hairdresser', label: 'Salons', words: ['salon', 'hairdresser', 'barber'] },
  { tag: 'shop=clothes', label: 'Clothes shops', words: ['boutique', 'clothes shop', 'clothing shop', 'clothing store', 'garment shop'] },
  { tag: 'shop=gift', label: 'Gift shops', words: ['gift shop', 'gift store'] },
  { tag: 'shop=florist', label: 'Florists', words: ['florist', 'flower shop'] },
  { tag: 'shop=books', label: 'Bookshops', words: ['bookshop', 'bookstore', 'book shop', 'book store'] },
  { tag: 'shop=jewelry', label: 'Jewellers', words: ['jeweller', 'jeweler', 'jewellery shop', 'jewelry shop'] },
  { tag: 'shop=furniture', label: 'Furniture shops', words: ['furniture shop', 'furniture store'] },
  { tag: 'shop=interior_decoration', label: 'Interior shops', words: ['interior designer', 'interior decorator', 'home decor shop'] },
  { tag: 'shop=supermarket', label: 'Supermarkets', words: ['supermarket', 'grocery', 'groceries', 'kirana'] },
  { tag: 'shop=mall', label: 'Malls', words: ['mall', 'shopping centre', 'shopping center'] },
  { tag: 'shop=electronics', label: 'Electronics shops', words: ['electronics shop', 'electronics store', 'appliance shop', 'appliance store'] },
  { tag: 'shop=mobile_phone', label: 'Mobile phone shops', words: ['mobile shop', 'mobile phone shop', 'mobile store', 'phone shop'] },
  { tag: 'shop=hardware', label: 'Hardware shops', words: ['hardware shop', 'hardware store'] },
  { tag: 'shop=car_repair', label: 'Garages', words: ['garage', 'car workshop', 'auto workshop', 'car repair shop'] },
  { tag: 'amenity=bank', label: 'Banks', words: ['banks', 'bank branch', 'bank branches'] },
  { tag: 'shop=travel_agency', label: 'Travel agents', words: ['travel agent', 'travel agency', 'travel agencies', 'tour operator'] },
  { tag: 'craft=caterer', label: 'Caterers', words: ['caterer', 'catering'] },
  { tag: 'craft=photographer', label: 'Photographers', words: ['photographer', 'photo studio'] },
  { tag: 'craft=tailor', label: 'Tailors', words: ['tailor'] },
  { tag: 'office=coworking', label: 'Coworking spaces', words: ['coworking', 'co-working'] },
  { tag: 'office=lawyer', label: 'Law firms', words: ['lawyer', 'law firm', 'advocate'] },
  { tag: 'office=accountant', label: 'Accountants', words: ['accountant', 'chartered accountant', 'ca firm'] },
  { tag: 'office=architect', label: 'Architects', words: ['architect'] },
  { tag: 'office=estate_agent', label: 'Estate agents', words: ['estate agent', 'real estate', 'property dealer'] },
  { tag: 'office=it', label: 'Software and IT companies', words: ['startup', 'start-up', 'software company', 'software companies', 'it company', 'it companies', 'tech company', 'tech companies'] },
  { tag: 'building=apartments', label: 'Apartment blocks', misses: 'It lists apartment blocks by name, not a housing society\'s office or committee.',
    words: ['apartment', 'apartment block', 'apartment building', 'flats', 'housing society', 'housing societies', 'residential society', 'residential societies', 'gated society', 'gated societies', 'residents welfare association', 'condominium'] },
  { tag: 'landuse=residential', label: 'Housing colonies', misses: 'It lists housing areas by name, not a residents\' office or committee.',
    words: ['housing colony', 'housing colonies', 'residential colony', 'residential colonies', 'township', 'gated community', 'gated communities', 'housing complex', 'housing complexes', 'residential complex', 'residential complexes'] },
  { tag: 'building=office', label: 'Office buildings', words: ['office building', 'office block', 'office complex', 'office complexes', 'business park', 'tech park', 'it park'] },
  { tag: 'building=commercial', label: 'Commercial buildings', words: ['commercial building', 'commercial complex', 'commercial complexes', 'shopping complex', 'shopping complexes'] },
  { tag: 'office=company', label: 'Company offices', words: ['company', 'companies', 'office', 'firm', 'corporate'] },
]);

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KIND_WORDS = PLACE_KINDS.map(kind => new RegExp(`(?<![\\p{L}\\p{N}])(?:${kind.words.map(escape).join('|')})(?:s|es)?(?![\\p{L}\\p{N}])`, 'iu'));

/** The public map's kind of place for plain words: the one named first in the sentence, or null when none is named. */
export function categoryFor(words: string): string | null {
  let best: { tag: string; at: number } | null = null;
  PLACE_KINDS.forEach((kind, index) => {
    const at = typeof words === 'string' ? words.search(KIND_WORDS[index]!) : -1;
    if (at >= 0 && (!best || at < best.at)) best = { tag: kind.tag, at };
  });
  return (best as { tag: string } | null)?.tag ?? null;
}

/**
 * Every kind of place the words name, in the order they name them: a plan that sells to "offices and housing
 * societies" names two, and a search looks for one at a time. Words one kind already took are not read again as
 * another ("office building" is not also an office).
 */
export function kindsNamed(words: string): string[] {
  if (typeof words !== 'string') return [];
  const found: { tag: string; at: number; end: number; index: number }[] = [];
  PLACE_KINDS.forEach((kind, index) => {
    for (const match of words.matchAll(new RegExp(KIND_WORDS[index]!.source, 'giu'))) found.push({ tag: kind.tag, at: match.index!, end: match.index! + match[0].length, index });
  });
  found.sort((a, b) => a.at - b.at || a.index - b.index);
  const tags: string[] = [];
  let taken = -1;
  for (const item of found) {
    if (item.at < taken) continue;
    taken = item.end;
    if (!tags.includes(item.tag)) tags.push(item.tag);
  }
  return tags;
}

/** Places of no listed kind: a shop, a store, a local business. The owner, or the chief, picks the nearest kind. */
const OTHER_PLACES = /(?<![\p{L}\p{N}])(?:shops?|stores?|outlets?|showrooms?|factory|factories|workshops?|warehouses?|(?:local|nearby|neighbourhood|neighborhood) business(?:es)?)(?![\p{L}\p{N}])/iu;

/**
 * Whether the words name places a map could list at all. People, channels and online businesses (parents, YouTube
 * creators, production houses) are not: the public map cannot find them, and no map search is proposed for them.
 */
export function namesPlaces(words: string): boolean {
  return typeof words === 'string' && (kindsNamed(words).length > 0 || OTHER_PLACES.test(words));
}

/** The way to earn as far as a search reads it: who pays, and how they are reached (core/way.ts). */
export type WayLines = { customer: string; reach: string };

/**
 * The kinds of place the plan's own customers are, as the map names them, in the plan's order: from who pays, else
 * from how they are reached. Empty when the plan names no listed kind.
 */
export function planKinds(way: WayLines | undefined): string[] {
  if (!way) return [];
  const paying = kindsNamed(way.customer);
  return paying.length ? paying : kindsNamed(way.reach);
}

/**
 * Whether the plan's customers are places a map could list. Null with no way kept: nothing is known, so nothing is
 * said. False for people, channels and online businesses.
 */
export function planHasPlaces(way: WayLines | undefined): boolean | null {
  return way ? namesPlaces(`${way.customer} ${way.reach}`) : null;
}

const listed = (items: readonly string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * Whether a public map search the chief words fits the plan (found live, 15 Nov 2026: "companies in Lucknow" for a
 * plan that sells to offices and housing societies, and a map search offered for customers who are YouTube creators).
 * The plan's own customers decide the kind: a search is for one of the kinds the plan names; when the plan names
 * places of no listed kind, the nearest kind is the chief's to suggest; when its customers are not places at all, no
 * map search is proposed. With no way kept nothing is held. The reason finishes "Chausar could not propose this:".
 * The owner's own search, from Clients, is theirs to choose and is not held by this.
 */
export function searchFit(way: WayLines | undefined, category: string): { ok: true } | { ok: false; reason: string } {
  if (!way) return { ok: true };
  const kinds = planKinds(way);
  if (kinds.length) return kinds.includes(category) ? { ok: true } : { ok: false, reason: `the plan sells to ${listed(kinds.map(kindWords))}, so a search is for one of those.` };
  return planHasPlaces(way) ? { ok: true } : { ok: false, reason: 'the public map lists places only, and the plan\'s customers are not places on it. The owner can add people they know in Clients.' };
}

/** Said where a search starts (the Find customers sheet, the connections step) when the plan's customers are not places. */
export const MAP_PLACES_ONLY = 'The public map lists places only, and your customers are not a kind of place on it. For now, add people you already know in Clients, or use a lead tool once you connect one.';
/** What every public map search will not find, said on its card. */
export const MAP_GAPS = 'It finds only places listed there by name, so some will be missing.';

/** A kind's words for a card ('cafes'): its label, or for a tag the owner typed, the tag's own word. */
export function kindWords(tag: string): string {
  return (PLACE_KINDS.find(kind => kind.tag === tag)?.label ?? tag.split('=')[1]?.replaceAll('_', ' ') ?? 'places').toLowerCase();
}

const CITY = /(?<![\p{L}])(?:[Ii]n|[Aa]round|[Nn]ear|[Aa]cross)\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){0,2})/gu;
/** Words with a capital after "in" that are no city: a language, a month, a day, a tool, a word that starts a sentence. */
const NOT_A_CITY: ReadonlySet<string> = new Set([
  'hindi', 'english', 'marathi', 'tamil', 'telugu', 'bengali', 'gujarati', 'kannada', 'malayalam', 'punjabi', 'urdu', 'odia', 'assamese', 'sanskrit', 'french',
  'german', 'spanish', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'excel', 'word', 'tally', 'python', 'java', 'photoshop', 'canva', 'figma',
  'whatsapp', 'instagram', 'youtube', 'facebook', 'linkedin', 'google', 'i', 'my', 'we', 'our', 'the', 'a', 'an', 'this', 'that', 'it',
]);
function cityIn(text: string, country: string): string {
  for (const match of text.matchAll(CITY)) {
    const found = match[1] ?? '';
    if (found.toLowerCase() !== country.trim().toLowerCase() && !NOT_A_CITY.has(found.split(/\s+/)[0]!.toLowerCase())) return found;
  }
  return '';
}

/** Before a kind of place, the words that make it a customer: "orders from cafes", "contracts with offices". */
const SOLD_TO = /(?<![\p{L}])(?:for|from|to|with|serve|serves|serving|supply|supplies|supplying)\s+(?:[\p{L}'-]+\s+){0,2}$/iu;
/** Where the owner works is not who they sell to: "I work at an office", "I worked for a hotel". */
const WORKS_THERE = /(?<![\p{L}])work(?:s|ed|ing)?\s+(?:for|with|at|in)\s+(?:[\p{L}'-]+\s+){0,2}$/iu;

/**
 * The kind of place the owner's own about words say they sell to, or null when unsure: the first kind named right
 * after words of selling ("bulk orders from cafes"), never a place they only mention ("I work at an office").
 */
function kindSoldTo(about: string): string | null {
  const found: { tag: string; at: number; index: number }[] = [];
  PLACE_KINDS.forEach((kind, index) => {
    for (const match of about.matchAll(new RegExp(KIND_WORDS[index]!.source, 'giu'))) found.push({ tag: kind.tag, at: match.index!, index });
  });
  found.sort((a, b) => a.at - b.at || a.index - b.index);
  for (const item of found) {
    const before = about.slice(0, item.at);
    if (SOLD_TO.test(before) && !WORKS_THERE.test(before)) return item.tag;
  }
  return null;
}

/**
 * The brief as Chausar first offers it: who, from the kept way to earn; the city, when the way names one after "in",
 * "near", "around" or "across" (a country is not a city); the public map's kind, when the words name one. What the way
 * does not say is read from the owner's own about words where that is safe (about: what the owner said the business
 * is), and never when the way's customers are not places on a map. Whatever is still missing is left empty for the
 * owner. country: the business's country name, never taken for a city.
 */
export function seedBrief(way: WayLines | undefined, country: string, about = ''): FindBrief {
  const who = (way?.customer ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const mine = (way ? planHasPlaces(way) : true) && typeof about === 'string' ? about : '';
  const place = (way ? cityIn(way.customer, country) || cityIn(way.reach, country) : '') || cityIn(mine, country);
  return { who, place, category: planKinds(way)[0] ?? kindSoldTo(mine) ?? '', count: FIND_DEFAULT_COUNT, source: { kind: 'public-map' } };
}

const BAD = 'INVALID_VENTURE_REQUEST';
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: unknown, keys: readonly string[], line: string): Record<string, unknown> => {
  check(isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), BAD, line);
  return value as Record<string, unknown>;
};
const oneLine = (value: unknown, min: number, max: number, line: string): string => {
  check(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max && !/[\u0000-\u001F\u007F]/.test(value.trim()), BAD, line);
  return (value as string).trim();
};
export const NO_PUBLIC_KIND = 'The public map lists places such as cafes, clinics and offices, and has no kind for this. Pick a kind of place, or connect a lead tool.';

/** The brief exactly as it will run, or a refusal in owner words. Nothing is filled in or repaired. */
export function checkBrief(raw: unknown): FindBrief {
  const body = exact(raw, ['who', 'place', 'category', 'count', 'source'], 'A search says who to look for, the city, the kind of place, how many and where to look.');
  const who = oneLine(body.who, 2, 200, 'Say who to look for, in one line.');
  const place = oneLine(body.place, 2, 100, 'Name the city to look in.');
  check(Number.isInteger(body.count) && (body.count as number) >= 1 && (body.count as number) <= FIND_MAX_COUNT, BAD, 'Choose how many to find, from one to fifty.');
  const count = body.count as number;
  check(isObject(body.source), BAD, 'Choose the public map or one tool you connected.');
  if (body.source.kind === 'public-map') {
    exact(body.source, ['kind'], 'The public map search takes no other settings.');
    check(typeof body.category === 'string', BAD, 'Pick a kind of place.');
    check(body.category !== '', 'LEAD_SOURCE_REQUIRED', NO_PUBLIC_KIND);
    check(TAG.test(body.category), BAD, 'Pick a kind of place from the list, or type a map tag such as shop=bakery.');
    return { who, place, category: body.category, count, source: { kind: 'public-map' } };
  }
  check(body.source.kind === 'connected', BAD, 'Choose the public map or one tool you connected.');
  const source = exact(body.source, ['kind', 'serverId', 'tool', 'arguments'], 'A connected tool needs its server, its tool and the exact inputs.');
  check(typeof source.serverId === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(source.serverId), BAD, 'Choose one of your connected tools.');
  const tool = oneLine(source.tool, 1, 200, 'Name the tool to call.');
  check(isObject(source.arguments), BAD, 'Write the tool\'s inputs as one JSON object.');
  let text = '';
  try { text = JSON.stringify(source.arguments); } catch { text = ''; }
  check(text.length > 0 && text.length <= 8192, BAD, 'The tool\'s inputs are too long. Keep them under eight thousand characters.');
  check(body.category === '' || (typeof body.category === 'string' && TAG.test(body.category)), BAD, 'Leave the kind of place empty for a connected tool, or pick one from the list.');
  return { who, place, category: body.category as string, count, source: { kind: 'connected', serverId: source.serverId as string, tool, arguments: JSON.parse(text) as Record<string, Json> } };
}

/**
 * The chief's plain words ("cafes in Pune", and how many as digits or nothing) as an exact public map brief, or why
 * they cannot be one, in words that finish "Chausar could not propose this:". The last "in" splits who from the city.
 */
export function briefFromWords(text: string, quantity: string): { brief: FindBrief } | { reason: string } {
  const words = text.replace(/\s+/g, ' ').trim();
  const at = words.toLowerCase().lastIndexOf(' in ');
  if (at < 2 || at + 4 >= words.length) return { reason: 'it needs who to look for and the city, like cafes in Pune.' };
  const who = words.slice(0, at).trim(), place = words.slice(at + 4).trim().replace(/[.!?]+$/, '');
  const many = quantity.trim();
  if (many && !/^(?:[1-9]|[1-4]\d|50)$/.test(many)) return { reason: 'the count was not a whole number from one to fifty.' };
  const category = categoryFor(who);
  if (!category) return { reason: 'the public map has no kind of place for that. The owner can start it from Clients, Pipeline with a lead tool.' };
  try { return { brief: checkBrief({ who, place, category, count: many ? Number(many) : FIND_DEFAULT_COUNT, source: { kind: 'public-map' } }) }; }
  catch (error) { return { reason: (error as Error).message.replace(/^\p{Lu}/u, letter => letter.toLowerCase()) }; }
}

/**
 * Round 6 (re-check 036): a search card's title, which the app says in the owner's language (app/ui/src/places/today/
 * plan-words.ts); the {kind}, the {place} and the {server} keep their words.
 */
export const FIND_TITLE_WORDS = Object.freeze({
  map: 'Find possible customers: {kind} in {place}',
  tool: 'Find possible customers in {place} with {server}',
});

/** The approval card's words for a brief: its title and exactly where it looks. serverName: the connected tool's name. */
export function briefWords(brief: FindBrief, serverName = ''): { title: string; looks: string } {
  if (brief.source.kind === 'public-map') {
    const kind = kindWords(brief.category);
    const misses = PLACE_KINDS.find(item => item.tag === brief.category)?.misses;
    return {
      title: FIND_TITLE_WORDS.map.replace('{kind}', () => kind).replace('{place}', () => brief.place),
      // What it finds, then plainly what it will not: the kind's own limit, and the map's gaps.
      looks: `Looks on OpenStreetMap, a public map, for up to ${brief.count} ${kind} in ${brief.place}, and reads each one's own website for a contact email. ${misses ? `${misses} ` : ''}${MAP_GAPS}`,
    };
  }
  const server = serverName || brief.source.serverId;
  return {
    title: FIND_TITLE_WORDS.tool.replace('{place}', () => brief.place).replace('{server}', () => server),
    looks: `Calls ${server} once, its tool ${brief.source.tool}, with exactly the inputs shown, keeps up to ${brief.count} of the businesses it returns, and reads each one's own website for a contact email.`,
  };
}
