/**
 * Words added by the Books design audit (BK-01..BK-20), in English and Hindi: match relations
 * and evidence, malformed tax ids, cancelled approvals after an undo, a source order tried on
 * a copy, rebuilds from the start, proposed memory lines and account reasons.
 */
import type { Language } from '../../app/presentation.ts';
import { words, type Catalogue } from '../../places/types.ts';

const en = {
  // BK-13
  'rel.same-tax-registration': 'Same GSTIN: the same customer.',
  'rel.same-owner-separate-registrations': 'Same PAN in two GSTINs: the same owner, kept as two branches.',
  'rel.cannot-match-tax-identities': 'Two different PANs: these cannot be the same customer.',
  'rel.abstain': 'Not enough to say. A hint never joins two records on its own.',
  'ev.same-gstin': 'same GSTIN', 'ev.same-pan': 'same PAN', 'ev.different-pan': 'different PANs', 'ev.same-phone': 'same phone (a hint)',
  'ev.same-email': 'same mail (a hint)', 'ev.same-name': 'same name (a hint)',
  badId: 'This {kind} has {n} characters; it needs {expected}. It is not used as evidence.',
  badIdFormat: 'This {kind} does not pass its format check. It is not used as evidence.',
  undoCancelled: 'Undone. {n} approvals that depended on the join were cancelled.',
  undoNothing: 'Undone. No approval depended on the join.',
  undoNotCancelled: '{n} approvals could not be cancelled here. Drop them in Work: {ids}.',
  // BK-14 / BK-09
  tryOrder: 'Try {source} first on a copy',
  together: 'Taken together from {source}: every field of this claim, such as the amount with its currency and date, comes from this one source.',
  orderChange: 'For {kind}: {order}',
  noOrder: 'Open a source order from Sources that disagree.',
  // BK-05 / BK-09
  recipeProposals: 'Changes to try on a copy',
  noRecipeProposals: 'No proposed change for this recipe’s sources. Map a field first.',
  // BK-12
  askAbout: 'Ask about this record',
  askAboutNotBuilt: 'Not built yet: asking about this record from the ask line (the ask line cannot carry a record yet).',
  // BK-16
  rebuiltFromStart: 'Each rebuild is checked against a full rebuild from the start, on a copy that keeps nothing worked out before.',
  // BK-17
  waiting: 'Waiting for your yes', waitingNote: 'Lines proposed from the ask line. Nothing changes until the owner or a cofounder confirms.',
  waitingOther: 'The owner or a cofounder confirms these lines.',
  // BK-11
  'because.group': 'Its parent group is {group}.', 'because.groupUnder': 'Its parent group is {group}, under {under}.',
  'because.group-unsortable': 'Its parent group {group} is not one Chausar can sort.',
  'because.no-group': 'No parent group was read, so Chausar asks instead of guessing.',
  'because.side.debit': 'A debit account in the vouchers read.', 'because.side.credit': 'A credit account in the vouchers read.',
  'because.recipe': 'The import recipe treats it as {cls}.', 'because.learned': 'Proposed from earlier decisions in this workspace.',
  'because.said-no': 'You said no to the proposed class.', 'because.accountant': 'Corrected by an accountant.',
  namesStay: 'Customer and supplier accounts are sorted by their group only; their names never leave this computer.',
  // BK-01
  'src.paused': 'paused', 'src.failedRead': 'last read failed',
} as const;
type Key = keyof typeof en;

