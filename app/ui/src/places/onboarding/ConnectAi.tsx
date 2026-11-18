import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { EngineError, type ModelStatusLite, type ToolLite, type ToolsLite } from '../../engine/types';
import { useOwnerZone } from '../../shell/clock';
import { Tile } from '../../parts/Tile';
import { Button } from '../../parts/Button';
import { Fold } from '../../parts/Fold';
import { Icon } from '../../parts/Icon';
import { YourAi, TEMPLATES } from '../connections/YourAi';
import { openExternal } from '../connections/external';
import { planRiskWords } from '../connections/planRisk';
import s from './FirstRun.module.css';
import { ConsentWords } from '../../parts/ConsentWords';
import { InlineError } from '../../parts/InlineError';
import { momentOf } from '../../parts/custody';

/** How often the screen looks again while a tool's own sign-in waits for the owner. */
export const LOGIN_POLL_MS = 1500;
/** A tool that said its sign-in finished may take a moment to say "signed in": this many more looks, then the screen stops. */
const SETTLE_LOOKS = 3;
type Cli = ToolLite['cli'];
/** The two sign-ins, in the order shown. The first is the one filled button. */
const CHOICES: readonly Cli[] = ['codex', 'claude-code'];
const PRESET: Readonly<Record<Cli, string>> = { codex: 'codex-cli', 'claude-code': 'claude-code-cli' };
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const connectedTo = (status: ModelStatusLite | undefined) => Boolean(status && Object.values(status.tiers).some((tier) => tier.presetId !== TEMPLATES && tier.usable));
const inFlight = (tool: ToolLite) => tool.login.state === 'starting' || tool.login.state === 'waiting';
/**
 * A choice that cannot work on this computer as it is: the tool is missing, the engine refused it, its test call
 * failed, or the engine left a line saying what to fix. A click then only looks again, since the owner may have fixed it.
 */
const stuck = (tool: ToolLite) => !tool.found || tool.setup?.state === 'refused'
  || (tool.tested === 'failed' && tool.login.state !== 'failed') || (tool.login.state === 'idle' && tool.login.line !== null);

/**
 * Step 1 of the first run, Connect your AI, as a simple sign-in (the founder: "You don't need to know how to build
 * agents or write prompts. This needs to be simple."): a title, one line, and two buttons, "Sign in with ChatGPT" and
 * "Sign in with Claude". The owner never has to know which tool runs behind a button, its version or where it sits;
 * that detail lives in Connections (Your AI).
 *
 * One click runs the engine's same steps in order, each still checked by the engine: the owner's yes to a tool Chausar
 * found and has not used before (venture.ai.setup.trust; in the app the main process shows its own dialog), the tool's
 * own sign-in when it is signed out (venture.ai.login.*: its code and link show here, and Chausar never sees a password
 * or login file), then the connection (venture.ai.connect). A tool already signed in is only used, never signed in again.
 *
 * The click is the connection's consent, so the engine's own words of what the connection sends are on this screen
 * before it: one line, with each tool's full consent in a closed "What's sent" fold, and the connection sends that
 * consent's digest. The buttons wait until those words are here, and for nothing else.
 *
 * The look at this computer (venture.ai.tools: where each tool is, the reviewed Codex's digest, each tool's own status
 * command) is slow on a first start (seen live on Windows, 15 Nov 2026: 32 to 38 seconds, with both buttons dead until
 * it ended). So the words are asked for first, which starts nothing, and the look begins once they are here and runs
 * behind the buttons. A press before the look has answered waits for a look of its own and then goes on; every step is
 * still the engine's, and nothing about the tool is trusted sooner.
 *
 * A choice that cannot work says so in one line under its button, in the engine's words; only there is a tool named.
 * A choice that can work carries the platform's own risk there instead, one short line in the engine's own words
 * (models/plan-risk.ts): what OpenAI has not yet said about a ChatGPT plan, and that a Claude plan's limits are for one
 * person. It is plain to see at rest, never only inside "What's sent".
 * The AI key and the way on with no AI sit behind a closed "More options".
 */
