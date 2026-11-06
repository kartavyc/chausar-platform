// Chausar venture launcher: the words a delivery draft stands for outside Chausar (W1 H6 with H17). One place makes
// them, so a share link, the client's answer and a post all mean the same text: the owner's edit, else the rendered
// draft, with the secret screen applied (core/secrets.ts), and one digest over the draft's id, its title and that text.
// build/share-links.ts shows and binds the client's answer to it; build/posting.ts posts from it and checks the
// client's answer against it.
import type { DeliveryRunRecord } from '../contracts.ts';
import { digest } from '../records.ts';
import { redactSecrets } from '../core/secrets.ts';

/** What the client sees of a draft. text is null when the draft has no text yet. */
export type ClientDraft = { title: string; text: string | null; digest: string };

/** The draft as the client sees it, and the digest a client's answer and a post are bound to. */
export function clientDraft(run: Pick<DeliveryRunRecord, 'id' | 'status' | 'editedText' | 'renderedText' | 'deliverable'>): ClientDraft {
  const shown = run.status === 'edited' && run.editedText ? run.editedText : run.renderedText;
  const text = typeof shown === 'string' ? redactSecrets(shown) : null;
  const title = redactSecrets(run.deliverable?.title ?? 'Draft');
  return { title, text, digest: digest({ deliveryId: run.id, title, text }) };
}
