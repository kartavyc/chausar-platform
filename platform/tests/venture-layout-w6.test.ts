// UI as data (wave 6, package 6H3, decision D40): each place is a list of blocks from a fixed library, saved per owner
// as a layout record. The owner (from the app) and the owner's AI (through Chausar's MCP tools) can show, hide, move and
// rename blocks, save views and navigate. Guardrails: approvals, questions, hard stops and money totals always show and
// keep their place and name; a block with figures is renamed only to a name that means the same; a block without
// figures never takes a money name; a name never has more words than the block's own, so a page's words at rest never
// rise; every change has its exact Undo and says who made it; the layout is data (ids and plain words), never code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { business, code, owner, phone } from './venture-judge-helpers.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { createLayoutTools } from '../runtime/venture/agent-runtime/ui-tools.ts';
import { AGENT_MCP_TOOL_NAMES } from '../runtime/venture/agent-runtime/driver-types.ts';
import { LAYOUT_LIBRARY } from '../runtime/venture/views/layout-core.ts';
import type { Context } from '../runtime/contracts.ts';

const ai: Context = { ...owner, channel: 'mcp', sourceTainted: true };
const names = (view: any) => view.blocks.map((block: any) => block.id);
const shown = (view: any) => view.blocks.filter((block: any) => block.shown).map((block: any) => block.id);

async function env() {
  const biz = await business('Pricing strategy advice for small online shops, done by AI helpers with me checking every reply.');
  const tools = createLayoutTools(biz.deps, { context: ai, assert: () => undefined });
  const tool = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const found = tools.find(item => item.name === name);
    assert.ok(found, `no tool ${name}`);
    return found.call(args, ai);
  };
  return { ...biz, tools, tool };
}

test('6H3: Today and Money start from the library, everything shown, locked blocks marked', async () => {
  const { call } = await env();
  const today = await call('venture.layout.get', { place: 'today' });
  assert.deepEqual(names(today), ['greeting', 'notices', 'goal', 'team', 'needs', 'working', 'earlier', 'ideas', 'apps']);
  assert.deepEqual(shown(today), names(today));
  assert.equal(today.custom, false);
  assert.equal(today.ai, null);
  assert.deepEqual(today.views, []);
  const needs = today.blocks.find((block: any) => block.id === 'needs');
  assert.equal(needs.keep, 'approval');
  assert.equal(needs.rename, 'fixed');
  assert.equal(needs.movable, false);
  const team = today.blocks.find((block: any) => block.id === 'team');
  assert.deepEqual({ name: team.name, keep: team.keep, rename: team.rename, movable: team.movable }, { name: 'Team at work', keep: null, rename: 'free', movable: true });
  const money = await call('venture.layout.get', { place: 'money' });
  assert.deepEqual(names(money), ['glance', 'owed', 'flow', 'weeks']);
  assert.equal(money.blocks.find((block: any) => block.id === 'glance').keep, 'money');
  const flow = money.blocks.find((block: any) => block.id === 'flow');
  assert.equal(flow.rename, 'aliases');
  assert.deepEqual(flow.aliases, LAYOUT_LIBRARY.money.blocks.find(block => block.id === 'flow')!.aliases);
  await assert.rejects(call('venture.layout.get', { place: 'onboarding' }), code('LAYOUT_UNKNOWN_PLACE'));
  await assert.rejects(call('venture.layout.get', { place: 'today', extra: 1 }), code('INVALID_VENTURE_REQUEST'));
});

