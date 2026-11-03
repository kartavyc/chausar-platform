/**
 * W6 6F5 (D34): the AI tool's own connections. Owners on a ChatGPT or Claude plan connect Gmail once inside ChatGPT or
 * Claude; when they turn it on in Chausar's AI settings, Codex or Claude Code may use it. Gmail is the only connection
 * Chausar turns on in the beta. Its tools are sorted here by name, never by the tool's own description or hints: only
 * making a draft and sending are on ('ask'), each waits for the owner's exact approval card, and the tool's automatic
 * reviewer never decides one. Every other tool stays off, reading the mailbox included (other people's mail has no
 * recorded consent), as do deleting, archiving, labelling and forwarding. 'read' is kept for a later, consented reader.
 * Owners without a connection keep the existing path: a ready draft opened in their own mail app.
 */

/** The Gmail connector in ChatGPT's apps, as Codex 0.154.0's apps server names it (read on this computer, 1 November). */
export const GMAIL_CONNECTOR_ID = 'connector_2128aebfecb84f64a069897515042a44';
/** The MCP server Codex runs the apps through. */
export const CODEX_APPS_SERVER = 'codex_apps';

export type ConnectorUse = 'read' | 'ask';

// Reading the mailbox stays off: it would put other people's mail in front of the AI without their recorded consent.
// Only making a draft and sending are on, and each always asks the owner.
const CODEX_GMAIL: Readonly<Record<string, ConnectorUse>> = Object.freeze({ send_email: 'ask', send_draft: 'ask', create_draft: 'ask' });
/** Claude's Gmail connector names its tools differently. */
const CLAUDE_GMAIL: Readonly<Record<string, ConnectorUse>> = Object.freeze({ send_message: 'ask', reply: 'ask', create_draft: 'ask' });

const own = (table: Readonly<Record<string, ConnectorUse>>, name: string): ConnectorUse | null => (Object.hasOwn(table, name) ? table[name]! : null);

/** A Codex Gmail tool, with or without its "gmail." prefix: read, ask, or null when it stays off. */
export function codexGmailTool(name: unknown): ConnectorUse | null {
  if (typeof name !== 'string') return null;
  return own(CODEX_GMAIL, name.startsWith('gmail.') ? name.slice('gmail.'.length) : name);
}
/** The tool names Codex's Gmail app is configured with, in both spellings, and how each is approved. */
export function codexGmailToolsConfig(): Record<string, { enabled: true; approval_mode: 'approve' | 'prompt' }> {
  const tools: Record<string, { enabled: true; approval_mode: 'approve' | 'prompt' }> = {};
  for (const [name, use] of Object.entries(CODEX_GMAIL)) {
    // 'approve' is Codex's "never ask" for a read Chausar listed by name; 'prompt' is always ask.
    const row = { enabled: true as const, approval_mode: use === 'read' ? 'approve' as const : 'prompt' as const };
    tools[name] = row; tools[`gmail.${name}`] = { ...row };
  }
  return tools;
}

/** A claude.ai connector server Chausar uses: Gmail only, judged by where it came from, never by its name alone. */
export function claudeGmailServer(server: { name?: unknown; source?: unknown } | undefined): boolean {
  return !!server && server.source === 'claudeai' && typeof server.name === 'string' && /\bgmail\b/i.test(server.name);
}
/** A Claude Gmail tool from its full name (mcp__server__tool): read, ask, or null when it stays off. */
export function claudeGmailTool(fullName: unknown): ConnectorUse | null {
  if (typeof fullName !== 'string' || !fullName.startsWith('mcp__')) return null;
  const at = fullName.lastIndexOf('__');
  return at > 4 ? own(CLAUDE_GMAIL, fullName.slice(at + 2)) : null;
}

export const CONNECTOR_WORDS = Object.freeze({
  codexCard: 'Codex wants to send this through your own Gmail connection in ChatGPT. Approving sends exactly this, once.',
  claudeCard: 'Claude wants to send this through your own Gmail connection in Claude. Approving sends exactly this, once.',
  instructions: 'The owner’s own Gmail connection is on for sending only; it cannot read mail. To send, use its send tool with the exact recipient, subject and body of the handoff you proposed; Chausar shows the owner that exact send to approve. Never retry a declined send, and never try to read, delete, archive, label or forward mail.',
});
