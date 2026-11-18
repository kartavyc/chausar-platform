import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { AboutBeforeLite, AboutReadLite, CountryLite, OfferUnit, TeamCardLite } from '../../engine/types';
import { OFFER_UNITS } from '../../../../../platform/runtime/venture/core/offer-units';
import { renamesAsked } from '../../../../../platform/runtime/venture/core/offer-rename';
import { KEEPER_JOINS } from '../../../../../platform/runtime/venture/agents/order-agents-core';
import { deptKey } from '../../text/dept';
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

export type AboutMode = 'a' | 'b' | 'plan';
type Mode = AboutMode;
/** failed: a read that failed or an AI that stopped, said as Chausar's turn in the chat (B4 task 4). */
/** file: the bubble names a file sent with no words, so it is no turn of the talk a follow-up carries. */
/** connect: the turn says no AI is connected, and offers the way back to step 1. */
type Bubble = { who: 'me' | 'them'; text: string; failed?: boolean; byAi?: boolean; file?: boolean; connect?: boolean };
/** C4 task 1: an offer on the plan card, kept (ticked) by default, renamed in place, or added by the owner. */
/** mine: the owner typed this name (a rename or an offer they added); a follow-up tells the AI it is the owner's own. */
/** unit: the unit the offer is priced in (the engine's core/offer-units.ts): the AI's suggestion or the field's own, until the owner changes it. */
type OfferRow = { key: number; name: string; line: string; kept: boolean; editing: boolean; mine: boolean; unit: OfferUnit };
/** The engine keeps one to three offers from the card (core/blueprint.ts SHOWN_OFFER_IDS). */
const CARD_OFFERS_MAX = 3;
/**
 * C4 task 1 (146.w1): a message that asks for a rename in any words. When renameIn cannot read a name from it, the chat
 * says so in one fixed line and points at the name field.
 */
