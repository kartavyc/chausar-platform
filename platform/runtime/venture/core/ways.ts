// Chausar venture launcher, core (Ink v2 wave 4, package 4J8; catalogue U3): venture.playbooks.list, the ways to earn
// the Start gallery shows. Answered before any vault (PRE_VAULT_METHODS): no state of its own, no model, no write. One
// way per registered playbook that delivers today (playbooks/ways.ts), its AI team read from the playbook's own agents
// and their departments (4A1), what it needs (the owner's own AI, connections that work today, the hours), and its
// hours and pay range labelled a model estimate with their basis. The businesses the
// owner already runs come only from trusted host composition (the open business; 4J6's snapshots add the others),
// never from the payload, which must be empty. Sorting and the hours filter are code here, so every screen orders the
// tiles the same way.
import type { State } from '../../contracts.ts';
import type { WaysView, WayView } from '../contracts.ts';
import { currentVenture, exactPayload } from '../records.ts';
import { currentRegistry, pickPlaybook, type PlaybookRegistration } from '../playbooks/registry.ts';
import { flagshipDelivery } from '../playbooks/steps.ts';
import { departmentOfRole, departmentOfService } from '../playbooks/departments.ts';
import { UP_TO_HOURS, UP_TO_WORDS, WAY_AI_NEED, WAY_CATEGORIES, WAY_SOURCE, WAYS, type WayData } from '../playbooks/ways.ts';
import { kitDefinitions } from '../playbooks/kit/installed.ts';
import { kitWay } from '../playbooks/kit/tile.ts';

/** A business on this computer as a way sees it: its folder id, its name, and the playbook its idea picks (or none). */
export type WayBusiness = { businessId: string; name: string; playbook: string | null };
export type WaySort = 'best-fit' | 'fewest-hours' | 'name';

/** Initials as the app's avatar draws them: the first letters of the first two words, or the first two of one word. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).map(word => [...word].filter(part => /\p{L}/u.test(part))).filter(letters => letters.length > 0);
  const [first, second] = words;
  if (!first) return '?';
  return (second ? [first[0], second[0]] : first.slice(0, 2)).join('').toLocaleUpperCase('en-IN');
}

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const rupees = (amount: number) => `₹${RUPEES.format(amount)}`;

/** One way's view, or null when its playbook is not registered or does not deliver: no tile for an unbuilt one. */
function wayView(way: WayData, registry: readonly PlaybookRegistration[], businesses: readonly WayBusiness[]): WayView | null {
  const registration = registry.find(entry => entry.id === way.playbook);
  const delivery = registration ? flagshipDelivery(registration.id) : null;
  if (!registration || !delivery) return null;
  // The AI team is the playbook's agents only: its code (checks, the calculator) is never shown as AI. A tile that names
  // its team (Ink v2 wave 5, 5A1) shows those roles, in its order.
  const shown = way.team ? way.team.flatMap(id => delivery.roles.filter(role => role.id === id)) : delivery.roles;
  const agents = shown.filter(role => role.kind === 'agent');
  const team = agents.map(role => ({ role: role.name, initials: initialsOf(role.name), department: departmentOfRole(delivery, role.id) }));
  const pay = { en: `${rupees(way.pay.minRupees)} to ${rupees(way.pay.maxRupees)}`, hi: `${rupees(way.pay.minRupees)} से ${rupees(way.pay.maxRupees)}` };
  return {
    id: way.playbook, playbook: way.playbook, label: way.en.label, category: way.category,
    department: departmentOfService(registration.serviceType), line: way.en.line,
    hours: `${way.hours.min} to ${way.hours.max} h a week`, minHours: way.hours.min, maxHours: way.hours.max, hoursEstimate: true,
    youDo: way.en.youDo, team, teamLine: way.en.teamLine,
    clientsPay: { text: pay.en, per: way.en.per, estimate: true, source: WAY_SOURCE.en },
    needs: { ai: WAY_AI_NEED.en, connections: way.en.needs },
    starter: way.en.starter,
    yours: businesses.filter(business => business.playbook === way.playbook).map(business => ({ businessId: business.businessId, name: business.name })),
    hi: {
      label: way.hi.label, line: way.hi.line, hours: `हफ़्ते में ${way.hours.min} से ${way.hours.max} घंटे`, youDo: way.hi.youDo,
      team: agents.map(role => way.roles[role.id] ?? role.name), teamLine: way.hi.teamLine,
      pay: pay.hi, per: way.hi.per, source: WAY_SOURCE.hi, starter: way.hi.starter,
      needs: { ai: WAY_AI_NEED.hi, connections: way.hi.needs },
    },
  };
}

