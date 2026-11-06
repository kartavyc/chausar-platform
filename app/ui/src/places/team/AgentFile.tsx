import { useId, useState, type ChangeEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { AgentView } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import s from './AgentExtras.module.css';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** The longest agent file the engine reads is 100,000 characters; a file far past it is not read at all. */
const MOST_BYTES = 400_000;

/** Offers text as a file to save, without keeping it anywhere: a temporary address, clicked once, then let go. */
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A picked file's words. */
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

/**
 * The agent file (W4 4J22b, from 4J17's export.ts; catalogue A18), under the Persona tab: Export saves the file the
 * engine makes (the agent's steps, persona and standing orders, never its notes, no client's name, no key) to give to
 * another business, where importing it makes a copy of this agent. Import reads a file the owner picks and hands it
 * to the engine, which reads it as untrusted words: it becomes a change in the chat of the agent the file names (this
 * one, or another of the team), which the owner accepts or says no to, and nothing changes before that. The line says
 * which agent, and links to its chat.
 */
export function AgentFile({ agent }: { agent: AgentView }) {
  const t = useT();
  const engine = useEngine();
  const headId = useId();
  const pickId = useId();
  const [said, setSaid] = useState<string | null>(null);
  // The agent an imported file went to: the one the file names, which may be another of the team (export.ts).
  const [imported, setImported] = useState<string | null>(null);
  const team = useResource('venture.team.list', {}, { skip: !imported });
  const importedName = imported ? team.data?.agents.find((one) => one.id === imported)?.name ?? (imported === agent.id ? agent.name : null) : null;
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function exportFile() {
    setBusy(true);
    setSaid(null);
    setImported(null);
    setProblem(null);
    try {
      const file = await engine.request('venture.agents.export', { agent: agent.id });
      download(file.fileName, file.text);
      setSaid(t('team.persona.file.saved', { name: file.fileName }));
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setSaid(null);
    setImported(null);
    setProblem(null);
    try {
      if (file.size > MOST_BYTES) throw new Error(t('team.persona.file.tooBig'));
      const result = await engine.request('venture.agents.import', { text: await readText(file) });
      setImported(result.proposal.agent);
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      input.value = '';
      setBusy(false);
    }
  }

  return (
    <section className={s.section} aria-labelledby={headId}>
      <h3 id={headId} className={s.small}>{t('team.persona.file.title')}</h3>
      <p className={s.quiet}>{t('team.persona.file.line', { name: agent.name })}</p>
      <div className={s.buttons} data-start="">
        <Button size="sm" disabled={busy} onClick={() => void exportFile()}>
          <Icon name="file-text" size={16} />
          {t('team.persona.file.export')}
        </Button>
        <label className={s.pick} htmlFor={pickId} data-disabled={busy ? '' : undefined}>
          <Icon name="upload" size={16} />
          {t('team.persona.file.import')}
        </label>
        <input id={pickId} type="file" accept=".json,application/json" className="sr-only" disabled={busy} onChange={(event) => void importFile(event)} />
      </div>
      {said && <p className={s.said} role="status">{said}</p>}
      {imported && importedName && (
        <p className={s.said} role="status">
          <span>{t('team.persona.file.imported', { name: importedName })}</span>{' '}
          <a className={s.chatLink} href={`#/team?sheet=agent:${encodeURIComponent(imported)}&tab=chat`}>{t('team.persona.file.openChat', { name: importedName })}</a>
        </p>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}
