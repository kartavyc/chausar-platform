/**
 * Words for the round-2 job screens (person steps, the measure, Edit and Delete, the missed-run
 * rule, month-end) and Chausar is driving, in English and Hindi. Kept apart from text.ts so the
 * Work catalogues merge cleanly.
 */
import type { Language } from '../../app/presentation.ts';
import { words } from '../../places/types.ts';
import { fill } from './kit/words.ts';

const EN = {
  'person.you': 'You', 'person.named': '{name}', 'person.done': 'Done', 'person.doneOn': 'Done on {when} by {by}', 'person.doneOnly': 'Done on {when}',
  'person.waits': 'The job waits for this step. It is never marked done by itself.',
  'person.notBuilt': 'Marking a step done arrives with job extensions. Not built yet.',
  'person.notYours': 'This step is for {name}.',
  'measure.title': 'The measure against its goal', 'measure.goal': 'Goal', 'measure.sentence': '{name} at each run, against its goal.',
  'measure.goalWritten': 'Goal set on the job: {amount}. It has no receipt, so it is written here and not drawn.',
  'measure.gaps': '{n} runs have no figure you can read. They show as gaps.', 'measure.none': 'This job has no measure yet: no run has named a calculation.',
  'schedule.title': 'When it runs', 'schedule.every': 'every {n} days', 'schedule.everyMs': 'on a fixed interval',
  'schedule.monthEnd': 'the last day of each month at {at} ({zone})', 'schedule.calendar': 'on a calendar, at {at} ({zone})', 'schedule.paused': 'calendar paused',
  'missed.change': 'Change the missed-run rule', 'missed.save': 'Save the rule', 'missed.notBuilt': 'Changing this rule for this job is not built yet.',
  'missed.after': 'Changed. The job waits for your approval again.',
  'edit.title': 'Edit', 'edit.open': 'Edit the job', 'edit.save': 'Save the change', 'edit.note': 'A change goes through a new approval before the job runs again.',
  'edit.notBuilt': 'Editing this job is not built yet. A ready-made brief cannot be changed; cancel it and start another.',
  'edit.nothing': 'Change at least one thing.', 'edit.done': 'Changed. It waits for your approval.',
  'delete.open': 'Delete', 'delete.ask': 'Delete this job?', 'delete.yes': 'Delete it', 'delete.keep': 'Keep it',
  'delete.cancelNote': 'Without job extensions, Delete cancels the job: it stops, and its record is kept.',
  'delete.cancelled': 'Cancelled. The job has stopped; its record is kept.', 'delete.deleted': 'Deleted.',
  'start.schedule': 'When it runs', 'start.monthEnd': 'On the last day of each month, 18:00 India time',
  'start.every30': 'Every 30 days, not month-end',
  'start.monthEndMissing': 'Month-end on the calendar is not available on this computer. You may choose every 30 days instead; it is not month-end.',
  'start.monthEndNote': 'On the calendar this works out what customers owe at each month end, with its receipt.',
  'driving.title': 'Chausar is driving', 'driving.banner': 'Chausar is driving. Ctrl Alt Pause to stop.', 'driving.stop': 'Stop', 'driving.continue': 'Continue',
  'driving.choose': 'Choose the one window Chausar may use', 'driving.start': 'Start in this window', 'driving.noWindows': 'No window is open that Chausar may use.',
  'driving.rules': 'One window only. Read and export only: no edits, no payment screens. Chausar never types a password, never answers a one-time code and never solves a captcha.',
  'driving.notBuilt': 'Driving a program is not built yet. It arrives with the session lane.',
  'driving.signIn': 'Sign in yourself. Chausar continues after.', 'driving.paused': 'You moved the mouse. Paused.',
  'driving.stoppedByKey': 'Stopped by your key.', 'driving.stopped': 'Stopped.', 'driving.failed': 'A step failed.', 'driving.done': 'Done.', 'driving.idle': 'Not driving.',
  'driving.steps': 'Steps', 'step.done': 'done', 'step.running': 'running', 'step.failed': 'failed',
} as const;
export type JobKey = keyof typeof EN;

