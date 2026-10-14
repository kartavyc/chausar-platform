/**
 * Every word a person reads on the Trust screens, in English and Hindi. A sentence with a
 * gap is written whole in each language and filled with `fill`; no sentence is built by
 * joining pieces of different languages. Engine text (names, paths, notes) fills a gap
 * as data and is drawn as a text node.
 */
import type { Catalogue } from '../../places/types.ts';

function cat<K extends string>(en: Record<K, string>, hi: Record<K, string>): Catalogue<K> { return { en, hi }; }

/** Fill `{name}` gaps in one catalogue sentence. */
export function fill(sentence: string, values: Readonly<Record<string, string>>): string {
  return sentence.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => values[name] ?? whole);
}

export const COMMON = cat({
  whereRules: 'Trust · Rules', wherePeople: 'Trust · People', whereModels: 'Trust · Models', whereNetwork: 'Trust · Network',
  whereRecord: 'Trust · Record', whereSharing: 'Trust · Sharing', whereVault: 'Trust · Vault', whereMarkings: 'Trust · Markings',
  whereRetention: 'Trust · Retention', whereChannels: 'Trust · Channels', whereAccess: 'Trust · Access',
  rules: 'Rules', see: 'See', send: 'Send', keep: 'Keep', do: 'Do', people: 'People', models: 'Models', network: 'Network',
  record: 'Record', sharing: 'Sharing', vault: 'Vault', channels: 'Channels', markings: 'Markings', retention: 'Retention', access: 'Access',
  sheetRule: 'Rule', sheetDetail: 'Detail',
  ownerOnly: 'Only the owner can change this.', adminOnly: 'Only the owner or a cofounder can change this.',
  sending: 'Saving…', applied: 'Saved.', refused: 'This change was refused.', refusedCode: 'Code {code}',
  notAllowed: 'Your seat cannot make this change.', notBuiltChange: 'This change is not built yet.', lockedChange: 'The workspace is locked.',
  invalidReply: 'The reply could not be read, so nothing is shown as saved.',
  waitOwner: 'Waiting for the owner to confirm.', waitCofounder: 'Waiting for the cofounder to confirm.',
  pendingTitle: 'Changes waiting for a second person', pendingBy: 'Asked by {by} on {date}.',
  needsOwner: 'The owner confirms it.', needsCofounder: 'The cofounder confirms it.', yourChange: 'Your own change: the other person confirms it.',
  confirm: 'Confirm', cancel: 'Cancel', save: 'Save', bytes: '{n} bytes', sizeUnknown: 'size not known', cost: 'cost',
  on: 'On', off: 'Off', experimental: 'experimental',
}, {
  whereRules: 'भरोसा · नियम', wherePeople: 'भरोसा · लोग', whereModels: 'भरोसा · मॉडल', whereNetwork: 'भरोसा · नेटवर्क',
  whereRecord: 'भरोसा · रिकॉर्ड', whereSharing: 'भरोसा · साझा करना', whereVault: 'भरोसा · तिजोरी', whereMarkings: 'भरोसा · चिह्न',
  whereRetention: 'भरोसा · रखना', whereChannels: 'भरोसा · चैनल', whereAccess: 'भरोसा · पहुँच',
  rules: 'नियम', see: 'देखना', send: 'भेजना', keep: 'रखना', do: 'करना', people: 'लोग', models: 'मॉडल', network: 'नेटवर्क',
  record: 'रिकॉर्ड', sharing: 'साझा करना', vault: 'तिजोरी', channels: 'चैनल', markings: 'चिह्न', retention: 'रखना', access: 'पहुँच',
  sheetRule: 'नियम', sheetDetail: 'विवरण',
  ownerOnly: 'इसे केवल मालिक बदल सकते हैं।', adminOnly: 'इसे केवल मालिक या सह-संस्थापक बदल सकते हैं।',
  sending: 'सहेजा जा रहा है…', applied: 'सहेज दिया गया।', refused: 'यह बदलाव अस्वीकार हुआ।', refusedCode: 'कोड {code}',
  notAllowed: 'आपकी सीट यह बदलाव नहीं कर सकती।', notBuiltChange: 'यह बदलाव अभी बना नहीं है।', lockedChange: 'कार्यस्थान बंद है।',
  invalidReply: 'जवाब पढ़ा नहीं जा सका, इसलिए कुछ भी सहेजा हुआ नहीं दिखाया गया।',
  waitOwner: 'मालिक की पुष्टि का इंतज़ार है।', waitCofounder: 'सह-संस्थापक की पुष्टि का इंतज़ार है।',
  pendingTitle: 'दूसरे व्यक्ति की पुष्टि का इंतज़ार कर रहे बदलाव', pendingBy: '{by} ने {date} को माँगा।',
  needsOwner: 'मालिक इसकी पुष्टि करेंगे।', needsCofounder: 'सह-संस्थापक इसकी पुष्टि करेंगे।', yourChange: 'यह आपका अपना बदलाव है: दूसरा व्यक्ति इसकी पुष्टि करेगा।',
  confirm: 'पुष्टि करें', cancel: 'रद्द करें', save: 'सहेजें', bytes: '{n} बाइट', sizeUnknown: 'आकार पता नहीं', cost: 'लागत',
  on: 'चालू', off: 'बंद', experimental: 'प्रयोग में',
});

