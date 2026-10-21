// Chausar venture launcher: the flagship playbook registry (design 7.8). Each flagship playbook lives in its own
// folder, venture/playbooks/<id>/, as data plus deterministic checks, and registers here with one import and one
// entry in PLAYBOOK_REGISTRY. Several packages register here, so change this file with small edits only.
//
// A registration extends one of the built-in service types (core/service-types.ts) instead of adding a new one: the
// plan, prices, invoices and the eight-step delivery playbook keep working, and the flagship adds its own offers,
// steps, checks and approvals on top. label is the human label the screens show for the playbook.
import type { ServiceType } from '../contracts.ts';
import { CA_FIRM_REGISTRATION } from './ca-firm/registration.ts';
import { YOUTUBE_REGISTRATION } from './youtube/registration.ts';
import { SOCIAL_AGENCY_REGISTRATION } from './social/registration.ts';

export type PlaybookRegistration = {
  /** The folder name: short and lowercase. */
  id: string;
  /** The human label the screens show, for example 'AI-native CA firm'. */
  label: string;
  /** The built-in service type this playbook extends. */
  serviceType: ServiceType;
  /** Lower-case phrases in the owner's idea that pick this playbook. */
  picks: readonly string[];
  /** One plain sentence on what the playbook is for. */
  summary: string;
};

export const PLAYBOOK_REGISTRY: readonly PlaybookRegistration[] = Object.freeze([
  CA_FIRM_REGISTRATION,
  YOUTUBE_REGISTRATION,
  SOCIAL_AGENCY_REGISTRATION,
]);

const ID = /^[a-z][a-z0-9-]{0,40}$/;

/** Ids are unique and short, every registration has a label, and no phrase picks two playbooks. */
export function validateRegistry(registry: readonly PlaybookRegistration[] = PLAYBOOK_REGISTRY): void {
  const ids = new Set<string>();
  const phrases = new Map<string, string>();
  for (const entry of registry) {
    if (!ID.test(entry.id)) throw new Error(`The playbook id ${JSON.stringify(entry.id)} is not a short lowercase name.`);
    if (ids.has(entry.id)) throw new Error(`The playbook ${entry.id} is registered twice.`);
    ids.add(entry.id);
    if (typeof entry.label !== 'string' || !entry.label.trim()) throw new Error(`The playbook ${entry.id} has no label.`);
    if (!entry.picks.length) throw new Error(`The playbook ${entry.id} has no phrases that pick it.`);
    for (const phrase of entry.picks) {
      if (phrase !== phrase.toLowerCase().trim() || !phrase) throw new Error(`The playbook ${entry.id} has a phrase that is not lower case: ${JSON.stringify(phrase)}.`);
      const other = phrases.get(phrase);
      if (other && other !== entry.id) throw new Error(`The phrase ${JSON.stringify(phrase)} picks both ${other} and ${entry.id}.`);
      phrases.set(phrase, entry.id);
    }
  }
}

/**
 * The playbook an idea picks: every registration with a phrase inside the lower-cased idea is a candidate, the
 * longest phrase found wins, and a tie goes to the playbook registered first. No phrase found gives null, and the
 * plain service type serves the business.
 */
export function pickPlaybook(idea: string, registry: readonly PlaybookRegistration[] = PLAYBOOK_REGISTRY): PlaybookRegistration | null {
  const text = idea.toLowerCase().replace(/\s+/g, ' ');
  let best: PlaybookRegistration | null = null;
  let bestLength = 0;
  for (const entry of registry) {
    for (const phrase of entry.picks) {
      if (phrase.length > bestLength && text.includes(phrase)) { best = entry; bestLength = phrase.length; }
    }
  }
  return best;
}

export function findPlaybook(id: string, registry: readonly PlaybookRegistration[] = PLAYBOOK_REGISTRY): PlaybookRegistration | null {
  return registry.find(entry => entry.id === id) ?? null;
}

/** The human label for a registered playbook, or null when the id is not registered. */
export function playbookLabel(id: string, registry: readonly PlaybookRegistration[] = PLAYBOOK_REGISTRY): string | null {
  return findPlaybook(id, registry)?.label ?? null;
}
