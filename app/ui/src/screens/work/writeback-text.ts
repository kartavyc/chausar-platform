/**
 * Words the write-back parts of the Work screens draw, in English and Hindi. Kept apart from
 * text.ts so the two can change independently.
 */
import type { Language } from '../../app/presentation.ts';
import { words } from '../../places/types.ts';

const EN = {
  'wb.system': 'System', 'wb.connection': 'Connection', 'wb.waitsBecause': 'Why it waits', 'wb.removed': '{label} (removed)',
  'wb.env.practice': 'practice', 'wb.env.sandbox': 'sandbox', 'wb.env.live': 'live',
  'wb.notice.expired': 'This expired. Nothing was sent.',
  'wb.notice.prepared-again': 'The target changed after you approved. It was prepared again; nothing was sent.',
  'wb.notice.already-done': 'This was already in the system. Nothing was sent again.',
  'wb.notice.looked-first': 'This may already have gone out. Chausar looked first and sent nothing again.',
  'wb.notice.cancelled-evidence': 'What this was based on changed. Nothing was sent. Prepare it again.',
  'wb.practice': 'Practise it first', 'wb.settled.person': 'Settled by a person’s word.', 'wb.settled.system': 'Read back from the system.',
  'pass.title': 'Approve with your passphrase', 'pass.field': 'Passphrase', 'pass.note': 'Your passphrase is checked once and never kept.',
  'pass.go': 'Approve', 'pass.empty': 'Type your passphrase first.',
  'file.saving': 'Saving the file and the checklist…', 'file.saved': 'Saved to this computer:', 'file.bytes': '{n} bytes',
  'rem.title': 'Reminder to the customer', 'rem.link': 'Invoice link', 'rem.noLink': 'This reminder has no invoice link.',
  'rem.due': 'Due on this invoice', 'rem.agreement': 'Agreement to reminders',
  'rem.ch.email': 'Mail', 'rem.ch.whatsapp': 'WhatsApp', 'rem.ans.yes': 'yes', 'rem.ans.no': 'no', 'rem.ans.not-asked': 'not asked',
  'rem.from': 'from {source}, {date}', 'rem.fromDate': 'on {date}',
  'rem.stopped': 'Stopped by the customer on {date}.',
  'rem.capReached': '{n} reminders were prepared today. The rest wait until tomorrow.',
  'rem.customerCap': 'This customer already has a reminder today.',
  'rem.caps': 'Limits: {perCustomer} per customer a day, {perDay} a day in all. Prepared that day: {n}.',
  'rem.notes': 'For you only: payment rules', 'rem.source': 'Source: {source}', 'rem.checked': 'Checked on {date}', 'rem.notLegal': 'Not legal advice.',
  'rem.blocked': 'Blocked at prepare: {reason}', 'rem.record': 'Record the agreement on the customer’s page when the customer gives it.',
  'cando.score': 'Write score', 'e.qualification': 'Write-back test', 'e.score': 'Write score', 'e.waitsBecause': 'Why it waits',
  'e.planned': 'Planned status', 'e.reference': 'Business reference written into the system', 'e.lifetime': 'How long a yes lasts',
  'e.reviewed': 'Reviewed on', 'e.undo': 'How to undo it', 'e.grants': 'Connections allowed to write', 'e.grantsNone': 'No connection may write this yet.',
  'q.synthetic-tested': 'tested on practice systems', 'q.sandbox-verified': 'tested on a sandbox account', 'q.live-verified': 'tested live', 'q.unqualified': 'not tested yet',
  'g.write': '{label} ({env}): may write', 'g.read': '{label} ({env}): may read only',
  'practice.outcome.would-be-done': 'It would be done and read back.',
  'practice.outcome.would-be-not-sure': 'The reply would be lost; Chausar would not be sure and would look before trying again.',
  'practice.outcome.would-not-happen': 'It would not happen.',
  'practice.outcome.already-done': 'It is already in the system. Nothing would be sent.',
  'practice.outcome.prepare-only': 'Prepared only. Nothing would be sent.',
  'practice.outcome.refused': 'The system would refuse it.',
  'practice.requests': '{n} requests would leave this computer.',
} as const;
export type WbKey = keyof typeof EN;

