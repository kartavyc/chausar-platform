import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { AboutReadLite, CountryLite } from '../../engine/types';
import { Bento, Tile } from '../../parts/Tile';
import { Button } from '../../parts/Button';
import { Chip } from '../../parts/Chip';
import { Icon } from '../../parts/Icon';
// One-shot C3: off under the computer's reduce-motion setting or the owner's Animations off; then A becomes B with no motion.
import { motionOff } from '../../parts/motion';
import { cleanSentence, computerCountry, pickCountry, sentenceProblem, OPEN_BOX } from './flow';
import { aboutFile, type AboutFile } from './linkedin';
import { renameIn } from './rename';
import f from './FirstRun.module.css';
import s from './AboutYou.module.css';
import { Progress } from '../../parts/Progress';

type Mode = 'a' | 'b' | 'plan';
type Bubble = { who: 'me' | 'them'; text: string };
/** name (one-shot A1, row 3): the name the card shows, which the saved plan keeps with the card's offers. */
export type KeptPlan = { read: AboutReadLite & { idea: string; family: NonNullable<AboutReadLite['family']> }; countryCode: string; name: string };
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
export function AboutYou({ connected, onKeep }: { connected: boolean; onKeep: (plan: KeptPlan) => void }) {
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
  const [motion] = useState(() => (motionOff() ? 'none' : 'once'));
  const [text, setText] = useState('');
  const [file, setFile] = useState<AboutFile | null>(null);
  const [said, setSaid] = useState('');
  const [reply, setReply] = useState('');
  const [thread, setThread] = useState<Bubble[]>([]);
  const [read, setRead] = useState<AboutReadLite | null>(null);
  const [name, setName] = useState<string | null>(null);
  /** One-shot A3 (S1): the name the owner asked for in the chat; it wins over the field's name until they change it again. */
  const [ownName, setOwnName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
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
    const lines = [!next.family ? t('first-run.about.replyNoFamily') : t(next.source === 'keywords' ? 'first-run.about.replyKeywords' : 'first-run.about.reply', { family: next.family.label })];
    if (next.file && !next.file.included && next.file.line) lines.push(next.file.line);
    return lines.join('\n');
  }

  function took(next: AboutReadLite) {
    setRead(next);
    setThread((was) => [...was, { who: 'them', text: answerWords(next) }]);
    if (next.country && next.country.code !== countryCode && !picked.current) setCountryAsk(next.country);
    void nameFor(next, countryCode);
  }

  async function ask(params: { text?: string; attachment?: AboutFile }) {
    setBusy(true); setProblem(null);
    try { took(await client.request('venture.about.read', params)); }
    catch (error) { setProblem(messageOf(error)); }
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
  async function pick(familyId: string, keep: Mode) {
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

  const keepable = read?.family && read.idea && countryCode ? { read: read as KeptPlan['read'], countryCode, name: (ownName ?? name ?? read.family.label).trim() } : null;
  const tiles = families.data?.families ?? [];

  const where = (
    <div className={s.where}>
      {choosing && countries.length > 0 ? (
        <>
          <label htmlFor={countryId}>{t('onboarding.country')}</label>
          <select id={countryId} className={s.select} value={countryCode ?? 'XX'} onChange={(event) => chooseCountry(event.target.value)}>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </>
      ) : country ? (
        <>
          <Chip tone="line">{fromZone ? t('first-run.about.fromZone', { country: country.name }) : country.name}</Chip>
          <Chip tone="line">{country.currency}</Chip>
          <Button variant="quiet" onClick={() => setChoosing(true)}>{t('onboarding.change')}</Button>
        </>
      ) : null}
    </div>
  );

  // B3: the read failed and nothing was read: the preview says the problem, not that it is still reading.
  const failedRead = !busy && !read && problem !== null;
  // On Send the preview comes in with the chat, in the same motion, and fills in when the answer arrives.
  const preview = mode !== 'a' && (
    <Tile as="section" span={mode === 'plan' ? 12 : 5} label={t('first-run.about.preview')} className={mode === 'b' ? `${s.preview} ${s.slide}` : s.preview} card>
      <div className={s.previewHead}>
        <h2 className={s.chatTitle}>{t('first-run.about.business')}</h2>
        {/* B3: only while a read is on its way. */}
        {mode === 'b' && busy && <Chip tone="working">{t('first-run.about.updating')}</Chip>}
        {mode === 'plan' && <Button variant="quiet" onClick={() => setMode('a')}>{t('first-run.about.back')}</Button>}
      </div>
      {read ? planOf(read) : failedRead ? <p className={f.problem} role="alert">{problem}</p> : <p className={s.hint}>{t('first-run.about.reading')}</p>}
    </Tile>
  );

  function planOf(read: AboutReadLite) {
    return (
    <>
      <div className={s.nameCard}>
        <p className={s.label}>{t('first-run.about.name')}</p>
        <p className={s.name} data-content="" data-plan-name="">{ownName ?? name ?? read.family?.label ?? ''}</p>
        {read.family && <p className={s.offerLine}>{read.family.label}</p>}
      </div>
      <label className={s.label} htmlFor={fieldId}>{t('first-run.about.field')}</label>
      <select id={fieldId} className={s.select} value={read.family?.id ?? ''} disabled={busy} onChange={(event) => void pick(event.target.value, mode)}>
        {!read.family && <option value="">{t('first-run.about.pick')}</option>}
        {tiles.map((tile) => <option key={tile.id} value={tile.id}>{tile.label}</option>)}
      </select>
      {read.offers.length > 0 && (
        <>
          <p className={s.label}>{t('first-run.about.sell')}</p>
          <ul className={s.offers}>
            {read.offers.map((offer) => (
              <li key={offer.name} className={s.offer} data-content="">
                <span className={s.offerName}>{offer.name}</span>
                {offer.line && <span className={s.offerLine}>{offer.line}</span>}
              </li>
            ))}
          </ul>
          <p className={s.hint}>{t('first-run.about.prices')}</p>
        </>
      )}
      {where}
      <div className={s.keep}>
        <Button variant="primary" size="lg" disabled={!keepable || busy} onClick={() => { if (keepable) onKeep(keepable); }}>{t('first-run.about.keep')}</Button>
      </div>
    </>
    );
  }

  if (mode === 'a') {
    return (
      <div className={f.wrap}>
        <p className={f.eyebrow}>{t('first-run.stepOf', { n: '2' })}</p>
        <h1 id={headingId} className={f.title}>{t('first-run.about.title')}</h1>
        <p className={f.sub}>{t('first-run.about.sub')}</p>
        <Bento className={f.grid} as="section" labelledBy={headingId}>
          <Tile span={12} card>
            <form className={s.box} onSubmit={send} noValidate>
              <label htmlFor={boxId} className={s.boxLabel}>{t('first-run.about.label')}</label>
              <div className={s.boxRow}>
                <textarea ref={box} id={boxId} className={s.input} rows={2} value={text} placeholder={t('first-run.about.placeholder')}
                  aria-invalid={boxWrong ? true : undefined}
                  onChange={(event) => { setText(event.target.value); setProblem(null); setBoxWrong(false); }} onKeyDown={(event) => onKey(event, send)} />
                <label className={s.attach} title={t('first-run.about.attach')}>
                  <Icon name="paperclip" size={18} />
                  <span className="sr-only">{t('first-run.about.attach')}</span>
                  <input className="sr-only" type="file" accept=".pdf,.zip,application/pdf,application/zip" onChange={(event) => void onFile(event)} />
                </label>
                <Button variant="primary" size="lg" type="submit" disabled={busy}>{t('first-run.about.send')}</Button>
              </div>
              {file && (
                <p className={s.file}><Icon name="file-text" size={14} /><span data-content="">{file.name}</span>
                  <Button variant="quiet" size="sm" onClick={() => setFile(null)}>{t('first-run.about.removeFile', { name: file.name })}</Button></p>
              )}
              <p className={s.hint}>{t('first-run.about.hint')}</p>
            </form>
          </Tile>
          <Tile span={12} pad="compact">{where}</Tile>
          <h2 className={s.pickHead}>{t('first-run.about.pick')}</h2>
          <ul className={s.families}>
            {tiles.map((tile) => (
              <li key={tile.id}>
                <button type="button" className={s.family} disabled={busy} onClick={() => void pick(tile.id, 'plan')}>
                  <span className={s.familyName}>{tile.label}</span>
                  <span className={s.familyLine}>{tile.line}</span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" className={s.family} data-else="" onClick={() => box.current?.focus()}>
                <span className={s.familyName}>{t('first-run.about.else')}</span>
                <span className={s.familyLine}>{t('first-run.about.elseLine')}</span>
              </button>
            </li>
          </ul>
        </Bento>
        {problem && <p className={f.problem} role="alert">{problem}</p>}
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
            {thread.map((bubble, index) => (
              <p key={index} className={`${s.bubble} ${bubble.who === 'me' ? s.me : s.them}`} data-content={bubble.who === 'me' ? '' : undefined}>{bubble.text}</p>
            ))}
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
                <Button type="submit" disabled={busy}>{t('first-run.about.send')}</Button>
              </div>
            </form>
          </Tile>
        )}
        {preview}
      </Bento>
      {problem && !failedRead && <p className={f.problem} role="alert">{problem}</p>}
    </div>
  );
}
