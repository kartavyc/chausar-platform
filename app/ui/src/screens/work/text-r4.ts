/**
 * Words for the round-4 Work parts (docs/lanes/work-books.md, "Round 4 contracts"): jobs-ext's
 * ready-made jobs in Start a job, practice for core actions, the own-secret second ask, grouped
 * steps, route meters and child tasks, the reminders view, deleting again after a restore, and
 * the links to other lanes' Work pages. English and Hindi, same keys.
 */
import type { Language } from '../../app/presentation.ts';
import { words } from '../../places/types.ts';
import { fill } from './kit/words.ts';

const EN = {
  'lane.title': 'Ready-made jobs from job extensions',
  'lane.note': 'Each one is a card you read before it starts. Proposing makes the card; nothing runs until you approve it.',
  'lane.notBuilt': 'Ready-made jobs from job extensions are not built yet.',
  'lane.active': '{n} of {cap} jobs are active.',
  'lane.everyOther': 'on its own schedule',
  'lane.rounds': 'A result after {n} rounds, for you to accept.',
  'lane.round': 'A result after every run, for you to accept.',
  'lane.needsModel': 'needs an AI model', 'lane.noModel': 'runs without one',
  'lane.cannot': 'Cannot start in this workspace yet.',
  'code.DICTIONARY_REQUIRED': 'Publish your business meanings first.',
  'code.TEMPLATE_CALCULATION_MISSING': 'Your published meanings have no calculation this job needs.',
  'code.TEMPLATE_NOT_BUILT': 'This job needs a part of Chausar that is not built yet.',
  'code.AGENT_ROUTE_REQUIRED': 'This job needs an installed agent route. None is installed.',
  'code.GST_SOURCES_REQUIRED': 'Choose the purchase register and the GSTR-2B source in job extensions first.',
  'code.other': 'Cannot start yet. Code {code}.',
  'practice.try': 'Practice this',
  'practice.core.title': 'Practice: checked, not run',
  'practice.core.note': 'Practice checks this exact request the way the real action would. It does not run the action, and nothing is sent or saved.',
  'practice.outcome.would-create-local-draft': 'It would create a local draft in Chausar. Nothing is sent.',
  'practice.outcome.checked-not-run': 'The request is complete and the action would accept it. It was not run.',
  'practice.outcome.refused': 'The real action would refuse this request. Code {code}.',
  'practice.request': 'The exact request',
  'secret.title': 'Approve with your approval secret', 'secret.field': 'Approval secret',
  'secret.setFirst': 'Set your approval secret in Trust first. Until then this seat cannot approve money.', 'secret.locked': 'Too many wrong tries. The second ask is locked until {time}.',
  'secret.note': 'Your own approval secret, set for your seat. It is checked once and never kept.',
  'group.steps': 'Its steps',
  'routes.title': 'Model routes',
  'routes.zero': 'on this computer, priced at zero', 'routes.minutes': '{n} minutes', 'routes.noMinutes': 'minutes not counted',
  'routes.estimate': '{amount} (estimate)', 'routes.untested': 'not tested on this route',
  'routes.untestedStop': 'Stopped: it reached a model route it was not tested on.',
  'children.title': 'Child tasks', 'children.notBuilt': 'Results of child tasks arrive with the core job runner. Not built yet.',
  'children.none': 'This job has no child tasks.', 'children.missing': 'No result: this child task did not deliver one.',
  'children.result': '{done} done, {open} still open', 'children.receipts': 'Receipts',
  'rem.title': 'Reminders to customers',
  'rem.notBuilt': 'Reminders arrive with write-back. Not built yet.',
  'rem.note': 'Nothing is sent until you approve the reminder.',
  'rem.prepare': 'Prepare a reminder', 'rem.customer': 'Customer', 'rem.search': 'Find a customer by name', 'rem.searchGo': 'Find',
  'rem.noCustomers': 'No customer matches.', 'rem.invoice': 'Invoice', 'rem.noInvoices': 'This customer has no invoice in the books loaded.',
  'rem.connection': 'Send through', 'rem.noConnections': 'No mail or WhatsApp connection can send reminders yet.',
  'rem.language': 'Language of the reminder', 'rem.lang.en': 'English', 'rem.lang.hi': 'Hindi',
  'rem.go': 'Prepare', 'rem.prepared': 'Prepared. It waits for your yes in Approvals.', 'rem.open': 'Open its approval',
  'rem.blocked': 'Not prepared: {reason}',
  'rem.list': 'Reminders prepared', 'rem.none': 'No reminders yet.',
  'rem.today': 'Today is {today} in {zone}: {prepared} of {perDay} reminders prepared, {sent} sent. At most {perCustomer} per customer a day.',
  'rem.limits': 'At most {perDay} reminders a day, and {perCustomer} per customer a day.',
  'rem.capsZone': 'Counted on {day} in {zone}, write-back’s own time zone.',
  'restore.reapply': 'Delete again what came back',
  'restore.reapplyNote': 'Customer records you deleted after the backup came back with it. Deleting them again uses the deletions you already approved.',
  'restore.reapplied': '{n} customer records deleted again.',
  'links.jobs': 'More for jobs', 'links.cando': 'Write connections and grants',
  'rem.openRecord': 'Open this customer’s page',
  'driving.cannot': 'This computer cannot be driven here. Code {code}.', 'driving.exports': 'Exported files, kept for a day',
} as const;

