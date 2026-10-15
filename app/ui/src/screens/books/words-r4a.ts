/**
 * Words for the round-4 Books additions (BK-02, BK-03, BK-05 and the links to other lanes' Books
 * places), in English and Hindi.
 */
import type { Language } from '../../app/presentation.ts';
import { words, type Catalogue } from '../../places/types.ts';

const en = {
  // BK-03 Which company?
  companiesTitle: 'Companies open in Tally now', listCompanies: 'List the companies open in Tally', listingCompanies: 'Asking Tally…',
  pickCompany: 'Which company?', booksFrom: 'books from {when}', noCompanies: 'Tally has no company open. Open the company in Tally, then ask again.',
  'companies.connectors-not-installed': 'Connecting systems is not installed in this build. Type the company name exactly as Tally shows it.',
  'companies.not-built': 'Listing the companies open in Tally is not built yet. Type the company name exactly as Tally shows it.',
  'companies.no-connection': 'Once one Tally company is connected on this computer, Chausar can list the others open in Tally. For the first, type the name exactly as Tally shows it.',
  currentOpen: 'This connection\'s company is open in Tally now.', currentNotOpen: 'This connection\'s company "{name}" is not open in Tally now. Open it in Tally before reading.',
  useCompany: 'Use this company',

  // BK-02 one source: where refused files are kept, the sign-in path, the data's age.
  keptTitle: 'Where refused files are kept',
  keptNot: 'Chausar does not keep a refused file, and never opens it from here. What was read and why it was refused stays below, in this source\'s history.',
  keptWhere: 'Your file stays where you keep it: {where}', keptYours: 'Your file stays where you brought it from.',
  noRefused: 'Nothing from this source was refused.', 'origin.file': 'file brought in', 'origin.connector': 'read',
  signInPathTitle: 'How sign-in works here',
  'path.browser': 'Pressing Sign in again opens the system\'s own sign-in page in your browser. You sign in there; Chausar never sees your password. Then you come back here.',
  'path.key': 'This system signs in with a key you create in the system itself. Enter it in Trust, credentials; it is never kept with the connection.',
  'path.none': 'This system needs no sign-in.', pathEndpoint: 'Chausar reads it on this computer at {endpoint}.',
  ageTitle: 'How old the data is', 'age.today': 'Read today ({when}).', 'age.yesterday': 'Read yesterday ({when}).', 'age.days': 'Read {n} days ago ({when}).',
  'age.never': 'Never read.', ageStale: 'Older than its freshness target.', ageSchedule: 'Read again every {every} hours; fresh for {target} hours.',

  // Other lanes' Books places.
  moreInBooks: 'More in Books', moreForMeanings: 'Dictionary edits and the answer key',

  // BK-05 answer in place, who answered, diff, reconcile.
  answerTitle: 'Answer the question here', 'q.ambiguous_field': 'Which heading holds "{field}"?', 'q.unknown_value': 'What does this value in "{field}" mean?',
  'q.date_format': 'How are dates written in "{field}"?', 'q.currency': 'Which currency is "{field}" in, where the row does not say?', 'q.sign_convention': 'Is "{field}" money coming in or going out?',
  sampleWas: 'The value as the source wrote it: {sample}', answerChoice: 'Your answer', answerSend: 'Answer', answering: 'Answering…',
  answerRule: 'The answer applies only to this source and this recipe version.',
  answeredRead: 'Answered. The source was read again with your answer.', answeredNext: 'The read asks one more question.',
  'again.bring-the-file-again': 'Answered. Bring the file again to read it with your answer.', 'again.read-again': 'Answered. Read the source again to use your answer.',
  answerNotBuilt: 'Answering here is not built yet. Read the source again after changing it.',
  'choice.leave-out': 'leave these rows out', 'choice.no-status': 'no status', 'choice.in': 'money in', 'choice.out': 'money out',
  answersTitle: 'Who answered', noAnswers: 'Nobody has answered a question for this recipe yet.', answeredBy: '{name}, {role}, on {when}: {field} → {choice}',
  removeAnswer: 'Remove the answer', removeAnswerConfirm: 'Remove this answer? Later reads will ask the question again. Facts already imported stay.',
  answerRemoved: 'The answer is removed.', reconciledBy: 'Reconciled by {by}, {role}, on {when}.',
  gstinTitle: 'Tax registration (GSTIN)',
  diffTitle: 'What changes between versions', showDiff: 'Show what changes', diffSame: 'Nothing changes.',
  diffOld: 'The version this read used was not kept, so the change cannot be shown.', diffNotBuilt: 'Comparing versions is not built yet.',
  diffFromTo: 'From {from} ({fromLabel}) to {to} ({toLabel})', 'label.read-with': 'read with', 'label.seed': 'as shipped', 'label.current': 'current', 'label.with-answers': 'with answers',
  'chg.added': 'added', 'chg.removed': 'removed', 'chg.changed': 'changed',
  'effect.columns': 'columns', 'effect.meaning': 'meaning', 'effect.dates': 'dates', 'effect.amount': 'amount', 'effect.check': 'check', 'effect.identity': 'identity', 'effect.other': 'other',
  'col.path': 'Where', 'col.change': 'Change', 'col.before': 'Before', 'col.after': 'After', 'col.effect': 'Affects',
  reconcileTitle: 'Reconcile with the system\'s own report', reconcileTotal: 'Report total in rupees (optional)', reconcileSend: 'Reconcile', reconcileNotBuilt: 'Reconciling is not built yet.',
  'rec.matches': 'They match.', 'rec.differs': 'They differ.', 'rec.rows-changed': 'Some imported rows were since deleted or replaced.', 'rec.not-imported': 'This read was not imported.', 'rec.no-source-total': 'The system gave no total to compare with.',
  recRows: '{live} live rows, {changed} changed', recNone: 'no figure',
  recHistory: 'Reconciliations',

  // Refusals in plain words.
  'say.RECIPE_ANSWER_NOT_BUILT': 'Answering here is not built yet. Read the source again after changing it.',
  'say.RECIPE_RECONCILE_NOT_BUILT': 'Reconciling is not built yet.',
  'say.RECIPE_QUESTION_NONE': 'This read asked no question.', 'say.RECIPE_ANSWER_INVALID': 'Choose one of the offered answers.',
  'say.RECIPE_ANSWER_STALE': 'The recipe changed since this read. Read the source again.', 'say.ANSWER_LIMIT': 'This source has too many answers. Remove one first.',
  'say.ANSWER_NOT_FOUND': 'This answer was not found.', 'say.INVALID_SOURCE_TOTALS': 'Enter the report total in rupees and paise.',
  'say.TALLY_CONNECTION_REQUIRED': 'Choose a Tally connection on this computer.', 'say.READ_NOT_AVAILABLE': 'Tally did not answer. Check that Tally is open with its XML interface on.',
  'say.ENVELOPE_NOT_FOUND': 'This read is no longer available.',
};
type Key = keyof typeof en;
const hi: Readonly<Record<Key, string>> = {
  companiesTitle: 'अभी Tally में खुली कंपनियाँ', listCompanies: 'Tally में खुली कंपनियाँ दिखाएँ', listingCompanies: 'Tally से पूछ रहे हैं…',
  pickCompany: 'कौन सी कंपनी?', booksFrom: 'खाते {when} से', noCompanies: 'Tally में कोई कंपनी खुली नहीं है। Tally में कंपनी खोलें, फिर दोबारा पूछें।',
  'companies.connectors-not-installed': 'इस बिल्ड में सिस्टम जोड़ना शामिल नहीं है। कंपनी का नाम ठीक वैसा ही लिखें जैसा Tally में दिखता है।',
  'companies.not-built': 'Tally में खुली कंपनियों की सूची अभी बनी नहीं है। कंपनी का नाम ठीक वैसा ही लिखें जैसा Tally में दिखता है।',
  'companies.no-connection': 'इस कंप्यूटर पर एक Tally कंपनी जुड़ते ही Chausar Tally में खुली बाकी कंपनियाँ दिखा सकता है। पहली कंपनी के लिए नाम ठीक वैसा ही लिखें जैसा Tally में दिखता है।',
  currentOpen: 'इस कनेक्शन की कंपनी अभी Tally में खुली है।', currentNotOpen: 'इस कनेक्शन की कंपनी "{name}" अभी Tally में खुली नहीं है। पढ़ने से पहले इसे Tally में खोलें।',
  useCompany: 'यह कंपनी लें',

  keptTitle: 'अस्वीकार हुई फ़ाइलें कहाँ रहती हैं',
  keptNot: 'Chausar अस्वीकार हुई फ़ाइल अपने पास नहीं रखता, और यहाँ से उसे कभी नहीं खोलता। क्या पढ़ा गया और क्यों अस्वीकार हुआ, यह नीचे इस स्रोत के इतिहास में रहता है।',
  keptWhere: 'आपकी फ़ाइल वहीं रहती है जहाँ आप उसे रखते हैं: {where}', keptYours: 'आपकी फ़ाइल वहीं रहती है जहाँ से आप उसे लाए थे।',
  noRefused: 'इस स्रोत से कुछ भी अस्वीकार नहीं हुआ।', 'origin.file': 'लाई गई फ़ाइल', 'origin.connector': 'पढ़ाई',
  signInPathTitle: 'यहाँ साइन-इन कैसे होता है',
  'path.browser': '"फिर से साइन इन करें" दबाने पर आपके ब्राउज़र में उस सिस्टम का अपना साइन-इन पेज खुलता है। आप वहीं साइन इन करते हैं; Chausar आपका पासवर्ड कभी नहीं देखता। फिर आप यहाँ लौट आते हैं।',
  'path.key': 'यह सिस्टम एक कुंजी से साइन इन करता है, जो आप उसी सिस्टम में बनाते हैं। इसे ट्रस्ट, क्रेडेंशियल में डालें; यह कनेक्शन के साथ कभी नहीं रखी जाती।',
  'path.none': 'इस सिस्टम में साइन-इन की ज़रूरत नहीं है।', pathEndpoint: 'Chausar इसे इसी कंप्यूटर पर {endpoint} पर पढ़ता है।',
  ageTitle: 'डेटा कितना पुराना है', 'age.today': 'आज पढ़ा गया ({when})।', 'age.yesterday': 'कल पढ़ा गया ({when})।', 'age.days': '{n} दिन पहले पढ़ा गया ({when})।',
  'age.never': 'कभी नहीं पढ़ा गया।', ageStale: 'अपनी ताज़गी की सीमा से पुराना।', ageSchedule: 'हर {every} घंटे में फिर पढ़ा जाता है; {target} घंटे तक ताज़ा माना जाता है।',

  moreInBooks: 'खातों में और', moreForMeanings: 'शब्दकोश के बदलाव और उत्तर-कुंजी',

  answerTitle: 'सवाल का जवाब यहीं दें', 'q.ambiguous_field': '"{field}" किस शीर्षक में है?', 'q.unknown_value': '"{field}" में इस मान का क्या मतलब है?',
  'q.date_format': '"{field}" में तारीख़ें कैसे लिखी हैं?', 'q.currency': 'जहाँ पंक्ति में मुद्रा नहीं लिखी, वहाँ "{field}" किस मुद्रा में है?', 'q.sign_convention': '"{field}" आने वाला पैसा है या जाने वाला?',
  sampleWas: 'स्रोत में लिखा मान: {sample}', answerChoice: 'आपका जवाब', answerSend: 'जवाब दें', answering: 'जवाब भेज रहे हैं…',
  answerRule: 'यह जवाब सिर्फ़ इसी स्रोत और रेसिपी के इसी संस्करण पर लागू होता है।',
  answeredRead: 'जवाब दिया गया। आपके जवाब के साथ स्रोत फिर से पढ़ा गया।', answeredNext: 'इस पढ़ाई में एक और सवाल है।',
  'again.bring-the-file-again': 'जवाब दिया गया। आपके जवाब के साथ पढ़ने के लिए फ़ाइल फिर से लाएँ।', 'again.read-again': 'जवाब दिया गया। अपने जवाब के इस्तेमाल के लिए स्रोत फिर से पढ़ें।',
  answerNotBuilt: 'यहाँ जवाब देना अभी बना नहीं है। बदलाव करके स्रोत फिर से पढ़ें।',
  'choice.leave-out': 'ये पंक्तियाँ छोड़ दें', 'choice.no-status': 'कोई स्थिति नहीं', 'choice.in': 'आने वाला पैसा', 'choice.out': 'जाने वाला पैसा',
  answersTitle: 'किसने जवाब दिया', noAnswers: 'इस रेसिपी के किसी सवाल का अभी तक किसी ने जवाब नहीं दिया।', answeredBy: '{name}, {role}, {when} को: {field} → {choice}',
  removeAnswer: 'जवाब हटाएँ', removeAnswerConfirm: 'यह जवाब हटाएँ? आगे की पढ़ाई में सवाल फिर पूछा जाएगा। पहले से आयात हुए तथ्य बने रहेंगे।',
  answerRemoved: 'जवाब हटा दिया गया।', reconciledBy: '{by}, {role} ने {when} को मिलान किया।',
  gstinTitle: 'कर पंजीकरण (GSTIN)',
  diffTitle: 'संस्करणों के बीच क्या बदलता है', showDiff: 'बदलाव दिखाएँ', diffSame: 'कुछ नहीं बदलता।',
  diffOld: 'इस पढ़ाई में इस्तेमाल हुआ संस्करण रखा नहीं गया, इसलिए बदलाव दिखाया नहीं जा सकता।', diffNotBuilt: 'संस्करणों की तुलना अभी बनी नहीं है।',
  diffFromTo: '{from} ({fromLabel}) से {to} ({toLabel}) तक', 'label.read-with': 'जिससे पढ़ा गया', 'label.seed': 'जैसा आया था', 'label.current': 'मौजूदा', 'label.with-answers': 'जवाबों के साथ',
  'chg.added': 'जोड़ा गया', 'chg.removed': 'हटाया गया', 'chg.changed': 'बदला गया',
  'effect.columns': 'कॉलम', 'effect.meaning': 'मतलब', 'effect.dates': 'तारीख़ें', 'effect.amount': 'रक़म', 'effect.check': 'जाँच', 'effect.identity': 'पहचान', 'effect.other': 'अन्य',
  'col.path': 'कहाँ', 'col.change': 'बदलाव', 'col.before': 'पहले', 'col.after': 'बाद में', 'col.effect': 'असर',
  reconcileTitle: 'सिस्टम की अपनी रिपोर्ट से मिलान करें', reconcileTotal: 'रिपोर्ट का कुल रुपयों में (ज़रूरी नहीं)', reconcileSend: 'मिलान करें', reconcileNotBuilt: 'मिलान करना अभी बना नहीं है।',
  'rec.matches': 'दोनों मेल खाते हैं।', 'rec.differs': 'दोनों में अंतर है।', 'rec.rows-changed': 'आयात हुई कुछ पंक्तियाँ बाद में हटाई या बदली गईं।', 'rec.not-imported': 'यह पढ़ाई आयात नहीं हुई।', 'rec.no-source-total': 'सिस्टम ने तुलना के लिए कोई कुल नहीं दिया।',
  recRows: '{live} चालू पंक्तियाँ, {changed} बदलीं', recNone: 'कोई आँकड़ा नहीं',
  recHistory: 'मिलान',

  'say.RECIPE_ANSWER_NOT_BUILT': 'यहाँ जवाब देना अभी बना नहीं है। बदलाव करके स्रोत फिर से पढ़ें।',
  'say.RECIPE_RECONCILE_NOT_BUILT': 'मिलान करना अभी बना नहीं है।',
  'say.RECIPE_QUESTION_NONE': 'इस पढ़ाई में कोई सवाल नहीं पूछा गया।', 'say.RECIPE_ANSWER_INVALID': 'दिए गए जवाबों में से एक चुनें।',
  'say.RECIPE_ANSWER_STALE': 'इस पढ़ाई के बाद रेसिपी बदल गई। स्रोत फिर से पढ़ें।', 'say.ANSWER_LIMIT': 'इस स्रोत के बहुत सारे जवाब हैं। पहले एक हटाएँ।',
  'say.ANSWER_NOT_FOUND': 'यह जवाब नहीं मिला।', 'say.INVALID_SOURCE_TOTALS': 'रिपोर्ट का कुल रुपये और पैसे में लिखें।',
  'say.TALLY_CONNECTION_REQUIRED': 'इस कंप्यूटर पर एक Tally कनेक्शन चुनें।', 'say.READ_NOT_AVAILABLE': 'Tally ने जवाब नहीं दिया। देखें कि Tally खुला है और उसका XML इंटरफ़ेस चालू है।',
  'say.ENVELOPE_NOT_FOUND': 'यह पढ़ाई अब उपलब्ध नहीं है।',
};

export const BOOKS_R4A: Catalogue<Key> = { en, hi };
export type R4 = Readonly<Record<Key, string>>;
export type R4Key = Key;
export function useR4(language: Language): R4 { return words(BOOKS_R4A, language); }
export function sayR4(w: R4, code: string | null): string | null {
  if (code === null) return null;
  const key = `say.${code}` as Key;
  return Object.hasOwn(w, key) ? w[key] : null;
}
