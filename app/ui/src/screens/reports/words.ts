/**
 * Every word a person reads on the Reports screens, in English and Hindi. A sentence with
 * a value in it is one whole template per language; `fill` puts the values in as text.
 */
import type { Catalogue } from '../../places/types.ts';

type Key =
  | 'where' | 'packs' | 'weekahead' | 'duedates' | 'exports' | 'sent' | 'briefs'
  | 'packsNote' | 'packGst' | 'gst.regular' | 'gst.composition' | 'gst.none' | 'checkedAt' | 'packsEmpty' | 'pagesEmpty'
  | 'state.ready-tested' | 'state.ready-untested' | 'state.not-started' | 'stateWithReason'
  | 'pageKind' | 'badSheet' | 'language' | 'english' | 'hindi' | 'print' | 'exportTo'
  | 'fmt.xlsx' | 'fmt.csv' | 'fmt.html' | 'fmt.pdf' | 'fmt.tally'
  | 'making' | 'fileMade' | 'fileSize' | 'checkNumber' | 'notEncrypted' | 'textCells'
  | 'refused.PDF_USES_PRINT' | 'refused.TALLY_PAGE_EXPORT_NOT_AVAILABLE' | 'refused.TALLY_PAGE_NO_FIGURES' | 'tallyVouchers' | 'tallyLeftOut' | 'refused.RELAY_NOT_AVAILABLE' | 'refused.ACCESS_DENIED' | 'refused.notBuilt' | 'refused.other'
  | 'periodLine' | 'noPeriod' | 'madeAt' | 'at' | 'projection' | 'projectionNote' | 'gap' | 'pageGaps' | 'notes' | 'source' | 'checkedOn' | 'notLegal'
  | 'markings' | 'marking.personal' | 'marking.financial' | 'marking.confidential' | 'footerCheck' | 'footerAt' | 'footerNone'
  | 'viewerNoExport' | 'receipts' | 'receipt' | 'pageNotStarted' | 'Dr' | 'Cr' | 'lineId'
  | 'review' | 'monday' | 'friday' | 'changed' | 'decide' | 'due' | 'nothingHere' | 'inbox' | 'inboxEmpty' | 'reviewOn'
  | 'missed' | 'missedNone' | 'late' | 'builtOnTime' | 'explanation' | 'rhythmLink' | 'chartSentence' | 'briefId'
  | 'decisions' | 'decisionsNone' | 'observed' | 'notObserved' | 'lessons' | 'lessonEvidence' | 'lessonChange' | 'lessonsWhere' | 'lessonsNone' | 'lessonsUnavailable'
  | 'rhythm' | 'days' | 'day0' | 'day1' | 'day2' | 'day3' | 'day4' | 'day5' | 'day6' | 'time' | 'dailyClosing' | 'fyStart' | 'missedRule' | 'run-late' | 'skip'
  | 'mail' | 'whatsapp' | 'mailAddress' | 'phone' | 'verify' | 'verifying' | 'verified' | 'notVerified' | 'relayNotAvailable' | 'partial' | 'templateNotApproved'
  | 'testMode' | 'preview' | 'save' | 'saving' | 'saved' | 'nothingChanged' | 'rhythmReadOnly' | 'badTime' | 'badFy' | 'badDays'
  | 'dueOn' | 'lastChecked' | 'checkOld' | 'appliesKinds' | 'appliesGst' | 'appliesStates' | 'notCovered' | 'coveredKinds' | 'dueNone'
  | 'profile' | 'kind' | 'gstMode' | 'stateCode' | 'noProfile' | 'badState' | 'badKind' | 'profileReadOnly' | 'tableVersion'
  | 'exportAll' | 'exportWarning' | 'lockedChoice' | 'confirmTitle' | 'confirm' | 'cancel' | 'exportingAll' | 'exportDone' | 'exportedAt'
  | 'stores' | 'storeName' | 'storeRows' | 'storeCheck' | 'locked' | 'notLocked' | 'encrypted' | 'earlier' | 'noExports' | 'ownerOnly' | 'folder' | 'askLink'
  | 'ask' | 'askNote' | 'question' | 'receiptId' | 'reason' | 'make' | 'fileName' | 'sendsNothing' | 'needQuestion' | 'needReason' | 'badReceipt' | 'askReadOnly'
  | 'notBuilt' | 'unknownSheet' | 'on' | 'off' | 'notSet'
  | 'period' | 'period.fytd' | 'period.last-fy' | 'period.month' | 'period.quarter' | 'period.custom' | 'period.badDate' | 'period.badOrder' | 'period.tooLong'
  | 'periodMonth' | 'periodFyStart' | 'periodQuarter' | 'quarter.1' | 'quarter.2' | 'quarter.3' | 'quarter.4' | 'periodFrom' | 'periodTo' | 'periodShow' | 'periodHead'
  | 'sourceDate' | 'sourceUndated' | 'sourceUnconfirmed'
  | 'noChange' | 'notEnough' | 'notEnoughAction' | 'partlyLoaded' | 'briefGaps' | 'lakh' | 'crore'
  | 'channels' | 'channel.whatsapp' | 'channel.telegram' | 'channel.mail' | 'channelOn' | 'channelOff' | 'channelVerified' | 'channelNotVerified'
  | 'channelsWhere' | 'channelsLink' | 'channelsNotBuilt' | 'channelsStale' | 'channelsFailed' | 'channelsLoading' | 'channelsNone'
  | 'kindOther' | 'kindOtherName' | 'stateNames'
  | 'receiptPick' | 'receiptNone' | 'receiptsNotBuilt' | 'receiptsEmpty' | 'receiptsFailed' | 'savedAnswer' | 'savedUntitled' | 'receiptTyped'
  | 'openQuestion' | 'questionFiles' | 'questionFilesNone' | 'questionFilesNotBuilt' | 'openFile' | 'questionFileMade' | 'questionFileClose' | 'questionFileNote';

