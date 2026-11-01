// Chausar venture launcher, core (wave 6, 6C6 / D5, D21): the day-job question and each profession's rules.
// When the owner's profession is picked, onboarding asks whether their employment contract allows side work and says
// plainly that this is their responsibility (D5). It then shows that profession's rules and what its regulator forbids,
// which Chausar switches off for the business (for advocates: outreach and advertising, BCI Rule 36). A switch-off comes
// from this data, never from an owner setting or an attestation, so neither can turn it back on.
//
// The statutes are named from Chausar's own notes and have NOT yet been checked against their official pages (6E6 checks
// each before the beta ships), so every rule carries checked: false and the screen says so. Pure and shared with the fake
// engine: no clock, no store, no Node built-ins.
import { HARD_STOPS, type HardStop } from '../policy/hard-stops.ts';

export const SIDE_WORK_QUESTION = 'Does your employment contract allow side work? This is your responsibility.';
export const SIDE_WORK_RESPONSIBILITY = 'Chausar does not read your contract. You decide, and you are responsible for it.';
export const SIDE_WORK_ANSWERS = ['allowed', 'not-allowed', 'not-sure'] as const;
export type SideWorkAnswer = typeof SIDE_WORK_ANSWERS[number];

/** What a regulator can switch off in a business. Each is refused in the engine where it happens (core/compliance.ts). */
export const REGULATOR_TOOLS = ['outreach', 'advertising'] as const;
export type RegulatorTool = typeof REGULATOR_TOOLS[number];

export type ProfessionRule = { id: string; title: string; line: string; checked: boolean };
export type ProfessionCompliance = {
  id: string; label: string; family: string | null;
  rules: readonly ProfessionRule[];
  switchedOff: readonly { tool: RegulatorTool; line: string }[];
  hardStops: readonly string[];
};

const rule = (id: string, title: string, line: string): ProfessionRule => Object.freeze({ id, title, line, checked: false });
const p = (item: ProfessionCompliance): ProfessionCompliance => Object.freeze({ ...item, rules: Object.freeze([...item.rules]), switchedOff: Object.freeze([...item.switchedOff]), hardStops: Object.freeze([...item.hardStops]) });

export const PROFESSION_COMPLIANCE: readonly ProfessionCompliance[] = Object.freeze([
  p({
    id: 'advocate', label: 'Advocate', family: 'licensed',
    rules: [rule('bci-rule-36', 'BCI Rule 36', 'Advocates may not advertise or ask people for work, directly or through others.')],
    switchedOff: [
      { tool: 'outreach', line: 'Outreach is off: Bar Council rules bar advocates from asking people for work.' },
      { tool: 'advertising', line: 'Promotional posts are off: Bar Council rules bar advocates from advertising.' },
    ],
    hardStops: ['advocate-solicit'],
  }),
  p({
    id: 'doctor', label: 'Doctor', family: 'licensed',
    rules: [rule('telemedicine-2020', 'Telemedicine Practice Guidelines 2020', 'Only you, as a registered doctor, consult and prescribe. Chausar handles appointments and follow-ups.')],
    switchedOff: [], hardStops: ['medical-diagnosis'],
  }),
  p({
    id: 'financial-planner', label: 'Financial planner or mutual fund distributor', family: 'licensed',
    rules: [rule('sebi-ia-ra', 'SEBI adviser and research analyst rules', 'Investment advice and research reports need a SEBI registration. Without one, Chausar makes review packs only.')],
    switchedOff: [], hardStops: ['securities-advice'],
  }),
  p({
    id: 'school-teacher', label: 'School teacher', family: 'teaching',
    rules: [rule('rte-s28', 'RTE Act section 28', 'Teachers in schools under the Right to Education Act may not take private tuition.')],
    switchedOff: [], hardStops: ['child-data'],
  }),
  p({
    id: 'architect', label: 'Interior designer or architect', family: 'creative',
    rules: [rule('coa-title', 'Architects Act title rule', 'Only an architect registered with the Council of Architecture may use the title architect.')],
    switchedOff: [], hardStops: [],
  }),
  p({
    id: 'real-estate-broker', label: 'Real estate broker', family: 'local-services',
    rules: [rule('rera-agent', 'RERA agent registration', 'Agents register with the state RERA before selling registered projects.')],
    switchedOff: [], hardStops: ['fake-reviews'],
  }),
  p({
    id: 'home-chef', label: 'Home chef or tiffin service', family: 'local-services',
    rules: [rule('fssai', 'FSSAI registration', 'Selling food needs an FSSAI registration or licence.')],
    switchedOff: [], hardStops: ['fake-reviews'],
  }),
  p({
    id: 'physiotherapist', label: 'Physiotherapist', family: 'local-services',
    rules: [rule('ncahp', 'NCAHP Act', 'Physiotherapists register under the allied health professions law of their state.')],
    switchedOff: [], hardStops: ['medical-diagnosis'],
  }),
  p({
    id: 'call-centre-agent', label: 'Call centre agent', family: 'tech',
    rules: [rule('trai-dnd', 'TRAI commercial calls rules', 'No promotional calls or messages to numbers on the Do Not Disturb list.')],
    switchedOff: [], hardStops: ['undisclosed-ai'],
  }),
]);

const FAMILY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'money-tax': 'Money and tax', teaching: 'Teaching and coaching', creative: 'Creative work', writing: 'Writing and content',
  'local-services': 'Local services', documents: 'Documents and reports', research: 'Research and analysis', people: 'People and careers',
  'shop-office': 'Shop and back office', tech: 'Tech services', licensed: 'Licensed work',
});

/** A profession by id, else a family by id (with no profession-specific rules), else null. */
export function professionCompliance(id: unknown): ProfessionCompliance | null {
  if (typeof id !== 'string') return null;
  const found = PROFESSION_COMPLIANCE.find(item => item.id === id);
  if (found) return found;
  const label = FAMILY_LABELS[id];
  return label ? p({ id, label, family: id, rules: [], switchedOff: [], hardStops: [] }) : null;
}

/** FNV-1a as 8 hex characters: the same in Node and the browser. Binds an answer to the words the owner saw. */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

export type CompliancePure = {
  profession: { id: string; label: string; family: string | null };
  question: string; responsibility: string;
  rules: ProfessionRule[];
  switchedOff: { tool: RegulatorTool; line: string }[];
  hardStops: HardStop[];
  digest: string;
};

/** What the screen shows for a profession: the question, its rules, its switch-offs and its own hard stops (the full list is on Your rules). */
export function complianceOf(item: ProfessionCompliance): CompliancePure {
  const own = new Set(item.hardStops);
  const hardStops = HARD_STOPS.filter(stop => own.has(stop.id)).map(stop => ({ ...stop }));
  const body = {
    profession: { id: item.id, label: item.label, family: item.family }, question: SIDE_WORK_QUESTION, responsibility: SIDE_WORK_RESPONSIBILITY,
    rules: item.rules.map(entry => ({ ...entry })), switchedOff: item.switchedOff.map(entry => ({ ...entry })), hardStops,
  };
  return { ...body, digest: 'compliance-' + fnv(JSON.stringify(body)) };
}