const ASKS_RENAME = /\b(?:(?:call|name)\s+(?:it|this|the business|my business|this business)|rename)\b/i;
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** An offer is plain words: a digit, a currency sign or a link is refused when the plan is kept (the engine's shownOf). */
const NOT_PLAIN = /[\p{N}\p{Sc}]|:\/\//u;
const EMPTY_ROW = { name: '', line: '', kept: true, editing: false, mine: false, unit: 'project' as OfferUnit };
/**
 * The rows the owner types in when no AI read their work and it fits no listed field (the engine's ownOffers): the
 * read's rows (one taken from their own words, or the ones they already typed), else one empty row to start from.
 */
function typedRows(next: AboutReadLite, was: readonly OfferRow[]): OfferRow[] {
  const rows = next.offers.slice(0, CARD_OFFERS_MAX).map((offer, index) => ({ ...EMPTY_ROW, key: index, name: offer.name, line: offer.line ?? '', unit: offer.unit ?? 'project', mine: was.find((row) => sameName(row.name, offer.name))?.mine ?? false }));
  return rows.length ? rows : [{ ...EMPTY_ROW, key: 0 }];
}
/**
 * The card's rows for a read. After a follow-up (was: the rows before it) what the owner did holds whatever the answer
 * says: a name they typed stays marked theirs, an offer they unticked stays unticked, and one the answer left out stays
 * on the card as removed, so Undo is still there.
 */
function rowsOf(next: AboutReadLite, was: readonly OfferRow[] = []): OfferRow[] {
  const rows = next.offers.map((offer, index) => {
    const old = was.find((row) => sameName(row.name, offer.name));
    return { key: index, name: offer.name, line: offer.line ?? '', kept: old ? old.kept : true, editing: false, mine: old?.mine ?? false, unit: offer.unit ?? 'project' };
  });
  const gone = was.filter((row) => !row.kept && !rows.some((kept) => sameName(kept.name, row.name)));
  return [...rows, ...gone.map((row, index) => ({ ...row, key: rows.length + index, editing: false }))];
}
/** The engine takes at most this many turns with a follow-up (core/about-before.ts): the first message, then the newest. */
const TURNS_SENT = 40;
const OFFERS_SENT = 8;
const UNTICKED_SENT = 4;
/** name (one-shot A1, row 3): the name the card shows, which the saved plan keeps with the card's offers. */
/** The plan as kept. family: the listed field, or null for work that fits none (the plan still starts from the owner's words). */
/** team: the proposed agents the owner did not leave out, as the engine gave them; hired once the business exists. */
export type KeptPlan = { read: AboutReadLite & { idea: string }; countryCode: string; name: string; firstName?: string; team?: TeamCardLite[] };
/** What the owner had typed on step 2 when they went back to step 1 to connect an AI; it is there again when they return. */
export type AboutDraft = { text: string; firstName: string };
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
export function AboutYou({ connected, onKeep, onMode, draft, onConnect }: {
  connected: boolean; onKeep: (plan: KeptPlan) => void; onMode?: ((mode: AboutMode) => void) | undefined;
  /** What the box and the first name start with: the words kept when the owner went back to connect an AI. */
  draft?: AboutDraft | undefined;
  /** The way back to step 1 from "No AI is connected", with what the owner typed. */
  onConnect?: ((draft: AboutDraft) => void) | undefined;
}) {
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
  const [text, setText] = useState(draft?.text ?? '');
  // C4 task 2 (8.w1): optional, kept here only until the business is open (FirstRun's kept()).
  const [firstName, setFirstName] = useState(draft?.firstName ?? '');
  const [file, setFile] = useState<AboutFile | null>(null);
  const [said, setSaid] = useState('');
  const [reply, setReply] = useState('');
  const [thread, setThread] = useState<Bubble[]>([]);
  const [read, setReadOnly] = useState<AboutReadLite | null>(null);
  /** C4 task 1: the card's offers as the owner keeps, renames or adds them; reset with each new read. */
  const [rows, setRows] = useState<OfferRow[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  /** The proposed agents the owner left out, by name: a follow-up's answer keeps them out; a fresh read starts empty. */
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  /** follow: the read answers a follow-up, so what the owner did on the card holds (rowsOf, and the agents left out). */
  const setRead = useCallback((next: AboutReadLite | null, follow = false) => {
    setReadOnly(next);
    setRows((was) => (!next ? [] : next.ownOffers ? typedRows(next, follow ? was : []) : rowsOf(next, follow ? was : [])));
    setAdding(null);
    setLeft((was) => (follow && next ? new Set([...was].filter((name) => (next.team ?? []).some((agent) => agent.name === name))) : new Set()));
  }, []);
  const [name, setName] = useState<string | null>(null);
  /** One-shot A3 (S1): the name the owner asked for in the chat; it wins over the field's name until they change it again. */
  const [ownName, setOwnName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The last read failed; lastAsk is what Try again sends once more. */
  const [failed, setFailed] = useState(false);
  const lastAsk = useRef<{ text?: string; attachment?: AboutFile; before?: AboutBeforeLite } | null>(null);
  const [boxWrong, setBoxWrong] = useState(false);
  const [countries, setCountries] = useState<CountryLite[]>([]);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [fromZone, setFromZone] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [countryAsk, setCountryAsk] = useState<CountryLite | null>(null);
  const picked = useRef(false);
  /**
   * The field the owner picked themselves (a tile, or the Field list). It holds through every later answer, the way
   * their typed offers and name hold, until they pick another; a new first message starts over. Found on the first
   * Windows walk (15 Nov 2026): one more message put the engine's own reading of the words in its place (none without
   * an AI when no keyword fits), so the pick was gone and Keep this plan was locked.
   */
  const ownField = useRef<AboutReadLite['family']>(null);
  /**
   * An answer to a follow-up, with the owner's own field kept on it. Your AI's answer keeps everything it wrote and
   * takes the field (a profession only when it is one of that field's). With no AI the answer is only a keyword guess,
   * so the card stays the picked field's plan: the engine's own plan for that field and everything said so far
   * (venture.about.pick, what the pick itself asked), with the offers on the card as they are.
   */
  async function withOwnField(next: AboutReadLite, words: string): Promise<AboutReadLite> {
    const held = ownField.current;
    if (!held || next.family?.id === held.id) return next;
    if (next.source === 'ai') {
      const inField = families.data?.families.find((tile) => tile.id === held.id)?.professions.some((item) => item.id === next.profession?.id) ?? false;
      return { ...next, family: held, profession: inField ? next.profession : null };
    }
    const again = await client.request('venture.about.pick', { familyId: held.id, ...(words ? { text: words } : {}) });
    const onCard = rows.filter((row) => row.kept && row.name.trim().length >= 2).slice(0, CARD_OFFERS_MAX).map((row) => ({ name: row.name.trim(), line: row.line.trim(), ...(row.unit === 'project' ? {} : { unit: row.unit }) }));
    // Offers the owner typed stay the owner's own typed rows, under the picked field (as the pick left them).
    const typed = read?.ownOffers === true && onCard.length > 0;
    return { ...again, source: next.source, offers: onCard.length ? onCard : again.offers, ...(next.file ? { file: next.file } : {}), ...(typed ? { ownOffers: true as const, ...(read.name ? { name: read.name } : {}) } : {}) };
  }

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
    // No AI and no listed field, but words clear enough to keep: said plainly, with what the owner can do now.
    const lines = [next.reply ?? (next.ownOffers ? t('first-run.about.replyOwn') : !next.family ? t('first-run.about.replyNoFamily') : t(next.source === 'keywords' ? 'first-run.about.replyKeywords' : 'first-run.about.reply', { family: next.family.label }))];
    if (next.file && !next.file.included && next.file.line) lines.push(next.file.line);
    return lines.join('\n');
  }

  function took(next: AboutReadLite, follow: boolean) {
    setRead(next, follow);
    setThread((was) => [...was, { who: 'them', text: answerWords(next), ...(next.reply ? { byAi: true } : {}), ...(next.ownOffers ? { connect: true } : {}) }]);
    if (next.country && next.country.code !== countryCode && !picked.current) setCountryAsk(next.country);
    void nameFor(next, countryCode);
  }

  async function ask(params: { text?: string; attachment?: AboutFile; before?: AboutBeforeLite }) {
    setBusy(true); setProblem(null); setFailed(false);
    lastAsk.current = params;
    try {
      const follow = params.before !== undefined;
      const next = await client.request('venture.about.read', params);
      // Everything said so far: `said` is what came before this message (Try again finds the message in it already).
      const all = params.text && !said.endsWith(params.text) ? cleanSentence(`${said}\n${params.text}`).slice(-OPEN_BOX.max) : said;
      took(follow ? await withOwnField(next, all) : next, follow);
    }
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
    setThread([{ who: 'me', text: words || file!.name, ...(words ? {} : { file: true }) }]);
    ownField.current = null;
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
    // An offer rename ("Rename the first offer to ...", "Rename A to B") is the engine's to read and apply
    // (core/offer-rename.ts): it is no business rename, so it goes on with the message.
    const offerRename = read ? renamesAsked(more, rows.filter((row) => row.kept && row.name.trim().length >= 2)).renames.length > 0 : false;
    // C4 task 1 (146.w1): asked to rename in words code cannot read: one fixed line, and the AI is not asked.
    if (read && !renamed && !offerRename && ASKS_RENAME.test(more)) {
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
    // No plan yet (the first read failed): everything said goes as one fresh read, as a first message does.
    if (!read && sentenceProblem(combined)) { setProblem(t(sentenceProblem(combined)!)); return; }
    if (asked.length > OPEN_BOX.max) { setProblem(t('onboarding.tooLong')); return; }
    setSaid(combined);
    setReply('');
    if (!renamed) setThread((was) => [...was, { who: 'me', text: more }]);
    // A follow-up is a turn of the same talk: only the new message, with what came before, so the AI refines the plan
    // on the card instead of writing a new one (the engine's core/about-before.ts).
    // The name sent with it is the owner's own or the AI's, never the plan's label the box fell back to (the engine's core/business-name.ts).
    void ask(read ? { text: asked, before: beforeOf(read, renamed?.name ?? ownName ?? read.name ?? '') } : { text: combined });
  }

  /** What came before a follow-up: the talk so far, and the plan as the card shows it now, with what the owner did to it. */
  function beforeOf(shown: AboutReadLite, nameNow: string): AboutBeforeLite {
    const said = thread.flatMap((bubble): AboutBeforeLite['turns'] => (bubble.failed || bubble.file ? [] : bubble.who === 'me' ? [{ from: 'owner', text: bubble.text }] : bubble.byAi ? [{ from: 'you', text: bubble.text }] : []));
    return {
      turns: said.length > TURNS_SENT ? [said[0]!, ...said.slice(1 - TURNS_SENT)] : said,
      plan: {
        familyId: shown.family?.id ?? null, professionId: shown.profession?.id ?? null, name: nameNow.trim() || null,
        // The card's rows in order; past what the engine takes, the kept offers and the newest few the owner unticked.
        // A row the owner has not named yet (work outside the fields, typed on the card) is no offer: it is not sent.
        offers: (rows.length <= OFFERS_SENT ? rows : [...rows.filter((row) => row.kept), ...rows.filter((row) => !row.kept).slice(-UNTICKED_SENT)]).slice(0, OFFERS_SENT)
          .filter((row) => row.name.trim().length >= 2)
          .map((row) => ({ name: row.name.trim(), line: row.line.trim(), kept: row.kept, yours: row.mine, ...(row.unit === 'project' ? {} : { unit: row.unit }) })),
        way: shown.way ?? null,
        team: team.map((agent) => ({ name: agent.name, job: agent.job, duties: agent.duties, reads: agent.reads, left: left.has(agent.name), ...(agent.department ? { department: agent.department } : {}) })),
      },
    };
  }

  /**
   * A tile: straight to the plan in A, or a correction of the field in B. No AI either way.
   *
   * A pick sets the field. Where there is a plan already it sets nothing else (seen on Windows, 15 Nov 2026: a potter
   * with a plan from their AI picked "Creative work" and the whole card became that field's template, "Creative
   * studio" with Video edits). A plan is one your AI wrote, or offers the owner typed themselves: its name, offers,
   * way, team and needs stay, and only what hangs on the field follows the pick (its rules, the question "Which of
   * these are you?", a profession of another field). Only with no plan yet (no AI, nothing typed) does the pick bring
   * the field's starting examples.
   */
  async function pick(familyId: string, keep: Mode) {
    setBusy(true); setProblem(null);
    try {
      const words = cleanSentence(said || text);
      const next = await client.request('venture.about.pick', { familyId, ...(words ? { text: words } : {}) });
      ownField.current = next.family;
      const mine = rows.filter((row) => row.mine && row.kept && row.name.trim().length >= 2).slice(0, CARD_OFFERS_MAX);
      if (read && read.source === 'ai' && read.offers.length > 0) {
        // Your AI's plan, under the owner's field. The idea stays the owner's words, so who does each order stays too.
        // The AI judged the professions of its own field, never of this one: the owner is asked which they are.
        const { ownKind: _ownKind, ...plan } = read;
        const inField = families.data?.families.find((tile) => tile.id === familyId)?.professions.some((item) => item.id === read.profession?.id) ?? false;
        setReadOnly({ ...plan, family: next.family, profession: inField ? read.profession : null });
      } else if (read && mine.length) {
        // The owner's own typed offers, under the field: the field places the idea, as it does for any plan with no AI.
        // The name the card showed stays: with a field the fallback would become the field's own label.
        setReadOnly({ ...next, source: read.source, offers: mine.map((row) => ({ name: row.name.trim(), line: row.line.trim(), ...(row.unit === 'project' ? {} : { unit: row.unit }) })), ownOffers: true, ...(planName ? { name: planName } : {}), ...(read.file ? { file: read.file } : {}) });
        setRows(mine.map((row, index) => ({ ...row, key: index, editing: false })));
      } else {
        setRead(next);
        void nameFor(next, countryCode);
      }
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
  const keptOffers = rows.filter((row) => row.kept && row.name.trim().length >= 2).map((row) => ({ name: row.name.trim(), line: row.line.trim(), ...(row.unit === 'project' ? {} : { unit: row.unit }) }));
  /** The owner types what they sell: no AI read their work and it fits no listed field. */
  const typing = read?.ownOffers === true;
  const noOffer = read !== null && (typing || read.offers.length > 0) && keptOffers.length === 0;
  /** A kept offer that holds a number, a currency sign or a link: the engine would refuse it once the vault is made. */
  const notPlain = rows.some((row) => row.kept && NOT_PLAIN.test(`${row.name} ${row.line}`));
  // The listed fields are no gate: a plan with an idea is kept with or without one. Its name is the owner's, else the
  // engine's own name for the idea, else the field's, else its first offer's.
  // The name your AI proposed (checked by the engine) comes before the plan's own label; the owner's name before both.
  // Work outside the listed fields has no field's label to fall back to: the first offer names it before the plan's
  // own label ("Service business") ever does.
  const fallbackName = read?.family ? name ?? read.family.label ?? read.offers[0]?.name ?? keptOffers[0]?.name : read?.offers[0]?.name ?? keptOffers[0]?.name ?? name;
  const shownName = ownName ?? read?.name ?? fallbackName ?? '';
  const planName = shownName.trim();
  // The team is the way's: shown and kept only beside it, each agent unless the owner left it out.
  const team = read?.way ? read.team ?? [] : [];
  /** The agents that will do each order (the engine's agents/order-agents.ts): they join when the plan is accepted, so the owner sees one team. */
  const orderAgents = read?.way ? read.orderAgents ?? [] : [];
  const keptTeam = team.filter((agent) => !left.has(agent.name));
  const keepable = read?.idea && countryCode && !noOffer && !notPlain && planName
    ? { read: { ...read, offers: keptOffers.length ? keptOffers : read.offers } as KeptPlan['read'], countryCode, name: planName, ...(firstName.trim() ? { firstName: firstName.trim() } : {}), ...(keptTeam.length ? { team: keptTeam } : {}) } : null;
  /** Why the plan cannot be kept yet, in the one place that says it: under the button. */
  const whyNot = busy || !read || keepable ? undefined
    : notPlain ? t('first-run.about.offerPlain') : typing ? (noOffer ? t('first-run.about.ownNone') : undefined) : !read.family ? t('first-run.about.pickField') : undefined;
  function leave(agent: string, out: boolean) { setLeft((was) => { const next = new Set(was); if (out) next.add(agent); else next.delete(agent); return next; }); }
  const noOfferId = `${fieldId}-none`;

  function change(key: number, next: Partial<OfferRow>) { setRows((was) => was.map((row) => (row.key === key ? { ...row, ...next } : row))); }
  function renameRow(key: number, value: string) {
    const words = value.trim();
    setRows((was) => was.map((row) => (row.key !== key ? row : words.length >= 2 && words !== row.name ? { ...row, name: words, editing: false, mine: true } : { ...row, editing: false })));
  }
  /** Open while the new-offer field is: Enter and the blur that follows it add the offer once. */
  const addOpen = useRef(false);
  function startAdding() { addOpen.current = true; setAdding(''); }
  function added(value: string) {
    if (!addOpen.current) return;
    addOpen.current = false;
    const words = value.trim();
    setAdding(null);
    if (words.length >= 2) setRows((was) => [...was, { key: Math.max(-1, ...was.map((row) => row.key)) + 1, name: words, line: '', kept: true, editing: false, mine: true, unit: 'project' }]);
  }
  /** A typed row: what the owner writes in it is theirs. Removing the last one leaves an empty row to type in. */
  function typeRow(key: number, next: { name?: string; line?: string }) { change(key, { ...next, mine: true }); }
  function removeRow(key: number) { setRows((was) => { const left = was.filter((row) => row.key !== key); return left.length ? left : [{ ...EMPTY_ROW, key: 0 }]; }); }
  function addRow() { setRows((was) => [...was, { ...EMPTY_ROW, key: Math.max(-1, ...was.map((row) => row.key)) + 1 }]); }
  function offerKey(event: KeyboardEvent<HTMLInputElement>, save: (value: string) => void, cancel: () => void) {
    if (event.key === 'Enter') { event.preventDefault(); save(event.currentTarget.value); }
    else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  }
  const tiles = families.data?.families ?? [];
  /** The unit an offer is priced in: the owner's to choose, here and later on Prices. Never an amount. */
  const unitChoice = (row: OfferRow) => (
    <Select className={s.select} aria-label={t('business.unitOf', { offer: row.name })} value={row.unit} onChange={(event) => change(row.key, { unit: event.target.value as OfferUnit })}>
      {OFFER_UNITS.map((unit) => <option key={unit} value={unit}>{t(`business.unit.${unit}`)}</option>)}
    </Select>
  );

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
          <Chip tone="line">{fromZone ? t('first-run.about.fromZone', { country: country.name }) : country.name}</Chip>
          <Chip tone="line">{country.currency}</Chip>
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
          value={shownName} onChange={(event) => setOwnName(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
        {read.family && <p className={s.offerLine}>{read.family.label}</p>}
      </div>
      <Select label={t('first-run.about.field')} id={fieldId} value={read.family?.id ?? ''} disabled={busy} onChange={(event) => void pick(event.target.value, mode)}>
        {!read.family && <option value="">{t('first-run.about.pick')}</option>}
        {tiles.map((tile) => <option key={tile.id} value={tile.id}>{tile.label}</option>)}
      </Select>
      {typing && (
        <>
          <p className={s.label}>{t('first-run.about.sell')}</p>
          <p className={s.hint}>{t('first-run.about.ownHint')}</p>
          <ul className={s.offers}>
            {rows.map((row, index) => (
              <li key={row.key} className={s.offer}>
                <span className={s.offerRow}>
                  <input className={s.offerEdit} data-content="" aria-label={t('first-run.about.ownName', { n: String(index + 1) })} placeholder={t('first-run.about.ownNamePlaceholder')}
                    value={row.name} maxLength={60} onChange={(event) => typeRow(row.key, { name: event.target.value })} />
                  {rows.length > 1 && (
                    <Button variant="quiet" size="sm" aria-label={t('first-run.about.ownRemove', { n: String(index + 1) })} onClick={() => removeRow(row.key)}>
                      <Icon name="x" size={14} />
                    </Button>
                  )}
                </span>
                <input className={s.offerEdit} data-content="" aria-label={t('first-run.about.ownLine', { n: String(index + 1) })} placeholder={t('first-run.about.ownLinePlaceholder')}
                  value={row.line} maxLength={120} onChange={(event) => typeRow(row.key, { line: event.target.value })} />
                {row.name.trim().length >= 2 && unitChoice(row)}
              </li>
            ))}
          </ul>
          {rows.length < CARD_OFFERS_MAX && <Button variant="quiet" size="sm" onClick={addRow}>{t('first-run.about.addOffer')}</Button>}
          <p className={s.hint}>{t('first-run.about.prices')}</p>
        </>
      )}
      {!typing && read.offers.length > 0 && (
        <>
          <p className={s.label}>{t('first-run.about.sell')}</p>
          {/* Offers no AI wrote for this owner (a tile, or the keyword guess) are the field's own starting examples. */}
          {read.source !== 'ai' && <p className={s.hint}>{t('first-run.about.examples')}</p>}
          <ul className={s.offers}>
            {rows.map((row) => (
              <li key={row.key} className={s.offer} data-content="">
                {!row.kept ? (
                  // Removed: one line and Undo (a seam for C3 task 13's removed-row part).
                  <span className={s.offerRow}>
                    <span className={s.offerLine}>{t('first-run.about.removed', { name: row.name })}</span>
                    <Button variant="quiet" size="sm" onClick={() => change(row.key, { kept: true })}>{t('first-run.about.undo')}</Button>
                  </span>
                ) : row.editing ? (
                  <input className={s.offerEdit} aria-label={t('first-run.about.renameOffer', { name: row.name })} defaultValue={row.name} maxLength={60} autoFocus
                    onKeyDown={(event) => offerKey(event, (value) => renameRow(row.key, value), () => change(row.key, { editing: false }))}
                    onBlur={(event) => renameRow(row.key, event.currentTarget.value)} />
                ) : (
                  <span className={s.offerRow}>
                    <label className={s.offerTick}>
                      <input type="checkbox" checked onChange={() => change(row.key, { kept: false })} />
                      <span className={s.offerName} data-offer-name="">{row.name}</span>
                    </label>
                    <Button variant="quiet" size="sm" aria-label={t('first-run.about.renameOffer', { name: row.name })} onClick={() => change(row.key, { editing: true })}>
                      <Icon name="pencil" size={14} />
                    </Button>
                  </span>
                )}
                {row.kept && row.line && <span className={s.offerLine}>{row.line}</span>}
                {row.kept && !row.editing && unitChoice(row)}
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
      {/* The way to earn your AI proposed (the engine's core/way.ts): its own words, marked as the AI's. */}
      {read.way && (
        <section className={s.way} aria-label={t('first-run.way.title')}>
          <p className={s.label}>{t('first-run.way.title')} <span className={s.byAi}>{t('first-run.about.byAi')}</span></p>
          <dl className={s.wayList}>
            {(['customer', 'reach', 'teamDoes', 'youDo'] as const).map((part) => (
              <div key={part} className={s.wayRow}>
                <dt className={s.offerLine}>{t(`first-run.way.${part}`)}</dt>
                <dd className={s.wayWords} data-content="">{read.way![part]}</dd>
              </div>
            ))}
          </dl>
          <p className={s.offerLine}>{t('first-run.way.firstWeek')}</p>
          <ol className={s.waySteps}>
            {read.way.firstWeek.map((step, index) => <li key={index} data-content="">{step}</li>)}
          </ol>
        </section>
      )}
      {/* The small team your AI proposed for that way (the engine's agents/team-proposal.ts). Keeping the plan hires the
          ones not left out; the two standing lines are the engine's own (agents/hire.ts HIRE_WORDS). */}
      {(team.length > 0 || orderAgents.length > 0) && (
        <section className={s.way} aria-label={t('first-run.team.title')}>
          <p className={s.label}>{t('first-run.team.title')} <span className={s.byAi}>{t('first-run.about.byAi')}</span></p>
          <ul className={s.offers}>
            {team.map((agent) => (left.has(agent.name) ? (
              <li key={agent.digest} className={s.offer}>
                <span className={s.offerRow}>
                  <span className={s.offerLine} data-content="">{t('first-run.team.left', { name: agent.name })}</span>
                  <Button variant="quiet" size="sm" aria-label={t('first-run.team.putBack', { name: agent.name })} onClick={() => leave(agent.name, false)}>{t('first-run.about.undo')}</Button>
                </span>
              </li>
            ) : (
              <li key={agent.digest} className={s.offer} data-team-agent="">
                <span className={s.offerRow}>
                  <span className={s.offerName} data-content="">{agent.name}</span>
                  <Button variant="quiet" size="sm" aria-label={t('first-run.team.leaveOutName', { name: agent.name })} onClick={() => leave(agent.name, true)}>{t('first-run.team.leaveOut')}</Button>
                </span>
                <span className={s.wayWords} data-content="">{agent.job}</span>
                <ul className={s.waySteps}>
                  {agent.duties.map((duty, index) => <li key={index} data-content="">{duty}</li>)}
                </ul>
                {agent.reads.length > 0 && <span className={s.offerLine}>{t('team.hire.readsLine', { reads: agent.reads.map((area) => t(`team.hire.read.${area}`)).join(', ') })}</span>}
                {agent.department && <span className={s.offerLine}>{t(deptKey(agent.department))}</span>}
              </li>
            )))}
          </ul>
          {/* The agents that do each order join when the plan is accepted: shown here so the owner sees one team. */}
          {orderAgents.length > 0 && (
            <>
              <p className={s.offerLine}>{t('first-run.team.orderTitle')}</p>
              <ul className={s.offers}>
                {orderAgents.map((agent) => (
                  <li key={agent.name} className={s.offer} data-order-agent="">
                    <span className={s.offerName} data-content="">{agent.name}</span>
                    <span className={s.wayWords} data-content="">{agent.does}</span>
                    <span className={s.offerLine}>{t('first-run.team.orderJoins')}</span>
                  </li>
                ))}
              </ul>
              {/* Keeper joins with them: it does no order and is code, not AI, but every agent that joins is listed. */}
              <ul className={s.offers}>
                <li className={s.offer} data-joining-agent="">
                  <span className={s.offerName} data-content="">{KEEPER_JOINS.name}</span>
                  <span className={s.wayWords} data-content="">{KEEPER_JOINS.does}</span>
                  <span className={s.offerLine}>{t('first-run.team.orderJoins')}</span>
                </li>
              </ul>
            </>
          )}
          {team.length > 0 && <p className={s.hint}>{t('first-run.team.keeps')}</p>}
          <p className={s.hint}>{t('first-run.team.never')}</p>
          <p className={s.hint}>{t('first-run.team.asks')}</p>
        </section>
      )}
      {where}
      <div className={s.keep}>
        {noOffer && !typing && <p id={noOfferId} className={s.hint}>{t('first-run.about.noOffer')}</p>}
        <Button variant="primary" size="lg" disabled={!keepable || busy} disabledReason={whyNot} aria-describedby={noOffer && !typing ? noOfferId : undefined} onClick={() => { if (keepable) onKeep(keepable); }}>{t('first-run.about.keep')}</Button>
      </div>
    </>
    );
  }

  const firstNameField = <Field label={t('first-run.about.firstName')} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.currentTarget.value)} />;

  if (mode === 'a') {
    return (
      <div className={f.wrap}>
        <p className={f.eyebrow}>{t('first-run.stepOf', { n: '2' })}</p>
        <h1 id={headingId} className={f.title}>{t('first-run.about.title')}</h1>
        <p className={f.sub}>{t('first-run.about.sub')}</p>
        <Bento className={f.grid} as="section" labelledBy={headingId}>
          <Tile span={12} card>
            {firstNameField}
            <form className={s.box} onSubmit={send} noValidate>
              <label htmlFor={boxId} className={s.boxLabel}>{t('first-run.about.label')}</label>
              <div className={s.boxRow}>
                <textarea ref={box} id={boxId} className={s.input} rows={2} value={text} placeholder={t('first-run.about.placeholder')}
                  aria-invalid={boxWrong ? true : undefined}
                  onChange={(event) => { setText(event.target.value); setProblem(null); setBoxWrong(false); }} onKeyDown={(event) => onKey(event, send)} />
                <FilePick compact icon="paperclip" choose={t('first-run.about.attach')} files={[]} accept=".pdf,.zip,application/pdf,application/zip" onChange={(event) => void onFile(event)} />
                <Button variant="primary" size="lg" type="submit" disabled={busy || (!text.trim() && !file)}>{t('first-run.about.send')}</Button>
              </div>
              {file && (
                <p className={s.file}><Icon name="file-text" size={14} /><span data-content="">{file.name}</span>
                  <Button variant="quiet" size="sm" onClick={() => setFile(null)}>{t('first-run.about.removeFile', { name: file.name })}</Button></p>
              )}
              <p className={s.hint}>{t('first-run.about.hint')}</p>
              {problem && <InlineError>{problem}</InlineError>}
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
            ) : bubble.connect && onConnect && index === thread.length - 1 ? (
              // No AI is connected: the newest such turn carries the way back to step 1, with what the owner typed.
              <div key={index} className={`${s.bubble} ${s.them} ${s.turnAct}`}>
                <p>{bubble.text}</p>
                <Button size="sm" onClick={() => onConnect({ text: said, firstName })}>{t('first-run.about.connectAi')}</Button>
              </div>
            ) : (
              <p key={index} className={`${s.bubble} ${bubble.who === 'me' ? s.me : s.them}`} data-content={bubble.who === 'me' || bubble.byAi ? '' : undefined} data-by={bubble.byAi ? 'ai' : undefined}>
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