const hi: Readonly<Record<Key, string>> = {
  'rel.same-tax-registration': 'एक ही GSTIN: एक ही ग्राहक।',
  'rel.same-owner-separate-registrations': 'दो GSTIN में एक ही PAN: एक ही मालिक, दो शाखाओं के रूप में रखा गया।',
  'rel.cannot-match-tax-identities': 'दो अलग PAN: ये एक ही ग्राहक नहीं हो सकते।',
  'rel.abstain': 'कहने के लिए काफ़ी नहीं। कोई संकेत अपने आप दो रिकॉर्ड नहीं जोड़ता।',
  'ev.same-gstin': 'एक ही GSTIN', 'ev.same-pan': 'एक ही PAN', 'ev.different-pan': 'अलग-अलग PAN', 'ev.same-phone': 'एक ही फ़ोन (संकेत)',
  'ev.same-email': 'एक ही मेल (संकेत)', 'ev.same-name': 'एक ही नाम (संकेत)',
  badId: 'इस {kind} में {n} अक्षर हैं; {expected} चाहिए। इसे सबूत नहीं माना गया।',
  badIdFormat: 'यह {kind} अपनी जाँच में सही नहीं है। इसे सबूत नहीं माना गया।',
  undoCancelled: 'वापस लिया गया। जोड़ पर टिकी {n} मंज़ूरियाँ रद्द हुईं।',
  undoNothing: 'वापस लिया गया। कोई मंज़ूरी जोड़ पर टिकी नहीं थी।',
  undoNotCancelled: '{n} मंज़ूरियाँ यहाँ रद्द नहीं हो सकीं। उन्हें काम में हटाएँ: {ids}।',
  tryOrder: '{source} को पहले रखकर नक़ल पर आज़माएँ',
  together: '{source} से एक साथ लिया गया: इस दावे का हर क्षेत्र, जैसे रक़म अपनी मुद्रा और तारीख़ के साथ, इसी एक स्रोत से आता है।',
  orderChange: '{kind} के लिए: {order}',
  noOrder: 'स्रोतों का क्रम "स्रोत जो मेल नहीं खाते" से खोलें।',
  recipeProposals: 'नक़ल पर आज़माने के बदलाव',
  noRecipeProposals: 'इस रेसिपी के स्रोतों के लिए कोई प्रस्तावित बदलाव नहीं। पहले कोई क्षेत्र जोड़ें।',
  askAbout: 'इस रिकॉर्ड के बारे में पूछें',
  askAboutNotBuilt: 'अभी बना नहीं: पूछने की पंक्ति से इस रिकॉर्ड के बारे में पूछना (पूछने की पंक्ति अभी रिकॉर्ड नहीं ले जा सकती)।',
  rebuiltFromStart: 'हर दोबारा बनाया उत्तर शुरू से पूरे दोबारा बनाने से मिलाया जाता है, ऐसी नक़ल पर जो पहले का कुछ भी नहीं रखती।',
  waiting: 'आपकी हाँ का इंतज़ार', waitingNote: 'पूछने की पंक्ति से प्रस्तावित पंक्तियाँ। मालिक या सह-संस्थापक की पुष्टि तक कुछ नहीं बदलता।',
  waitingOther: 'मालिक या सह-संस्थापक इन पंक्तियों की पुष्टि करते हैं।',
  'because.group': 'इसका मूल समूह {group} है।', 'because.groupUnder': 'इसका मूल समूह {group} है, {under} के अंदर।',
  'because.group-unsortable': 'इसका मूल समूह {group} ऐसा नहीं जिसे Chausar छाँट सके।',
  'because.no-group': 'कोई मूल समूह नहीं पढ़ा गया, इसलिए Chausar अंदाज़ा नहीं लगाता, पूछता है।',
  'because.side.debit': 'पढ़े गए वाउचरों में नामे खाता।', 'because.side.credit': 'पढ़े गए वाउचरों में जमा खाता।',
  'because.recipe': 'आयात की रेसिपी इसे {cls} मानता है।', 'because.learned': 'इस कार्यक्षेत्र के पहले के फ़ैसलों से प्रस्तावित।',
  'because.said-no': 'आपने प्रस्तावित वर्ग को ना कहा।', 'because.accountant': 'लेखाकार ने सुधारा।',
  namesStay: 'ग्राहक और आपूर्तिकर्ता खाते सिर्फ़ उनके समूह से छाँटे जाते हैं; उनके नाम इस कंप्यूटर से बाहर नहीं जाते।',
  'src.paused': 'रुका हुआ', 'src.failedRead': 'पिछला पढ़ना विफल',
};

export const BOOKS_AUDIT: Catalogue<Key> = { en, hi };
export type AuditKey = Key;
export type AuditWords = Readonly<Record<Key, string>>;
export function useAuditWords(language: Language): AuditWords { return words(BOOKS_AUDIT, language); }
