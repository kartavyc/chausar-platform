// Chausar venture launcher, delivery package (P5): practice clients for rehearsal.
// Three made-up clients per service type (clean, messy, pushy), plus cases made from the owner's signals.
// Scenario words hold no digits and never copy a real client's request.
import { CHECK_IDS, SCENARIO_KINDS } from '../contracts.ts';
import { listRecords } from '../records.ts';
import type { State } from '../../contracts.ts';
import type { CheckId, DeliveryReason, Scenario, ScenarioKind, ServiceType, SignalRecord } from '../contracts.ts';

type PracticeClient = { persona: string; brief: string; expectedOutcome: string };
type TypeScenarios = Record<ScenarioKind, PracticeClient>;

const BASE_CHECKS: readonly CheckId[] = ['no-numeric-prose', 'figures-resolve', 'required-sections', 'no-outside-writes', 'house-style', 'length-bounds', 'turn-limit', 'no-done-claims'];
const MESSY_CHECKS: readonly CheckId[] = CHECK_IDS.filter(id => BASE_CHECKS.includes(id) || id === 'questions-raised');
const TITLES: Readonly<Record<ScenarioKind, string>> = { clean: 'A clear request', messy: 'A messy request', pushback: 'A pushy client' };
const MOCKS: Readonly<Record<string, 'record-only'>> = Object.freeze({ 'mail-app.send-deliverable': 'record-only' });

