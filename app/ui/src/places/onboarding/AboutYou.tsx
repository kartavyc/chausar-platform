import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { AboutReadLite, CountryLite } from '../../engine/types';
import { Bento, Tile } from '../../parts/Tile';
import { Button } from '../../parts/Button';
import { Chip } from '../../parts/Chip';
import { Field } from '../../parts/Field';
import { Icon } from '../../parts/Icon';
import { InlineError } from '../../parts/InlineError';
// One-shot C3: off under the computer's reduce-motion setting or the owner's Animations off; then A becomes B with no motion.
import { motionOff } from '../../parts/motion';
import { cleanSentence, computerCountry, pickCountry, sentenceProblem, OPEN_BOX } from './flow';
import { aboutFile, type AboutFile } from './linkedin';
import { renameIn } from './rename';
import f from './FirstRun.module.css';
import s from './AboutYou.module.css';
import { Select } from '../../parts/Select';
import { FilePick } from '../../parts/FilePick';
import { Progress } from '../../parts/Progress';
import { Fold } from '../../parts/Fold';
import { Reveal } from '../../parts/RevealBlock';
import { useChanged } from '../../parts/useChanged';

export type AboutMode = 'a' | 'b' | 'plan';
type Mode = AboutMode;
/** failed: a read that failed or an AI that stopped, said as Chausar's turn in the chat (B4 task 4). */
type Bubble = { who: 'me' | 'them'; text: string; failed?: boolean; byAi?: boolean };
/** C4 task 1: an offer on the plan card, kept (ticked) by default, renamed in place, or added by the owner. */
type OfferRow = { key: number; name: string; line: string; kept: boolean; editing: boolean };
/** The engine keeps one to three offers from the card (core/blueprint.ts SHOWN_OFFER_IDS). */
const CARD_OFFERS_MAX = 3;
/** B4 task 12: the fields shown at rest; the others sit under More fields. */
const FIELDS_AT_REST = 6;
/**
 * C4 task 1 (146.w1): a message that asks for a rename in any words. When renameIn cannot read a name from it, the chat
 * says so in one fixed line and points at the name field.
 */
const ASKS_RENAME = /\b(?:(?:call|name)\s+(?:it|this|the business|my business|this business)|rename)\b/i;
const rowsOf = (next: AboutReadLite): OfferRow[] => next.offers.map((offer, index) => ({ key: index, name: offer.name, line: offer.line ?? '', kept: true, editing: false }));
/** name (one-shot A1, row 3): the name the card shows, which the saved plan keeps with the card's offers. */
export type KeptPlan = { read: AboutReadLite & { idea: string; family: NonNullable<AboutReadLite['family']> }; countryCode: string; name: string; firstName?: string };


/**
 * Step 2 of the first run, About you (W6 6C2, DECISIONS D16 and D16a; reference-ui/OnboardAB.dc.html). It opens as
 * option A: the message box over the field tiles. Send turns it into option B: the chat on the left and the live
 * "Your business" on the right, in one motion of at most 400 ms (none with reduced motion). It changes on Send only,
 * never while the owner types. A tile goes straight to the plan; "Back to fields" returns to A.
 *
 * The owner's AI reads what was sent (venture.about.read): a sentence, a resume PDF, or the owner's own LinkedIn data
 * export (only Profile.csv leaves the page, linkedin.ts); it returns the field, offers and country. With no AI the
 * engine guesses the field from keywords. The tiles are the fallback and the correction path (venture.about.pick).
 * Offers never carry an amount: prices are set by the owner after the plan is kept. The country starts from the
 * computer's time zone, never its language; an AI reading of another country asks before it changes anything.
 */