export const SEAT_WORDS = cat({
  owner: 'Owner', cofounder: 'Cofounder', accountant: 'Accountant', ca: 'CA', staff: 'Staff', viewer: 'Viewer', assistant: 'Assistant',
}, {
  owner: 'मालिक', cofounder: 'सह-संस्थापक', accountant: 'अकाउंटेंट', ca: 'सीए', staff: 'स्टाफ़', viewer: 'देखने वाले', assistant: 'सहायक',
});

export const KIND_WORDS = cat({
  personal: 'personal', financial: 'financial', confidential: 'confidential',
}, {
  personal: 'व्यक्तिगत', financial: 'वित्तीय', confidential: 'गोपनीय',
});

export const RULES = cat({
  seeAll: 'Reads every source.', seeSome: 'Reads {allowed} sources, refuses {refused}.',
  sendNothing: 'Nothing is sent to an AI model.', sendShape: 'Shape only: headings and types, no values.', sendSamples: 'A few sample rows, with stand-ins for names.',
  localOnly: 'Local only.',
  keepDays: 'Kept for {days} days.', keepForever: 'Kept until you delete it.',
  'preset.ask-everything': 'Asks you about everything.', 'preset.routine': 'Routine work runs on its own.',
  'preset.all-but-waits': 'Everything runs except what always waits.', 'preset.custom': 'Your own mix of switches.',
  detailSee: 'Which sources Chausar may read, and which data is marked.', detailSend: 'What an AI model may be sent.',
  detailKeep: 'What is kept, and for how long.', detailDo: 'What may run without asking.',
  openPage: 'Open the full page',
  leftTitle: 'What left this computer today', leftNone: 'Nothing left this computer today.',
  leftSentence: 'Lines from this computer to {n} places.', thisComputer: 'This computer',
  leftLine: '{destination}: {count}', leftStopped: '{destination}: {count}, stopped',
  foot: "You are responsible for your customers' data. This app helps you see it, delete it and get a report.",
  linkCustomers: 'Books · Customers', linkReport: 'The deletion report',
}, {
  seeAll: 'हर स्रोत पढ़ता है।', seeSome: '{allowed} स्रोत पढ़ता है, {refused} नहीं पढ़ता।',
  sendNothing: 'किसी AI मॉडल को कुछ नहीं भेजा जाता।', sendShape: 'केवल ढाँचा: शीर्षक और प्रकार, कोई मान नहीं।', sendSamples: 'कुछ नमूना पंक्तियाँ, नामों की जगह बदले हुए नाम।',
  localOnly: 'केवल इसी कंप्यूटर पर।',
  keepDays: '{days} दिन तक रखा जाता है।', keepForever: 'जब तक आप न हटाएँ, रखा जाता है।',
  'preset.ask-everything': 'हर बात आपसे पूछता है।', 'preset.routine': 'रोज़ का काम अपने आप चलता है।',
  'preset.all-but-waits': 'हमेशा रुकने वाली बातों को छोड़कर सब अपने आप चलता है।', 'preset.custom': 'आपका अपना स्विचों का मेल।',
  detailSee: 'चौसर कौन-से स्रोत पढ़ सकता है, और कौन-सा डेटा चिह्नित है।', detailSend: 'AI मॉडल को क्या भेजा जा सकता है।',
  detailKeep: 'क्या रखा जाता है, और कब तक।', detailDo: 'क्या बिना पूछे चल सकता है।',
  openPage: 'पूरा पन्ना खोलें',
  leftTitle: 'आज इस कंप्यूटर से क्या बाहर गया', leftNone: 'आज इस कंप्यूटर से कुछ बाहर नहीं गया।',
  leftSentence: 'इस कंप्यूटर से {n} जगहों तक रेखाएँ।', thisComputer: 'यह कंप्यूटर',
  leftLine: '{destination}: {count}', leftStopped: '{destination}: {count}, रोका गया',
  foot: 'अपने ग्राहकों के डेटा की ज़िम्मेदारी आपकी है। यह ऐप आपको उसे देखने, हटाने और उसकी रिपोर्ट पाने में मदद करता है।',
  linkCustomers: 'खाते · ग्राहक', linkReport: 'हटाने की रिपोर्ट',
});

