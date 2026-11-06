// Chausar venture launcher, policy (wave 6, 6C5 / D21): the hard stops. No owner attestation, setting or profession can
// unlock these; each is explained in one plain line. They are listed beside the attestable rules so the owner sees what
// will always be refused, and venture.rules.attest refuses any of their ids with HARD_STOP. Each is enforced where the
// work happens (for example the advocate outreach switch in core/compliance.ts, the CAPTCHA stop in build/browser.ts,
// LinkedIn copy-and-open only in network/outreach.ts, disclosed AI voices in the narration and social checks).
// Pure: the fake engine shows the same list.
import { ChausarError } from '../../portable.ts';

export type HardStop = { id: string; line: string };

export const HARD_STOPS: readonly HardStop[] = Object.freeze([
  { id: 'securities-advice', line: 'No stock tips, target prices or promised returns without a SEBI registration.' },
  { id: 'advocate-solicit', line: 'Advocates may not advertise or ask people for work.' },
  { id: 'medical-diagnosis', line: 'No AI diagnosis or prescription.' },
  { id: 'child-data', line: "No children's data without a parent's checked consent." },
  { id: 'captcha', line: 'No getting past a CAPTCHA. Chausar stops there.' },
  { id: 'detection-evasion', line: 'No hiding automation from a website.' },
  { id: 'linkedin-automation', line: 'No automated LinkedIn reading or messages. Copy and open only.' },
  { id: 'fake-reviews', line: 'No fake reviews.' },
  { id: 'undisclosed-ai', line: 'AI voices and presenters are always disclosed.' },
].map(item => Object.freeze(item)));

export const HARD_STOP_WORDS = 'This is a hard stop. No attestation or setting can unlock it.';

export function isHardStop(id: unknown): boolean {
  return typeof id === 'string' && HARD_STOPS.some(item => item.id === id);
}

/** Always throws HARD_STOP with the stop's own line. */
export function refuseHardStop(id: string): never {
  const stop = HARD_STOPS.find(item => item.id === id);
  throw new ChausarError('HARD_STOP', stop ? `${stop.line} ${HARD_STOP_WORDS}` : HARD_STOP_WORDS);
}
