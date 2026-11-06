import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { SAMPLE_APP_HTML } from '../../src/engine/fake-apps';
import { APP_NEVER_LINE, madeLine } from '../../../../platform/runtime/venture/apps/words';
import { MINI_FRAME_CSP, OFFLINE_LINE } from '../../../../platform/runtime/venture/apps/frame';

// Wave 6 package 6H1 (D39): the fake engine's mini apps answer as the engine's apps/apps.ts does (the engine's own
// tests are platform/tests/venture-mini-apps-w6.test.ts): the same shapes, words, codes and checks. The fake has no AI,
// so "make" writes the sample app. Lumen Studio starts with one app, allowed and not pinned.

function fake(options: { fresh?: boolean } = {}) {
  return createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z', ...options }));
}
const call = (client: ReturnType<typeof fake>, app: string, tool: string, args: Record<string, unknown> = {}) => client.request('venture.apps.call', { app, tool, arguments: args });

describe('fake mini apps (6H1)', () => {
  it('lists the sample app, allowed and not pinned, with the ideas and the never line', async () => {
    const listed = await fake().request('venture.apps.list', {});
    expect(listed.apps.map((app) => [app.id, app.name, app.allowed, app.pinned, app.reads])).toEqual([
      ['miniapp_sample', 'Who owes me', true, false, ['Reads: Clients', 'Reads: Invoices', 'Keeps notes', 'Proposes cards']],
    ]);
    expect(listed.ideas).toHaveLength(3);
    expect(listed.never).toBe(APP_NEVER_LINE);
  });

  it('make writes a new app that asks first; its document carries the policy and the bridge', async () => {
    const client = fake();
    await expect(client.request('venture.apps.make', { ask: ' ' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const made = await client.request('venture.apps.make', { ask: 'A sheet of my clients and what each owes me' });
    const app = made.app;
    expect(app.version).toBe(1);
    expect(app.ask).toMatchObject({ added: ['clients', 'invoices', 'notes', 'propose'], first: true });
    expect(app.tools).toEqual([]);
    expect(app.document.includes(MINI_FRAME_CSP)).toBe(true);
    expect(app.document.endsWith(`<body>${SAMPLE_APP_HTML}</body></html>`)).toBe(true);
    expect(made.line).toBe(madeLine(1, ['clients', 'invoices', 'notes', 'propose']));
    await expect(call(client, app.id, 'clients_list')).rejects.toMatchObject({ code: 'APP_NOT_ALLOWED' });
    await expect(client.request('venture.apps.grant', { app: app.id, digest: '0'.repeat(64) })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    const granted = await client.request('venture.apps.grant', { app: app.id, digest: app.ask!.digest });
    expect(granted.app.ask).toBeNull();
    expect(granted.app.tools).toEqual(['clients_list', 'invoices_list', 'notes_get', 'notes_set', 'propose']);
    expect(granted.line).toBe(`${app.name} can run now, with only what you allowed.`);
  });

  it('reads answer within the grant, names only and balances with receipts; unknown and ungranted tools are refused', async () => {
    const client = fake();
    const clients = (await call(client, 'miniapp_sample', 'clients_list')).structuredContent as { clients: { id: string; name: string }[] };
    expect(clients.clients.length).toBeGreaterThan(0);
    expect(clients.clients.every((item) => Object.keys(item).join() === 'id,name')).toBe(true);
    const invoices = ((await call(client, 'miniapp_sample', 'invoices_list')).structuredContent as { invoices: { balance: { display: string; receiptId: string } }[] }).invoices;
    expect(invoices.length).toBeGreaterThan(0);
    const receipt = await client.request('venture.receipt.get', { id: invoices[0]!.balance.receiptId });
    expect(receipt.figures[0]!.display).toBe(invoices[0]!.balance.display);
    await expect(call(client, 'miniapp_sample', 'orders_list')).rejects.toMatchObject({ code: 'APP_NOT_ALLOWED' });
    await expect(call(client, 'miniapp_sample', 'read_files')).rejects.toMatchObject({ code: 'APP_TOOL_UNKNOWN' });
    await expect(call(client, 'miniapp_missing', 'clients_list')).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
  });

  it('notes are bounded; a reminder becomes one card on Today', async () => {
    const client = fake();
    await call(client, 'miniapp_sample', 'notes_set', { key: 'mon', value: 'yes' });
    expect((await call(client, 'miniapp_sample', 'notes_get')).structuredContent).toEqual({ notes: { mon: 'yes' } });
    await expect(call(client, 'miniapp_sample', 'notes_set', { key: 'bad key', value: 'x' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const invoices = ((await call(client, 'miniapp_sample', 'invoices_list')).structuredContent as { invoices: { id: string; number: string; status: string }[] }).invoices;
    const open = invoices.find((item) => item.status === 'issued' || item.status === 'part-paid')!;
    const before = (await client.request('venture.queue.list', { scope: 'current' })).rows.length;
    const proposed = (await call(client, 'miniapp_sample', 'propose', { kind: 'draft-reminder', invoiceId: open.id })).structuredContent as { card: { title: string }; line: string };
    expect(proposed.line).toBe('On Today for your approval.');
    expect(proposed.card.title).toBe(`Draft a payment reminder for invoice ${open.number}`);
    const rows = (await client.request('venture.queue.list', { scope: 'current' })).rows;
    expect(rows.length).toBe(before + 1);
    expect(rows.some((row) => row.title === proposed.card.title && (row.line ?? '').startsWith('From the app "Who owes me".'))).toBe(true);
    const again = (await call(client, 'miniapp_sample', 'propose', { kind: 'draft-reminder', invoiceId: open.id })).structuredContent as { line: string };
    expect(again.line).toBe('It is on Today already.');
    expect((await client.request('venture.queue.list', { scope: 'current' })).rows.length).toBe(before + 1);
  });

  it('the calculator answers with a receipt in the engine words', async () => {
    const client = fake();
    const made = (await client.request('venture.apps.make', { ask: 'Fee calculator' })).app;
    await client.request('venture.apps.grant', { app: made.id, digest: made.ask!.digest });
    await expect(call(client, made.id, 'calculate', { operation: 'add', amounts: ['1'] })).rejects.toMatchObject({ code: 'APP_NOT_ALLOWED' });
  });

  it('versions with undo, pin with undo, export with no data, Turn off and delete', async () => {
    const client = fake();
    const changed = (await client.request('venture.apps.make', { ask: 'Add a column', app: 'miniapp_sample' })).app;
    expect(changed.version).toBe(2);
    expect(changed.name).toBe('Who owes me');
    expect(changed.ask).toBeNull();
    const back = await client.request('venture.apps.restore', { app: 'miniapp_sample', version: 1 });
    expect(back.undo).toEqual({ version: 2 });
    expect(back.line).toBe('Now on version 1. Undo goes back.');
    await expect(client.request('venture.apps.restore', { app: 'miniapp_sample', version: 9 })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const pinned = await client.request('venture.apps.pin', { app: 'miniapp_sample', pinned: true });
    expect(pinned.undo).toEqual({ pinned: false });
    expect(pinned.line).toBe('Pinned to Today.');
    const file = await client.request('venture.apps.export', { app: 'miniapp_sample' });
    expect(file).toMatchObject({ fileName: 'who-owes-me.html', mediaType: 'text/html' });
    expect(file.document.includes(OFFLINE_LINE)).toBe(true);
    expect(file.document.includes('ui/initialize')).toBe(false);
    const off = await client.request('venture.apps.revoke', { app: 'miniapp_sample' });
    expect(off.app.tools).toEqual([]);
    expect(off.app.ask?.first).toBe(true);
    const removed = await client.request('venture.apps.remove', { app: 'miniapp_sample' });
    expect(removed.line).toBe('Who owes me and its notes are deleted.');
    await expect(client.request('venture.apps.get', { app: 'miniapp_sample' })).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
  });
});