export const SEE = cat({
  sourcesTitle: 'Sources', sourcesNote: 'Choose which sources Chausar may read.', sourcesCounts: 'The list of sources is not built yet. From the rules:',
  sourcesNone: 'No source is added yet.', stopAsk: 'Stop reading {name}? What Chausar learned from it is removed.', stopConfirm: 'Stop reading',
  markingsTitle: 'Markings', markingsNote: 'A marking follows the data into every summary, report, brief and export made from it.',
  whereTitle: 'Where each marking is set', whereSource: 'On a source file', whereRecord: "On a record's page", whereField: 'On a field in a table',
  linkSource: 'Books · Sources', linkRecord: 'Books · Customers', linkField: 'Books · Meanings',
  marksTitle: 'Marks', marksNone: 'Nothing is marked yet.',
  markSource: '{kind}: source {source}', markRecord: '{kind}: record {record} in {source}', markField: '{kind}: field {field} in {source}',
  autoFinancial: 'marked financial from the start', autoOther: 'marked from the start', markBy: 'marked by {by} on {date}',
  unmark: 'Remove the mark', seatsTitle: 'What each seat may see', seatCol: 'Seat', seesLabel: '{seat} sees {kind}',
}, {
  sourcesTitle: 'स्रोत', sourcesNote: 'चुनें कि चौसर कौन-से स्रोत पढ़ सकता है।', sourcesCounts: 'स्रोतों की सूची अभी बनी नहीं है। नियमों से:',
  sourcesNone: 'अभी कोई स्रोत नहीं जोड़ा गया।', stopAsk: '{name} पढ़ना बंद करें? चौसर ने इससे जो सीखा है, वह हटा दिया जाएगा।', stopConfirm: 'पढ़ना बंद करें',
  markingsTitle: 'चिह्न', markingsNote: 'चिह्न डेटा के साथ हर सारांश, रिपोर्ट, ब्रीफ़ और निर्यात में जाता है जो उससे बनता है।',
  whereTitle: 'हर चिह्न कहाँ लगाया जाता है', whereSource: 'स्रोत फ़ाइल पर', whereRecord: 'रिकॉर्ड के पन्ने पर', whereField: 'तालिका के किसी खाने पर',
  linkSource: 'खाते · स्रोत', linkRecord: 'खाते · ग्राहक', linkField: 'खाते · अर्थ',
  marksTitle: 'चिह्न लगे हुए', marksNone: 'अभी कुछ भी चिह्नित नहीं है।',
  markSource: '{kind}: स्रोत {source}', markRecord: '{kind}: {source} में रिकॉर्ड {record}', markField: '{kind}: {source} में खाना {field}',
  autoFinancial: 'शुरू से वित्तीय चिह्नित', autoOther: 'शुरू से चिह्नित', markBy: '{by} ने {date} को चिह्नित किया',
  unmark: 'चिह्न हटाएँ', seatsTitle: 'हर सीट क्या देख सकती है', seatCol: 'सीट', seesLabel: '{seat} {kind} देखती है',
});

export const SEND = cat({
  'level.nothing': 'Nothing', 'level.shape': 'Shape only', 'level.samples': 'Samples',
  inUse: 'In use', use: 'Use this level', example: 'example', memory: 'Memory', question: 'Your question',
  standIns: 'Names, phone numbers and GSTINs are swapped for stand-ins before any call and put back after.',
  voiceTitle: 'Voice', voiceOff: 'Voice is off.', voiceNote: 'Audio leaves this computer when voice is on.',
  localTitle: 'Local only', localNote: 'Only a model on this computer is used.',
  financialTitle: 'Routes approved for data marked financial', financialNone: 'No route is approved. Data marked financial goes only to a local model.',
  removeRoute: 'Remove {route}',
}, {
  'level.nothing': 'कुछ नहीं', 'level.shape': 'केवल ढाँचा', 'level.samples': 'नमूने',
  inUse: 'लागू', use: 'यह स्तर लागू करें', example: 'उदाहरण', memory: 'स्मृति', question: 'आपका सवाल',
  standIns: 'किसी भी कॉल से पहले नाम, फ़ोन नंबर और GSTIN बदले हुए नामों से बदल दिए जाते हैं और बाद में वापस रखे जाते हैं।',
  voiceTitle: 'आवाज़', voiceOff: 'आवाज़ बंद है।', voiceNote: 'आवाज़ चालू होने पर ऑडियो इस कंप्यूटर से बाहर जाता है।',
  localTitle: 'केवल इसी कंप्यूटर पर', localNote: 'केवल इस कंप्यूटर पर चलने वाला मॉडल इस्तेमाल होता है।',
  financialTitle: 'वित्तीय चिह्नित डेटा के लिए मंज़ूर रास्ते', financialNone: 'कोई रास्ता मंज़ूर नहीं है। वित्तीय चिह्नित डेटा केवल इसी कंप्यूटर के मॉडल को जाता है।',
  removeRoute: '{route} हटाएँ',
});

