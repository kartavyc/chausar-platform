export type TemplateServiceType = keyof typeof REQUIRED_SECTIONS;
export type TemplatePart = {kind:'text';text:string}|{kind:'figure';receiptId:string;figureKey:string};
export type TemplateOutline = {title:string;sections:{heading:string;parts:TemplatePart[]}[];questionsForClient:string[]};

export const REQUIRED_SECTIONS = Object.freeze({
  agency: ['Summary', 'Plan', 'Drafts', 'Next steps'],
  studio: ['Summary', 'What we will make', 'Questions on the brief', 'Next steps'],
  consulting: ['Summary', 'What we heard', 'Recommendations', 'Next steps'],
  bookkeeping: ['Summary', 'What we will do', 'What we need from you', 'Next steps'],
  research: ['Summary', 'Method', 'What we will look for', 'Sources to check'],
  content: ['Summary', 'Draft', 'Notes for review', 'Next steps'],
  support: ['Summary', 'Replies drafted', 'Escalations', 'Next steps'],
  other: ['Summary', 'What we will do', 'Questions', 'Next steps'],
});
/** The first line of every template outline stored for a real order. */
export const TEMPLATE_OUTLINE_LINE = "Template outline. No AI wrote this and it doesn't read the client's request.";
export const TEMPLATE_QUESTION = 'Is anything missing that we should know before we start?';
/** Client-facing: the owner copies the outline to a client, so it never says "your plan" (that would read as the client's). */
export const TEMPLATE_PRICE_SENTENCE = 'Here is the price for this work.';

export const TEMPLATE_OUTLINES: Readonly<Record<TemplateServiceType, readonly string[]>> = Object.freeze({
  agency: [
    'Thanks for reaching out. This reply sets out how we will approach your request.',
    'We will agree on the goal, the audience and the channels first, then plan the work week by week.',
    'We will share first drafts for you to review before anything goes out.',
    'Once you confirm the goal, we will start on the plan and send it to you for review.',
  ],
  studio: [
    'Thanks for your message. This reply sets out how we will handle your project.',
    'We will make the pieces described in your brief, in the style you choose.',
    'We will list anything in the brief that needs a choice from you before we start.',
    'Once you answer the question below, we will start the first draft for your review.',
  ],
  consulting: [
    'Thanks for reaching out. This reply sets out how we will work on your question.',
    'We will restate your goal and the main problem in our own words, so you can correct us.',
    'We will suggest a short list of options, with what each one needs from you.',
    'Once you confirm the goal, we will book a working session and prepare the first options.',
  ],
  bookkeeping: [
    'Thanks for your message. This reply sets out how we will handle your books.',
    'We will sort your bills, match them to your bank statement and list anything that needs your answer.',
    'Please send your bank statement and your bills for the period.',
    'Once the files arrive, we will prepare a short report for you to review.',
  ],
  research: [
    'Thanks for your message. This reply sets out how we will answer your question.',
    'We will agree on the question first, then gather sources and note where each finding comes from.',
    'We will look for the facts that answer your question and flag anything we cannot confirm.',
    'We will use public sources and any material you share, and list each one in the report.',
  ],
  content: [
    'Thanks for your message. This reply sets out how we will write your piece.',
    'We will write a first draft in the voice and length you ask for.',
    'We will add notes on any facts or claims you should confirm before it goes live.',
    'Once you share the topic and any links, we will start the draft for your review.',
  ],
  support: [
    'Thanks for reaching out. This reply sets out how we will help with your customer messages.',
    'We will draft replies to your customers in your tone, for you to approve before they go out.',
    'We will mark any message that needs you, such as refunds or complaints, and pass it to you.',
    'Once you share your common questions and policies, we will start drafting replies.',
  ],
  other: [
    'Thanks for your message. This reply sets out how we will handle your request.',
    'We will do the work described in your request and keep you informed at each step.',
    'We will list anything we need from you before we start.',
    'Once you confirm the details, we will start and send you a draft to review.',
  ],
});
export const TEMPLATE_TITLE = 'Reply outline';

/**
 * The template outline: no AI wrote it and it never read the client's message. One sentence per required section,
 * the plan's total in the second section when a receipt exists, and one question for the client.
 */
export function templateOutline(serviceType: TemplateServiceType, total: { receiptId: string; figureKey: string } | null): TemplateOutline {
  const headings = REQUIRED_SECTIONS[serviceType];
  const sentences = TEMPLATE_OUTLINES[serviceType];
  const sections = headings.map((heading, index) => {
    const parts: TemplatePart[] = [{ kind: 'text', text: sentences[index]! }];
    if (index === 1 && total) parts.push({ kind: 'text', text: TEMPLATE_PRICE_SENTENCE }, { kind: 'figure', receiptId: total.receiptId, figureKey: total.figureKey });
    return { heading, parts };
  });
  return { title: TEMPLATE_TITLE, sections, questionsForClient: [TEMPLATE_QUESTION] };
}
