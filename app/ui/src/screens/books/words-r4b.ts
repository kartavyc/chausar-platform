/**
 * Words added in round 4 of the Books screens, in English and Hindi: publish strategies of a
 * copy (BK-09), reminders and notes on a record's time line and asking about it (BK-12), the
 * demo clock on History (BK-15), the not-counted count from receipts (BK-19), the core deletion
 * (BK-20) and the outline of every page of a bill (WK-13/BK-18).
 */
import type { Language } from '../../app/presentation.ts';
import { words, type Catalogue } from '../../places/types.ts';

const en = {
  // BK-09
  'strat.title': 'How to publish',
  'strat.name.prospective': 'From now on',
  'strat.name.retrospective': 'From now on, and work out saved answers again',
  'strat.about.prospective': 'Future answers use the change. Saved answers are marked out of date; their receipts stay exactly as they were.',
  'strat.about.retrospective': 'Future answers use the change, and each saved answer is worked out again as a new receipt for its own date. The original receipts stay.',
  'strat.impact': '{n} saved answers change · {r} worked out again · {a} jobs or actions still open',
  'strat.kept': '{n} earlier receipts are kept unchanged.',
  'strat.refused': 'Not possible this way ({code}).',
  'strat.openWork': 'Settle the open jobs and actions first. Publishing waits until none is open.',
  'strat.publish': 'Publish: {name}',
  'strat.published': 'Published: {name}.',
  // BK-12
  'tl.title': 'Reminders and notes',
  'tl.type.reminder': 'Reminder prepared', 'tl.type.action': 'Action', 'tl.type.reminder-sent': 'Reminder sent', 'tl.type.payment-noted': 'Payment noted', 'tl.type.note': 'Note',
  'tl.source.actions': 'Actions record', 'tl.source.writeback-journal': 'Write-back follow-up journal', 'tl.source.memory': 'What Chausar remembers',
  'tl.col.when': 'When', 'tl.col.type': 'What happened', 'tl.col.what': 'Detail', 'tl.col.state': 'State', 'tl.col.source': 'From',
  'tl.empty': 'No reminder or note names this record.',
  'tl.journalNotBuilt': 'Not built yet: reminders sent through a connected system (its follow-up journal).',
  'tl.omitted': '{n} older entries are not shown.',
  'tl.notBuilt': 'Not built yet: reminders and notes on the time line.',
  'ask.about': 'Ask about this record',
  'ask.set': 'The ask line is now about {name}.',
  // BK-15
  'clock.set': 'Demo clock: {date}. This is a demo workspace; its clock is moved by hand.',
  'clock.notSet': 'Demo workspace: the demo clock is not set yet.',
  'clock.notBuilt': 'Not built yet: the demo clock state.',
  // BK-19
  'rates.fromReceipts': 'Not counted, as receipts say',
  'rates.receiptLine': '{operation} on {when}: {rows} rows in {currency} not counted',
  'rates.receiptsNone': 'No receipt has rows left out for want of a rate.',
  'rates.receiptsWait': 'Receipts do not carry this count yet. The count above is over the books.',
  // BK-20
  'del.core': 'Facts, receipts, answers, actions and conversations are deleted through the core too, and each is counted again after.',
  'del.coreEveryRow': 'The core deletes every row about this customer, including rows you cannot see here.',
  'del.coreNeedsFull': 'Deleting through the core removes every row about this customer, including rows you cannot see. Only a person with every branch can do it.',
  // Bill photo
  'bill.pageOf': 'Page {n} of {of}',
  'bill.outlineNote': 'Each field is outlined where its words were read. Faint boxes are the other words on the page.',
  'bill.omitted': '{n} more words on this page are not outlined.',
};
type Key = keyof typeof en;