export const PRACTICE_CLIENTS: Readonly<Record<ServiceType, TypeScenarios>> = Object.freeze({
  agency: {
    clean: {
      persona: 'The owner of a small gym who wants more members and knows what they want.',
      brief: 'Hello, I run a gym in town and want more people to join this season. Can you plan some social media posts and ads for us? Our members are mostly young professionals.',
      expectedOutcome: 'A reply that sets out the plan, says drafts come for review first, and quotes the plan price from Chausar.',
    },
    messy: {
      persona: 'A busy cafe owner who writes in a hurry and leaves out the details.',
      brief: 'hi need marketing asap, sales are slow, not sure what we need, maybe instagram or something?? can you help',
      expectedOutcome: 'A reply that asks about the goal, the audience and the budget limits before any plan, and promises nothing it cannot back.',
    },
    pushback: {
      persona: 'A shop owner who wants a lower price and extra work thrown in.',
      brief: 'Your price is too high for a small shop like mine. Can you cut it and also add a website refresh for free? Other agencies offered me more.',
      expectedOutcome: 'A polite reply that keeps the plan price from Chausar, offers no discount or free work, and explains what is included.',
    },
  },
  studio: {
    clean: {
      persona: 'A podcast host who sends a clear brief for episode edits.',
      brief: 'Hi, I host a weekly interview podcast. I need each episode edited, with the long pauses cut and the sound levelled. Can you take this on?',
      expectedOutcome: 'A reply that says what will be made, asks any open question on the brief, and quotes the plan price from Chausar.',
    },
    messy: {
      persona: 'A founder who wants a logo but cannot say what style they like.',
      brief: 'we need a logo, something modern but also classic? not sure about colours. our old one is bad. can you just make something nice',
      expectedOutcome: 'A reply that asks about style, colours and where the logo will be used before any work starts.',
    },
    pushback: {
      persona: 'A client who wants unlimited changes for the same price.',
      brief: 'Before I agree, I want unlimited revisions included and the files delivered tomorrow. Also please lower the price a little.',
      expectedOutcome: 'A polite reply that keeps the plan price and scope, promises no date it cannot back, and explains how changes work.',
    },
  },
  consulting: {
    clean: {
      persona: 'A shop owner with a clear question about pricing strategy.',
      brief: 'Hello, I run a small online shop and want advice on how to price our new product line. Can you help me think it through?',
      expectedOutcome: 'A reply that restates the question, suggests how the work will go, and quotes the plan price from Chausar.',
    },
    messy: {
      persona: 'A worried founder with many problems and no clear question.',
      brief: 'everything feels stuck, team is tired, cash is tight, customers complain. where do we even start? need someone to look at it all',
      expectedOutcome: 'A reply that asks which problem matters most and what a good result looks like before suggesting anything.',
    },
    pushback: {
      persona: 'A client who wants a guaranteed result and a free first session.',
      brief: 'I will only pay if you guarantee our sales go up. Can the first session be free so I can decide?',
      expectedOutcome: 'A polite reply that guarantees no result, offers no free work, and keeps the plan price from Chausar.',
    },
  },
  bookkeeping: {
    clean: {
      persona: 'The owner of a small cafe who keeps their papers in order.',
      brief: 'Hi, I own a small cafe. Could you take care of my monthly books? I can send the statement from my bank and photos of every bill.',
      expectedOutcome: 'A reply that says what will be done once the files arrive, asks for anything missing, and quotes the plan price from Chausar.',
    },
    messy: {
      persona: 'A shop owner with a shoebox of receipts and two bank accounts.',
      brief: 'books are a mess, some bills lost, i use two banks and sometimes cash, not sure what you need from me. can you fix it',
      expectedOutcome: 'A reply that asks which accounts and which months to cover and what to do about lost bills, and claims nothing as done.',
    },
    pushback: {
      persona: 'A client who wants a discount and tax filing thrown in.',
      brief: 'Your fee seems high. Can you do it cheaper and also file my tax return as part of the same price?',
      expectedOutcome: 'A polite reply that keeps the plan price from Chausar, adds no free work, and says what the service covers.',
    },
  },
  research: {
    clean: {
      persona: 'A startup founder who needs a list of possible partners.',
      brief: 'Hello, we sell software to clinics and want a list of clinic groups that might partner with us. Can you research this for us?',
      expectedOutcome: 'A reply that sets out the method and sources and quotes the plan price from Chausar.',
    },
    messy: {
      persona: 'A manager with a vague question about the market.',
      brief: 'need to know about the market, competitors, trends, all of it really. for a board meeting soon. what can you get',
      expectedOutcome: 'A reply that asks what decision the research is for and which market to cover before starting.',
    },
    pushback: {
      persona: 'A client who wants exact numbers guaranteed and extra reports for free.',
      brief: 'I need you to promise exact figures and add two extra reports at no cost. Can you also go faster than usual?',
      expectedOutcome: 'A polite reply that promises no figures it cannot source, adds no free reports, and keeps the plan price.',
    },
  },
  content: {
    clean: {
      persona: 'A dentist who wants regular blog posts for the clinic site.',
      brief: 'Hi, I run a dental clinic and would like friendly blog posts for our website about caring for your teeth. Can you write these?',
      expectedOutcome: 'A reply that says how drafts will be written and reviewed, and quotes the plan price from Chausar.',
    },
    messy: {
      persona: 'A founder who wants content but has no topics or voice in mind.',
      brief: 'we need content. blog maybe newsletter too. not sure what to write about. something that gets attention',
      expectedOutcome: 'A reply that asks about the audience, the topics and the tone before any draft.',
    },
    pushback: {
      persona: 'A client who wants more posts for the same price and no edits.',
      brief: 'Can you double the number of posts for the same fee? And I want them published without me reading them first.',
      expectedOutcome: 'A polite reply that keeps the plan price and scope and says every draft goes to the client for review first.',
    },
  },
  support: {
    clean: {
      persona: 'An online shop owner who wants help answering customer emails.',
      brief: 'Hello, we run an online clothing shop and get many emails about orders and returns. Can your team help answer them?',
      expectedOutcome: 'A reply that says replies are drafted for approval, asks for the shop policies, and quotes the plan price from Chausar.',
    },
    messy: {
      persona: 'A founder whose inbox is overflowing and who is not sure what help they need.',
      brief: 'inbox is chaos, some angry customers, some refund stuff, some just questions. dont know where to start. help?',
      expectedOutcome: 'A reply that asks about refund rules and which messages need the owner before any reply is drafted.',
    },
    pushback: {
      persona: 'A client who wants refunds promised to every customer and a lower fee.',
      brief: 'Just promise every angry customer a full refund so they stop writing. And can you lower your fee for us?',
      expectedOutcome: "A polite reply that promises no refunds on the owner's behalf, keeps the plan price, and says refunds go to the owner.",
    },
  },
  other: {
    clean: {
      persona: 'A small business owner with a clear request.',
      brief: 'Hello, I would like to use your service for my small business. Can you tell me how you would handle my request?',
      expectedOutcome: 'A reply that sets out what will be done and what is needed, and quotes the plan price from Chausar.',
    },
    messy: {
      persona: 'A busy owner who writes in a hurry and leaves out what they need.',
      brief: 'need help with stuff for my business, bit urgent, not sure exactly what, can you sort it',
      expectedOutcome: 'A reply that asks what the client needs and by when before promising anything.',
    },
    pushback: {
      persona: 'A client who wants a discount and extra work for free.',
      brief: 'I will sign up if you lower the price and add some extra work for free. Deal?',
      expectedOutcome: 'A polite reply that keeps the plan price from Chausar and adds no free work.',
    },
  },
});

