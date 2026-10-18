// Chausar hosted tier: the mail port for sign-in links. This build sends no email. The development outbox keeps each
// message in memory and, when asked, prints it on this server's own console; without it, email sign-in refuses with a
// plain reason. A real sender (SMTP or a mail API under the operator's account) is planned and listed in the deploy notes.
import { ChausarError } from '../contracts.ts';

export type MailMessage = { kind: 'magic-link'; to: string; subject: string; text: string; link: string };

export interface Mailer {
  readonly kind: 'dev-outbox' | 'not-configured';
  /** True only for a sender that delivers to a real inbox. No mailer in this build does. */
  readonly delivers: boolean;
  send(message: MailMessage): Promise<void>;
}

export class DevOutbox implements Mailer {
  readonly kind = 'dev-outbox' as const;
  readonly delivers = false;
  readonly messages: MailMessage[] = [];
  #print: ((line: string) => void) | null;
  constructor(print: ((line: string) => void) | null = null) { this.#print = print; }
  async send(message: MailMessage) {
    this.messages.push(structuredClone(message));
    if (this.messages.length > 100) this.messages.shift();
    this.#print?.(`[dev outbox] Sign-in link for ${message.to}: ${message.link}`);
  }
  latest(to: string): MailMessage | undefined { return [...this.messages].reverse().find(message => message.to === to); }
}

export class NoMailer implements Mailer {
  readonly kind = 'not-configured' as const;
  readonly delivers = false;
  async send(): Promise<void> {
    throw new ChausarError('MAIL_NOT_CONFIGURED', 'Email sign-in links are not set up on this server yet. Sign in with a passkey.');
  }
}