const HI: Readonly<Record<WbKey, string>> = {
  'wb.system': 'सिस्टम', 'wb.connection': 'कनेक्शन', 'wb.waitsBecause': 'यह क्यों रुका है', 'wb.removed': '{label} (हटाया गया)',
  'wb.env.practice': 'अभ्यास', 'wb.env.sandbox': 'सैंडबॉक्स', 'wb.env.live': 'असली',
  'wb.notice.expired': 'इसका समय बीत गया। कुछ नहीं भेजा गया।',
  'wb.notice.prepared-again': 'आपकी मंज़ूरी के बाद लक्ष्य बदल गया। इसे फिर से तैयार किया गया; कुछ नहीं भेजा गया।',
  'wb.notice.already-done': 'यह पहले से सिस्टम में था। दोबारा कुछ नहीं भेजा गया।',
  'wb.notice.looked-first': 'हो सकता है यह पहले ही चला गया हो। Chausar ने पहले देखा और दोबारा कुछ नहीं भेजा।',
  'wb.notice.cancelled-evidence': 'जिस पर यह आधारित था वह बदल गया। कुछ नहीं भेजा गया। इसे फिर से तैयार करें।',
  'wb.practice': 'पहले अभ्यास करें', 'wb.settled.person': 'किसी व्यक्ति के कहने पर तय हुआ।', 'wb.settled.system': 'सिस्टम से वापस पढ़ा गया।',
  'pass.title': 'अपने पासफ़्रेज़ से मंज़ूर करें', 'pass.field': 'पासफ़्रेज़', 'pass.note': 'आपका पासफ़्रेज़ एक बार जाँचा जाता है और कभी रखा नहीं जाता।',
  'pass.go': 'मंज़ूर करें', 'pass.empty': 'पहले अपना पासफ़्रेज़ लिखें।',
  'file.saving': 'फ़ाइल और चेकलिस्ट सहेज रहे हैं…', 'file.saved': 'इस कंप्यूटर पर सहेजा गया:', 'file.bytes': '{n} बाइट',
  'rem.title': 'ग्राहक को याद दिलाना', 'rem.link': 'बिल का लिंक', 'rem.noLink': 'इस संदेश में बिल का लिंक नहीं है।',
  'rem.due': 'इस बिल पर बाकी', 'rem.agreement': 'याद दिलाने की सहमति',
  'rem.ch.email': 'मेल', 'rem.ch.whatsapp': 'व्हाट्सऐप', 'rem.ans.yes': 'हाँ', 'rem.ans.no': 'नहीं', 'rem.ans.not-asked': 'पूछा नहीं गया',
  'rem.from': '{source} से, {date}', 'rem.fromDate': '{date} को',
  'rem.stopped': 'ग्राहक ने {date} को रोक दिया।',
  'rem.capReached': 'आज {n} याद-दिलाने वाले संदेश तैयार हुए। बाकी कल तक रुकेंगे।',
  'rem.customerCap': 'इस ग्राहक के लिए आज एक संदेश पहले से है।',
  'rem.caps': 'सीमा: हर ग्राहक को दिन में {perCustomer}, कुल दिन में {perDay}। उस दिन तैयार: {n}।',
  'rem.notes': 'सिर्फ़ आपके लिए: भुगतान के नियम', 'rem.source': 'स्रोत: {source}', 'rem.checked': '{date} को जाँचा गया', 'rem.notLegal': 'यह कानूनी सलाह नहीं है।',
  'rem.blocked': 'तैयारी पर ही रुका: {reason}', 'rem.record': 'जब ग्राहक सहमति दे, तो ग्राहक के पेज पर उसे दर्ज करें।',
  'cando.score': 'लिखने का स्कोर', 'e.qualification': 'राइट-बैक जाँच', 'e.score': 'लिखने का स्कोर', 'e.waitsBecause': 'यह क्यों रुकता है',
  'e.planned': 'तय स्थिति', 'e.reference': 'सिस्टम में लिखा जाने वाला व्यावसायिक संदर्भ', 'e.lifetime': 'मंज़ूरी कितनी देर चलती है',
  'e.reviewed': 'समीक्षा की तारीख़', 'e.undo': 'इसे कैसे वापस करें', 'e.grants': 'लिखने की अनुमति वाले कनेक्शन', 'e.grantsNone': 'अभी कोई कनेक्शन इसे नहीं लिख सकता।',
  'q.synthetic-tested': 'अभ्यास सिस्टम पर जाँचा गया', 'q.sandbox-verified': 'सैंडबॉक्स खाते पर जाँचा गया', 'q.live-verified': 'असली पर जाँचा गया', 'q.unqualified': 'अभी जाँचा नहीं गया',
  'g.write': '{label} ({env}): लिख सकता है', 'g.read': '{label} ({env}): सिर्फ़ पढ़ सकता है',
  'practice.outcome.would-be-done': 'यह हो जाता और वापस पढ़ा जाता।',
  'practice.outcome.would-be-not-sure': 'जवाब खो जाता; Chausar को पक्का न पता होता और दोबारा कोशिश से पहले वह देखता।',
  'practice.outcome.would-not-happen': 'यह नहीं होता।',
  'practice.outcome.already-done': 'यह पहले से सिस्टम में है। कुछ नहीं भेजा जाता।',
  'practice.outcome.prepare-only': 'सिर्फ़ तैयार। कुछ नहीं भेजा जाता।',
  'practice.outcome.refused': 'सिस्टम इसे मना कर देता।',
  'practice.requests': '{n} अनुरोध इस कंप्यूटर से बाहर जाते।',
};

export type WbWords = Readonly<Record<WbKey, string>>;
export function wbWords(language: Language): WbWords { return words<WbKey>({ en: EN, hi: HI }, language); }
export function wbSay(w: WbWords, key: WbKey, values: Readonly<Record<string, string | number>> = {}): string {
  return w[key].replace(/\{(\w+)\}/g, (all, name: string) => Object.hasOwn(values, name) ? String(values[name]) : all);
}
/** A known key, or null when the engine sent a word this screen has no text for. */
export function wbKnown(w: WbWords, key: string): string | null { return Object.hasOwn(w, key) ? w[key as WbKey] : null; }
