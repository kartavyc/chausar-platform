/**
 * AS-05 the receipt: the chain on top (your question, the calculation chosen, rows read, total
 * checked), then the six parts: figures, definitions, what was left out and why, coverage,
 * sources with their way in and recipe, and the small print with its five versions and the
 * "Allowed by" line. It opens the rows (both tabs), what was sent and the meaning.
 */
import { useEffect, useState } from 'react';
import type { Catalogue } from '../../../places/types.ts';
import type { FigureLabel } from '../../../app/presentation.ts';
import { KeyValue, type Pair } from '../../../parts/KeyValue';
import { Button } from '../../../parts/Button';
import { Label } from '../../../parts/Label';
import { MissingWords } from '../../../parts/Figure';
import { AskPage, countWords, dayText, figureOf, fill, periodText, useAsk, useRead, useWords, type AskView } from './kit';
import { call } from './client.ts';
import { receiptExport, receiptReply, type ReceiptReply } from './core-replies.ts';
import { Refusal, understoodText, useExplain, useShared } from './core-words';
import { State } from '../../../patterns/States';
import s from './core.module.css';

type Key =
  | 'title' | 'question' | 'fromMenu' | 'calc' | 'rowsRead' | 'checked' | 'notChecked' | 'figures' | 'definitions' | 'exclusions' | 'noExclusions'
  | 'excluded' | 'coverage' | 'notCounted' | 'fx' | 'sources' | 'file' | 'interface' | 'entered' | 'tested' | 'not-yet-tested' | 'noRecipe' | 'sourceRows'
  | 'smallPrint' | 'app' | 'dictionary' | 'definition' | 'recipes' | 'calculator' | 'allowedBy' | 'desktop' | 'phone' | 'mcp' | 'asOf' | 'createdAt'
  | 'rowsCounted' | 'rowsLeftOut' | 'sent' | 'sentNothing' | 'sentGone' | 'meaning' | 'seedNote' | 'period' | 'compared' | 'none'
  | 'wayIn' | 'wayInValue' | 'recipeValue' | 'rate' | 'rateValue' | 'allowed' | 'allowedValue' | 'tool'
  | 'meaningVersion' | 'meaningUnknown' | 'demo' | 'export' | 'exporting' | 'exportReady' | 'download' | 'exportNote';