export function AboutYou({ connected, onKeep, onMode }: { connected: boolean; onKeep: (plan: KeptPlan) => void; onMode?: ((mode: AboutMode) => void) | undefined }) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const boxId = useId();
  const sayId = useId();
  const fieldId = useId();
  const countryId = useId();
  const families = useResource('venture.about.families', {});
  const box = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<Mode>('a');
  // C1 task 11: the first run's stepper follows the mode (the plan card is step 3, "Your business").
  useEffect(() => { onMode?.(mode); }, [mode, onMode]);
  const [motion] = useState(() => (motionOff() ? 'none' : 'once'));
  const [text, setText] = useState('');
  // C4 task 2 (8.w1): optional, kept here only until the business is open (FirstRun's kept()).
  const [firstName, setFirstName] = useState('');
  const [file, setFile] = useState<AboutFile | null>(null);
  const [said, setSaid] = useState('');
  const [reply, setReply] = useState('');
  const [thread, setThread] = useState<Bubble[]>([]);
  const [read, setReadOnly] = useState<AboutReadLite | null>(null);
  const fieldChanged = useChanged(read?.family?.id);
  /** C4 task 1: the card's offers as the owner keeps, renames or adds them; reset with each new read. */
  const [rows, setRows] = useState<OfferRow[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const setRead = useCallback((next: AboutReadLite | null) => { setReadOnly(next); setRows(next ? rowsOf(next) : []); setAdding(null); }, []);
  const [name, setName] = useState<string | null>(null);
  /** One-shot A3 (S1): the name the owner asked for in the chat; it wins over the field's name until they change it again. */
  const [ownName, setOwnName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The last read failed; lastAsk is what Try again sends once more. */
  const [failed, setFailed] = useState(false);
  const lastAsk = useRef<{ text?: string; attachment?: AboutFile } | null>(null);
  const [boxWrong, setBoxWrong] = useState(false);
  const [countries, setCountries] = useState<CountryLite[]>([]);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [fromZone, setFromZone] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [countryAsk, setCountryAsk] = useState<CountryLite | null>(null);
  const picked = useRef(false);

  useEffect(() => {
    client.request('venture.countries', {}).then((list) => {
      setCountries(list);
      const zone = computerCountry();
      const code = pickCountry(list.map((c) => c.code), zone);
      setCountryCode((was) => was ?? code);
      setFromZone(zone !== null && zone === code);
    }, (error: unknown) => setProblem(messageOf(error)));
  }, [client]);

  const country = countries.find((c) => c.code === countryCode) ?? null;

  /** The plan's name, as the engine's own preview of this idea names it. */
  const nameFor = useCallback(async (next: AboutReadLite, code: string | null) => {
    setName(null);
    if (!next.idea || !code) return;
    try { setName((await client.request('venture.preview', { idea: next.idea, countryCode: code })).serviceLabel); }
    catch { setName(null); }
  }, [client]);

  function answerWords(next: AboutReadLite): string {
    // C5 task 6: the AI's own short reply when it gave one (core/about.ts kept it), else the fixed line.
    const lines = [next.reply ?? (!next.family ? t('first-run.about.replyNoFamily') : t(next.source === 'keywords' ? 'first-run.about.replyKeywords' : 'first-run.about.reply', { family: next.family.label }))];
    if (next.file && !next.file.included && next.file.line) lines.push(next.file.line);
    return lines.join('\n');
  }

  function took(next: AboutReadLite) {
    setRead(next);
    setThread((was) => [...was, { who: 'them', text: answerWords(next), ...(next.reply ? { byAi: true } : {}) }]);
    if (next.country && next.country.code !== countryCode && !picked.current) setCountryAsk(next.country);
    void nameFor(next, countryCode);
  }

  async function ask(params: { text?: string; attachment?: AboutFile }) {
    setBusy(true); setProblem(null); setFailed(false);
    lastAsk.current = params;
    try { took(await client.request('venture.about.read', params)); }
    catch (error) {
      setThread((was) => [...was, { who: 'them', text: messageOf(error), failed: true }]);
      setFailed(true);
    }
    finally { setBusy(false); }
  }

  /** Send: the page becomes B at once, and the AI's answer arrives in the chat. Never on a keystroke. */
  function send(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    const words = cleanSentence(text);
    if (!file) {
      const wrong = sentenceProblem(words);
      if (wrong) { setProblem(t(wrong)); setBoxWrong(true); box.current?.focus(); return; }
    } else if (words.length > 0 && words.length < OPEN_BOX.min) { setProblem(t('onboarding.tooShort')); return; }
    setSaid(words);
    setThread([{ who: 'me', text: words || file!.name }]);
    setRead(null);
    setMode('b');
    void ask({ ...(words ? { text: words } : {}), ...(file ? { attachment: file } : {}) });
  }

  function sendReply(event?: FormEvent) {
    event?.preventDefault();
    const more = cleanSentence(reply);
    if (busy || more.length === 0) return;
    // One-shot A3 (S1): a rename is read by code and kept on the card; the AI never names a business, so it is not asked.
    // A3 review (L2): what the message asks after the name ("and add wedding shoots too") still goes to the AI.
    const renamed = read ? renameIn(more) : null;
    // C4 task 1 (146.w1): asked to rename in words code cannot read: one fixed line, and the AI is not asked.
    if (read && !renamed && ASKS_RENAME.test(more)) {
      setReply('');
      setThread((was) => [...was, { who: 'me', text: more }, { who: 'them', text: t('first-run.about.renameHere') }]);
      return;
    }
    if (renamed) {
      setOwnName(renamed.name);
      setReply('');
      setThread((was) => [...was, { who: 'me', text: more }, { who: 'them', text: t('first-run.about.renamed', { name: renamed.name }) }]);
      if (!renamed.rest) return;
    }
    const asked = renamed ? cleanSentence(renamed.rest) : more;
    const combined = cleanSentence(`${said}\n${asked}`).slice(-OPEN_BOX.max);
    if (sentenceProblem(combined)) { setProblem(t(sentenceProblem(combined)!)); return; }
    setSaid(combined);
    setReply('');
    if (!renamed) setThread((was) => [...was, { who: 'me', text: more }]);
    void ask({ text: combined });
  }

  /** A tile: straight to the plan in A, or a correction of the field in B. No AI either way. */
  async function pick(familyId: import('../../engine/types.ts').FamilyLite['id'], keep: Mode) {
    setBusy(true); setProblem(null);
    try {
      const words = cleanSentence(said || text);
      const next = await client.request('venture.about.pick', { familyId, ...(words ? { text: words } : {}) });
      setRead(next);
      void nameFor(next, countryCode);
      setMode(keep);
    } catch (error) { setProblem(messageOf(error)); }
    finally { setBusy(false); }
  }

  function chooseCountry(code: string) {
    picked.current = true;
    setCountryAsk(null);
    setChoosing(false);
    setFromZone(false);
    setCountryCode(code);
    if (read) void nameFor(read, code);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    setProblem(null);
    try { setFile(await aboutFile(chosen, { tooBig: t('first-run.about.fileTooBig'), kind: t('first-run.about.fileKind') })); }
    catch (error) { setProblem(messageOf(error)); }
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>, then: () => void) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); then(); }
  }

  // C4 task 1: the plan keeps the offers still ticked, with the owner's renames and additions.
  const keptOffers = rows.filter((row) => row.kept && row.name.trim().length >= 2).map((row) => ({ name: row.name.trim(), line: row.line.trim() }));
  const noOffer = read !== null && read.offers.length > 0 && keptOffers.length === 0;
  const keepable = read?.family && read.idea && countryCode && !noOffer
    ? { read: { ...read, offers: keptOffers.length ? keptOffers : read.offers } as KeptPlan['read'], countryCode, name: (ownName ?? name ?? read.family.label).trim(), ...(firstName.trim() ? { firstName: firstName.trim() } : {}) } : null;
  const noOfferId = `${fieldId}-none`;

  function change(key: number, next: Partial<OfferRow>) { setRows((was) => was.map((row) => (row.key === key ? { ...row, ...next } : row))); }
  function renameRow(key: number, value: string) { const words = value.trim(); change(key, words.length >= 2 ? { name: words, editing: false } : { editing: false }); }
  /** Open while the new-offer field is: Enter and the blur that follows it add the offer once. */
  const addOpen = useRef(false);
  function startAdding() { addOpen.current = true; setAdding(''); }
  function added(value: string) {
    if (!addOpen.current) return;
    addOpen.current = false;
    const words = value.trim();
    setAdding(null);
    if (words.length >= 2) setRows((was) => [...was, { key: Math.max(-1, ...was.map((row) => row.key)) + 1, name: words, line: '', kept: true, editing: false }]);
  }
  function offerKey(event: KeyboardEvent<HTMLInputElement>, save: (value: string) => void, cancel: () => void) {
    if (event.key === 'Enter') { event.preventDefault(); save(event.currentTarget.value); }
    else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  }
  const tiles = families.data?.families ?? [];

  const where = (
    <div className={s.where}>
      {choosing && countries.length > 0 ? (
        <>
          <label htmlFor={countryId}>{t('onboarding.country')}</label>
          <Select id={countryId} className={s.select} value={countryCode ?? 'XX'} onChange={(event) => chooseCountry(event.target.value)}>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
        </>
      ) : country ? (
        <>
          <span>{fromZone ? t('first-run.about.fromZone', { country: country.name }) : country.name}</span>
          <span>{country.currency}</span>
          <Button variant="quiet" onClick={() => setChoosing(true)}>{t('onboarding.change')}</Button>
        </>
      ) : null}
    </div>
  );

  // B3: the read failed: the preview never says it is still reading or updating. B4: the words are in the chat.
  const stopped = !busy && failed;
  // On Send the preview comes in with the chat, in the same motion, and fills in when the answer arrives.
  const preview = mode !== 'a' && (
    <Tile as="section" span={mode === 'plan' ? 12 : 5} label={t('first-run.about.preview')} className={mode === 'b' ? `${s.preview} ${s.slide}` : s.preview} card>
      <div className={s.previewHead}>
        <h2 className={s.chatTitle}>{t('first-run.about.business')}</h2>
        {/* B3: only while a read is on its way. */}
        {mode === 'b' && busy && <Chip tone="working">{t('first-run.about.updating')}</Chip>}
        {mode === 'b' && stopped && <Chip tone="idle">{t('first-run.about.stopped')}</Chip>}
        {mode === 'plan' && <Button variant="quiet" onClick={() => setMode('a')}>{t('first-run.about.back')}</Button>}
      </div>
      {read ? planOf(read) : stopped ? null : <p className={s.hint}>{t('first-run.about.reading')}</p>}
      {mode === 'plan' && problem && <InlineError>{problem}</InlineError>}
    </Tile>
  );

  function planOf(read: AboutReadLite) {
    return (
    <>
      <div className={s.nameCard}>
        {/* C4 task 1 (47.f2, 251.w1): the suggested name is a field the owner can type over; focus selects it. */}
        <label className={s.label} htmlFor={`${fieldId}-name`}>{t('first-run.about.name')}</label>
        <input id={`${fieldId}-name`} className={s.name} data-content="" data-plan-name="" maxLength={60}
          value={ownName ?? name ?? read.family?.label ?? ''} onChange={(event) => setOwnName(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
      </div>
      <Select label={t('first-run.about.field')} id={fieldId} data-changed={fieldChanged} value={read.family?.id ?? ''} disabled={busy} onChange={(event) => { const tile = tiles.find(row => row.id === event.target.value); if (tile) void pick(tile.id, mode); }}>
        {!read.family && <option value="">{t('first-run.about.pick')}</option>}
        {tiles.map((tile) => <option key={tile.id} value={tile.id}>{tile.label}</option>)}
      </Select>
      {read.offers.length > 0 && (
        <>
          <p className={s.label}>{t('first-run.about.sell')}</p>
          <ul className={s.offers}>
            {rows.map((row) => (
              <li key={row.key} className={s.offer} data-content="">
                {!row.kept && (
                  <span className={s.offerRow}>
                    <span className={s.offerLine}>{t('first-run.about.removed', { name: row.name })}</span>
                    <Button variant="quiet" size="sm" onClick={() => change(row.key, { kept: true })}>{t('first-run.about.undo')}</Button>
                  </span>
                )}
                <Reveal open={row.kept}>
                {row.editing ? (
                  <input className={s.offerEdit} aria-label={t('first-run.about.renameOffer', { name: row.name })} defaultValue={row.name} maxLength={60} autoFocus
                    onKeyDown={(event) => offerKey(event, (value) => renameRow(row.key, value), () => change(row.key, { editing: false }))}
                    onBlur={(event) => renameRow(row.key, event.currentTarget.value)} />
                ) : (
                  <span className={s.offerRow}>
                    <label className={s.offerTick}>
                      <input type="checkbox" checked onChange={() => change(row.key, { kept: false })} />
                      <span className={s.offerName}>{row.name}</span>
                    </label>
                    <Button variant="quiet" size="sm" aria-label={t('first-run.about.renameOffer', { name: row.name })} onClick={() => change(row.key, { editing: true })}>
                      <Icon name="pencil" size={14} />
                    </Button>
                  </span>
                )}
                {row.line && <span className={s.offerLine}>{row.line}</span>}
                </Reveal>
              </li>
            ))}
            {adding !== null && (
              <li className={s.offer}>
                <input className={s.offerEdit} aria-label={t('first-run.about.newOffer')} value={adding} maxLength={60} autoFocus
                  onChange={(event) => setAdding(event.target.value)}
                  onKeyDown={(event) => offerKey(event, added, () => { addOpen.current = false; setAdding(null); })} onBlur={(event) => added(event.currentTarget.value)} />
              </li>
            )}
          </ul>
          {adding === null && keptOffers.length < CARD_OFFERS_MAX && (
            <Button variant="quiet" size="sm" onClick={startAdding}>{t('first-run.about.addOffer')}</Button>
          )}
          <p className={s.hint}>{t('first-run.about.prices')}</p>
        </>
      )}
      {where}
      <div className={s.keep}>
        {noOffer && <p id={noOfferId} className={s.hint}>{t('first-run.about.noOffer')}</p>}
        <Button variant="primary" size="lg" disabled={!keepable || busy} disabledReason={!busy && read && !read.family ? t('first-run.about.pickField') : undefined} aria-describedby={noOffer ? noOfferId : undefined} onClick={() => { if (keepable) onKeep(keepable); }}>{t('first-run.about.keep')}</Button>
      </div>
    </>
    );
  }

  /** B4 task 12: a field is a plain row; its line is the row's title. */
  const tileRow = (tile: (typeof tiles)[number]) => (
    <li key={tile.id}>
      <button type="button" className={s.family} title={tile.line} disabled={busy} onClick={() => void pick(tile.id, 'plan')}>{tile.label}</button>
    </li>
  );

  const firstNameField = <Field label={t('first-run.about.firstName')} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.currentTarget.value)} />;

  if (mode === 'a') {
    return (
      <div className={f.wrap}>
        <h1 id={headingId} className={f.title}>{t('first-run.about.title')}</h1>
        <p className={f.sub}>{t('first-run.about.sub')}</p>
        <Bento className={f.grid} as="section" labelledBy={headingId}>
          <Tile span={12} plain>
            {firstNameField}
            <form className={s.box} onSubmit={send} noValidate>
              <label htmlFor={boxId} className={s.boxLabel}>{t('first-run.about.label')}</label>
              <div className={s.boxRow}>
                <textarea ref={box} id={boxId} className={s.input} rows={2} value={text} placeholder={t('first-run.about.placeholder')}
                  aria-invalid={boxWrong ? true : undefined}
                  onChange={(event) => { setText(event.target.value); setProblem(null); setBoxWrong(false); }} onKeyDown={(event) => onKey(event, send)} />
                <Button variant="primary" size="lg" type="submit" disabled={busy || (!text.trim() && !file)}>{t('first-run.about.send')}</Button>
              </div>
              <FilePick icon="paperclip" choose={t('first-run.about.attach')} files={file ? [file] : []} onRemove={() => setFile(null)} accept=".pdf,.zip,application/pdf,application/zip" onChange={(event) => void onFile(event)} />
              <p className={s.hint}>{t('first-run.about.hint')}</p>
              {problem && <InlineError>{problem}</InlineError>}
            </form>
          </Tile>
          <div className={f.wide}>{where}</div>
          <h2 className={`${s.pickHead} ${f.wide}`}>{t('first-run.about.pick')}</h2>
          <ul className={`${s.families} ${f.wide}`} aria-label={t('first-run.about.pick')}>{tiles.slice(0, FIELDS_AT_REST).map(tileRow)}</ul>
          {tiles.length > FIELDS_AT_REST && (
            <Fold summary={t('first-run.about.moreFields')} className={f.wide}>
              <ul className={s.families} aria-label={t('first-run.about.moreFields')}>{tiles.slice(FIELDS_AT_REST).map(tileRow)}</ul>
            </Fold>
          )}
        </Bento>
        {!connected && <span className="sr-only">{t('first-run.step.templates')}</span>}
      </div>
    );
  }

  return (
    <div className={f.wrap} data-motion={motion} data-mode={mode}>
      <h1 className="sr-only">{t('first-run.about.title')}</h1>
      <Bento as="section" label={t('first-run.about.chatMeta')}>
        {mode === 'b' && (
          <Tile as="section" span={7} label={t('first-run.about.chat')} className={`${s.chat} ${s.rise}`}>
            <div className={s.chatHead}>
              <h2 className={s.chatTitle}>{t('app.name')}</h2>
              <span className={s.hint}>{t('first-run.about.chatMeta')}</span>
              <Button variant="quiet" onClick={() => setMode('a')}>{t('first-run.about.back')}</Button>
            </div>
            {firstNameField}
            {thread.map((bubble, index) => (bubble.failed ? (
              <div key={index} className={`${s.bubble} ${s.them}`} data-failed-turn="">
                <InlineError fix={stopped && index === thread.length - 1 && lastAsk.current ? { label: t('first-run.ai.tryAgain'), onSelect: () => { void ask(lastAsk.current!); } } : undefined}>{bubble.text}</InlineError>
              </div>
            ) : (              <p key={index} className={`${s.bubble} ${bubble.who === 'me' ? s.me : s.them}`} data-content={bubble.who === 'me' || bubble.byAi ? '' : undefined} data-by={bubble.byAi ? 'ai' : undefined}>
                {bubble.byAi && <span className={s.byAi}>{t('first-run.about.byAi')}</span>}
                <span>{bubble.text}</span>
              </p>
            )))}
            {/* One-shot C3 task 11: Chausar's turn in the chat says which step it is on. */}
            {busy && <div className={`${s.bubble} ${s.them}`}><Progress kind="about" active /></div>}
            {countryAsk && (
              <div className={`${s.bubble} ${s.them}`}>
                <p>{t('onboarding.countrySuggestion', { country: countryAsk.name, currency: countryAsk.currency })}</p>
                {read?.evidence && <blockquote data-content="" aria-label={t('onboarding.countryEvidence')}>{read.evidence}</blockquote>}
                <div className={s.where}>
                  <Button variant="secondary" onClick={() => chooseCountry(countryAsk.code)}>{t('onboarding.countryUse', { country: countryAsk.name })}</Button>
                  <Button variant="quiet" onClick={() => { picked.current = true; setCountryAsk(null); }}>{t('onboarding.countryKeep', { country: country?.name ?? '' })}</Button>
                </div>
              </div>
            )}
            <form className={s.chatFoot} onSubmit={sendReply} noValidate>
              <label htmlFor={sayId} className="sr-only">{t('first-run.about.say')}</label>
              <div className={s.boxRow}>
                <textarea id={sayId} className={s.input} rows={2} value={reply} placeholder={t('first-run.about.sayPlaceholder')}
                  onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => onKey(event, sendReply)} />
                <Button type="submit" disabled={busy || !reply.trim()}>{t('first-run.about.send')}</Button>
              </div>
              {problem && <InlineError>{problem}</InlineError>}
            </form>
          </Tile>
        )}
        {preview}
      </Bento>
    </div>
  );
}