export const KEEP = cat({
  kindsTitle: 'How long each kind is kept', until: 'until you delete it', days: '{days} days', daysField: 'Days to keep {kind}',
  daysHint: 'Leave it empty to keep it until you delete it.', badDays: 'Type a whole number of days, from 1 to 3650.',
  inventoryTitle: 'Everything the app writes to disk', inventoryNone: 'Nothing is listed.', kindsNone: 'No kind of data is listed.',
}, {
  kindsTitle: 'हर तरह का डेटा कब तक रखा जाता है', until: 'जब तक आप न हटाएँ', days: '{days} दिन', daysField: '{kind} कितने दिन रखें',
  daysHint: 'खाली छोड़ें तो यह तब तक रहेगा जब तक आप न हटाएँ।', badDays: '1 से 3650 तक दिनों की पूरी संख्या लिखें।',
  inventoryTitle: 'ऐप डिस्क पर जो कुछ लिखता है', inventoryNone: 'कुछ भी सूची में नहीं है।', kindsNone: 'किसी तरह का डेटा सूची में नहीं है।',
});

export const DO = cat({
  presetsTitle: 'Presets', presetLabel: 'Preset',
  'preset.ask-everything': 'Ask me everything', 'preset.routine': 'Routine work on its own', 'preset.all-but-waits': 'Everything except what always waits',
  custom: 'Your switches are your own mix; no preset matches them.',
  presetNote: 'A preset only sets the switches for each kind. There is no single switch that makes everything run on its own.',
  kindsTitle: 'Each kind of action', runsAlone: '{kind} runs on its own', maxCount: 'Most in a day', maxAmount: 'Most in a day, in rupees',
  limitCount: 'up to {count} a day', limitBoth: 'up to {count} a day and {amount}', agreed: 'agreed {agreed} of {total} times', noHistory: 'no history yet',
  badCount: 'Type a whole number.', badAmount: 'Type rupees with at most two decimals, like 1,234.50.', kindsNone: 'No kind of action is listed.',
  waitsTitle: 'Always waits for you', waitsLead: 'Anything that cannot be undone, and in particular:',
  limitsTitle: 'Limits', perCustomer: 'Reminders to one customer in a day', perDay: 'Reminders in a day, in all', activeJobs: 'Active jobs',
  aiCap: 'Monthly AI cap, in rupees', aiCapNone: 'No monthly AI cap.', aiCapHint: 'Leave it empty for no cap.',
}, {
  presetsTitle: 'पहले से तय मेल', presetLabel: 'मेल',
  'preset.ask-everything': 'हर बात मुझसे पूछें', 'preset.routine': 'रोज़ का काम अपने आप', 'preset.all-but-waits': 'हमेशा रुकने वाली बातों को छोड़कर सब',
  custom: 'आपके स्विच आपका अपना मेल हैं; कोई तय मेल इनसे नहीं मिलता।',
  presetNote: 'तय मेल केवल हर तरह के काम के स्विच लगाता है। ऐसा कोई एक स्विच नहीं है जो सब कुछ अपने आप चला दे।',
  kindsTitle: 'हर तरह का काम', runsAlone: '{kind} अपने आप चलता है', maxCount: 'एक दिन में सबसे ज़्यादा', maxAmount: 'एक दिन में सबसे ज़्यादा, रुपयों में',
  limitCount: 'दिन में {count} तक', limitBoth: 'दिन में {count} तक और {amount} तक', agreed: '{total} में से {agreed} बार सहमत', noHistory: 'अभी कोई इतिहास नहीं',
  badCount: 'पूरी संख्या लिखें।', badAmount: 'ज़्यादा से ज़्यादा दो दशमलव के साथ रुपये लिखें, जैसे 1,234.50।', kindsNone: 'किसी तरह का काम सूची में नहीं है।',
  waitsTitle: 'हमेशा आपका इंतज़ार करता है', waitsLead: 'जो कुछ भी वापस नहीं हो सकता, और ख़ास तौर पर:',
  limitsTitle: 'सीमाएँ', perCustomer: 'एक ग्राहक को एक दिन में याद दिलाना', perDay: 'एक दिन में कुल याद दिलाना', activeJobs: 'चल रहे काम',
  aiCap: 'AI की मासिक सीमा, रुपयों में', aiCapNone: 'AI की कोई मासिक सीमा नहीं।', aiCapHint: 'कोई सीमा न रखनी हो तो खाली छोड़ें।',
});