test('6H3: the owner hides, moves and renames with an exact Undo; locked blocks keep their slot', async () => {
  const { call, store } = await env();
  const hid = await call('venture.layout.change', { place: 'today', change: { op: 'hide', block: 'ideas' } });
  assert.equal(hid.line, 'You hid Ideas.');
  assert.deepEqual(hid.undo, { place: 'today', change: { op: 'restore', to: 'default' } });
  assert.equal(hid.layout.blocks.find((block: any) => block.id === 'ideas').shown, false);
  assert.equal(hid.layout.custom, true);
  // Move Earlier to the first movable slot: it takes Team's slot beside the goal; the locked blocks stay where they are.
  const moved = await call('venture.layout.change', { place: 'today', change: { op: 'move', block: 'earlier', to: 0 } });
  assert.deepEqual(names(moved.layout), ['greeting', 'notices', 'goal', 'earlier', 'needs', 'team', 'working', 'ideas', 'apps']);
  assert.equal(moved.line, 'You moved Earlier.');
  const renamed = await call('venture.layout.change', { place: 'today', change: { op: 'rename', block: 'earlier', name: 'History' } });
  assert.equal(renamed.line, 'You renamed Earlier to History.');
  assert.equal(renamed.layout.blocks.find((block: any) => block.id === 'earlier').name, 'History');
  // Undo puts back exactly what was there before the rename.
  const undone = await call('venture.layout.change', renamed.undo);
  assert.equal(undone.line, 'You undid the change.');
  assert.deepEqual(names(undone.layout), names(moved.layout));
  assert.equal(undone.layout.blocks.find((block: any) => block.id === 'earlier').name, 'Earlier');
  assert.equal((await call('venture.layout.get', { place: 'today' })).ai, null);
  // Each change is one record; Money's layout is its own.
  assert.equal(listRecords(store.read(), 'venture-layout').length, 4);
  assert.equal((await call('venture.layout.get', { place: 'money' })).custom, false);
  const reset = await call('venture.layout.change', { place: 'today', change: { op: 'reset' } });
  assert.deepEqual(shown(reset.layout), names(reset.layout));
  assert.deepEqual(names(reset.layout), ['greeting', 'notices', 'goal', 'team', 'needs', 'working', 'earlier', 'ideas', 'apps']);
  // The owner's own changes come from the app.
  await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'hide', block: 'team' } }, phone), code('APP_APPROVAL_REQUIRED'));
});

test('6H3: approvals, questions, stops and money totals always show, keep their slot and their name', async () => {
  const { call } = await env();
  for (const block of ['needs', 'greeting', 'notices', 'goal']) {
    await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'hide', block } }), code('LAYOUT_LOCKED'));
    await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'move', block, to: 0 } }), code('LAYOUT_LOCKED'));
    await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'rename', block, name: 'Inbox' } }), code('LAYOUT_LOCKED'));
  }
  await assert.rejects(call('venture.layout.change', { place: 'money', change: { op: 'hide', block: 'glance' } }), code('LAYOUT_LOCKED'));
  await assert.rejects(call('venture.layout.change', { place: 'money', change: { op: 'hide', block: 'owed' } }), code('LAYOUT_LOCKED'));
  // A block with figures takes only a name that means the same.
  const ok = await call('venture.layout.change', { place: 'money', change: { op: 'rename', block: 'flow', name: 'Money flow' } });
  assert.equal(ok.layout.blocks.find((block: any) => block.id === 'flow').name, 'Money flow');
  await assert.rejects(call('venture.layout.change', { place: 'money', change: { op: 'rename', block: 'flow', name: 'Profit' } }), code('LAYOUT_FIGURE_NAME'));
  await assert.rejects(call('venture.layout.change', { place: 'money', change: { op: 'rename', block: 'weeks', name: 'Paid' } }), code('LAYOUT_FIGURE_NAME'));
  // A block without figures never takes a money word, a number, code, more words than its own, or another block's name.
  for (const name of ['Profit', 'Total', 'Rs', 'Team 2', '<b>Team</b>', 'Team at work now', 'Needs you', 'Working now', 'Team \u2014 ops', '', '   ']) {
    await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'rename', block: 'team', name } }), code('LAYOUT_NAME'), name);
  }
  // Unknown blocks, unknown ops and extra fields are refused: the layout is data.
  await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'hide', block: 'script' } }), code('LAYOUT_UNKNOWN_BLOCK'));
  await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'style', block: 'team', css: 'display:none' } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'hide', block: 'team', html: '<p>' } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'move', block: 'team', to: 9 } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'keep' }, by: 'ai' }), code('INVALID_VENTURE_REQUEST'));
});