export function ConnectAi({ onDone, onSkip }: { onDone: (label: string) => void; onSkip: () => void }) {
  const t = useT();
  const client = useEngine();
  const zone = useOwnerZone();
  const headingId = useId();
  const lineId = useId();
  const options = useResource('venture.ai.options', {});
  // The look at this computer starts once the words are here (or could not be read), never beside them.
  const tools = useResource('venture.ai.tools', {}, { skip: !options.data && !options.error });
  const [view, setView] = useState<ToolsLite | undefined>(undefined);
  /** The call in flight for a choice, which the one progress line names. */
  const [busy, setBusy] = useState<{ cli: Cli; step: 'checking' | 'starting' | 'connecting' } | null>(null);
  /** The owner's click, still being carried out while the tool's own sign-in waits: signed in, the connection follows. */
  const [going, setGoing] = useState<Cli | null>(null);
  /** B4 task 4: what failed, under the button that failed; the same button tries again. */
  const [trouble, setTrouble] = useState<{ cli: Cli; line: string } | null>(null);
  /** The AI key's own trouble, by its button. */
  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  // A2 second review: Cancel in main's own dialog is not a problem; it is said calmly.
  const [note, setNote] = useState<{ cli: Cli; line: string } | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const opened = useRef(new Set<string>());
  const settling = useRef(0);

  useEffect(() => { if (tools.data) setView(tools.data); }, [tools.data]);
  const waiting = view?.tools.find(inFlight);
  const toolOf = (from: ToolsLite | undefined, cli: Cli) => from?.tools.find((tool) => tool.cli === cli);
  const presetOf = (cli: Cli) => options.data?.presets.find((preset) => preset.id === PRESET[cli]);
  const nameOf = (cli: Cli) => t(cli === 'codex' ? 'first-run.ai.codex.name' : 'first-run.ai.claude.name');

  const look = useCallback(async () => {
    const fresh = await client.request('venture.ai.tools', {});
    setView(fresh);
    return fresh;
  }, [client]);

  // While a sign-in waits, look again: the tool's own status says when it finished.
  useEffect(() => {
    if (!waiting) return;
    const cli = waiting.cli;
    const timer = setTimeout(() => { look().catch((error: unknown) => setTrouble({ cli, line: messageOf(error) })); }, LOGIN_POLL_MS);
    return () => clearTimeout(timer);
  }, [look, view, waiting]);

  // The owner pressed Sign in: the tool's page opens once, as soon as the tool prints its link.
  useEffect(() => {
    const link = waiting?.login.link;
    if (!waiting || !link || opened.current.has(waiting.cli)) return;
    opened.current.add(waiting.cli);
    openExternal(link).catch(() => { /* the link stays on screen with Open again */ });
  }, [waiting]);

  /** The connection, with the consent the screen shows (its digest). */
  async function connect(cli: Cli) {
    const preset = presetOf(cli);
    if (!preset) return;
    setBusy({ cli, step: 'connecting' });
    await client.request('venture.ai.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
    onDone(nameOf(cli));
  }

  function failed(cli: Cli, error: unknown) {
    if (error instanceof EngineError && error.code === 'CODEX_NOT_CHOSEN') setNote({ cli, line: error.message });
    else setTrouble({ cli, line: messageOf(error) });
  }

  /**
   * The one click: the owner's yes if the engine waits for it, the tool's own sign-in if it is signed out, then the
   * connection. Every step is the engine's own call, and each stops here in the engine's words if it refuses.
   */
  async function signIn(cli: Cli) {
    setTrouble(null); setNote(null); setGoing(null); setCopied(false);
    settling.current = 0;
    setBusy({ cli, step: 'checking' });
    try {
      // A press before the first look answered, or on a choice that could not work, looks at this computer itself.
      let tool = toolOf(view, cli);
      if (!tool || stuck(tool)) tool = toolOf(await look(), cli);
      if (!tool || stuck(tool)) return;
      // A2: a tool found and not yet used runs only after the owner's yes to the exact one the engine showed.
      if (tool.setup?.state === 'review') {
        if (!tool.setup.sha256) return;
        await client.request('venture.ai.setup.trust', { cli: 'codex', sha256: tool.setup.sha256 });
        tool = toolOf(await look(), cli);
        if (!tool || stuck(tool) || tool.setup?.state === 'review') return;
      }
      if (tool.signedIn !== 'yes') {
        setBusy({ cli, step: 'starting' });
        const started = await client.request('venture.ai.login.start', { cli });
        setView((was) => (was ? { ...was, tools: was.tools.map((item) => (item.cli === cli ? started : item)) } : was));
        // The tool's own sign-in now waits for the owner; the watch below goes on once it ends.
        if (started.signedIn !== 'yes') { setGoing(cli); return; }
      }
      await connect(cli);
    } catch (error) { failed(cli, error); }
    finally { setBusy(null); }
  }

  // The click goes on once the tool's own sign-in ends: signed in, the connection; failed or cancelled, it stops and
  // the line under the button says why.
  useEffect(() => {
    if (!going || busy) return;
    const tool = view?.tools.find((item) => item.cli === going);
    if (!tool || inFlight(tool)) return;
    const cli = going;
    if (tool.signedIn === 'yes') {
      setGoing(null);
      void (async () => {
        try { await connect(cli); } catch (error) { failed(cli, error); } finally { setBusy(null); }
      })();
      return;
    }
    if (tool.login.state === 'signed-in' && tool.tested !== 'failed' && settling.current < SETTLE_LOOKS) {
      settling.current += 1;
      const timer = setTimeout(() => { look().catch((error: unknown) => { setGoing(null); setTrouble({ cli, line: messageOf(error) }); }); }, LOGIN_POLL_MS);
      return () => clearTimeout(timer);
    }
    setGoing(null);
    // `connect` and `failed` read this render's options and words; the click is carried on from the newest look.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, going, busy]);

  async function cancel(cli: Cli) {
    setTrouble(null); setGoing(null);
    try {
      const tool = await client.request('venture.ai.login.cancel', { cli });
      opened.current.delete(cli);
      setView((was) => (was ? { ...was, tools: was.tools.map((item) => (item.cli === cli ? tool : item)) } : was));
    } catch (error) { setTrouble({ cli, line: messageOf(error) }); }
  }

  async function keyDone() {
    setKeyProblem(null);
    try {
      const status = await client.request('venture.ai.status', {});
      if (connectedTo(status)) onDone(t('first-run.ai.key.name'));
      else setKeyProblem(t('first-run.ai.keyFirst'));
    } catch (error) { setKeyProblem(messageOf(error)); }
  }

  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); }
  }

  /** The words of what is sent: until they are here, the buttons wait. The first look at this computer runs behind them. */
  const lookError = (!view && tools.error) || (!options.data && options.error) || null;
  const ready = Boolean(options.data);
  const settlingNow = going !== null && !busy && !waiting;
  const progress = busy ? t(busy.step === 'checking' ? 'first-run.ai.checking' : busy.step === 'starting' ? 'first-run.ai.starting' : 'first-run.ai.connecting')
    : waiting ? t(waiting.login.state === 'waiting' ? 'first-run.ai.waiting' : 'first-run.ai.starting')
      : settlingNow || (!view && !lookError) ? t('first-run.ai.checking') : null;

  /** The one line under a button: why this choice cannot work, in the engine's words, or nothing. */
  function lineUnder(cli: Cli, id: string) {
    if (trouble?.cli === cli) return <InlineError id={id}>{trouble.line}</InlineError>;
    if (note?.cli === cli) return <p id={id} className={s.status} role="status">{note.line}</p>;
    const tool = toolOf(view, cli);
    if (!tool || inFlight(tool) || busy?.cli === cli) return null;
    if (tool.login.state === 'failed' && tool.login.line) return <InlineError id={id}>{tool.login.line}</InlineError>;
    if (tool.tested === 'failed' && tool.problem) {
      // A2: when the AI company's own status page says it has problems, that goes in the same line.
      const provider = tool.provider ? `${tool.provider.line} ${t('ai.statusFrom', { source: tool.provider.source, time: momentOf(tool.provider.readAt, zone) })}` : undefined;
      return <InlineError id={id} detail={provider}>{tool.problem}</InlineError>;
    }
    if (tool.setup?.state === 'refused') return <p id={id} className={s.hint}>{tool.setup.line}</p>;
    if (tool.login.line) return <p id={id} className={s.hint}>{tool.login.line}</p>;
    return null;
  }

  /** The full consent of each sign-in that can be used here, as the engine wrote it; of both until the first look says which can. */
  const consents = [...new Set(CHOICES.filter((cli) => { const tool = toolOf(view, cli); return !view || (tool?.found && tool.setup?.state !== 'refused'); })
    .flatMap((cli) => { const preset = presetOf(cli); return preset ? [preset.consentText] : []; }))];

  return (
    <div className={s.wrap}>
      <p className={s.eyebrow}>{t('first-run.stepOf', { n: '1' })}</p>
      <h1 id={headingId} className={s.title}>{t('first-run.ai.title')}</h1>
      <p className={s.sub}>{t('first-run.ai.sub')}</p>
      <Tile as="section" labelledBy={headingId} className={s.signIn} card>
        <div className={s.choices}>
          {CHOICES.map((cli, index) => {
            const id = `${lineId}-${cli}`;
            const line = lineUnder(cli, id);
            // The platform's own risk of this sign-in, in the engine's words, at rest and in small type (the founder's
            // rule). A choice with something to fix says that instead, and a tool that is not here has no plan to use yet.
            const risk = !line && toolOf(view, cli)?.found ? planRiskWords(t, PRESET[cli]) : null;
            // One filled button: ChatGPT, unless the owner has opened the key form, whose Continue is then the filled one.
            const variant = index === 0 && !keyOpen ? 'primary' : 'secondary';
            // While a sign-in waits the buttons wait too, unless a look failed: then the same button takes it up again.
            const off = !ready || busy !== null || !presetOf(cli) || ((going !== null || waiting !== undefined) && trouble?.cli !== cli);
            return (
              <div key={cli} className={s.choice} data-choice={cli}>
                <Button variant={variant} size="lg" disabled={off} aria-busy={busy?.cli === cli || going === cli || undefined} aria-describedby={line || risk ? id : undefined} onClick={() => void signIn(cli)}>
                  {t(cli === 'codex' ? 'first-run.ai.signIn.codex' : 'first-run.ai.signIn.claude')}
                </Button>
                {line && <div data-choice-line="">{line}</div>}
                {risk && <p id={id} className={s.hint} data-plan-risk="">{risk}</p>}
              </div>
            );
          })}
        </div>
        {lookError && <InlineError fix={{ label: t('first-run.ai.tryAgain'), onSelect: () => { if (!view) tools.reload(); if (!options.data) options.reload(); } }}>{lookError.message}</InlineError>}
        {progress && <p className={s.progress} role="status">{progress}</p>}
        {waiting && (
          <div className={s.finish}>
            {waiting.login.code && (
              <div className={s.codeBox}>
                <span className={s.code} aria-label={t('first-run.ai.codeLabel')} data-content="">{waiting.login.code}</span>
                <span className={s.hint}>{t('first-run.ai.typeCode')}</span>
              </div>
            )}
            <div className={s.finishTools}>
              {waiting.login.link && <Button onClick={() => void openExternal(waiting.login.link!).catch(() => undefined)}>{t('first-run.ai.openAgain')}</Button>}
              {waiting.login.code && <Button onClick={() => void copy(waiting.login.code!)}>{t('first-run.ai.copyCode')}</Button>}
              <Button variant="quiet" onClick={() => void cancel(waiting.cli)}>{t('first-run.ai.cancel')}</Button>
            </div>
            {copied && <p className={s.status} role="status">{t('first-run.ai.copied')}</p>}
          </div>
        )}
        <div className={s.sent}>
          <Icon name="lock" size={16} />
          {consents.length > 0 ? <ConsentWords line={t('first-run.ai.limits')} text={consents} /> : <p>{t('first-run.ai.limits')}</p>}
        </div>
      </Tile>

      {/* Closing the fold puts the key form away too, so the filled button is the sign-in again. */}
      <Fold summary={t('onboarding.welcome.more')} className={s.more} onToggle={(event) => { if (!event.currentTarget.open) setKeyOpen(false); }}>
        <div className={s.finishTools}>
          <Button aria-expanded={keyOpen} onClick={() => setKeyOpen((open) => !open)}>{t('first-run.ai.key.use')}</Button>
          <Button variant="quiet" onClick={onSkip}>{t('first-run.ai.noAi')}</Button>
        </div>
        {keyOpen && (
          <section className={s.keyPanel} aria-label={t('first-run.ai.key.name')}>
            <YourAi focus />
            <Button variant="primary" size="lg" onClick={() => void keyDone()}>{t('first-run.ai.keyContinue')}</Button>
            {keyProblem && <InlineError>{keyProblem}</InlineError>}
          </section>
        )}
      </Fold>
    </div>
  );
}
