// C7 task 13: fixed phrase lists, one per hard stop (policy/hard-stops.ts), so words an owner writes for a hired agent can
// be checked in code. The securities stop also asks securitiesAdviceIn, the guard every model answer already passes.
// The lists are English and deliberately narrow: each catches the plain ways of asking for the stop, and the test holds
// one ordinary sentence beside each that must pass. Nothing here is a model's judgement.
import { HARD_STOPS, type HardStop } from './hard-stops.ts';
import { securitiesAdviceIn } from './securities-guard.ts';

export const HARD_STOP_PHRASES: Readonly<Record<string, readonly RegExp[]>> = Object.freeze({
  'securities-advice': Object.freeze([
    /\btarget\s+prices?\b/, /\b(?:promised|guaranteed|assured|sure)\s+returns?\b/, /\bstock\s+(?:tips?|picks?|recommendations?)\b/,
    /\b(?:buy|sell|hold)\s+(?:or|and)\s+(?:buy|sell|hold)\b.*\b(?:stocks?|shares?)\b/, /\b(?:which|what)\s+(?:stocks?|shares?)\s+to\s+buy\b/,
  ]),
  'advocate-solicit': Object.freeze([
    /\badverti[sz]\w*\s+(?:my\s+|our\s+)?(?:legal|law|advocate|lawyer)\b/, /\b(?:solicit|canvass)\w*\s+(?:\w+\s+){0,2}(?:clients?|cases?|work)\b/,
    /\b(?:find|get|bring)\s+(?:me\s+)?(?:new\s+)?(?:legal|law)\s+(?:clients?|cases?)\b/, /\bpromot\w*\s+(?:my\s+)?(?:legal|law)\s+(?:practice|services?|firm)\b/,
  ]),
  'medical-diagnosis': Object.freeze([
    /\bdiagnos(?:e|es|ed|ing|is|ises)\b/, /\bprescri(?:be|bes|bed|bing|ption|ptions)\b/, /\b(?:which|what)\s+(?:medicine|medicines|drugs?|dosage)\s+to\s+take\b/,
  ]),
  'child-data': Object.freeze([
    /\b(?:children|child|kids?|minors?|students?\s+under\s+(?:18|eighteen))(?:'s|s'|’s)?\s+(?:data|details|photos?|pictures?|records?|information|phone\s+numbers?|addresses)\b/,
    /\b(?:data|details|photos?|records?|information)\s+(?:of|about|from)\s+(?:children|kids|minors)\b/,
  ]),
  'captcha': Object.freeze([
    /\b(?:solv|bypass|break|crack|beat|skip|get(?:s|ting)?\s+past|get(?:s|ting)?\s+around|get(?:s|ting)?\s+through)\w*\s+(?:\w+\s+){0,2}captchas?\b/, /\bcaptcha\s+(?:solv\w*|bypass\w*|breaker|cracker)\b/,
  ]),
  'detection-evasion': Object.freeze([
    /\b(?:avoid|evade|evading|dodge|beat|bypass)\w*\s+(?:\w+\s+){0,2}(?:detection|bot\s+checks?|anti-?bot)\b/, /\b(?:rotat\w*\s+(?:\w+\s+)?prox(?:y|ies)|proxy\s+rotation)\b/,
    /\bundetect(?:able|ed)\b/, /\bcannot\s+tell\s+it\s+is\s+a\s+bot\b/, /\b(?:look|act|appear)s?\s+(?:like\s+a\s+)?human\s+to\s+(?:the\s+)?(?:site|website|platform)\b/,
  ]),
  'linkedin-automation': Object.freeze([
    /\b(?:message|messages|messaging|dm|dms|invite|invites|connect\s+with|scrape|scrapes|scraping|automat\w*)\b.*\blinkedin\b/,
    /\blinkedin\b.*\b(?:messages?|messaging|dms?|connection\s+requests?|invites?|invitations?|scrap\w*|automat\w*|outreach|auto-?\w+)\b/,
  ]),
  'fake-reviews': Object.freeze([
    /\b(?:fake|false|made-up|paid|five-?\s?star|5-?\s?star)\s+(?:reviews?|ratings?|testimonials?)\b/, /\bwrite\w*\s+(?:\w+\s+){0,2}reviews?\s+(?:for|of|about|on)\b/,
    /\breviews?\s+(?:from|under)\s+(?:fake|other)\s+(?:names?|accounts?)\b/,
  ]),
  'undisclosed-ai': Object.freeze([
    /\b(?:pretend\w*|pos(?:e|es|ing))\s+(?:to\s+be\s+|as\s+)(?:a\s+)?(?:human|real\s+person|person|me)\b/,
    /\bwithout\s+(?:disclos\w*|saying|mentioning|telling)\b.{0,30}\b(?:ai|bot|automated)\b/, /\b(?:hide|hides|hiding)\s+(?:\w+\s+){0,2}(?:ai|bot)\b/, /\bundisclosed\s+ai\b/,
  ]),
});

/** The first hard stop the words ask for, or null. Case, accents and runs of spaces are ignored. */
export function hardStopIn(text: string): HardStop | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const flat = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  for (const stop of HARD_STOPS) {
    if (stop.id === 'securities-advice' && securitiesAdviceIn(text)) return stop;
    if ((HARD_STOP_PHRASES[stop.id] ?? []).some(pattern => pattern.test(flat))) return stop;
  }
  return null;
}