const hi: Readonly<Record<Key, string>> = {
  'strat.title': 'कैसे प्रकाशित करें',
  'strat.name.prospective': 'अब से आगे',
  'strat.name.retrospective': 'अब से आगे, और सहेजे जवाब फिर से निकालें',
  'strat.about.prospective': 'आगे के जवाब बदलाव से निकलेंगे। सहेजे जवाब पुराने चिह्नित होंगे; उनकी रसीदें जैसी थीं वैसी ही रहेंगी।',
  'strat.about.retrospective': 'आगे के जवाब बदलाव से निकलेंगे, और हर सहेजा जवाब अपनी ही तारीख़ के लिए नई रसीद के साथ फिर से निकाला जाएगा। मूल रसीदें बनी रहेंगी।',
  'strat.impact': '{n} सहेजे जवाब बदलेंगे · {r} फिर से निकाले जाएँगे · {a} काम या कार्रवाइयाँ अभी खुली हैं',
  'strat.kept': '{n} पुरानी रसीदें बिना बदले रखी जाएँगी।',
  'strat.refused': 'इस तरह संभव नहीं ({code})।',
  'strat.openWork': 'पहले खुले काम और कार्रवाइयाँ निपटाएँ। जब तक कोई खुला है, प्रकाशन रुका रहेगा।',
  'strat.publish': 'प्रकाशित करें: {name}',
  'strat.published': 'प्रकाशित हुआ: {name}।',
  'tl.title': 'याद दिलाना और नोट',
  'tl.type.reminder': 'याद दिलाना तैयार', 'tl.type.action': 'कार्रवाई', 'tl.type.reminder-sent': 'याद दिलाना भेजा', 'tl.type.payment-noted': 'भुगतान दर्ज', 'tl.type.note': 'नोट',
  'tl.source.actions': 'कार्रवाइयों का रिकॉर्ड', 'tl.source.writeback-journal': 'वापस-लिखने का फ़ॉलो-अप रजिस्टर', 'tl.source.memory': 'चौसर को क्या याद है',
  'tl.col.when': 'कब', 'tl.col.type': 'क्या हुआ', 'tl.col.what': 'ब्योरा', 'tl.col.state': 'स्थिति', 'tl.col.source': 'कहाँ से',
  'tl.empty': 'कोई याद दिलाना या नोट इस रिकॉर्ड का नाम नहीं लेता।',
  'tl.journalNotBuilt': 'अभी बना नहीं: जुड़े सिस्टम से भेजे गए याद दिलाने (उसका फ़ॉलो-अप रजिस्टर)।',
  'tl.omitted': '{n} पुरानी प्रविष्टियाँ नहीं दिखाई गईं।',
  'tl.notBuilt': 'अभी बना नहीं: समय-रेखा पर याद दिलाना और नोट।',
  'ask.about': 'इस रिकॉर्ड के बारे में पूछें',
  'ask.set': 'पूछने की पंक्ति अब {name} के बारे में है।',
  'clock.set': 'डेमो घड़ी: {date}। यह डेमो कार्यक्षेत्र है; इसकी घड़ी हाथ से आगे बढ़ाई जाती है।',
  'clock.notSet': 'डेमो कार्यक्षेत्र: डेमो घड़ी अभी तय नहीं हुई।',
  'clock.notBuilt': 'अभी बना नहीं: डेमो घड़ी की स्थिति।',
  'rates.fromReceipts': 'नहीं गिने गए, रसीदों के अनुसार',
  'rates.receiptLine': '{when} का {operation}: {currency} की {rows} पंक्तियाँ नहीं गिनी गईं',
  'rates.receiptsNone': 'किसी रसीद में दर न होने से छूटी पंक्तियाँ नहीं हैं।',
  'rates.receiptsWait': 'रसीदों में यह गिनती अभी नहीं आती। ऊपर की गिनती बहीखातों पर है।',
  'del.core': 'तथ्य, रसीदें, जवाब, कार्रवाइयाँ और बातचीत भी कोर के ज़रिए मिटाई जाती हैं, और हर एक को बाद में फिर गिना जाता है।',
  'del.coreEveryRow': 'कोर इस ग्राहक की हर पंक्ति मिटाता है, उन पंक्तियों समेत जो आपको यहाँ नहीं दिखतीं।',
  'del.coreNeedsFull': 'कोर के ज़रिए मिटाने से इस ग्राहक की हर पंक्ति मिटती है, उन पंक्तियों समेत जो आपको नहीं दिखतीं। यह सिर्फ़ हर शाखा वाला व्यक्ति कर सकता है।',
  'bill.pageOf': 'पन्ना {n}, कुल {of}',
  'bill.outlineNote': 'हर खाने के चारों ओर वहाँ घेरा है जहाँ उसके शब्द पढ़े गए। हल्के घेरे पन्ने के बाकी शब्द हैं।',
  'bill.omitted': 'इस पन्ने के {n} और शब्दों पर घेरा नहीं है।',
};

export const BOOKS_R4B: Catalogue<Key> = { en, hi };
export type R4bKey = Key;
export type R4bWords = Readonly<Record<Key, string>>;
export function useR4bWords(language: Language): R4bWords { return words(BOOKS_R4B, language); }