/**
 * The gallery from way data, a registry and the businesses the host named: one way per registered playbook that
 * delivers, in registry order; the categories that have a way, with counts, in the chips' order; and the hours filter's
 * count. Pure: no clock, no store, no model.
 */
export function waysView(data: readonly WayData[], registry: readonly PlaybookRegistration[], businesses: readonly WayBusiness[]): WaysView {
  const ways = registry
    .map(entry => data.find(way => way.playbook === entry.id))
    .map(way => (way ? wayView(way, registry, businesses) : null))
    .filter((way): way is WayView => way !== null);
  const categories = WAY_CATEGORIES
    .map(category => ({ id: category.id, label: category.en, hi: category.hi, count: ways.filter(way => way.category === category.id).length }))
    .filter(category => category.count > 0);
  return { ways, categories, upTo: { maxHours: UP_TO_HOURS, label: UP_TO_WORDS.en, hi: UP_TO_WORDS.hi, count: waysUpTo(ways, UP_TO_HOURS).length } };
}

/**
 * venture.playbooks.list {} (read, before any vault): the ways to earn. businesses: trusted host composition only (the
 * open business, from openWayBusiness), never from the payload, which must be empty.
 */
export function listWays(payload: unknown, businesses: readonly WayBusiness[] = []): WaysView {
  exactPayload(payload, []);
  // Ink v2 wave 5 (5A1): every kit playbook that landed has its tile from its definition (playbooks/kit/tile.ts).
  return waysView([...WAYS, ...kitDefinitions().map(kitWay)], currentRegistry(), businesses);
}

/** The open business as a way's "You run this": its name and the playbook its idea picks, or null with no business. */
export function openWayBusiness(state: State, businessId: string): WayBusiness | null {
  const venture = currentVenture(state);
  if (!venture) return null;
  return { businessId, name: venture.workingName, playbook: pickPlaybook(venture.idea)?.id ?? null };
}

/** The ways that need at most this many hours a week (the "Up to 5 h a week" filter reads maxHours). */
export function waysUpTo<T extends Pick<WayView, 'maxHours'>>(ways: readonly T[], hours: number): T[] {
  return ways.filter(way => way.maxHours <= hours);
}

/**
 * The ways in one of the gallery's orders, as a new list: best fit puts 4C1's fit first and keeps the rest as given;
 * fewest hours goes by the most hours a week, then the fewest, then the name; name goes by the shown name in the
 * owner's language.
 */
export function orderWays(ways: readonly WayView[], by: WaySort, fitWayId: string | null = null, language: 'en' | 'hi' = 'en'): WayView[] {
  const nameOf = (way: WayView) => (language === 'hi' ? way.hi.label : way.label);
  const locale = language === 'hi' ? 'hi-IN' : 'en-IN';
  const byName = (a: WayView, b: WayView) => nameOf(a).localeCompare(nameOf(b), locale);
  const list = [...ways];
  if (by === 'name') return list.sort(byName);
  if (by === 'fewest-hours') return list.sort((a, b) => a.maxHours - b.maxHours || a.minHours - b.minHours || byName(a, b));
  const fit = list.findIndex(way => way.id === fitWayId);
  return fit < 0 ? list : [list[fit], ...list.slice(0, fit), ...list.slice(fit + 1)];
}