export const PEOPLE = cat({
  invite: 'Invite', inviteTitle: 'Invite a person', seatChoice: 'Seat', nameField: 'Name', endsField: 'The seat ends on (YYYY-MM-DD)',
  sendInvite: 'Send the invite', needEnd: 'A CA seat needs an end date, like 2026-12-31.', needName: 'Type a name.',
  code: 'One-time code', codeOnce: 'This code is shown once.', expires: 'It expires on {date}.',
  guideTitle: 'One-page guide for your accountant', guideNote: 'Forward this guide. It is shown here as text.', guideSave: 'Save the guide',
  ended: 'This seat ended on {date}.', removed: 'Removed on {date}. What was already copied or exported stays with that person.', endsOn: 'Ends on {date}.',
  remove: 'Remove', removeAsk: 'Remove {name}? What was already copied or exported stays with that person.', removeConfirm: 'Remove {name}',
  you: 'you', peopleNone: 'Nobody is listed.',
  machinesTitle: 'Machines and the pen', writer: 'This computer holds the pen: it may write.',
  reader: 'This computer reads only. A change from here goes to the computer that holds the pen as a request.',
  penUnknown: 'Which computer holds the pen is not known yet.', oneWriter: 'One writer at a time. Only the computer that holds the pen runs scheduled jobs.',
  syncOn: 'Sync is on.', syncOff: 'Sync is off.',
}, {
  invite: 'बुलाएँ', inviteTitle: 'किसी को बुलाएँ', seatChoice: 'सीट', nameField: 'नाम', endsField: 'सीट इस तारीख़ को ख़त्म होगी (YYYY-MM-DD)',
  sendInvite: 'न्योता भेजें', needEnd: 'सीए की सीट के लिए ख़त्म होने की तारीख़ चाहिए, जैसे 2026-12-31।', needName: 'नाम लिखें।',
  code: 'एक बार का कोड', codeOnce: 'यह कोड केवल एक बार दिखाया जाता है।', expires: 'यह {date} को समाप्त होगा।',
  guideTitle: 'आपके अकाउंटेंट के लिए एक पन्ने की गाइड', guideNote: 'यह गाइड आगे भेजें। यहाँ यह सादे पाठ के रूप में दिखाई गई है।', guideSave: 'गाइड सहेजें',
  ended: 'यह सीट {date} को ख़त्म हो गई।', removed: '{date} को हटाया गया। जो पहले ही कॉपी या निर्यात हो चुका है, वह उस व्यक्ति के पास रहता है।', endsOn: '{date} को ख़त्म होगी।',
  remove: 'हटाएँ', removeAsk: '{name} को हटाएँ? जो पहले ही कॉपी या निर्यात हो चुका है, वह उस व्यक्ति के पास रहता है।', removeConfirm: '{name} को हटाएँ',
  you: 'आप', peopleNone: 'कोई सूची में नहीं है।',
  machinesTitle: 'कंप्यूटर और कलम', writer: 'कलम इस कंप्यूटर के पास है: यह लिख सकता है।',
  reader: 'यह कंप्यूटर केवल पढ़ता है। यहाँ से किया गया बदलाव अनुरोध बनकर कलम वाले कंप्यूटर के पास जाता है।',
  penUnknown: 'कलम किस कंप्यूटर के पास है, यह अभी पता नहीं।', oneWriter: 'एक समय में एक ही लिखने वाला। तय समय के काम केवल कलम वाला कंप्यूटर चलाता है।',
  syncOn: 'सिंक चालू है।', syncOff: 'सिंक बंद है।',
});

export const MODELS = cat({
  orderTitle: 'The order routes are tried in', routesTitle: 'Routes', routesNone: 'No route is set up.',
  'health.ready': 'ready', 'health.signed-out': 'signed out', 'health.not-installed': 'not installed', 'health.version-not-tested': 'version not tested',
  'health.timed-out': 'timed out', 'health.error': 'error',
  keeps: 'What it keeps', keepsFor: 'For how long', trains: 'Trains on it', yes: 'Yes', no: 'No', country: 'Country', terms: 'Terms', readOn: 'Read on {date}',
  termsLink: 'Read the terms', noTerms: 'Terms not recorded for this route.',
  lastCost: 'Last answer', noLastCost: 'No answer yet', spend: 'Spent this month', cap: 'Monthly limit', noCap: 'No limit set', notShown: 'shown to the owner and cofounder', notCounted: 'not counted yet', capNote: 'The limit is recorded. Requests are not yet stopped when it is reached.',
  capField: 'Monthly limit, in rupees', capHint: 'Leave it empty for no limit.', setCap: 'Set the limit', badCap: 'Type rupees with at most two decimals, like 1,234.50.',
  costTitle: 'Cost', voiceTitle: 'Voice', voiceNone: 'No speech provider', voiceProvider: 'Speech provider', minutes: 'Minutes this month',
}, {
  orderTitle: 'रास्ते किस क्रम में आज़माए जाते हैं', routesTitle: 'रास्ते', routesNone: 'कोई रास्ता तैयार नहीं है।',
  'health.ready': 'तैयार', 'health.signed-out': 'साइन आउट', 'health.not-installed': 'इंस्टॉल नहीं', 'health.version-not-tested': 'संस्करण जाँचा नहीं गया',
  'health.timed-out': 'समय ख़त्म', 'health.error': 'गड़बड़ी',
  keeps: 'क्या रखता है', keepsFor: 'कब तक', trains: 'इस पर सीखता है', yes: 'हाँ', no: 'नहीं', country: 'देश', terms: 'शर्तें', readOn: '{date} को पढ़ी गईं',
  termsLink: 'शर्तें पढ़ें', noTerms: 'इस रास्ते की शर्तें दर्ज नहीं हैं।',
  lastCost: 'पिछला जवाब', noLastCost: 'अभी कोई जवाब नहीं', spend: 'इस महीने ख़र्च', cap: 'मासिक सीमा', noCap: 'कोई सीमा तय नहीं', notShown: 'मालिक और सह-संस्थापक को दिखता है', notCounted: 'अभी गिना नहीं गया', capNote: 'सीमा दर्ज है। सीमा पूरी होने पर अनुरोध अभी रोके नहीं जाते।',
  capField: 'मासिक सीमा, रुपयों में', capHint: 'कोई सीमा न रखनी हो तो खाली छोड़ें।', setCap: 'सीमा तय करें', badCap: 'ज़्यादा से ज़्यादा दो दशमलव के साथ रुपये लिखें, जैसे 1,234.50।',
  costTitle: 'लागत', voiceTitle: 'आवाज़', voiceNone: 'कोई आवाज़ सेवा नहीं', voiceProvider: 'आवाज़ सेवा', minutes: 'इस महीने के मिनट',
});

