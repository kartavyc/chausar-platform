import { CONVERSATION_SYNTHESIS_INSTRUCTIONS, conversationSynthesisSchema, validateConversationSynthesis,
  materializeConversationSynthesis } from './conversation-synthesis.ts';
import type { ConversationSynthesisCodec } from './conversation-synthesis-contract.ts';
import { check } from './contracts.ts';

// The product supports Hindi as well as English. Hindi written numbers and
// currency terms must use current receipt slots under the same prose rule.
const HINDI_NUMERIC_PROSE = /(?<![\p{L}\p{M}])(?:शून्य|एक|दो|तीन|चार|पाँच|पांच|छह|छः|सात|आठ|नौ|दस|ग्यारह|बारह|तेरह|चौदह|पंद्रह|पन्द्रह|सोलह|सत्रह|अठारह|उन्नीस|बीस|तीस|चालीस|पचास|साठ|सत्तर|अस्सी|नब्बे|सौ|हजार|हज़ार|लाख|करोड़|करोड|अरब|खरब|आधा|आधी|चौथाई|दोगुना|दुगुना|प्रतिशत|रुपया|रुपये|रुपयों|पैसा|पैसे|डॉलर|डालर)(?![\p{L}\p{M}])/u;

/** Adapt the isolated production writer to the host-owned transport boundary. */
export const installedConversationSynthesisCodec: ConversationSynthesisCodec = Object.freeze({
  instructions: CONVERSATION_SYNTHESIS_INSTRUCTIONS,
  schema: conversationSynthesisSchema,
  validate: (raw, summary) => {
    const output = validateConversationSynthesis(raw, summary);
    for (const paragraph of output.paragraphs) {
      const prose = paragraph.parts.map(part => part.kind === 'text' ? part.text : ' ').join('')
        .normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '');
      check(!HINDI_NUMERIC_PROSE.test(prose), 'INVALID_CONVERSATION_SYNTHESIS', 'Hindi numeric assertions and currency terms must come from current local receipt slots.');
    }
    return output;
  },
  materialize: (output, summary, currentText) => ({
    paragraphs: materializeConversationSynthesis(output, summary, currentText).paragraphs.map(paragraph => paragraph.text),
  }),
});
