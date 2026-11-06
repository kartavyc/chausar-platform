import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { EngineError, type ModelStatusLite, type ToolLite, type ToolsLite } from '../../engine/types';
import { Bento, Tile } from '../../parts/Tile';
import { Button } from '../../parts/Button';
import { Chip } from '../../parts/Chip';
import { Icon } from '../../parts/Icon';
import { YourAi, TEMPLATES } from '../connections/YourAi';
import { openExternal } from '../connections/external';
import s from './FirstRun.module.css';
import { ProviderTrouble } from '../../parts/ProviderTrouble';
import { ConsentWords } from '../../parts/ConsentWords';
import { InlineError } from '../../parts/InlineError';

/** How often the screen looks again while a tool's own sign-in waits for the owner. */
export const LOGIN_POLL_MS = 1500;
const PRESET: Readonly<Record<ToolLite['cli'], string>> = { codex: 'codex-cli', 'claude-code': 'claude-code-cli' };
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const connectedTo = (status: ModelStatusLite | undefined) => Boolean(status && Object.values(status.tiers).some((tier) => tier.presetId !== TEMPLATES && tier.usable));

/**
 * Step 1 of the first run, Connect your AI (W6 6C1, DECISIONS D12; reference-ui/Main.dc.html): Codex and Claude Code as
 * found on this computer, each with its own sign-in started by the engine as the tool's own login (venture.ai.login.*);
 * the code and link the tool printed show here, and Chausar never sees a password or login file. A tool already signed
 * in is only used, never signed in again. The AI key path is the existing Your AI tile (keys in this computer's
 * keychain once the business is kept). "Skip for now: use templates" goes on with no AI.
 *
 * Using a signed-in tool is the connection's consent: the button sits right above the engine's own words of what the
 * connection sends, and sends that consent's digest (venture.ai.connect).
 */