const HI: Readonly<Record<JobKey, string>> = {
  'person.you': 'आप', 'person.named': '{name}', 'person.done': 'हो गया', 'person.doneOn': '{when} को {by} ने पूरा किया', 'person.doneOnly': '{when} को पूरा',
  'person.waits': 'जॉब इस क़दम का इंतज़ार करता है। यह अपने आप कभी पूरा नहीं माना जाता।',
  'person.notBuilt': 'क़दम को पूरा बताना जॉब एक्सटेंशन के साथ आएगा। अभी बना नहीं है।',
  'person.notYours': 'यह क़दम {name} के लिए है।',
  'measure.title': 'लक्ष्य के सामने माप', 'measure.goal': 'लक्ष्य', 'measure.sentence': 'हर रन पर {name}, उसके लक्ष्य के सामने।',
  'measure.goalWritten': 'जॉब पर तय लक्ष्य: {amount}। इसकी कोई रसीद नहीं, इसलिए यह लिखा है, रेखा में नहीं।',
  'measure.gaps': '{n} रन का कोई आँकड़ा आप नहीं पढ़ सकते। वे ख़ाली जगह दिखते हैं।', 'measure.none': 'इस जॉब का अभी कोई माप नहीं: किसी रन ने कोई गणना नहीं बताई।',
  'schedule.title': 'कब चलता है', 'schedule.every': 'हर {n} दिन', 'schedule.everyMs': 'तय अंतराल पर',
  'schedule.monthEnd': 'हर महीने के आख़िरी दिन {at} ({zone})', 'schedule.calendar': 'कैलेंडर पर, {at} ({zone})', 'schedule.paused': 'कैलेंडर रुका है',
  'missed.change': 'छूटे रन का नियम बदलें', 'missed.save': 'नियम सहेजें', 'missed.notBuilt': 'इस जॉब का यह नियम बदलना अभी बना नहीं है।',
  'missed.after': 'बदल गया। जॉब फिर आपकी मंज़ूरी का इंतज़ार करता है।',
  'edit.title': 'बदलें', 'edit.open': 'जॉब बदलें', 'edit.save': 'बदलाव सहेजें', 'edit.note': 'जॉब फिर चलने से पहले बदलाव नई मंज़ूरी से गुज़रता है।',
  'edit.notBuilt': 'इस जॉब को बदलना अभी बना नहीं है। तैयार ब्रीफ़ बदला नहीं जा सकता; इसे रद्द करके दूसरा शुरू करें।',
  'edit.nothing': 'कम से कम एक चीज़ बदलें।', 'edit.done': 'बदल गया। यह आपकी मंज़ूरी का इंतज़ार करता है।',
  'delete.open': 'हटाएँ', 'delete.ask': 'यह जॉब हटाएँ?', 'delete.yes': 'हटा दें', 'delete.keep': 'रहने दें',
  'delete.cancelNote': 'जॉब एक्सटेंशन के बिना, हटाना जॉब को रद्द करता है: यह रुकता है और इसका रिकॉर्ड रहता है।',
  'delete.cancelled': 'रद्द। जॉब रुक गया; इसका रिकॉर्ड रखा गया है।', 'delete.deleted': 'हटा दिया।',
  'start.schedule': 'कब चलता है', 'start.monthEnd': 'हर महीने के आख़िरी दिन, शाम 6 बजे भारत समय',
  'start.every30': 'हर 30 दिन, महीने का अंत नहीं',
  'start.monthEndMissing': 'इस कंप्यूटर पर कैलेंडर से महीने का अंत उपलब्ध नहीं है। आप हर 30 दिन चुन सकते हैं; यह महीने का अंत नहीं है।',
  'start.monthEndNote': 'कैलेंडर पर यह हर महीने के अंत में ग्राहकों का बकाया रसीद के साथ निकालता है।',
  'driving.title': 'चौसर चला रहा है', 'driving.banner': 'चौसर चला रहा है। रोकने के लिए Ctrl Alt Pause।', 'driving.stop': 'रोकें', 'driving.continue': 'जारी रखें',
  'driving.choose': 'वह एक विंडो चुनें जिसे चौसर इस्तेमाल कर सकता है', 'driving.start': 'इस विंडो में शुरू करें', 'driving.noWindows': 'ऐसी कोई विंडो खुली नहीं जिसे चौसर इस्तेमाल कर सके।',
  'driving.rules': 'सिर्फ़ एक विंडो। सिर्फ़ पढ़ना और निर्यात: कोई बदलाव नहीं, कोई भुगतान स्क्रीन नहीं। चौसर कभी पासवर्ड नहीं लिखता, कभी वन-टाइम कोड का जवाब नहीं देता और कभी कैप्चा हल नहीं करता।',
  'driving.notBuilt': 'किसी प्रोग्राम को चलाना अभी बना नहीं है। यह सेशन लेन के साथ आएगा।',
  'driving.signIn': 'ख़ुद साइन इन करें। चौसर उसके बाद जारी रखेगा।', 'driving.paused': 'आपने माउस हिलाया। रुका।',
  'driving.stoppedByKey': 'आपकी कुंजी से रुका।', 'driving.stopped': 'रुका।', 'driving.failed': 'एक क़दम असफल हुआ।', 'driving.done': 'पूरा।', 'driving.idle': 'नहीं चला रहा।',
  'driving.steps': 'क़दम', 'step.done': 'पूरा', 'step.running': 'चल रहा', 'step.failed': 'असफल',
};

export type JobWords = Readonly<Record<JobKey, string>>;
export function jobWords(language: Language): JobWords { return words<JobKey>({ en: EN, hi: HI }, language); }
export function sayJob(j: JobWords, key: JobKey, values?: Readonly<Record<string, string | number>>): string { return fill(j[key], values); }
