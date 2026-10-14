/**
 * AS-07 what was sent to the AI model: the exact text that left the computer for one answer,
 * with stand-ins where names were, the route, the send level, the size and the cost. Once the
 * kept time has passed only its fingerprint remains, and the page says so.
 */
import type { Catalogue } from '../../../places/types.ts';
import { KeyValue, type Pair } from '../../../parts/KeyValue';
import { MissingWords } from '../../../parts/Figure';
import { AskPage, countWords, dayText, fill, moneyText, useAsk, useRead, useWords, type AskView } from './kit';
import { call } from './client.ts';
import { sentReply, type SentReply } from './core-replies.ts';
import { useExplain } from './core-words';
import s from './core.module.css';

const WORDS = {
  en: {
    title: 'What was sent to the AI model', menu: 'Nothing was sent. This answer was chosen from the menu, so no AI model was used.',
    none: 'Nothing was sent to an AI model for this answer.', removed: 'The text was removed after the time you set. Its fingerprint is kept.',
    noText: 'The text was not kept. Its fingerprint is kept.', standIns: 'Names, phone numbers and GSTINs were replaced with stand-ins before sending.',
    route: 'Route', level: 'Send level', size: 'Size', bytes: '{count} bytes', cost: 'Cost', at: 'Sent on', digest: 'Fingerprint', boundary: 'Boundary',
  },
  hi: {
    title: 'AI मॉडल को क्या भेजा गया', menu: 'कुछ नहीं भेजा गया। यह जवाब मेन्यू से चुना गया, इसलिए कोई AI मॉडल नहीं लगा।',
    none: 'इस जवाब के लिए किसी AI मॉडल को कुछ नहीं भेजा गया।', removed: 'आपके तय समय के बाद पाठ हटा दिया गया। उसकी पहचान रखी गई है।',
    noText: 'पाठ रखा नहीं गया। उसकी पहचान रखी गई है।', standIns: 'भेजने से पहले नाम, फ़ोन नंबर और GSTIN की जगह बदले हुए नाम रखे गए।',
    route: 'रास्ता', level: 'भेजने का स्तर', size: 'आकार', bytes: '{count} बाइट', cost: 'ख़र्च', at: 'भेजा गया', digest: 'पहचान', boundary: 'सीमा',
  },
} as const satisfies Catalogue<'title' | 'menu' | 'none' | 'removed' | 'noText' | 'standIns' | 'route' | 'level' | 'size' | 'bytes' | 'cost' | 'at' | 'digest' | 'boundary'>;

export function SentScreen({ view }: { view: Extract<AskView, { kind: 'sent' }> }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useExplain();
  const [load, retry] = useRead(`sent|${view.receiptId}`, () => call(ask.rpc, 'askx.sent', { receiptId: view.receiptId }, sentReply));
  return (
    <AskPage title={w.title} load={load} retry={retry} explain={explain}>
      {(r: SentReply) => {
        if (r.kind === 'nothing') return <p className={s.note} data-sent="nothing">{r.why === 'menu' ? w.menu : w.none}</p>;
        const pairs: Pair[] = [
          { name: w.route, value: r.routeId, mono: true },
          { name: w.level, value: r.sendLevel },
          { name: w.size, value: fill(w.bytes, { count: countWords(String(r.bytes)) }), mono: true },
          { name: w.cost, value: r.costMinor === null ? undefined : moneyText(r.costMinor), after: r.costMinor === null ? <MissingWords missing="unknown" /> : undefined, mono: true },
          { name: w.at, value: dayText(r.at, ask.language) },
          ...(ask.view === 'books' || r.text === null || r.removed ? [{ name: w.digest, value: r.digest, mono: true }] : []),
          ...(ask.view === 'books' ? [{ name: w.boundary, value: r.boundary, mono: true }] : []),
        ];
        return (
          <div className={s.page} data-sent="sent">
            {r.removed || r.text === null
              ? <p className={s.note} data-sent-removed="">{r.removed ? w.removed : w.noText}</p>
              : <><pre className={s.pre} data-sent-text="">{r.text}</pre>{ask.view !== 'books' && <p className={s.small}>{w.standIns}</p>}</>}
            <KeyValue onReceipt={() => undefined} pairs={pairs} />
          </div>
        );
      }}
    </AskPage>
  );
}
