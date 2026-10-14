/**
 * The status line adapter (SH-01): turns a validated `todayx.status` reply into the three
 * facts of the status line and the two plain sentences of the Simple view. Pure: no React,
 * no bridge. Dates and counts are formatted through `format/`; words come from this file's
 * two catalogues, so the status line never shows prose from the engine.
 */

import type { StatusReply } from '../bridge/todayx-contract.ts';
import { date as formatDate } from '../format/dates.ts';
import { count } from '../format/counts.ts';
import type { Address, Language, StatusLineData } from './presentation.ts';

const WORDS = {
  en: {
    sourcesNone: 'No source yet',
    sourcesFresh: '{count} sources, read {date}',
    sourcesStale: '{count} sources, oldest read {date}',
    modelNone: 'No AI model connected',
    modelReady: '{route}, sends {level}',
    nothing: 'nothing', shape: 'shape only', samples: 'samples',
    leftToday: '{count} calls left this computer today',
    nothingLeft: 'Nothing left this computer today',
    holdsPen: '{holder} holds the pen',
    unknown: 'What left today is not known',
    simpleSources: 'Your books were last read {date}.',
    simpleNoSources: 'No books are read yet.',
    simpleModel: 'Questions in plain words go to {route}.',
    simpleNoModel: 'No AI model is connected. The menu still works.',
  },
  hi: {
    sourcesNone: 'अभी कोई स्रोत नहीं',
    sourcesFresh: '{count} स्रोत, {date} को पढ़े',
    sourcesStale: '{count} स्रोत, सबसे पुराना {date} को पढ़ा',
    modelNone: 'कोई AI मॉडल नहीं जुड़ा',
    modelReady: '{route}, {level} भेजता है',
    nothing: 'कुछ नहीं', shape: 'केवल ढांचा', samples: 'नमूने',
    leftToday: 'आज इस कंप्यूटर से {count} कॉल बाहर गईं',
    nothingLeft: 'आज इस कंप्यूटर से कुछ बाहर नहीं गया',
    holdsPen: 'कलम {holder} के पास है',
    unknown: 'आज क्या बाहर गया, यह पता नहीं',
    simpleSources: 'आपकी बहियाँ आख़िरी बार {date} को पढ़ी गईं।',
    simpleNoSources: 'अभी कोई बही नहीं पढ़ी गई।',
    simpleModel: 'सादे शब्दों के सवाल {route} को जाते हैं।',
    simpleNoModel: 'कोई AI मॉडल नहीं जुड़ा। मेनू फिर भी काम करता है।',
  },
} as const;

type Key = keyof typeof WORDS.en;
/** A read time is an instant; the status line names its day only. */
function date(iso: string, form: 'short', language: Language): string { return formatDate(iso.slice(0, 10), form, language); }
function fill(language: Language, key: Key, values: Readonly<Record<string, string>> = {}): string {
  return WORDS[language][key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}

const SOURCES: Address = { place: 'books', sub: 'sources' };
const MODELS: Address = { place: 'trust', sub: 'models' };
const NETWORK: Address = { place: 'trust', sub: 'network' };
const PEOPLE: Address = { place: 'trust', sub: 'people' };

export function statusLine(reply: StatusReply, language: Language): StatusLineData {
  const s = reply.sources, m = reply.model, third = reply.third;
  const sources = s.state === 'none' ? fill(language, 'sourcesNone')
    : fill(language, s.state === 'fresh' ? 'sourcesFresh' : 'sourcesStale', { count: count(s.count), date: date(s.state === 'fresh' ? s.newestReadAt : s.oldestReadAt, 'short', language) });
  const model = m.state === 'none' ? fill(language, 'modelNone') : fill(language, 'modelReady', { route: m.routeLabel, level: WORDS[language][m.sendLevel] });
  const thirdFact = third.kind === 'left-today' ? { text: fill(language, 'leftToday', { count: count(third.calls) }), address: NETWORK }
    : third.kind === 'nothing-left' ? { text: fill(language, 'nothingLeft'), address: NETWORK }
    : third.kind === 'holds-pen' ? { text: fill(language, 'holdsPen', { holder: third.holder }), address: PEOPLE }
    : { text: fill(language, 'unknown'), address: NETWORK };
  return { sources: { text: sources, address: SOURCES }, model: { text: model, address: MODELS }, third: thirdFact };
}

/** The Simple view's two plain sentences. */
export function statusSentences(reply: StatusReply, language: Language): readonly [string, string] {
  const s = reply.sources, m = reply.model;
  return [
    s.state === 'none' ? fill(language, 'simpleNoSources') : fill(language, 'simpleSources', { date: date(s.newestReadAt, 'short', language) }),
    m.state === 'none' ? fill(language, 'simpleNoModel') : fill(language, 'simpleModel', { route: m.routeLabel }),
  ];
}