const WORDS = {
  en: {
    title: 'The receipt', question: 'Your question: {question}', fromMenu: 'Your question: chosen from the menu', calc: 'Calculation chosen: {calc}',
    rowsRead: '{count} rows read', checked: 'Total checked', notChecked: 'Total not checked', figures: 'Figures', definitions: 'What the words mean',
    exclusions: 'Left out', noExclusions: 'Nothing was left out.', excluded: '{count} rows', coverage: 'Coverage',
    notCounted: '{count} amounts not counted: no exchange rate.', fx: 'Rate {rate} from {from} to {to}', sources: 'Sources',
    file: 'an exported file', interface: 'its own interface', entered: 'entered by hand', tested: 'Recipe tested', 'not-yet-tested': 'Recipe not yet tested', noRecipe: 'No recipe',
    sourceRows: '{count} rows', smallPrint: 'Small print', app: 'App', dictionary: 'Meanings', definition: 'Definition', recipes: 'Recipes', calculator: 'Calculator',
    allowedBy: 'Allowed by {role} {member}, on the {device}, {at}', desktop: 'desktop', phone: 'phone', mcp: 'tool connection',
    asOf: 'As known on {date}', createdAt: 'Worked out on {date}',
    rowsCounted: 'Rows counted', rowsLeftOut: 'Rows left out', sent: 'What was sent to the AI model', sentNothing: 'Nothing was sent to an AI model for this answer.',
    sentGone: 'What was sent is no longer kept.', meaning: 'Open the meaning', seedNote: 'From the starting menu.', period: 'Period', compared: 'Compared with', none: 'none',
    wayIn: 'Way in: {source}', wayInValue: '{way} · {format}', recipeValue: '{state} · {id}', rate: 'Rate: {from} to {to}', rateValue: '{rate} · {date}',
    allowed: 'Allowed by', allowedValue: '{role} {member} · {device} · {at}', tool: 'This was asked through a tool connection. Only the text handed to the tool is visible.',
    meaningVersion: 'Meaning version {version}, published by {by} on {date}', meaningUnknown: 'Which published meaning this used is not known.',
    demo: 'This is a demo workspace: every date and figure on this receipt is made up.',
    export: 'Export the rows', exporting: 'Preparing the file…', exportReady: 'The rows are ready as a file.', download: 'Save {name}',
    exportNote: 'Exporting changes nothing in your books.',
  },
  hi: {
    title: 'रसीद', question: 'आपका सवाल: {question}', fromMenu: 'आपका सवाल: मेन्यू से चुना गया', calc: 'चुनी गई गणना: {calc}',
    rowsRead: '{count} पंक्तियाँ पढ़ी गईं', checked: 'कुल जाँचा गया', notChecked: 'कुल नहीं जाँचा गया', figures: 'आँकड़े', definitions: 'शब्दों का अर्थ',
    exclusions: 'छोड़ा गया', noExclusions: 'कुछ नहीं छोड़ा गया।', excluded: '{count} पंक्तियाँ', coverage: 'कवरेज',
    notCounted: '{count} रकमें नहीं गिनी गईं: विनिमय दर नहीं है।', fx: '{from} से {to} की दर {rate}', sources: 'स्रोत',
    file: 'एक्सपोर्ट की गई फ़ाइल', interface: 'उसका अपना इंटरफ़ेस', entered: 'हाथ से दर्ज', tested: 'तरीका जाँचा गया', 'not-yet-tested': 'तरीका अभी जाँचा नहीं गया', noRecipe: 'कोई तरीका नहीं',
    sourceRows: '{count} पंक्तियाँ', smallPrint: 'बारीक जानकारी', app: 'ऐप', dictionary: 'अर्थ', definition: 'परिभाषा', recipes: 'तरीके', calculator: 'कैलकुलेटर',
    allowedBy: '{role} {member} ने {device} पर अनुमति दी, {at}', desktop: 'डेस्कटॉप', phone: 'फ़ोन', mcp: 'टूल कनेक्शन',
    asOf: '{date} को जैसा पता था', createdAt: '{date} को निकाला गया',
    rowsCounted: 'गिनी गई पंक्तियाँ', rowsLeftOut: 'छोड़ी गई पंक्तियाँ', sent: 'AI मॉडल को क्या भेजा गया', sentNothing: 'इस जवाब के लिए किसी AI मॉडल को कुछ नहीं भेजा गया।',
    sentGone: 'जो भेजा गया वह अब रखा नहीं है।', meaning: 'अर्थ खोलें', seedNote: 'शुरुआती मेन्यू से।', period: 'अवधि', compared: 'इससे तुलना', none: 'कोई नहीं',
    wayIn: 'आने का रास्ता: {source}', wayInValue: '{way} · {format}', recipeValue: '{state} · {id}', rate: 'दर: {from} से {to}', rateValue: '{rate} · {date}',
    allowed: 'अनुमति', allowedValue: '{role} {member} · {device} · {at}', tool: 'यह एक टूल कनेक्शन से पूछा गया। सिर्फ़ टूल को दिया गया पाठ दिखता है।',
    meaningVersion: 'अर्थ संस्करण {version}, {by} ने {date} को प्रकाशित किया', meaningUnknown: 'यह किस प्रकाशित अर्थ से बना, यह पता नहीं।',
    demo: 'यह डेमो कार्यक्षेत्र है: इस रसीद की हर तारीख़ और हर आँकड़ा बनावटी है।',
    export: 'पंक्तियाँ निर्यात करें', exporting: 'फ़ाइल तैयार हो रही है…', exportReady: 'पंक्तियाँ फ़ाइल के रूप में तैयार हैं।', download: '{name} सहेजें',
    exportNote: 'निर्यात करने से आपकी बही में कुछ नहीं बदलता।',
  },
} as const satisfies Catalogue<Key>;

export function ReceiptScreen({ view }: { view: Extract<AskView, { kind: 'receipt' }> }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useExplain();
  const [load, retry] = useRead(`receipt|${view.receiptId}`, () => call(ask.rpc, 'askx.receipt', { receiptId: view.receiptId }, receiptReply));
  return (
    <AskPage title={w.title} load={load} retry={retry} explain={explain}>
      {(r: ReceiptReply) => <ReceiptBody receipt={r} />}
    </AskPage>
  );
}

