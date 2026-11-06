// Chausar venture launcher, network (Ink v2 wave 4, package 4E2): Chausar's own drafts, written by code from the card's
// facts and the owner's own words, in English and Hindi (the Hindi machine-drafted, for a native reviewer, and kept
// free of gendered verbs where it can be). They are what the owner gets with no AI connected, and what replaces an AI
// draft that failed a check. They state nothing the records do not hold: the business's name and offers from the
// accepted plan, who the person is, the day of the last note, the page a lead was found on, and the owner's words as
// given. They never use the owner's first name (4J9 keeps it for Today's greeting only) and write no number of their
// own. An intro request follows Happenstance's structure: the ask to the connector with saying no made easy, and a
// forwardable blurb of five sentences in the third person, with no pitch and at most one link (the owner's words go in
// it only when it still keeps those rules).
import type { OutreachChannel, OutreachKind, OutreachLanguage } from '../contracts.ts';
import { blurbProblem } from './outreach-checks.ts';

/** The cold email unsubscribe line in Hindi; 4E3's opt-out reading knows both "unsubscribe" and "बंद करो". */
export const HINDI_UNSUBSCRIBE_LINE = 'ये ईमेल बंद करवाने के लिए "बंद करो" या unsubscribe लिखकर जवाब दें, फिर हम आपको नहीं लिखेंगे।';
/** The heading above an intro request's blurb when the handoff puts both in one message. */
export const BLURB_HEADING: Readonly<Record<OutreachLanguage, string>> = Object.freeze({ en: 'A note you can forward:', hi: 'आगे भेजने के लिए नोट:' });

/** Who a draft is to, or names: a person's name and company. */
export type Named = { name: string; company: string | null };
export type TemplateInput = {
  kind: Exclude<OutreachKind, 'reminder'>;
  channel: OutreachChannel;
  language: OutreachLanguage;
  /** Who the message goes to: the card's person, or for an intro request the connector. */
  to: Named;
  /** An intro request: the person the owner wants to meet. A double opt-in: the person the owner introduces. */
  other: Named | null;
  business: { name: string; offers: string[] };
  /** The owner's own words, as typed. */
  about: string | null;
  /** A cold email to a lead: the page the lead was found on, as host and path. */
  where: string | null;
  /** A follow-up: the day of the last note, as words ('15 Oct'). */
  lastSent: string | null;
};
export type DraftWords = { subject: string | null; text: string; blurb: string | null };

/** The first word of a name: what a note calls someone. */
export const firstOf = (name: string): string => name.trim().split(/\s+/)[0] || name;

/** The owner's words as one sentence: a full stop (or a danda in Hindi) added when they end without one. */
function sentence(words: string, language: OutreachLanguage): string {
  const trimmed = words.trim();
  return /[.!?।]$/u.test(trimmed) ? trimmed : `${trimmed}${language === 'hi' ? '।' : '.'}`;
}