export function ConnectAi({ onDone, onSkip }: { onDone: (label: string) => void; onSkip: () => void }) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const tools = useResource('venture.ai.tools', {});
  const options = useResource('venture.ai.options', {});
  const [view, setView] = useState<ToolsLite | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  /** B4 task 4: what failed, in the card of the tool that failed, in place of its button; again() is the same press. */
  const [trouble, setTrouble] = useState<{ cli: ToolLite['cli']; line: string; again: () => void } | null>(null);
  /** The AI key's own trouble, in the key card. */
  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  // A2 second review: Cancel in main's own dialog is not a problem; it is said calmly.
  const [note, setNote] = useState<{ cli: ToolLite['cli']; line: string } | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const opened = useRef(new Set<string>());

  useEffect(() => { if (tools.data) setView(tools.data); }, [tools.data]);
  const waiting = view?.tools.find((tool) => tool.login.state === 'starting' || tool.login.state === 'waiting');

  // While a sign-in waits, look again: the tool's own status says when it finished.
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      client.request('venture.ai.tools', {}).then(setView, (error: unknown) => setTrouble({
        cli: waiting.cli,
        line: messageOf(error),
        again: () => { setTrouble(null); tools.reload(); },
      }));
    }, LOGIN_POLL_MS);
    return () => clearTimeout(timer);
  }, [client, view, waiting, tools.reload]);

  // The owner pressed Sign in: the tool's page opens once, as soon as the tool prints its link.
  useEffect(() => {
    const link = waiting?.login.link;
    if (!waiting || !link || opened.current.has(waiting.cli)) return;
    opened.current.add(waiting.cli);
    openExternal(link).catch(() => { /* the link stays on screen with Open again */ });
  }, [waiting]);

  const presetOf = (cli: ToolLite['cli']) => options.data?.presets.find((preset) => preset.id === PRESET[cli]);
  const nameOf = (cli: ToolLite['cli']) => t(cli === 'codex' ? 'first-run.ai.codex.name' : 'first-run.ai.claude.name');

  const signIn = useCallback(async (cli: ToolLite['cli']) => {
    setTrouble(null); setBusy(cli);
    try {
      const tool = await client.request('venture.ai.login.start', { cli });
      setView((was) => (was ? { ...was, tools: was.tools.map((item) => (item.cli === cli ? tool : item)) } : was));
    } catch (error) { setTrouble({ cli, line: messageOf(error), again: () => void signIn(cli) }); }
    finally { setBusy(null); }
  }, [client]);

  /** A2: the owner's yes to the Codex Chausar found and showed (venture.ai.setup.trust), then the tools are read again. */
  async function choose(tool: ToolLite) {
    const sha256 = tool.setup?.sha256;
    if (!sha256) return;
    setTrouble(null); setNote(null); setBusy(tool.cli);
    try {
      await client.request('venture.ai.setup.trust', { cli: 'codex', sha256 });
      setView(await client.request('venture.ai.tools', {}));
    } catch (error) {
      if (error instanceof EngineError && error.code === 'CODEX_NOT_CHOSEN') setNote({ cli: tool.cli, line: error.message });
      else setTrouble({ cli: tool.cli, line: messageOf(error), again: () => void choose(tool) });
    }
    finally { setBusy(null); }
  }

  async function cancel(cli: ToolLite['cli']) {
    setTrouble(null);
    try {
      const tool = await client.request('venture.ai.login.cancel', { cli });
      opened.current.delete(cli);
      setView((was) => (was ? { ...was, tools: was.tools.map((item) => (item.cli === cli ? tool : item)) } : was));
    } catch (error) { setTrouble({ cli, line: messageOf(error), again: () => void cancel(cli) }); }
  }

  async function use(cli: ToolLite['cli']) {
    const preset = presetOf(cli);
    if (!preset) return;
    setTrouble(null); setBusy(cli);
    try {
      await client.request('venture.ai.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
      onDone(nameOf(cli));
    } catch (error) { setTrouble({ cli, line: messageOf(error), again: () => void use(cli) }); }
    finally { setBusy(null); }
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

  const recommended = view?.tools.find((tool) => tool.found)?.cli ?? null;

  function toolTile(tool: ToolLite) {
    const preset = presetOf(tool.cli);
    // A2: a Codex not yet chosen is shown first and used only after the owner says yes; one that cannot be used says why.
    const setup = tool.setup;
    const choosing = setup?.state === 'review';
    const refused = setup?.state === 'refused';
    const signedIn = tool.signedIn === 'yes' && !choosing && !refused;
    const primary = tool.cli === recommended;
    const hint = t(tool.cli === 'codex' ? 'first-run.ai.hint.codex' : 'first-run.ai.hint.claude');
    const failed = trouble?.cli === tool.cli ? trouble : null;
    return (
      <Tile key={tool.cli} as="section" span={4} label={nameOf(tool.cli)} className={s.option} card>
        <div className={s.optionHead}><Icon name={tool.cli === 'codex' ? 'clock' : 'sparkles'} size={20} /><h2 className={s.optionName}>{nameOf(tool.cli)}</h2></div>
        <p className={s.optionLine}>{t(tool.cli === 'codex' ? 'first-run.ai.codex.line' : 'first-run.ai.claude.line')}</p>
        <span>{signedIn ? <Chip tone="done">{t('first-run.ai.signedIn')}</Chip> : tool.found ? <Chip tone="line">{t('first-run.ai.installed', { name: tool.label })}</Chip> : <Chip tone="idle">{t('first-run.ai.notInstalled')}</Chip>}</span>
        <div className={s.optionAction}>
          {failed ? (
            <InlineError fix={{ label: t('first-run.ai.tryAgain'), onSelect: failed.again, busy: busy !== null }}>{failed.line}</InlineError>
          ) : choosing ? (
            <Button variant={primary ? 'primary' : 'secondary'} size="lg" disabled={busy !== null} aria-busy={busy === tool.cli || undefined} onClick={() => void choose(tool)}>{t('first-run.ai.setup.use')}</Button>
          ) : refused ? null : signedIn ? (
            <Button variant={primary ? 'primary' : 'secondary'} size="lg" disabled={busy !== null || !preset} aria-busy={busy === tool.cli || undefined} onClick={() => void use(tool.cli)}>{t('first-run.ai.use', { name: tool.label })}</Button>
          ) : tool.found ? (
            <Button variant={primary ? 'primary' : 'secondary'} size="lg" disabled={busy !== null || Boolean(waiting)} aria-busy={busy === tool.cli || undefined} onClick={() => void signIn(tool.cli)}>{t('first-run.ai.signIn', { name: tool.label })}</Button>
          ) : null}
          {(choosing || refused) && setup ? (
            <>
              <p className={s.hint}>{setup.line}</p>
              {setup.path && <p className={s.hint} data-content="">{setup.path}</p>}
            </>
          ) : signedIn && preset ? <ConsentWords className={s.hint} text={preset.consentText} /> : <p className={s.hint}>{tool.found ? hint : tool.login.line}</p>}
          {note?.cli === tool.cli && <p className={s.status} role="status">{note.line}</p>}
          {tool.login.state === 'failed' && tool.login.line && <InlineError>{tool.login.line}</InlineError>}
          {tool.tested === 'failed' && tool.problem && <InlineError>{tool.problem}</InlineError>}
          {tool.provider && <ProviderTrouble trouble={tool.provider} className={s.hint} />}
        </div>
      </Tile>
    );
  }

  return (
    <div className={s.wrap}>
      <p className={s.eyebrow}>{t('first-run.stepOf', { n: '1' })}</p>
      <h1 id={headingId} className={s.title}>{t('first-run.ai.title')}</h1>
      <p className={s.sub}>{t('first-run.ai.sub')}</p>
      <Bento className={s.grid} as="section" labelledBy={headingId}>
        {view ? view.tools.map(toolTile) : tools.error
          ? <InlineError className={s.wide} fix={{ label: t('first-run.ai.tryAgain'), onSelect: tools.reload }}>{tools.error.message}</InlineError>
          : <p className={s.status} role="status">{t('first-run.ai.checking')}</p>}
        <Tile as="section" span={4} label={t('first-run.ai.key.name')} className={s.option} card>
          <div className={s.optionHead}><Icon name="lock" size={20} /><h2 className={s.optionName}>{t('first-run.ai.key.name')}</h2></div>
          <p className={s.optionLine}>{t('first-run.ai.key.line')}</p>
          <span><Chip tone="line">{t('first-run.ai.key.chip')}</Chip></span>
          <div className={s.optionAction}>
            <Button size="lg" aria-expanded={keyOpen} onClick={() => setKeyOpen((open) => !open)}>{t('first-run.ai.key.add')}</Button>
            <p className={s.hint}>{t('first-run.ai.key.hint')}</p>
            {keyProblem && <InlineError>{keyProblem}</InlineError>}
          </div>
        </Tile>

        {waiting && (
          <Tile as="section" span={12} label={t(waiting.cli === 'codex' ? 'first-run.ai.finish.codex' : 'first-run.ai.finish.claude')} className={s.finish}>
            <div className={s.finishText}>
              <h2 className={s.finishTitle}>{t(waiting.cli === 'codex' ? 'first-run.ai.finish.codex' : 'first-run.ai.finish.claude')}</h2>
              <p className={s.sub}>{t(waiting.login.code ? 'first-run.ai.finish.line' : 'first-run.ai.finish.lineNoCode')}</p>
              <div className={s.finishTools}>
                {waiting.login.link && <Button onClick={() => void openExternal(waiting.login.link!).catch(() => undefined)}>{t('first-run.ai.openAgain')}</Button>}
                {waiting.login.code && <Button onClick={() => void copy(waiting.login.code!)}>{t('first-run.ai.copyCode')}</Button>}
                <Button variant="quiet" onClick={() => void cancel(waiting.cli)}>{t('first-run.ai.cancel')}</Button>
              </div>
              {copied && <p className={s.status} role="status">{t('first-run.ai.copied')}</p>}
            </div>
            <div className={s.codeBox}>
              {waiting.login.code && <span className={s.code} aria-label={t('first-run.ai.codeLabel')} data-content="">{waiting.login.code}</span>}
              <span className={s.hint} role="status">{t(waiting.login.state === 'waiting' ? 'first-run.ai.waiting' : 'first-run.ai.starting')}</span>
            </div>
          </Tile>
        )}

        {keyOpen && (
          <div className={s.keyPanel}>
            <YourAi focus />
            <Button variant="primary" size="lg" onClick={() => void keyDone()}>{t('first-run.ai.keyContinue')}</Button>
          </div>
        )}

        <Tile span={12} className={s.footer}>
          <Icon name="lock" size={16} />
          <p>{t('first-run.ai.limits')}</p>
          <Button variant="quiet" onClick={onSkip}>{t('first-run.ai.skip')}</Button>
        </Tile>
      </Bento>
    </div>
  );
}