export const NETWORK = cat({
  filterKind: 'Kind', filterPlugin: 'Plugin', all: 'All',
  'kind.model': 'model', 'kind.connector': 'connector', 'kind.action': 'action', 'kind.sharing': 'sharing', 'kind.phone': 'phone', 'kind.sync': 'sync', 'kind.plugin': 'plugin',
  'outcome.allowed': 'allowed', 'outcome.stopped': 'stopped', 'outcome.waiting': 'waiting for you',
  none: 'Nothing has left this computer.', callsTitle: 'Every call that left this computer',
  waitingTitle: 'What would have gone', waitingNote: 'This is the exact content, shown as text. Nothing was sent.', noContent: 'The content was not kept.',
  canaryTitle: 'The canary', planted: 'A test value is planted.', notPlanted: 'No test value is planted.', plant: 'Plant a test value',
  alert: 'A test value, or a GSTIN, mail address or phone number from your books, was seen leaving. Every send is stopped. Call {call} carried it, on {date}.', canaryNote: 'Chausar checks what already left for a planted test value and for GSTINs, mail addresses and phone numbers from your books. It finds a leak after it happened; it cannot yet stop one before it leaves.',
}, {
  filterKind: 'तरह', filterPlugin: 'प्लगइन', all: 'सब',
  'kind.model': 'मॉडल', 'kind.connector': 'कनेक्टर', 'kind.action': 'काम', 'kind.sharing': 'साझा करना', 'kind.phone': 'फ़ोन', 'kind.sync': 'सिंक', 'kind.plugin': 'प्लगइन',
  'outcome.allowed': 'जाने दिया', 'outcome.stopped': 'रोका गया', 'outcome.waiting': 'आपका इंतज़ार',
  none: 'इस कंप्यूटर से कुछ बाहर नहीं गया।', callsTitle: 'इस कंप्यूटर से बाहर गई हर कॉल',
  waitingTitle: 'जो बाहर जाता', waitingNote: 'यह ठीक वही सामग्री है, सादे पाठ के रूप में। कुछ भी भेजा नहीं गया।', noContent: 'सामग्री रखी नहीं गई।',
  canaryTitle: 'जाँच का निशान', planted: 'एक जाँच मान रखा गया है।', notPlanted: 'कोई जाँच मान नहीं रखा गया है।', plant: 'एक जाँच मान रखें',
  alert: 'एक जाँच मान, या आपकी बही का कोई GSTIN, मेल पता या फ़ोन नंबर बाहर जाता दिखा। हर भेजना रोक दिया गया है। इसे कॉल {call} ले गई, {date} को।', canaryNote: 'Chausar बाहर जा चुके अनुरोधों में रखा गया जाँच मान और आपकी बही के GSTIN, मेल पते और फ़ोन नंबर खोजता है। यह रिसाव होने के बाद पता चलता है; बाहर जाने से पहले अभी रोका नहीं जा सकता।',
});