function ReceiptBody({ receipt: r }: { receipt: ReceiptReply }) {
  const ask = useAsk(), w = useWords(WORDS), shared = useShared(), lang = ask.language, books = ask.view === 'books';
  const toReceipt = (receiptId: string) => { if (receiptId !== r.receiptId) ask.go({ kind: 'receipt', receiptId }); };
  const n = (value: number) => countWords(String(value));
  const figLabels: readonly FigureLabel[] = r.demo ? [...r.labels, 'demo-clock'] : r.labels;
  const figures: Pair[] = r.figures.map(f => ({ name: f.label, figure: figureOf(f.unit, f.minor, r.receiptId, figLabels) }));
  const when: Pair[] = [
    ...(r.period === null ? [] : [{ name: w.period, value: periodText(r.period, lang) }]),
    ...(r.comparePeriod === null ? [] : [{ name: w.compared, value: periodText(r.comparePeriod, lang) }]),
  ];
  const device = w[r.allowedBy.device];
  const smallPrint = (
    <div className={s.block}>
      <KeyValue onReceipt={toReceipt} pairs={[
        { name: w.app, value: r.versions.app ?? undefined, after: r.versions.app === null ? <MissingWords missing="unknown" /> : undefined, mono: true },
        { name: w.dictionary, value: `${r.versions.dictionary} · ${r.versions.dictionaryHash}`, mono: true },
        { name: w.definition, value: r.versions.definitionHash, mono: true },
        { name: w.recipes, value: r.versions.recipes.length > 0 ? r.versions.recipes.join(', ') : w.none, mono: true },
        { name: w.calculator, value: r.versions.calculator, mono: true },
        ...r.sources.map((src): Pair => ({
          name: fill(w.wayIn, { source: src.sourceId }),
          value: src.format === null ? w[src.wayIn] : fill(w.wayInValue, { way: w[src.wayIn], format: src.format }),
          after: <span className={s.small}>{src.recipe === null ? w.noRecipe : fill(w.recipeValue, { state: w[src.recipe.state], id: src.recipe.id })}</span>,
        })),
        ...r.fx.map((x): Pair => ({ name: fill(w.rate, { from: x.from, to: x.to }), value: x.on === null ? x.rate : fill(w.rateValue, { rate: x.rate, date: dayText(x.on, lang) }), mono: true })),
        { name: w.allowed, value: fill(w.allowedValue, { role: r.allowedBy.role, member: r.allowedBy.memberId, device, at: books ? r.allowedBy.at : dayText(r.allowedBy.at, lang) }) },
      ]} />
      <p className={s.small} data-meaning-version="">
        {r.meaning === null ? w.meaningUnknown : fill(w.meaningVersion, { version: n(r.meaning.version), by: r.meaning.publishedBy, date: dayText(r.meaning.publishedAt, lang) })}
      </p>
    </div>
  );

  return (
    <div className={s.page} data-receipt={r.receiptId}>
      <div className={s.block}>
        {(r.labels.length > 0 || r.demo) && (
          <p className={s.labels}>
            {r.labels.map(l => <Label key={l} kind={l} />)}{r.demo && <span data-demo=""><Label kind="demo-clock" /></span>}
            {r.labels.includes('seed') && <span className={s.small}>{w.seedNote}</span>}
          </p>
        )}
        {r.demo && <p className={s.small}>{w.demo}</p>}
        <ol className={s.chain} aria-label={w.title} data-chain="">
          <li>{r.chain.question === null ? w.fromMenu : fill(w.question, { question: r.chain.question })}</li>
          <li>{fill(w.calc, { calc: r.chain.calculation })}</li>
          <li>{fill(w.rowsRead, { count: n(r.chain.rowsRead) })}</li>
          <li>{r.chain.totalChecked ? w.checked : w.notChecked}</li>
        </ol>
        <p className={s.note}>{understoodText(r.label, r.period, r.branch, lang)}</p>
        <p className={s.small}>{fill(w.asOf, { date: dayText(r.asOf, lang) })} · {fill(w.createdAt, { date: dayText(r.createdAt, lang) })}</p>
      </div>

      <section className={s.section} aria-label={w.figures}>
        <h2 className={s.heading}>{w.figures}</h2>
        {figures.length > 0 ? <KeyValue align="right" onReceipt={toReceipt} pairs={[...figures, ...(books ? when : [])]} /> : <MissingWords missing="absent" />}
      </section>

      {r.definitions.length > 0 && (
        <section className={s.section} aria-label={w.definitions}>
          <h2 className={s.heading}>{w.definitions}</h2>
          <ul className={s.plain}>
            {r.definitions.map(d => (
              <li key={d.name}>
                <span className={s.text}>{d.label}</span> <span className={s.note}>{d.meaning}</span>
                {books && <span className={s.small}> {d.kind} · {d.field}</span>}
              </li>
            ))}
          </ul>
          <div className={s.actions}><Button variant="link" onClick={() => ask.leave({ place: 'books', sub: 'meanings' })}>{w.meaning}</Button></div>
        </section>
      )}

      <section className={s.section} aria-label={w.exclusions}>
        <h2 className={s.heading}>{w.exclusions}</h2>
        {r.exclusions.length === 0 ? <p className={s.note}>{w.noExclusions}</p>
          : <KeyValue onReceipt={toReceipt} pairs={r.exclusions.map(x => ({ name: x.reason, value: fill(w.excluded, { count: n(x.rows) }), indent: true }))} />}
      </section>

      <section className={s.section} aria-label={w.coverage} data-coverage="">
        <h2 className={s.heading}>{w.coverage}</h2>
        <p className={s.note}>{r.completeness === 'empty' ? shared.none : shared[r.completeness]}</p>
        {r.gaps.map(g => <p key={g} className={s.note}>{shared[g]}</p>)}
        {r.notCounted > 0 && <p className={s.note}>{fill(w.notCounted, { count: n(r.notCounted) })}</p>}
        {r.fx.map((x, i) => (
          <p key={i} className={s.small}>{fill(w.fx, { rate: x.rate, from: x.from, to: x.to })}{x.on !== null && ` · ${dayText(x.on, lang)}`}</p>
        ))}
      </section>

      {r.sources.length > 0 && (
        <section className={s.section} aria-label={w.sources}>
          <h2 className={s.heading}>{w.sources}</h2>
          <ul className={s.plain}>
            {r.sources.map(src => (
              <li key={src.sourceId} className={s.note} data-source={src.sourceId}>
                <span className="fig">{src.sourceId}</span> · {w[src.wayIn]}{src.format !== null && ` · ${src.format}`} · {src.recipe === null ? w.noRecipe : w[src.recipe.state]}
                {' · '}{fill(w.sourceRows, { count: n(src.rows) })}
                {books && src.recipe !== null && <span className={s.small}> · {src.recipe.id} {src.recipe.hash}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={s.actions}>
        <Button variant="link" onClick={() => ask.go({ kind: 'rows', receiptId: r.receiptId, tab: 'counted' })}>{w.rowsCounted}</Button>
        <Button variant="link" onClick={() => ask.go({ kind: 'rows', receiptId: r.receiptId, tab: 'left-out' })}>{w.rowsLeftOut}</Button>
        {r.sent.kind === 'model' && <Button variant="link" onClick={() => ask.go({ kind: 'sent', receiptId: r.receiptId })}>{w.sent}</Button>}
      </div>
      <ExportRows receiptId={r.receiptId} />
      {r.sent.kind === 'nothing' && <p className={s.small}>{w.sentNothing}</p>}
      <p className={s.small} data-allowed-by="">{fill(w.allowedBy, { role: r.allowedBy.role, member: r.allowedBy.memberId, device, at: dayText(r.allowedBy.at, lang) })}</p>
      {r.sent.kind === 'model' && !r.sent.available && <p className={s.small}>{w.sentGone}</p>}
      {r.allowedBy.device === 'mcp' && <p className={s.small} data-tool="">{w.tool}</p>}

      {books ? (
        <section className={s.section} aria-label={w.smallPrint} data-small-print="">
          <h2 className={s.heading}>{w.smallPrint}</h2>
          {smallPrint}
        </section>
      ) : (
        <details className={s.details} data-small-print="">
          <summary>{w.smallPrint}</summary>
          {smallPrint}
        </details>
      )}
    </div>
  );
}

type Exported = { readonly kind: 'idle' | 'busy' | 'not-built' } | { readonly kind: 'ready'; readonly name: string; readonly url: string } | { readonly kind: 'refused'; readonly code: string };

/**
 * The receipt's rows as one CSV file. Exporting changes nothing, so every seat may do it,
 * a viewer too. The file is the engine's text; the page only offers it to be saved.
 */
function ExportRows({ receiptId }: { receiptId: string }) {
  const ask = useAsk(), w = useWords(WORDS);
  const [state, setState] = useState<Exported>({ kind: 'idle' });
  const url = state.kind === 'ready' ? state.url : null;
  useEffect(() => () => { if (url !== null) URL.revokeObjectURL(url); }, [url]);
  async function run() {
    setState({ kind: 'busy' });
    const reply = await call(ask.rpc, 'askx.receipt.export', { receiptId }, receiptExport);
    if (!ask.live()) return;
    if (reply.kind === 'ok') setState({ kind: 'ready', name: reply.value.fileName, url: URL.createObjectURL(new Blob([reply.value.csv], { type: 'text/csv;charset=utf-8' })) });
    else setState(reply.kind === 'not-built' ? { kind: 'not-built' } : { kind: 'refused', code: reply.code });
  }
  return (
    <div className={s.block} data-receipt-export="">
      <div className={s.actions}>
        <Button disabled={state.kind === 'busy'} onClick={() => void run()}>{state.kind === 'busy' ? w.exporting : w.export}</Button>
        {state.kind === 'ready' && <span role="status" className={s.note}>{w.exportReady} <a href={state.url} download={state.name} data-receipt-download="">{fill(w.download, { name: state.name })}</a></span>}
      </div>
      <p className={s.small}>{w.exportNote}</p>
      {state.kind === 'not-built' && <State state={{ kind: 'not-built' }} />}
      {state.kind === 'refused' && <Refusal code={state.code} />}
    </div>
  );
}
