/**
 * Hindi companions for the four exact disclosure warnings emitted by the pinned
 * Engine. This is presentation copy, never a replacement for the Engine warning.
 *
 * Source: platform/runtime/gateway.ts at dbc1435. Match both the warning's family
 * and every character; a new or altered warning must remain verbatim without a
 * claimed translation until its meaning has been reviewed. Do not trim, normalise,
 * infer from a prefix, or translate questions, retained exchanges or payloads here.
 */
export type ModelDisclosureFamily = 'question' | 'definition' | 'continuation' | 'synthesis';

const KNOWN_WARNINGS: Readonly<Record<ModelDisclosureFamily, string>> = {
  question: 'The complete question is included separately from evidence Shape. Review it for private names, amounts and instructions before approving.',
  definition: 'Published calculation labels, definitions and parameter meanings are included separately from evidence Shape. Review definition text for private names, amounts and instructions before approving this exact payload.',
  continuation: 'The complete retained original objective, clarification and any prior exchanges are included separately from evidence Shape, with your exact current reply. Review all prior text for private names, amounts and instructions before approving this exact payload.',
  synthesis: 'The exact retained original objective, admitted claim text and derived tool summary are included separately from evidence Shape. Review private names, business details and instructions before approving this separate synthesis transfer once.',
};

export function knownModelDisclosureTranslationKey(family: ModelDisclosureFamily, warning: string): string | undefined {
  return warning === KNOWN_WARNINGS[family] ? `ASK.consent.disclosure.${family}` : undefined;
}