export const RECORD = cat({
  person: 'Person', everyone: 'Everyone', dayField: 'Day (YYYY-MM-DD)', badDay: 'Type a day like 2026-10-14.', showDay: 'Show this day', allDays: 'All days',
  verify: 'Verify', verified: 'Verified.', broken: 'The record breaks at entry {n}.', head: 'Check code {code}',
  limit: 'This record shows tampering. It cannot stop the owner of a computer from wiping that computer.',
  none: 'Nothing is recorded for this choice.', partial: 'Showing the newest {n} entries.', entry: 'Entry {n}',
}, {
  person: 'व्यक्ति', everyone: 'सब', dayField: 'दिन (YYYY-MM-DD)', badDay: '2026-10-14 जैसा दिन लिखें।', showDay: 'यह दिन दिखाएँ', allDays: 'सभी दिन',
  verify: 'जाँचें', verified: 'जाँच हो गई।', broken: 'रिकॉर्ड प्रविष्टि {n} पर टूटता है।', head: 'जाँच कोड {code}',
  limit: 'यह रिकॉर्ड छेड़छाड़ दिखाता है। यह किसी कंप्यूटर के मालिक को उस कंप्यूटर को मिटाने से नहीं रोक सकता।',
  none: 'इस चुनाव के लिए कुछ दर्ज नहीं है।', partial: 'सबसे नई {n} प्रविष्टियाँ दिखाई जा रही हैं।', entry: 'प्रविष्टि {n}',
});

export const SHARING = cat({
  on: 'Sharing is on.', off: 'Sharing is off.', notOpen: 'Sharing is not open yet. Nothing is sent.',
  previewTitle: 'What would be sent', preview: '{bytes}, {events} events', noPreview: 'No preview yet.',
  batchesTitle: 'What I shared', batchesNone: 'Nothing has been shared.', batch: '{events} events', running: '{events} events shared, 0 names, 0 amounts.',
  withdrawn: 'Sharing withdrawn on {date}.', withdraw: 'Withdraw', withdrawAsk: 'Withdraw sharing? Nothing more is sent.', withdrawConfirm: 'Withdraw sharing',
  cleanerTitle: 'The local cleaner', sample: 'Paste a sample', clean: 'Clean it', original: 'Original', cleaned: 'Cleaned copy',
  hit: 'Line {line}: {kind}', noHits: 'Nothing was found to clean.', nothingUploaded: 'Nothing is uploaded.', emptySample: 'Paste some text first.',
  hostedTitle: 'What the paid plan can see', planned: 'Planned, not available yet.', jobsTitle: 'Hosted jobs', jobsNone: 'No hosted job is listed.', keepsTitle: 'What the plan keeps about you',
  agreementsTitle: 'The privacy notice and your agreements', noticeVersion: 'Notice, version {v}', agreed: 'Agreed on {date}.', withdrawnOn: 'Withdrawn on {date}.',
  withdrawAgreement: 'Withdraw', withdrawAgreementAsk: 'Withdraw this agreement?', agreementsNone: 'No agreement is recorded.',
}, {
  on: 'साझा करना चालू है।', off: 'साझा करना बंद है।', notOpen: 'साझा करना अभी खुला नहीं है। कुछ भी भेजा नहीं जाता।',
  previewTitle: 'जो भेजा जाता', preview: '{bytes}, {events} घटनाएँ', noPreview: 'अभी कोई झलक नहीं।',
  batchesTitle: 'मैंने क्या साझा किया', batchesNone: 'कुछ भी साझा नहीं हुआ।', batch: '{events} घटनाएँ', running: '{events} घटनाएँ साझा, 0 नाम, 0 रकम।',
  withdrawn: '{date} को साझा करना वापस लिया गया।', withdraw: 'वापस लें', withdrawAsk: 'साझा करना वापस लें? आगे कुछ नहीं भेजा जाएगा।', withdrawConfirm: 'साझा करना वापस लें',
  cleanerTitle: 'स्थानीय सफ़ाई', sample: 'एक नमूना चिपकाएँ', clean: 'साफ़ करें', original: 'मूल', cleaned: 'साफ़ की हुई प्रति',
  hit: 'पंक्ति {line}: {kind}', noHits: 'साफ़ करने को कुछ नहीं मिला।', nothingUploaded: 'कुछ भी अपलोड नहीं होता।', emptySample: 'पहले कुछ पाठ चिपकाएँ।',
  hostedTitle: 'सशुल्क योजना क्या देख सकती है', planned: 'योजना में है, अभी उपलब्ध नहीं।', jobsTitle: 'होस्ट किए गए काम', jobsNone: 'कोई होस्ट किया गया काम सूची में नहीं है।', keepsTitle: 'योजना आपके बारे में क्या रखती है',
  agreementsTitle: 'निजता सूचना और आपकी सहमतियाँ', noticeVersion: 'सूचना, संस्करण {v}', agreed: '{date} को सहमति दी।', withdrawnOn: '{date} को वापस ली।',
  withdrawAgreement: 'वापस लें', withdrawAgreementAsk: 'यह सहमति वापस लें?', agreementsNone: 'कोई सहमति दर्ज नहीं है।',
});

