import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { EngineError, type ClaudeInstallViewLite, type ModelStatusLite, type ToolLite, type ToolsLite } from '../../engine/types';
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
import { Progress } from '../../parts/Progress';

/** How often the screen looks again while a tool's own sign-in waits for the owner. */
export const LOGIN_POLL_MS = 1500;
const PRESET: Readonly<Record<ToolLite['cli'], string>> = { codex: 'codex-cli', 'claude-code': 'claude-code-cli' };

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
const TOOL_STEPS = ['claude-code', 'codex'] as const;

export function ConnectAi({ onDone, onSkip }: { onDone: (label: string) => void; onSkip: () => void }) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const tools = useResource('venture.ai.tools', {});
  /** One-shot C3 task 11: the owner stops watching the check; the key and Skip are here, and the answer is still taken when it lands. */
  const [stopLooking, setStopLooking] = useState(false);
  const options = useResource('venture.ai.options', {});
  /** B4 task 12: the keychain chip shows only once a key is saved here. */
  const saved = useResource('venture.ai.status', {});
  const [view, setView] = useState<ToolsLite | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  /** B4 task 4: what failed, in the card of the tool that failed, in place of its button; again() is the same press. */
  const [trouble, setTrouble] = useState<{ cli: ToolLite['cli']; line: string; again: () => void } | null>(null);
  /** The AI key's own trouble, in the key card. */
  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  // A2 second review: Cancel in main's own dialog is not a problem; it is said calmly.
  const [note, setNote] = useState<{ cli: ToolLite['cli']; line: string } | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  /** D5: how far Install Claude Code has come, read from the engine while it runs. Only the desktop app can install. */
  const [installing, setInstalling] = useState<ClaudeInstallViewLite | null>(null);
  const canInstall = client.transport === 'desktop' || client.transport === 'fake';
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

  /** D5: main asks in its own dialog; the window sends nothing that says yes. Afterwards the tools are read again. */
  async function install() {
    setTrouble(null); setNote(null); setBusy('claude-code');
    setInstalling({ step: 'downloading', receivedBytes: 0, totalBytes: null, line: null });
    const reading = setInterval(() => { client.request('venture.ai.claude.progress', {}).then(setInstalling, () => { /* the next read */ }); }, LOGIN_POLL_MS);
    try {
      const { words } = await client.request('venture.ai.claude.install', {});
      setNote({ cli: 'claude-code', line: words });
      setView(await client.request('venture.ai.tools', {}));
    } catch (error) {
      if (error instanceof EngineError && error.code === 'CLAUDE_INSTALL_NOT_CHOSEN') setNote({ cli: 'claude-code', line: error.message });
      else setTrouble({ cli: 'claude-code', line: messageOf(error), again: () => void install() });
    } finally { clearInterval(reading); setInstalling(null); setBusy(null); }
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

  // B4 task 12: the fill sits on the way that works: a signed-in tool first, then the first one found; none while the key form is open.
  const usable = view?.tools.find((tool) => tool.found && tool.signedIn === 'yes' && tool.setup?.state !== 'review' && tool.setup?.state !== 'refused');
  const recommended = keyOpen ? null : usable?.cli ?? view?.tools.find((tool) => tool.found)?.cli ?? null;
  /** C4 task 4: Claude Code signed in on this computer, offered when Codex fails. */
  const claudeReady = view?.tools.some((tool) => tool.cli === 'claude-code' && tool.found && tool.signedIn === 'yes' && tool.setup?.state !== 'review' && tool.setup?.state !== 'refused') ?? false;

  /** C4 task 4: Try again after a Codex failure: its sign-in again, or a fresh look when it was the test call that failed. */
  async function retry(tool: ToolLite) {
    if (tool.login.state === 'failed') { await signIn(tool.cli); return; }
    setTrouble(null);
    try { setView(await client.request('venture.ai.tools', {})); } catch (error) { setTrouble({ cli: tool.cli, line: messageOf(error), again: () => void retry(tool) }); }
  }

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
    // C4 task 4: a Codex that failed offers three ways on in its own card, in place of its usual button.
    const codexFailed = tool.cli === 'codex' && (tool.login.state === 'failed' || tool.tested === 'failed');
    return (
      <Tile key={tool.cli} as="section" span={4} label={nameOf(tool.cli)} className={s.option} card>
        <div className={s.optionHead}><Icon name={tool.cli === 'codex' ? 'clock' : 'sparkles'} size={20} /><h2 className={s.optionName}>{nameOf(tool.cli)}</h2></div>
        <p className={s.optionLine}>{t(tool.cli === 'codex' ? 'first-run.ai.codex.line' : 'first-run.ai.claude.line')}</p>
        <span>{signedIn ? <Chip tone="done">{t('first-run.ai.signedIn')}</Chip> : tool.found ? <Chip tone="line">{t('first-run.ai.installed', { name: tool.label })}</Chip> : <Chip tone="idle">{t('first-run.ai.notInstalled')}</Chip>}</span>
        <div className={s.optionAction}>
          {failed ? (
            <>
              <InlineError fix={{ label: t('first-run.ai.tryAgain'), onSelect: failed.again, busy: busy !== null }}>{failed.line}</InlineError>
              {tool.cli === 'codex' && (
                <div className={s.finishTools}>
                  {claudeReady && <Button disabled={busy !== null || !presetOf('claude-code')} onClick={() => void use('claude-code')}>{t('first-run.ai.useClaude')}</Button>}
                  <Button variant="quiet" onClick={onSkip}>{t('first-run.ai.withTemplates')}</Button>
                </div>
              )}
            </>
          ) : codexFailed ? (
            <div className={s.finishTools}>
              <Button variant={primary ? 'primary' : 'secondary'} disabled={busy !== null} onClick={() => void retry(tool)}>{t('first-run.ai.tryAgain')}</Button>
              {claudeReady && <Button disabled={busy !== null || !presetOf('claude-code')} onClick={() => void use('claude-code')}>{t('first-run.ai.useClaude')}</Button>}
              <Button variant="quiet" onClick={onSkip}>{t('first-run.ai.withTemplates')}</Button>
            </div>
          ) : choosing ? (
            <Button variant={primary ? 'primary' : 'secondary'} size="lg" disabled={busy !== null} aria-busy={busy === tool.cli || undefined} onClick={() => void choose(tool)}>{t('first-run.ai.setup.use')}</Button>
          ) : refused ? null : signedIn ? (
            <Button variant={primary ? 'primary' : 'secondary'} size="lg" disabled={busy !== null || !preset} aria-busy={busy === tool.cli || undefined} onClick={() => void use(tool.cli)}>{t('first-run.ai.use', { name: tool.label })}</Button>
          ) : tool.found ? (
            <Button variant={primary ? 'primary' : 'secondary'} size="lg" disabled={busy !== null || Boolean(waiting)} aria-busy={busy === tool.cli || undefined} onClick={() => void signIn(tool.cli)}>{t('first-run.ai.signIn', { name: tool.label })}</Button>
          ) : tool.cli === 'claude-code' && canInstall ? (
            <>
              <Button variant={primary ? 'primary' : 'secondary'} size="lg" disabled={busy !== null || Boolean(waiting)} aria-busy={installing !== null || undefined} onClick={() => void install()}>{t('first-run.ai.install')}</Button>
              {installing && <p className={s.status} role="status" data-install-step={installing.step}>{t(installing.step === 'installing' ? 'first-run.ai.install.installing' : installing.step === 'checking' ? 'first-run.ai.install.checking' : 'first-run.ai.install.downloading')}</p>}
            </>
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
      <h1 id={headingId} className={s.title}>{t('first-run.ai.title')}</h1>
      <p className={s.sub}>{t('first-run.ai.sub')}</p>
      <Bento className={s.grid} as="section" labelledBy={headingId}>
        {/* One-shot C3 task 11: each tool's step as it is looked at, never a bare wait. */}
        {view ? view.tools.map(toolTile) : tools.error
          ? <InlineError className={s.wide} fix={{ label: t('first-run.ai.tryAgain'), onSelect: tools.reload }}>{tools.error.message}</InlineError>
          : !stopLooking && <Progress kind="ai-tools" active stepIds={TOOL_STEPS} onStopWaiting={() => setStopLooking(true)} stopWaitingLabel={t('first-run.ai.stopLooking')} labelOf={(cli) => t(cli === 'codex' ? 'first-run.ai.checkingCodex' : 'first-run.ai.checkingClaude')} />}
        <Tile as="section" span={4} label={t('first-run.ai.key.name')} className={s.option} card>
          <div className={s.optionHead}><Icon name="lock" size={20} /><h2 className={s.optionName}>{t('first-run.ai.key.name')}</h2></div>
          <p className={s.optionLine}>{t('first-run.ai.key.line')}</p>
          {keyOpen && connectedTo(saved.data) && <span><Chip tone="line">{t('first-run.ai.key.chip')}</Chip></span>}
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

        <div className={s.footer}>
          <Button variant="quiet" onClick={onSkip}>{t('first-run.ai.skip')}</Button>
          <p className={s.hint}>{t('first-run.ai.limits')}</p>
        </div>
      </Bento>
    </div>
  );
}