test('6H3: saved views keep an arrangement by name; switching applies it with Undo', async () => {
  const { call } = await env();
  await call('venture.layout.change', { place: 'today', change: { op: 'hide', block: 'team' } });
  await call('venture.layout.change', { place: 'today', change: { op: 'hide', block: 'ideas' } });
  const saved = await call('venture.layout.change', { place: 'today', change: { op: 'save-view', name: 'Mornings' } });
  assert.equal(saved.line, 'You saved the view Mornings.');
  assert.deepEqual(saved.layout.views, [{ id: 'v1', name: 'Mornings' }]);
  await call('venture.layout.change', { place: 'today', change: { op: 'reset' } });
  const used = await call('venture.layout.change', { place: 'today', change: { op: 'use-view', view: 'v1' } });
  assert.equal(used.line, 'You switched to the view Mornings.');
  assert.deepEqual(shown(used.layout), ['greeting', 'notices', 'goal', 'needs', 'working', 'earlier', 'apps']);
  await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'save-view', name: 'mornings' } }), code('LAYOUT_NAME'));
  await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'use-view', view: 'v9' } }), code('LAYOUT_UNKNOWN_VIEW'));
  for (const name of ['Two', 'Three', 'Four', 'Five']) await call('venture.layout.change', { place: 'today', change: { op: 'save-view', name } });
  await assert.rejects(call('venture.layout.change', { place: 'today', change: { op: 'save-view', name: 'Six' } }), code('LAYOUT_VIEWS_FULL'));
  const deleted = await call('venture.layout.change', { place: 'today', change: { op: 'delete-view', view: 'v1' } });
  assert.equal(deleted.line, 'You deleted the view Mornings.');
  assert.equal(deleted.layout.views.length, 4);
  const back = await call('venture.layout.change', deleted.undo);
  assert.deepEqual(back.layout.views.map((view: any) => view.name), ['Mornings', 'Two', 'Three', 'Four', 'Five']);
});

test('6H3: the AI reads the screen and changes it through its tools; each change says it was the AI and can be undone', async () => {
  const { call, tool, store } = await env();
  const screen = await tool('ui_read_screen', { place: 'today' });
  assert.equal(screen.place, 'today');
  assert.deepEqual(screen.blocks.map((block: any) => block.id), ['greeting', 'notices', 'goal', 'team', 'needs', 'working', 'earlier', 'ideas', 'apps']);
  assert.ok(screen.rules.length >= 4);
  assert.deepEqual(screen.places.map((place: any) => place.id), ['today', 'money']);
  const hid = await tool('ui_arrange', { place: 'today', op: 'hide', block: 'ideas' });
  assert.equal(hid.line, 'Your AI hid Ideas.');
  const renamed = await tool('ui_rename', { place: 'today', block: 'team', name: 'My team' });
  assert.equal(renamed.line, 'Your AI renamed Team at work to My team.');
  const viewed = await tool('ui_views', { place: 'today', op: 'save', name: 'Quiet' });
  assert.equal(viewed.line, 'Your AI saved the view Quiet.');
  const records = listRecords(store.read(), 'venture-layout');
  assert.deepEqual(records.map(record => record.by), ['ai', 'ai', 'ai']);
  // The owner sees every AI change since their own last one, with one Undo for all of them.
  const view = await call('venture.layout.get', { place: 'today' });
  assert.equal(view.ai.count, 3);
  assert.deepEqual(view.ai.lines, ['Your AI hid Ideas.', 'Your AI renamed Team at work to My team.', 'Your AI saved the view Quiet.']);
  assert.deepEqual(view.ai.undo, { place: 'today', change: { op: 'restore', to: 'default' } });
  const undone = await call('venture.layout.change', view.ai.undo);
  assert.equal(undone.layout.ai, null);
  assert.deepEqual(shown(undone.layout), names(undone.layout));
  assert.deepEqual(undone.layout.views, []);
  // Keep: the owner keeps what the AI did; the notice goes.
  await tool('ui_arrange', { place: 'today', op: 'move', block: 'ideas', to: 0 });
  const kept = await call('venture.layout.change', { place: 'today', change: { op: 'keep' } });
  assert.equal(kept.line, "You kept your AI's changes.");
  assert.equal(kept.layout.ai, null);
  assert.equal(names(kept.layout)[3], 'ideas');
  // The same guardrails hold for the AI, and it cannot keep its own changes or call another op.
  await assert.rejects(tool('ui_arrange', { place: 'today', op: 'hide', block: 'needs' }), code('LAYOUT_LOCKED'));
  await assert.rejects(tool('ui_rename', { place: 'money', block: 'flow', name: 'Profit' }), code('LAYOUT_FIGURE_NAME'));
  await assert.rejects(tool('ui_arrange', { place: 'today', op: 'keep', block: '' }), code('INVALID_ARGUMENTS'));
  // Each change tells the open screens to read again (ids only).
  const events = listRecords(store.read(), 'venture-event').filter(event => event.name === 'queue.changed');
  assert.ok(events.length >= 5);
  assert.deepEqual(events.at(-1)!.data, {});
});