export const VAULT = cat({
  backupTitle: 'Backups', noBackup: 'No backup yet.', backupOn: 'Last backup: {date}, {size}.',
  'test.passed': 'Its test restore passed.', 'test.failed': 'Its test restore failed.', 'test.not-tested': 'Its test restore has not been run.',
  backupNow: 'Back up now', backedUp: 'Backed up.',
  testTitle: 'Test restore', passphrase: 'Passphrase', runTest: 'Test restore', needPass: 'Type the passphrase.', testPassed: 'The test restore passed.', testFailed: 'The test restore failed.',
  lockTitle: 'The lock', idle: 'Lock after this many idle minutes', deviceCheck: "The computer's own check", saveLock: 'Save the lock', badMinutes: 'Type a whole number of minutes, from 1 to 1440.',
  diskTitle: 'The disk check', disk: '{free} free of {total}.', noDisk: 'The disk check is not available.',
  recoveryTitle: 'The recovery contact', recoveryNote: 'A person you trust who can confirm a recovery.', recoveryNone: 'No recovery contact.', recoveryIs: 'Recovery contact: {name}.',
  recoveryName: 'Name', clearRecovery: 'Remove the contact',
  versionTitle: 'Version', restoreTitle: 'Restore', restoreNote: 'Restoring is done from the workspace menu.',
  deleteLink: 'Delete a source, and the deletion report',
}, {
  backupTitle: 'बैकअप', noBackup: 'अभी कोई बैकअप नहीं।', backupOn: 'पिछला बैकअप: {date}, {size}।',
  'test.passed': 'इसकी जाँच-बहाली सफल रही।', 'test.failed': 'इसकी जाँच-बहाली विफल रही।', 'test.not-tested': 'इसकी जाँच-बहाली अभी नहीं चलाई गई।',
  backupNow: 'अभी बैकअप लें', backedUp: 'बैकअप हो गया।',
  testTitle: 'जाँच-बहाली', passphrase: 'पासफ़्रेज़', runTest: 'जाँच-बहाली चलाएँ', needPass: 'पासफ़्रेज़ लिखें।', testPassed: 'जाँच-बहाली सफल रही।', testFailed: 'जाँच-बहाली विफल रही।',
  lockTitle: 'ताला', idle: 'इतने मिनट कुछ न होने पर बंद करें', deviceCheck: 'कंप्यूटर की अपनी जाँच', saveLock: 'ताला सहेजें', badMinutes: '1 से 1440 तक मिनटों की पूरी संख्या लिखें।',
  diskTitle: 'डिस्क की जाँच', disk: '{total} में से {free} ख़ाली।', noDisk: 'डिस्क की जाँच उपलब्ध नहीं है।',
  recoveryTitle: 'बहाली का संपर्क', recoveryNote: 'कोई भरोसेमंद व्यक्ति जो बहाली की पुष्टि कर सके।', recoveryNone: 'कोई बहाली संपर्क नहीं।', recoveryIs: 'बहाली संपर्क: {name}।',
  recoveryName: 'नाम', clearRecovery: 'संपर्क हटाएँ',
  versionTitle: 'संस्करण', restoreTitle: 'बहाली', restoreNote: 'बहाली कार्यस्थान के मेन्यू से की जाती है।',
  deleteLink: 'कोई स्रोत हटाएँ, और हटाने की रिपोर्ट',
});

export const DELETION = cat({
  title: 'Delete a source', ownerOnly: 'Only the owner can delete a source.', chooseSource: 'Source', sourceField: 'Source id',
  again: 'Type the source id again to confirm', mismatch: 'The two do not match.', delete: 'Delete everywhere',
  reportTitle: 'Deletion report', reportOf: 'Source {source}, {date}', place: 'Place', state: 'State', reason: 'Reason',
  'state.deleted': 'deleted', 'state.pending': 'pending', 'state.not-possible': 'not possible', 'state.not-built': 'not built yet',
  earlier: 'Earlier reports', none: 'No deletion yet.', export: 'Export the report', exported: 'Saved as {name}.',
}, {
  title: 'कोई स्रोत हटाएँ', ownerOnly: 'स्रोत केवल मालिक हटा सकते हैं।', chooseSource: 'स्रोत', sourceField: 'स्रोत की पहचान',
  again: 'पुष्टि के लिए स्रोत की पहचान फिर से लिखें', mismatch: 'दोनों मेल नहीं खाते।', delete: 'हर जगह से हटाएँ',
  reportTitle: 'हटाने की रिपोर्ट', reportOf: 'स्रोत {source}, {date}', place: 'जगह', state: 'स्थिति', reason: 'कारण',
  'state.deleted': 'हटाया गया', 'state.pending': 'बाक़ी', 'state.not-possible': 'संभव नहीं', 'state.not-built': 'अभी बना नहीं',
  earlier: 'पिछली रिपोर्टें', none: 'अभी कुछ नहीं हटाया गया।', export: 'रिपोर्ट निर्यात करें', exported: '{name} के रूप में सहेजा गया।',
});