export const WORDS: Catalogue<Key> = {
  en: {
    where: 'Reports', packs: 'Packs', weekahead: 'The week ahead', duedates: 'Due dates', exports: 'Exports', sent: 'Sent', briefs: 'Briefs',
    packsNote: 'The papers a bank, an investor or a CA asks for.', packGst: 'Applies to GST: {modes}',
    'gst.regular': 'regular', 'gst.composition': 'composition', 'gst.none': 'no GST', checkedAt: 'Checked {when}',
    packsEmpty: 'No packs are set up yet.', pagesEmpty: 'This pack has no pages yet.',
    'state.ready-tested': 'Ready and tested', 'state.ready-untested': 'Ready, not tested yet', 'state.not-started': 'Not started', stateWithReason: '{state}: {reason}',
    pageKind: 'Report page', badSheet: 'This address is not a page of any pack.', language: 'Report language', english: 'English', hindi: 'हिन्दी',
    print: 'Print', exportTo: 'Export',
    'fmt.xlsx': 'Excel', 'fmt.csv': 'CSV', 'fmt.html': 'HTML', 'fmt.pdf': 'PDF', 'fmt.tally': 'File for Tally',
    making: 'Making the file…', fileMade: 'File made: {name}', fileSize: 'Size: {size} bytes', checkNumber: 'Check number: {check}',
    notEncrypted: 'This file is not encrypted.', textCells: 'Text cells are written as text, so a spreadsheet cannot run them as formulas.',
    'refused.PDF_USES_PRINT': 'Use Print and choose Save as PDF.',
    'refused.TALLY_PAGE_EXPORT_NOT_AVAILABLE': 'Only a page of balances with Dr and Cr can go to Tally. Export this page to Excel or CSV instead.',
    'refused.TALLY_PAGE_NO_FIGURES': 'No amount on this page is known yet, so there is nothing for Tally to import.',
    tallyVouchers: '{count} amounts are in the file as Memorandum vouchers, which stay out of the books in Tally.',
    tallyLeftOut: 'Left out, not written as zero: {line}',
    'refused.RELAY_NOT_AVAILABLE': 'The relay is a paid, hosted part: planned, not available yet.',
    'refused.ACCESS_DENIED': 'Your seat is not allowed to do this.', 'refused.notBuilt': 'This is not built yet.',
    'refused.other': 'That did not work. Code: {code}',
    period: 'Period', 'period.fytd': 'This financial year to date', 'period.last-fy': 'Last financial year', 'period.month': 'A month',
    'period.quarter': 'A quarter', 'period.custom': 'From and to', 'period.badDate': 'Choose real dates for the period.',
    'period.badOrder': 'The start date must be on or before the end date.', 'period.tooLong': 'Choose a period of at most two years.',
    periodMonth: 'Month', periodFyStart: 'Financial year starting in (year)', periodQuarter: 'Quarter',
    'quarter.1': 'April to June', 'quarter.2': 'July to September', 'quarter.3': 'October to December', 'quarter.4': 'January to March',
    periodFrom: 'From', periodTo: 'To', periodShow: 'Show this period', periodHead: '{kind}: {period}',
    sourceDate: 'Source dated {date}', sourceUndated: 'The source states no date.', sourceUnconfirmed: 'This source could not be opened and checked yet; it is the closest official page found.',
    periodLine: '{from} to {to}', noPeriod: 'No period', madeAt: 'Made {when}', at: '{date}, {time} UTC',
    projection: 'Projection', projectionNote: 'A projection, not a fact. It is kept apart from the facts above.',
    gap: 'Gap: {gap}', pageGaps: 'Gaps in the data', notes: 'Notes', source: 'Source: {title}', checkedOn: 'Checked on {date}', notLegal: 'Not legal advice.',
    markings: 'Markings', 'marking.personal': 'Personal', 'marking.financial': 'Financial', 'marking.confidential': 'Confidential',
    footerCheck: 'Check code {code}', footerAt: 'Recorded {when}', footerNone: 'No check code on this page yet.',
    viewerNoExport: 'Your seat can read and print this page, not export it.', receipts: 'Receipts on this page', receipt: 'Receipt',
    pageNotStarted: 'This page is not started yet.', Dr: 'Dr', Cr: 'Cr', lineId: 'Line {id}',
    review: 'Which review', monday: 'Monday', friday: 'Friday', changed: 'What changed', decide: 'What needs a decision', due: 'What is due',
    nothingHere: 'Nothing here this week.', inbox: 'Decision inbox', inboxEmpty: 'No decisions are waiting.', reviewOn: 'Review on {date}',
    missed: 'Missed while the computer slept', missedNone: 'Nothing was missed.',
    late: 'Due {scheduled}; made {built}.', builtOnTime: 'Made {built}.',
    explanation: 'The written explanation is a separate, optional step. It has not been written.',
    rhythmLink: 'Rhythm and delivery', chartSentence: 'How this number moved: {what}', briefId: 'Brief {id}',
    decisions: 'Decisions due for review', decisionsNone: 'No decisions are due for review.', observed: 'What was observed: {what}', notObserved: 'Nothing observed yet.',
    lessons: 'Proposed lessons', lessonEvidence: 'Evidence: {count}', lessonChange: 'What it would change: {change}',
    lessonsWhere: 'Approving lessons happens in Work · Approvals.', lessonsNone: 'No lessons are proposed this week.', lessonsUnavailable: 'Proposed lessons are not available yet.',
    rhythm: 'Rhythm and delivery', days: 'Days', day0: 'Sun', day1: 'Mon', day2: 'Tue', day3: 'Wed', day4: 'Thu', day5: 'Fri', day6: 'Sat',
    time: 'Time (HH:MM)', dailyClosing: 'Daily closing', fyStart: 'Financial year starts (MM-DD)',
    missedRule: 'When the computer was asleep at brief time', 'run-late': 'Make it late', skip: 'Skip it',
    mail: 'Delivery by mail', whatsapp: 'Delivery by WhatsApp', mailAddress: 'Your mail address', phone: 'Your phone number',
    verify: 'Verify', verifying: 'Verifying…', verified: 'Verified.', notVerified: 'Nothing is sent until this is verified.',
    relayNotAvailable: 'The relay is a paid, hosted part: planned, not available yet.', partial: 'Partial',
    templateNotApproved: 'The WhatsApp message template is not approved yet.', testMode: 'Sends only to the demo inbox and phone.',
    preview: 'The exact message, shown before the first one is sent', save: 'Save', saving: 'Saving…', saved: 'Saved.', nothingChanged: 'Nothing has changed yet.',
    rhythmReadOnly: 'Your seat can read these settings, not change them.', badTime: 'Write the time as HH:MM, for example 08:30.',
    badFy: 'Write the date as MM-DD, for example 04-01.', badDays: 'Choose at least one day.',
    dueOn: 'Due {date}', lastChecked: 'Last checked {date}', checkOld: 'Checked more than 30 days ago.',
    appliesKinds: 'Kinds of business: {list}', appliesGst: 'GST modes: {list}', appliesStates: 'States: {list}',
    notCovered: 'Due dates for this kind of business are not covered yet.', coveredKinds: 'Covered now: {list}', dueNone: 'Nothing is due in this window.',
    profile: 'Your business', kind: 'Kind of business', gstMode: 'GST mode', stateCode: 'State (two letters)', noProfile: 'No business profile is set yet.',
    badState: 'Write the state as two capital letters, for example MH.', badKind: 'Write the kind of business.',
    profileReadOnly: 'Only the owner or a cofounder can change the profile.', tableVersion: 'Table {version}, published {date}',
    exportAll: 'Export everything', exportWarning: 'Exported files are not encrypted.', lockedChoice: 'Put the files in a locked archive',
    confirmTitle: 'Export everything now? Every store is written to open files on this computer.', confirm: 'Yes, export everything', cancel: 'Cancel',
    exportingAll: 'Exporting…', exportDone: 'Export finished.', exportedAt: 'Exported {when}',
    stores: 'What was exported', storeName: 'Store', storeRows: 'Rows', storeCheck: 'Check number',
    locked: 'Locked archive', notLocked: 'Not locked', encrypted: 'Encrypted', earlier: 'Earlier exports', noExports: 'Nothing has been exported yet.',
    ownerOnly: 'Only the owner can export everything. You can read the list.', folder: 'Folder: {folder}', askLink: 'Ask a person',
    ask: 'Ask a person', askNote: 'One file made from your question, its receipt and the reason, for your own accountant or CA.',
    question: 'Your question', receiptId: 'Receipt id (optional)', reason: 'Why you are asking', make: 'Make the file', fileName: 'File: {name}',
    sendsNothing: 'The app sends nothing by itself. Send this file to your accountant or CA yourself.',
    needQuestion: 'Write your question.', needReason: 'Write why you are asking.', badReceipt: 'A receipt id has only letters, digits, dots, dashes and underscores.',
    askReadOnly: 'Your seat cannot make a question file.', notBuilt: 'Not built yet.', unknownSheet: 'Nothing opens at this address.', on: 'On', off: 'Off', notSet: 'Not set',
    noChange: 'No change since Monday.', notEnough: 'Not enough loaded to tell: the week before has no records yet.', notEnoughAction: 'Add a source',
    partlyLoaded: 'Partly loaded: some records were not counted.', briefGaps: 'What this brief cannot show', lakh: 'lakh', crore: 'crore',
    channels: 'Where briefs go', 'channel.whatsapp': 'WhatsApp', 'channel.telegram': 'Telegram', 'channel.mail': 'Mail',
    channelOn: 'On', channelOff: 'Off', channelVerified: 'Verified', channelNotVerified: 'Not verified yet: nothing is sent.',
    channelsWhere: 'Each channel is switched on, agreed to and verified in Tools · Phone. This page only shows where it stands.',
    channelsLink: 'Open Tools · Phone', channelsNotBuilt: 'Phone channels are not built yet, so briefs are not sent anywhere.',
    channelsStale: 'Last known state: the relay could not be reached just now.', channelsFailed: 'Where briefs go could not be read. Code {code}',
    channelsLoading: 'Reading where briefs go…', channelsNone: 'No phone channel is set up yet.',
    kindOther: 'Another kind', kindOtherName: 'Name the kind of business (lower-case words)', stateNames: 'State',
    receiptPick: 'A receipt to attach (optional)', receiptNone: 'No receipt', receiptsNotBuilt: 'Saved answers cannot be listed here yet; type a receipt id instead.',
    receiptsEmpty: 'You have no saved answers yet; type a receipt id instead.', receiptsFailed: 'Saved answers could not be read. Code {code}',
    savedAnswer: '{question}, saved {date}', savedUntitled: 'A saved answer', receiptTyped: 'Or type a receipt id',
    openQuestion: 'Open a question file', questionFiles: 'Question files in this workspace', questionFilesNone: 'No question file has been made in this workspace yet.',
    questionFilesNotBuilt: 'Opening question files is not built yet.', openFile: 'Open', questionFileMade: '{name}, made {when}', questionFileClose: 'Close the file',
    questionFileNote: 'The file is shown as text, exactly as it was written.',
  },
  hi: {
    where: 'रिपोर्ट', packs: 'पैक', weekahead: 'आने वाला हफ़्ता', duedates: 'नियत तारीख़ें', exports: 'निर्यात', sent: 'भेजे गए', briefs: 'ब्रीफ़',
    packsNote: 'वे काग़ज़ जो बैंक, निवेशक या CA माँगते हैं।', packGst: 'GST पर लागू: {modes}',
    'gst.regular': 'नियमित', 'gst.composition': 'कंपोज़िशन', 'gst.none': 'GST नहीं', checkedAt: 'जाँचा गया {when}',
    packsEmpty: 'अभी कोई पैक तैयार नहीं है।', pagesEmpty: 'इस पैक में अभी कोई पन्ना नहीं है।',
    'state.ready-tested': 'तैयार और जाँचा हुआ', 'state.ready-untested': 'तैयार, अभी जाँचा नहीं गया', 'state.not-started': 'शुरू नहीं हुआ', stateWithReason: '{state}: {reason}',
    pageKind: 'रिपोर्ट का पन्ना', badSheet: 'यह पता किसी पैक का पन्ना नहीं है।', language: 'रिपोर्ट की भाषा', english: 'English', hindi: 'हिन्दी',
    print: 'प्रिंट करें', exportTo: 'निर्यात करें',
    'fmt.xlsx': 'Excel', 'fmt.csv': 'CSV', 'fmt.html': 'HTML', 'fmt.pdf': 'PDF', 'fmt.tally': 'Tally के लिए फ़ाइल',
    making: 'फ़ाइल बन रही है…', fileMade: 'फ़ाइल बनी: {name}', fileSize: 'आकार: {size} बाइट', checkNumber: 'जाँच संख्या: {check}',
    notEncrypted: 'यह फ़ाइल एन्क्रिप्टेड नहीं है।', textCells: 'टेक्स्ट वाले सेल टेक्स्ट की तरह लिखे जाते हैं, ताकि स्प्रेडशीट उन्हें फ़ॉर्मूला की तरह न चला सके।',
    'refused.PDF_USES_PRINT': 'प्रिंट दबाएँ और Save as PDF चुनें।',
    'refused.TALLY_PAGE_EXPORT_NOT_AVAILABLE': 'केवल Dr और Cr वाले शेष का पन्ना Tally में जा सकता है। इस पन्ने को Excel या CSV में निर्यात करें।',
    'refused.TALLY_PAGE_NO_FIGURES': 'इस पन्ने की कोई राशि अभी ज्ञात नहीं है, इसलिए Tally में आयात के लिए कुछ नहीं है।',
    tallyVouchers: 'फ़ाइल में {count} राशियाँ मेमोरेंडम वाउचर के रूप में हैं, जो Tally में खातों से बाहर रहते हैं।',
    tallyLeftOut: 'छोड़ा गया, शून्य नहीं लिखा गया: {line}',
    'refused.RELAY_NOT_AVAILABLE': 'रिले एक सशुल्क, होस्ट किया गया हिस्सा है: योजना में है, अभी उपलब्ध नहीं।',
    'refused.ACCESS_DENIED': 'आपकी सीट को यह करने की अनुमति नहीं है।', 'refused.notBuilt': 'यह अभी बना नहीं है।',
    'refused.other': 'यह नहीं हो सका। कोड: {code}',
    period: 'अवधि', 'period.fytd': 'इस वित्त वर्ष में अब तक', 'period.last-fy': 'पिछला वित्त वर्ष', 'period.month': 'एक महीना',
    'period.quarter': 'एक तिमाही', 'period.custom': 'से और तक', 'period.badDate': 'अवधि के लिए सही तारीख़ें चुनें।',
    'period.badOrder': 'शुरू की तारीख़ आख़िरी तारीख़ से पहले या उसी दिन होनी चाहिए।', 'period.tooLong': 'अधिकतम दो साल की अवधि चुनें।',
    periodMonth: 'महीना', periodFyStart: 'वित्त वर्ष जिस साल शुरू हुआ (वर्ष)', periodQuarter: 'तिमाही',
    'quarter.1': 'अप्रैल से जून', 'quarter.2': 'जुलाई से सितंबर', 'quarter.3': 'अक्टूबर से दिसंबर', 'quarter.4': 'जनवरी से मार्च',
    periodFrom: 'से', periodTo: 'तक', periodShow: 'यह अवधि दिखाएँ', periodHead: '{kind}: {period}',
    sourceDate: 'स्रोत की तारीख़ {date}', sourceUndated: 'स्रोत में कोई तारीख़ नहीं दी गई है।', sourceUnconfirmed: 'यह स्रोत अभी खोलकर जाँचा नहीं जा सका; यह मिला सबसे नज़दीकी आधिकारिक पेज है।',
    periodLine: '{from} से {to}', noPeriod: 'कोई अवधि नहीं', madeAt: 'बना {when}', at: '{date}, {time} UTC',
    projection: 'अनुमान', projectionNote: 'यह अनुमान है, तथ्य नहीं। इसे ऊपर के तथ्यों से अलग रखा गया है।',
    gap: 'कमी: {gap}', pageGaps: 'डेटा में कमियाँ', notes: 'टिप्पणियाँ', source: 'स्रोत: {title}', checkedOn: '{date} को जाँचा गया', notLegal: 'यह क़ानूनी सलाह नहीं है।',
    markings: 'चिह्न', 'marking.personal': 'निजी', 'marking.financial': 'वित्तीय', 'marking.confidential': 'गोपनीय',
    footerCheck: 'जाँच कोड {code}', footerAt: 'दर्ज {when}', footerNone: 'इस पन्ने पर अभी जाँच कोड नहीं है।',
    viewerNoExport: 'आपकी सीट यह पन्ना पढ़ और प्रिंट कर सकती है, निर्यात नहीं।', receipts: 'इस पन्ने की रसीदें', receipt: 'रसीद',
    pageNotStarted: 'यह पन्ना अभी शुरू नहीं हुआ है।', Dr: 'नामे', Cr: 'जमा', lineId: 'पंक्ति {id}',
    review: 'कौन सी समीक्षा', monday: 'सोमवार', friday: 'शुक्रवार', changed: 'क्या बदला', decide: 'किस पर फ़ैसला चाहिए', due: 'क्या देय है',
    nothingHere: 'इस हफ़्ते यहाँ कुछ नहीं।', inbox: 'फ़ैसलों का इनबॉक्स', inboxEmpty: 'कोई फ़ैसला बाक़ी नहीं है।', reviewOn: '{date} को समीक्षा',
    missed: 'कंप्यूटर के सोते समय जो छूटा', missedNone: 'कुछ नहीं छूटा।',
    late: 'तय समय {scheduled}; बना {built}।', builtOnTime: 'बना {built}।',
    explanation: 'लिखित व्याख्या एक अलग, वैकल्पिक क़दम है। वह अभी लिखी नहीं गई है।',
    rhythmLink: 'लय और भेजना', chartSentence: 'यह संख्या कैसे बदली: {what}', briefId: 'ब्रीफ़ {id}',
    decisions: 'समीक्षा के लिए देय फ़ैसले', decisionsNone: 'कोई फ़ैसला समीक्षा के लिए देय नहीं है।', observed: 'क्या देखा गया: {what}', notObserved: 'अभी कुछ देखा नहीं गया।',
    lessons: 'प्रस्तावित सबक़', lessonEvidence: 'प्रमाण: {count}', lessonChange: 'इससे क्या बदलेगा: {change}',
    lessonsWhere: 'सबक़ों की मंज़ूरी काम · मंज़ूरियाँ में होती है।', lessonsNone: 'इस हफ़्ते कोई सबक़ प्रस्तावित नहीं है।', lessonsUnavailable: 'प्रस्तावित सबक़ अभी उपलब्ध नहीं हैं।',
    rhythm: 'लय और भेजना', days: 'दिन', day0: 'रवि', day1: 'सोम', day2: 'मंगल', day3: 'बुध', day4: 'गुरु', day5: 'शुक्र', day6: 'शनि',
    time: 'समय (HH:MM)', dailyClosing: 'रोज़ का समापन', fyStart: 'वित्त वर्ष शुरू होता है (MM-DD)',
    missedRule: 'जब ब्रीफ़ के समय कंप्यूटर सो रहा था', 'run-late': 'देर से बनाएँ', skip: 'छोड़ दें',
    mail: 'मेल से भेजना', whatsapp: 'WhatsApp से भेजना', mailAddress: 'आपका मेल पता', phone: 'आपका फ़ोन नंबर',
    verify: 'पुष्टि करें', verifying: 'पुष्टि हो रही है…', verified: 'पुष्टि हो गई।', notVerified: 'पुष्टि होने तक कुछ नहीं भेजा जाता।',
    relayNotAvailable: 'रिले एक सशुल्क, होस्ट किया गया हिस्सा है: योजना में है, अभी उपलब्ध नहीं।', partial: 'आंशिक',
    templateNotApproved: 'WhatsApp संदेश का साँचा अभी मंज़ूर नहीं हुआ है।', testMode: 'केवल डेमो इनबॉक्स और फ़ोन पर भेजता है।',
    preview: 'पहला संदेश भेजने से पहले दिखाया गया ठीक वही संदेश', save: 'सहेजें', saving: 'सहेजा जा रहा है…', saved: 'सहेजा गया।', nothingChanged: 'अभी कुछ नहीं बदला है।',
    rhythmReadOnly: 'आपकी सीट ये सेटिंग पढ़ सकती है, बदल नहीं सकती।', badTime: 'समय HH:MM में लिखें, जैसे 08:30।',
    badFy: 'तारीख़ MM-DD में लिखें, जैसे 04-01।', badDays: 'कम से कम एक दिन चुनें।',
    dueOn: 'देय {date}', lastChecked: 'आख़िरी जाँच {date}', checkOld: '30 दिन से ज़्यादा पहले जाँचा गया।',
    appliesKinds: 'व्यवसाय के प्रकार: {list}', appliesGst: 'GST प्रकार: {list}', appliesStates: 'राज्य: {list}',
    notCovered: 'इस तरह के व्यवसाय की नियत तारीख़ें अभी शामिल नहीं हैं।', coveredKinds: 'अभी शामिल: {list}', dueNone: 'इस अवधि में कुछ देय नहीं है।',
    profile: 'आपका व्यवसाय', kind: 'व्यवसाय का प्रकार', gstMode: 'GST प्रकार', stateCode: 'राज्य (दो अक्षर)', noProfile: 'व्यवसाय की प्रोफ़ाइल अभी तय नहीं है।',
    badState: 'राज्य दो बड़े अक्षरों में लिखें, जैसे MH।', badKind: 'व्यवसाय का प्रकार लिखें।',
    profileReadOnly: 'केवल मालिक या सह-संस्थापक प्रोफ़ाइल बदल सकते हैं।', tableVersion: 'तालिका {version}, प्रकाशित {date}',
    exportAll: 'सब कुछ निर्यात करें', exportWarning: 'निर्यात की गई फ़ाइलें एन्क्रिप्टेड नहीं होतीं।', lockedChoice: 'फ़ाइलों को ताले वाले संग्रह में रखें',
    confirmTitle: 'अभी सब कुछ निर्यात करें? हर भंडार इस कंप्यूटर पर खुली फ़ाइलों में लिखा जाएगा।', confirm: 'हाँ, सब कुछ निर्यात करें', cancel: 'रद्द करें',
    exportingAll: 'निर्यात हो रहा है…', exportDone: 'निर्यात पूरा हुआ।', exportedAt: 'निर्यात {when}',
    stores: 'क्या निर्यात हुआ', storeName: 'भंडार', storeRows: 'पंक्तियाँ', storeCheck: 'जाँच संख्या',
    locked: 'ताले वाला संग्रह', notLocked: 'ताला नहीं', encrypted: 'एन्क्रिप्टेड', earlier: 'पिछले निर्यात', noExports: 'अभी तक कुछ निर्यात नहीं हुआ।',
    ownerOnly: 'सब कुछ केवल मालिक निर्यात कर सकते हैं। आप सूची पढ़ सकते हैं।', folder: 'फ़ोल्डर: {folder}', askLink: 'किसी व्यक्ति से पूछें',
    ask: 'किसी व्यक्ति से पूछें', askNote: 'आपके सवाल, उसकी रसीद और कारण से बनी एक फ़ाइल, आपके अपने अकाउंटेंट या CA के लिए।',
    question: 'आपका सवाल', receiptId: 'रसीद आईडी (वैकल्पिक)', reason: 'आप क्यों पूछ रहे हैं', make: 'फ़ाइल बनाएँ', fileName: 'फ़ाइल: {name}',
    sendsNothing: 'ऐप अपने आप कुछ नहीं भेजता। यह फ़ाइल अपने अकाउंटेंट या CA को ख़ुद भेजें।',
    needQuestion: 'अपना सवाल लिखें।', needReason: 'लिखें कि आप क्यों पूछ रहे हैं।', badReceipt: 'रसीद आईडी में केवल अक्षर, अंक, बिंदु, डैश और अंडरस्कोर होते हैं।',
    askReadOnly: 'आपकी सीट सवाल की फ़ाइल नहीं बना सकती।', notBuilt: 'अभी बना नहीं है।', unknownSheet: 'इस पते पर कुछ नहीं खुलता।', on: 'चालू', off: 'बंद', notSet: 'तय नहीं',
    noChange: 'सोमवार से कोई बदलाव नहीं।', notEnough: 'बताने के लिए पूरा डेटा नहीं है: उससे पहले के हफ़्ते का कोई रिकॉर्ड अभी नहीं है।', notEnoughAction: 'स्रोत जोड़ें',
    partlyLoaded: 'आंशिक रूप से लोड: कुछ रिकॉर्ड गिने नहीं गए।', briefGaps: 'यह ब्रीफ़ क्या नहीं दिखा सकता', lakh: 'लाख', crore: 'करोड़',
    channels: 'ब्रीफ़ कहाँ जाते हैं', 'channel.whatsapp': 'WhatsApp', 'channel.telegram': 'Telegram', 'channel.mail': 'मेल',
    channelOn: 'चालू', channelOff: 'बंद', channelVerified: 'पुष्टि हो चुकी', channelNotVerified: 'अभी पुष्टि नहीं हुई: कुछ नहीं भेजा जाता।',
    channelsWhere: 'हर चैनल औज़ार · फ़ोन में चालू किया जाता है, उसकी सहमति दी जाती है और पुष्टि होती है। यह पन्ना केवल उसकी स्थिति दिखाता है।',
    channelsLink: 'औज़ार · फ़ोन खोलें', channelsNotBuilt: 'फ़ोन चैनल अभी बने नहीं हैं, इसलिए ब्रीफ़ कहीं नहीं भेजे जाते।',
    channelsStale: 'आख़िरी ज्ञात स्थिति: अभी रिले तक पहुँच नहीं हो सकी।', channelsFailed: 'ब्रीफ़ कहाँ जाते हैं, यह पढ़ा नहीं जा सका। कोड {code}',
    channelsLoading: 'ब्रीफ़ कहाँ जाते हैं, पढ़ा जा रहा है…', channelsNone: 'अभी कोई फ़ोन चैनल तय नहीं है।',
    kindOther: 'कोई और प्रकार', kindOtherName: 'व्यवसाय के प्रकार का नाम लिखें (अंग्रेज़ी के छोटे अक्षरों में)', stateNames: 'राज्य',
    receiptPick: 'जोड़ने के लिए एक रसीद (वैकल्पिक)', receiptNone: 'कोई रसीद नहीं', receiptsNotBuilt: 'सहेजे गए जवाब अभी यहाँ नहीं दिख सकते; इसके बजाय रसीद आईडी लिखें।',
    receiptsEmpty: 'आपके पास अभी कोई सहेजा गया जवाब नहीं है; इसके बजाय रसीद आईडी लिखें।', receiptsFailed: 'सहेजे गए जवाब पढ़े नहीं जा सके। कोड {code}',
    savedAnswer: '{question}, सहेजा गया {date}', savedUntitled: 'एक सहेजा गया जवाब', receiptTyped: 'या रसीद आईडी लिखें',
    openQuestion: 'सवाल की फ़ाइल खोलें', questionFiles: 'इस वर्कस्पेस की सवाल वाली फ़ाइलें', questionFilesNone: 'इस वर्कस्पेस में अभी कोई सवाल की फ़ाइल नहीं बनी है।',
    questionFilesNotBuilt: 'सवाल की फ़ाइलें खोलना अभी बना नहीं है।', openFile: 'खोलें', questionFileMade: '{name}, बनी {when}', questionFileClose: 'फ़ाइल बंद करें',
    questionFileNote: 'फ़ाइल टेक्स्ट के रूप में, ठीक वैसे ही दिखाई गई है जैसे लिखी गई थी।',
  },
};

export type Words = Readonly<Record<Key, string>>;

/** One whole template with its values put in as text. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (all, name: string) => values[name] ?? all);
}