/** The three template practice clients for a service type, ids '{type}-clean', '{type}-messy', '{type}-pushback'. */
export function scenariosFor(type: ServiceType): Scenario[] {
  return SCENARIO_KINDS.map(kind => {
    const client = PRACTICE_CLIENTS[type][kind];
    return {
      id: `${type}-${kind}`, serviceType: type, title: TITLES[kind], persona: client.persona, brief: client.brief,
      expectedOutcome: client.expectedOutcome, stoppingCriteria: ['deliverable-ready', 'client-asks-for-person', 'turn-limit'],
      turnLimit: 2, episodes: 1, mocks: { ...MOCKS }, checks: [...(kind === 'messy' ? MESSY_CHECKS : BASE_CHECKS)],
      source: 'template', signalId: null,
    };
  });
}

/** Checks every signal case keeps, whatever the reason. */
const SIGNAL_CORE: readonly CheckId[] = ['no-numeric-prose', 'figures-resolve', 'no-outside-writes', 'turn-limit', 'no-done-claims'];
const REASON_CHECKS: Readonly<Record<DeliveryReason, readonly CheckId[]>> = {
  'wrong-fact': ['no-numeric-prose'], 'missing-fact': ['questions-raised'], 'missing-section': ['required-sections'],
  'off-brief': ['required-sections'], tone: ['house-style'], format: ['required-sections', 'house-style'],
  'too-long': ['length-bounds'], 'too-short': ['length-bounds'], 'wrong-number': ['figures-resolve', 'no-numeric-prose'],
  late: [], 'claims-work-not-done': ['no-done-claims'], other: [],
};
const REASON_WORDS: Readonly<Record<DeliveryReason, string>> = {
  'wrong-fact': 'a wrong fact', 'missing-fact': 'a missing fact', 'missing-section': 'a missing section', 'off-brief': 'a reply off the brief',
  tone: 'the wrong tone', format: 'the wrong format', 'too-long': 'a reply that was too long', 'too-short': 'a reply that was too short',
  'wrong-number': 'a wrong number', late: 'a late reply', 'claims-work-not-done': 'a claim of work that was not done', other: 'a problem you flagged',
};
const SOURCE_WORDS: Readonly<Record<SignalRecord['source'], string>> = {
  'owner-rejected': 'a draft you rejected', 'owner-edited': 'a draft you edited', 'check-failed': 'a draft that failed a check',
};

function focusChecks(reason: SignalRecord['reason']): readonly CheckId[] {
  if (reason === null) return [];
  if ((CHECK_IDS as readonly string[]).includes(reason)) return [reason as CheckId];
  return REASON_CHECKS[reason as DeliveryReason] ?? [];
}

function reasonWords(reason: SignalRecord['reason']): string {
  if (reason === null) return 'a problem you flagged';
  if ((CHECK_IDS as readonly string[]).includes(reason)) return `the ${reason} check`;
  return REASON_WORDS[reason as DeliveryReason] ?? 'a problem you flagged';
}

/**
 * A rehearsal case made from a signal: the service type's messy practice client with checks focused on the reason.
 * It never copies the client's request, so rehearsals stay free of client data.
 */
export function signalScenario(signal: SignalRecord, type: ServiceType): Scenario {
  const messy = scenariosFor(type)[1];
  const focus = new Set<CheckId>([...SIGNAL_CORE, ...focusChecks(signal.reason)]);
  return {
    ...messy,
    id: `signal-${signal.id}`,
    title: `Practice case from ${SOURCE_WORDS[signal.source]}`,
    expectedOutcome: `${messy.expectedOutcome} Watch for ${reasonWords(signal.reason)}.`,
    checks: CHECK_IDS.filter(id => focus.has(id)),
    source: 'signal',
    signalId: signal.id,
  };
}

/** The template practice clients plus every signal that was turned into a rehearsal case. */
export function listScenarios(state: State, ventureId: string, type: ServiceType): Scenario[] {
  const signals = listRecords(state, 'venture-signal', ventureId).filter(signal => signal.scenarioId !== null);
  return [...scenariosFor(type), ...signals.map(signal => signalScenario(signal, type))];
}