/** 'a', 'a and b', 'a, b and c'; in Hindi with और. */
function listWords(items: readonly string[], language: OutreachLanguage): string {
  const and = language === 'hi' ? 'और' : 'and';
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

/**
 * An intro request's blurb with the owner's words in it when it still keeps the blurb rules (four or five sentences,
 * the third person, no pitch, at most one link), else without them: the words stay in the note to the connector.
 */
function keepingRules(about: string | null, blurb: (words: string | null) => string): string {
  const withWords = blurb(about);
  return about && blurbProblem(withWords) === null ? withWords : blurb(null);
}

const at = (who: Named, language: OutreachLanguage) => (who.company ? (language === 'hi' ? ` (${who.company})` : ` at ${who.company}`) : '');
const from = (who: Named, language: OutreachLanguage) => (who.company ? (language === 'hi' ? ` (${who.company})` : ` from ${who.company}`) : '');

function english(input: TemplateInput): DraftWords {
  const { to, business } = input;
  const other = input.other ?? { name: 'them', company: null };
  const about = input.about ? sentence(input.about, 'en') : null;
  const offers = business.offers.length ? ` that offers ${listWords(business.offers, 'en')}` : '';
  const email = input.channel === 'email';
  switch (input.kind) {
    case 'intro-request': {
      const target = firstOf(other.name);
      return {
        subject: email ? `An introduction to ${other.name}?` : null,
        text: [
          `Hi ${firstOf(to.name)}, I hope you are well.`,
          `Would you be open to introducing me to ${other.name}${at(other, 'en')}?`,
          about ? `What I would like to talk about with ${target}: ${about}` : `I would like a short conversation with ${target}.`,
          'There is a short note below that you can forward.',
          'If now is not a good time, or you would rather not, just say so. That is completely fine.',
        ].join(' '),
        blurb: keepingRules(about, words => [
          `${business.name} is a small business${offers}.`,
          `Its owner would like a short conversation with ${target}.`,
          words ? `What they would like to talk about: ${words}` : `It would be a short conversation about ${target}'s work.`,
          'Nothing is being sold in this note.',
          `If ${target} would rather not, that is completely fine.`,
        ].join(' ')),
      };
    }
    case 'double-opt-in': {
      const them = firstOf(to.name), introduced = firstOf(other.name);
      return {
        subject: email ? `An introduction to ${other.name}?` : null,
        text: [
          `Hi ${them}, I'd like to introduce you to ${other.name}${from(other, 'en')}.`,
          ...(about ? [about] : []),
          'Would you be open to it? If not, just say so. That is completely fine.',
        ].join(' '),
        blurb: [`${them}, meet ${introduced}. ${introduced}, meet ${them}.`, ...(about ? [about] : []), 'I will leave you both to take it from here.'].join(' '),
      };
    }
    case 'connection-note':
      return { subject: null, text: `Hi ${firstOf(to.name)}, ${about ?? `I run ${business.name}.`} It would be good to connect here.`, blurb: null };
    case 'follow-up':
      return input.lastSent
        ? {
          subject: email ? 'Following up' : null,
          text: [`Hi ${firstOf(to.name)}, just following up on my note of ${input.lastSent}.`, ...(about ? [about] : []), 'No pressure at all if now is not a good time.'].join(' '),
          blurb: null,
        }
        : { subject: email ? `Hello from ${business.name}` : null, text: `Hi ${firstOf(to.name)}, I hope you are well. ${about ?? 'I wanted to get in touch.'}`, blurb: null };
    case 'reply':
      return { subject: email ? 'Thank you' : null, text: `Hi ${firstOf(to.name)}, thank you for getting back to me. ${about ?? 'I am happy to answer any questions you have.'}`, blurb: null };
    default: // cold-email
      return {
        subject: `A note from ${business.name}`,
        text: [
          `Hi ${firstOf(to.name)},\n\nI run ${business.name}${business.offers.length ? `, which offers ${listWords(business.offers, 'en')}` : ''}.`,
          ...(input.where ? [`I found ${to.company ?? 'your details'} on ${input.where}.`] : []),
          ...(about ? [about] : []),
          'If this is not useful to you, there is no need to reply.',
        ].join(' '),
        blurb: null,
      };
  }
}

function hindi(input: TemplateInput): DraftWords {
  const { to, business } = input;
  const other = input.other ?? { name: 'उन', company: null };
  const about = input.about ? sentence(input.about, 'hi') : null;
  const offers = business.offers.length ? `, जो ${listWords(business.offers, 'hi')} का काम करता है` : '';
  const email = input.channel === 'email';
  switch (input.kind) {
    case 'intro-request': {
      const target = firstOf(other.name);
      return {
        subject: email ? `${other.name} से परिचय?` : null,
        text: [
          `नमस्ते ${firstOf(to.name)}, उम्मीद है आप ठीक हैं।`,
          `क्या आप ${other.name}${at(other, 'hi')} से मेरा परिचय करा सकते हैं?`,
          about ? `बात इस बारे में होगी: ${about}` : `बस ${target} से थोड़ी बात हो सके, इतना ही।`,
          'नीचे एक छोटा नोट है, जिसे आप आगे भेज सकते हैं।',
          'अगर अभी ठीक न लगे, या आप न चाहें, तो बस बता दीजिए। कोई बात नहीं।',
        ].join(' '),
        blurb: keepingRules(about, words => [
          `${business.name} एक छोटा बिज़नेस है${offers}।`,
          `इसके मालिक ${target} से थोड़ी बात करना चाहते हैं।`,
          words ? `बात इस बारे में होगी: ${words}` : `बात ${target} के काम को समझने के बारे में होगी।`,
          'इस नोट में कुछ बेचा नहीं जा रहा है।',
          `अगर ${target} न चाहें, तो कोई बात नहीं।`,
        ].join(' ')),
      };
    }
    case 'double-opt-in': {
      const them = firstOf(to.name), introduced = firstOf(other.name);
      return {
        subject: email ? `${other.name} से परिचय?` : null,
        text: [`नमस्ते ${them}, मेरा मन है कि आपका परिचय ${other.name}${from(other, 'hi')} से कराऊँ।`, ...(about ? [about] : []), 'क्या आप इसके लिए तैयार हैं? अगर नहीं, तो बस बता दीजिए। कोई बात नहीं।'].join(' '),
        blurb: [`${them}, ये ${introduced} हैं। ${introduced}, ये ${them} हैं।`, ...(about ? [about] : []), 'आगे की बात आप दोनों आपस में कर लीजिए।'].join(' '),
      };
    }
    case 'connection-note':
      return { subject: null, text: `नमस्ते ${firstOf(to.name)}, ${about ?? `${business.name} मेरा बिज़नेस है।`} आपसे यहाँ जुड़कर ख़ुशी होगी।`, blurb: null };
    case 'follow-up':
      return input.lastSent
        ? {
          subject: email ? 'पिछले संदेश के बारे में' : null,
          text: [`नमस्ते ${firstOf(to.name)}, ${input.lastSent} वाले मेरे संदेश की बस एक याद।`, ...(about ? [about] : []), 'अगर अभी सही समय नहीं है, तो कोई दबाव नहीं।'].join(' '),
          blurb: null,
        }
        : { subject: email ? `${business.name} की ओर से नमस्ते` : null, text: `नमस्ते ${firstOf(to.name)}, उम्मीद है आप ठीक हैं। ${about ?? 'बस हाल-चाल पूछने के लिए लिखा।'}`, blurb: null };
    case 'reply':
      return { subject: email ? 'धन्यवाद' : null, text: `नमस्ते ${firstOf(to.name)}, जवाब देने के लिए धन्यवाद। ${about ?? 'आपके जो भी सवाल हों, उनका जवाब देकर ख़ुशी होगी।'}`, blurb: null };
    default: // cold-email
      return {
        subject: `${business.name} की ओर से एक संदेश`,
        text: [
          `नमस्ते ${firstOf(to.name)},\n\n${business.name} मेरा बिज़नेस है${offers}।`,
          ...(input.where ? [`आपकी जानकारी मुझे ${input.where} पर मिली।`] : []),
          ...(about ? [about] : []),
          'अगर यह आपके काम का नहीं है, तो जवाब देने की ज़रूरत नहीं है।',
        ].join(' '),
        blurb: null,
      };
  }
}

/** Chausar's own draft of one message, in the language asked for. */
export function templateDraft(input: TemplateInput): DraftWords {
  return input.language === 'hi' ? hindi(input) : english(input);
}