export type R4Key = keyof typeof EN;

const HI: Readonly<Record<R4Key, string>> = {
  'lane.title': 'जॉब एक्सटेंशन के तैयार जॉब',
  'lane.note': 'हर एक एक कार्ड है जिसे आप शुरू होने से पहले पढ़ते हैं। प्रस्ताव से कार्ड बनता है; आपकी मंज़ूरी तक कुछ नहीं चलता।',
  'lane.notBuilt': 'जॉब एक्सटेंशन के तैयार जॉब अभी बने नहीं हैं।',
  'lane.active': '{cap} में से {n} जॉब चालू हैं।',
  'lane.everyOther': 'अपने समय पर',
  'lane.rounds': '{n} दौर के बाद एक नतीजा, आपकी स्वीकृति के लिए।',
  'lane.round': 'हर रन के बाद एक नतीजा, आपकी स्वीकृति के लिए।',
  'lane.needsModel': 'AI मॉडल चाहिए', 'lane.noModel': 'बिना मॉडल के चलता है',
  'lane.cannot': 'इस वर्कस्पेस में अभी शुरू नहीं हो सकता।',
  'code.DICTIONARY_REQUIRED': 'पहले अपने कारोबार के अर्थ प्रकाशित करें।',
  'code.TEMPLATE_CALCULATION_MISSING': 'आपके प्रकाशित अर्थों में वह गणना नहीं है जो इस जॉब को चाहिए।',
  'code.TEMPLATE_NOT_BUILT': 'इस जॉब को चौसर का एक हिस्सा चाहिए जो अभी बना नहीं है।',
  'code.AGENT_ROUTE_REQUIRED': 'इस जॉब को एक इंस्टॉल किया हुआ एजेंट रूट चाहिए। कोई इंस्टॉल नहीं है।',
  'code.GST_SOURCES_REQUIRED': 'पहले जॉब एक्सटेंशन में ख़रीद रजिस्टर और GSTR-2B का स्रोत चुनें।',
  'code.other': 'अभी शुरू नहीं हो सकता। कोड {code}।',
  'practice.try': 'इसका अभ्यास करें',
  'practice.core.title': 'अभ्यास: जाँचा गया, चलाया नहीं गया',
  'practice.core.note': 'अभ्यास इस सटीक अनुरोध को वैसे ही जाँचता है जैसे असली कार्रवाई जाँचती। यह कार्रवाई नहीं चलाता, और न कुछ भेजा जाता है न सहेजा जाता है।',
  'practice.outcome.would-create-local-draft': 'यह चौसर में एक स्थानीय ड्राफ़्ट बनाता। कुछ नहीं भेजा जाता।',
  'practice.outcome.checked-not-run': 'अनुरोध पूरा है और कार्रवाई इसे मान लेती। इसे चलाया नहीं गया।',
  'practice.outcome.refused': 'असली कार्रवाई इस अनुरोध को मना कर देती। कोड {code}।',
  'practice.request': 'सटीक अनुरोध',
  'secret.title': 'अपने मंज़ूरी-राज़ से मंज़ूर करें', 'secret.field': 'मंज़ूरी-राज़',
  'secret.setFirst': 'पहले ट्रस्ट में अपना मंज़ूरी-राज़ बनाएँ। तब तक यह सीट पैसे से जुड़ी मंज़ूरी नहीं दे सकती।', 'secret.locked': 'बहुत बार गलत राज़ डाला गया। दूसरी पुष्टि {time} तक बंद है।',
  'secret.note': 'आपकी सीट के लिए रखा आपका अपना मंज़ूरी-राज़। यह एक बार जाँचा जाता है और कभी रखा नहीं जाता।',
  'group.steps': 'इसके क़दम',
  'routes.title': 'मॉडल रूट',
  'routes.zero': 'इसी कंप्यूटर पर, क़ीमत शून्य', 'routes.minutes': '{n} मिनट', 'routes.noMinutes': 'मिनट गिने नहीं गए',
  'routes.estimate': '{amount} (अनुमान)', 'routes.untested': 'इस रूट पर परखा नहीं गया',
  'routes.untestedStop': 'रुका: यह एक ऐसे मॉडल रूट पर पहुँचा जिस पर इसे परखा नहीं गया था।',
  'children.title': 'उप-काम', 'children.notBuilt': 'उप-कामों के नतीजे कोर जॉब रनर के साथ आएँगे। अभी बना नहीं है।',
  'children.none': 'इस जॉब के कोई उप-काम नहीं हैं।', 'children.missing': 'कोई नतीजा नहीं: इस उप-काम ने नतीजा नहीं दिया।',
  'children.result': '{done} पूरे, {open} अभी खुले', 'children.receipts': 'रसीदें',
  'rem.title': 'ग्राहकों को याद-दिलाने वाले संदेश',
  'rem.notBuilt': 'याद-दिलाने वाले संदेश राइट-बैक के साथ आएँगे। अभी बना नहीं है।',
  'rem.note': 'आपकी मंज़ूरी तक कुछ नहीं भेजा जाता।',
  'rem.prepare': 'याद-दिलाने वाला संदेश तैयार करें', 'rem.customer': 'ग्राहक', 'rem.search': 'नाम से ग्राहक ढूँढें', 'rem.searchGo': 'ढूँढें',
  'rem.noCustomers': 'कोई ग्राहक मेल नहीं खाता।', 'rem.invoice': 'बिल', 'rem.noInvoices': 'लोड की गई बही में इस ग्राहक का कोई बिल नहीं है।',
  'rem.connection': 'किससे भेजें', 'rem.noConnections': 'अभी कोई मेल या WhatsApp कनेक्शन याद-दिलाने वाले संदेश नहीं भेज सकता।',
  'rem.language': 'संदेश की भाषा', 'rem.lang.en': 'अंग्रेज़ी', 'rem.lang.hi': 'हिंदी',
  'rem.go': 'तैयार करें', 'rem.prepared': 'तैयार। यह मंज़ूरियों में आपकी हाँ का इंतज़ार करता है।', 'rem.open': 'इसकी मंज़ूरी खोलें',
  'rem.blocked': 'तैयार नहीं हुआ: {reason}',
  'rem.list': 'तैयार किए गए संदेश', 'rem.none': 'अभी कोई संदेश नहीं।',
  'rem.today': '{zone} में आज {today} है: {perDay} में से {prepared} संदेश तैयार, {sent} भेजे गए। हर ग्राहक को दिन में ज़्यादा से ज़्यादा {perCustomer}।',
  'rem.limits': 'दिन में ज़्यादा से ज़्यादा {perDay} संदेश, और हर ग्राहक को दिन में {perCustomer}।',
  'rem.capsZone': '{day} को {zone} में गिना गया, राइट-बैक के अपने समय क्षेत्र में।',
  'restore.reapply': 'जो वापस आया उसे फिर से मिटाएँ',
  'restore.reapplyNote': 'बैकअप के बाद मिटाए गए ग्राहक रिकॉर्ड उसके साथ वापस आ गए। उन्हें फिर से मिटाने में वही मिटाना इस्तेमाल होता है जिसे आप पहले मंज़ूर कर चुके हैं।',
  'restore.reapplied': '{n} ग्राहक रिकॉर्ड फिर से मिटाए गए।',
  'links.jobs': 'जॉब के लिए और', 'links.cando': 'लिखने के कनेक्शन और अनुमतियाँ',
  'rem.openRecord': 'इस ग्राहक का पेज खोलें',
  'driving.cannot': 'यह कंप्यूटर यहाँ से चलाया नहीं जा सकता। कोड {code}।', 'driving.exports': 'निर्यात की गई फ़ाइलें, एक दिन रखी जाती हैं',
};

export type R4Words = Readonly<Record<R4Key, string>>;
export function r4Words(language: Language): R4Words { return words<R4Key>({ en: EN, hi: HI }, language); }
export function sayR4(r: R4Words, key: R4Key, values?: Readonly<Record<string, string | number>>): string { return fill(r[key], values); }
/** A refusal code in words when this catalogue knows it; else the code itself in a sentence. */
export function codeWords(r: R4Words, code: string): string {
  const key = `code.${code}`;
  return Object.hasOwn(r, key) ? r[key as R4Key] : fill(r['code.other'], { code });
}
