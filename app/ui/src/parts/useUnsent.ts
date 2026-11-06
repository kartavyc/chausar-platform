import { useRef, useState } from 'react';
import type { ThreadEntry } from './ChatThread';

/** One message that failed to send: the owner's words, when, the reason, and which chat it belongs to. */
interface Unsent { id: string; scope: string; words: string; at: string; problem: string; busy: boolean }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface UnsentOptions {
  /** The chat on screen; a bubble shows only in the chat it was written in. */
  scope: string;
  now: () => Date;
  /** A failure that is not a failed send (the owner said no to the consent, say): the words go back to the box as before. */
  staysInBox?: ((error: unknown) => boolean) | undefined;
}

/**
 * One-shot C4 task 30 (266.x1, 266.f1): a send that fails stays in the thread as a bubble marked "Not sent" with
 * "Try again", which sends the same words; the box is clear for the next thought. Nothing goes to browser storage, so
 * a bubble lasts as long as the screen does.
 */
export function useUnsent(send: (words: string) => Promise<void>, options: UnsentOptions) {
  const [list, setList] = useState<readonly Unsent[]>([]);
  const count = useRef(0);

  function keep(words: string, error: unknown) {
    count.current += 1;
    const item: Unsent = { id: `unsent-${count.current}`, scope: options.scope, words, at: options.now().toISOString(), problem: messageOf(error), busy: false };
    setList((was) => [...was, item]);
  }

  /** What the Composer calls: a failure becomes a bubble and the promise resolves, so the box clears. */
  async function sendKeeping(words: string): Promise<void> {
    try {
      await send(words);
    } catch (error) {
      if (options.staysInBox?.(error)) throw error;
      keep(words, error);
    }
  }

  async function retry(id: string) {
    const item = list.find((one) => one.id === id);
    if (!item || item.busy) return;
    setList((was) => was.map((one) => (one.id === id ? { ...one, busy: true } : one)));
    try {
      await send(item.words);
      setList((was) => was.filter((one) => one.id !== id));
    } catch (error) {
      setList((was) => was.map((one) => (one.id === id ? { ...one, busy: false, problem: messageOf(error) } : one)));
    }
  }

  const entries: ThreadEntry[] = list.filter((item) => item.scope === options.scope).map((item) => ({
    kind: 'owner', id: item.id, at: item.at, text: item.words,
    unsent: { problem: item.problem, busy: item.busy, onRetry: () => void retry(item.id) },
  }));
  return { sendKeeping, keep, entries };
}
