import { describe, expect, it } from 'vitest';
import { fromSections, ownerLineOf, toPlainMessage, toSections } from '../../src/parts/draft-text';
import { REQUIRED_SECTIONS, TEMPLATE_OUTLINE_LINE, figureWords, templateOutline, type TemplateServiceType } from '../../../../platform/runtime/venture/delivery/template-outline';
import { FakeEngine } from '../../src/engine/fake';
import type { DeliveryLite, OrderLite } from '../../src/engine/types';

/**
 * A template draft as the engine stores it, with and without a price. The engine's renderDeliverable stays out of the UI's
 * typecheck, so this writes the same form, and platform/tests/venture-draft-words-c4.test.ts pins that the engine's equals it.
 */
function engineTemplate(type: TemplateServiceType, priced: boolean): string {
  const outline = templateOutline(type, priced ? { receiptId: 'R-1', figureKey: 'total' } : null);
  const blocks = [`# ${outline.title}`, ...outline.sections.map((section) => `## ${section.heading}\n${section.parts.map((part) => (part.kind === 'text' ? part.text : figureWords('Total', 'INR 3,000.00'))).join(' ')}`)];
  blocks.push(['Questions for you:', ...outline.questionsForClient.map((question) => `- ${question}`)].join('\n'));
  return `${TEMPLATE_OUTLINE_LINE}\n\n${blocks.join('\n\n')}`;
}

describe('toSections and fromSections', () => {
  for (const type of Object.keys(REQUIRED_SECTIONS) as TemplateServiceType[]) {
    for (const priced of [false, true]) {
      it(`keeps the engine's ${type} template byte for byte (${priced ? 'with' : 'without'} a price)`, () => {
        const text = engineTemplate(type, priced);
        const doc = toSections(text);
        expect(doc).not.toBeNull();
        expect(doc!.sections.map((section) => section.heading)).toEqual(REQUIRED_SECTIONS[type]);
        expect(fromSections(doc!)).toBe(text);
      });
    }
  }

  it('keeps the fake engine\'s template draft byte for byte', async () => {
    const engine = new FakeEngine();
    const orders = await engine.request('venture.order.list', {}) as OrderLite[];
    const open = orders.find((order) => order.status === 'open')!;
    const run = await engine.request('venture.delivery.run', { orderId: open.id }) as DeliveryLite;
    const listed = (await engine.request('venture.delivery.list', {}) as DeliveryLite[]).find((item) => item.id === run.id)!;
    const text = listed.renderedText;
    expect(text).toBeTruthy();
    expect(fromSections(toSections(text!)!)).toBe(text);
  });

  it('gives the title and each section as plain text, with list items as bullets and no marks', () => {
    const doc = toSections('# Reply\n\n## Summary\nThanks **a lot** for *writing*.\n\n## Next steps\n- Send the files\n- Book a call')!;
    expect(doc.title).toBe('Reply');
    expect(doc.sections).toEqual([
      { heading: 'Summary', text: 'Thanks a lot for writing.' },
      { heading: 'Next steps', text: '• Send the files\n• Book a call' },
    ]);
    expect(fromSections(doc)).toBe('# Reply\n\n## Summary\nThanks a lot for writing.\n\n## Next steps\n- Send the files\n- Book a call');
  });

  it('writes an owner\'s bullet back as the list the engine keeps', () => {
    const doc = toSections('## Next steps\nOne line')!;
    doc.sections[0]!.text = 'One line\n• And a list item';
    expect(fromSections(doc)).toBe('## Next steps\nOne line\n- And a list item');
  });

  it('keeps a blank line after a heading, and a section with no words', () => {
    for (const text of ['# T\n\n## A\n\nWords\n\nMore words\n\n## B', 'Plain words only.\n\nA second paragraph.', '## A\nWords\n\nQuestions for you:\n- One?']) {
      expect(fromSections(toSections(text)!)).toBe(text);
    }
  });

  it('answers null for anything it could not write back', () => {
    for (const text of [
      '## A\n| a | b |\n|---|---|\n| 1 | 2 |',
      '## A\nSee [the site](https://example.com) for more.',
      '## A\n![a picture](pic.png)',
      '## A\n- one\n  - nested',
      '## A\n### deeper',
      '## A\n```\ncode\n```',
      '> a quote',
      '## A\n* a star list',
      '## A\nWords\r\nMore',
      '## A\nWords\n',
    ]) expect(toSections(text)).toBeNull();
  });

  it('never takes a star between spaces for a mark', () => {
    expect(toSections('## A\n2 * 3 * 4 is a sum')!.sections[0]!.text).toBe('2 * 3 * 4 is a sum');
  });
});

describe('toPlainMessage', () => {
  it('has no Markdown marks and keeps the paragraphs', () => {
    const message = toPlainMessage('# Reply\n\n## Summary\nThanks **a lot**.\n\nA second paragraph.\n\n## Next steps\n- One\n- Two');
    expect(message).not.toMatch(/[#*]/);
    expect(message).toBe('Reply\n\nSummary\nThanks a lot.\n\nA second paragraph.\n\nNext steps\n• One\n• Two');
  });

  it('keeps a sign-off on its own line', () => {
    expect(toPlainMessage('We will start on Monday.\n\nRegards,\nAsha')).toBe('We will start on Monday.\n\nRegards,\nAsha');
    expect(toPlainMessage('We will start on Monday. Regards, Asha')).toBe('We will start on Monday.\n\nRegards, Asha');
    expect(toPlainMessage('We will start on Monday. Thanks for your patience')).toBe('We will start on Monday. Thanks for your patience');
  });

  it('leaves the engine\'s line for the owner out of the client\'s message', () => {
    const text = engineTemplate('other', false);
    expect(ownerLineOf(text)).toBe(TEMPLATE_OUTLINE_LINE);
    expect(toPlainMessage(text).startsWith(TEMPLATE_OUTLINE_LINE)).toBe(false);
    expect(toPlainMessage(text).startsWith('Reply outline')).toBe(true);
    expect(ownerLineOf('My own words.')).toBeNull();
  });
});