test('6H3: the AI navigates by asking the app to open a place; the app reads it as data', async () => {
  const { call, tool } = await env();
  const went = await tool('ui_navigate', { place: 'money', sub: 'invoices' });
  assert.deepEqual({ href: went.href, line: went.line }, { href: '#/money/invoices', line: 'Your AI opened Money.' });
  const view = await call('venture.layout.get', { place: 'today' });
  assert.equal(view.go.href, '#/money/invoices');
  assert.equal(typeof view.go.id, 'string');
  await assert.rejects(tool('ui_navigate', { place: 'onboarding', sub: '' }), code('INVALID_ARGUMENTS'));
  await assert.rejects(tool('ui_navigate', { place: 'money', sub: '../x' }), code('LAYOUT_UNKNOWN_PLACE'));
  await assert.rejects(tool('ui_navigate', { place: 'money', sub: 'javascript:alert(1)' }), code('LAYOUT_UNKNOWN_PLACE'));
});

test('6H3: the five UI tools are in the pinned toolbox list', () => {
  for (const name of ['ui_read_screen', 'ui_arrange', 'ui_rename', 'ui_views', 'ui_navigate']) assert.ok((AGENT_MCP_TOOL_NAMES as readonly string[]).includes(name), name);
});

test('6H3: a running job toolbox lists exactly the pinned tools, and its UI tools act as the AI', async t => {
  const { kitBusiness, owner: kitOwner } = await import('./fixtures/venture/kit-business.ts');
  const { nativeContext } = await import('./fixtures/venture/native-context.ts');
  const kit = await kitBusiness();
  const order = await kit.call('venture.order.create', { clientId: kit.client.id, offerId: kit.offers[0]!.id, request: 'Write a short reply.' });
  const { job } = await nativeContext(kit.deps, kitOwner, order.id);
  t.after(() => job.close());
  const listed: any = await job.service.handle(kitOwner, { jsonrpc: '2.0', id: 5, method: 'tools/list' });
  assert.deepEqual(listed.result.tools.map((item: any) => item.name).sort(), [...AGENT_MCP_TOOL_NAMES].sort());
  const read: any = await job.service.handle(kitOwner, { jsonrpc: '2.0', id: 6, method: 'tools/list' });
  assert.equal(read.result.tools.find((item: any) => item.name === 'ui_read_screen').annotations.readOnlyHint, true);
  const hid: any = await job.service.handle(kitOwner, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'ui_arrange', arguments: { place: 'today', op: 'hide', block: 'team' } } });
  assert.equal(hid.error, undefined, JSON.stringify(hid.error));
  assert.equal(hid.result.structuredContent.data.line, 'Your AI hid Team at work.');
  const view = await kit.call('venture.layout.get', { place: 'today' });
  assert.equal(view.ai.count, 1);
});
