// Chausar's MCP toolbox, UI tools (wave 6, package 6H3, decision D40): the owner's AI reads a description of a place,
// shows, hides and moves its blocks, renames them, saves and uses views, and asks the app to open a place. Each tool
// calls the same engine path as the owner's own change (views/layout.ts), stored as made by the AI, with the same
// guardrails: approvals, questions, stops and money totals always show and keep their place and name; a block with
// figures keeps its meaning; every change is undoable by the owner and the app says it was the AI. The tools never
// change a setting, an approval, a limit or a receipt, and they take ids and plain words only.
import type { Context } from '../../contracts.ts';
import { validateMCPArguments, type RegisteredMCPTool } from '../../mcp.ts';
import type { VentureDeps } from '../contracts.ts';
import { readAs } from '../delivery/shared.ts';
import { changeLayout, layoutGo, layoutView } from '../views/layout.ts';
import { LAYOUT_LIBRARY, LAYOUT_PLACES, LAYOUT_RULES, NAV_PLACES, layoutPlace, type LayoutChange } from '../views/layout-core.ts';

/** The tools in AGENT_MCP_TOOL_NAMES order (driver-types.ts pins them). */
export const UI_TOOL_NAMES = ['ui_read_screen', 'ui_arrange', 'ui_rename', 'ui_views', 'ui_navigate'] as const;

/** What the tools need from a job: its context, and a check that the job may still act. */
export type UiToolCapability = { readonly context: Readonly<Context>; assert(): void };

const place = { type: 'string', enum: [...LAYOUT_PLACES] };
const text = (maxLength: number) => ({ type: 'string', maxLength });
const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', additionalProperties: false, properties, required });

export function createLayoutTools(deps: VentureDeps, capability: UiToolCapability): RegisteredMCPTool[] {
  const ctx = () => { capability.assert(); return capability.context as Context; };
  const change = async (where: unknown, request: LayoutChange) => {
    const result = await changeLayout(deps, ctx(), layoutPlace(where), request, 'ai');
    capability.assert();
    const { blocks, views, custom } = result.layout;
    return { line: result.line, undo: result.undo, blocks, views, custom };
  };
  // Each tool checks its own arguments too, so a direct call holds to the same closed schema as one through the service.
  const checked = (tool: RegisteredMCPTool): RegisteredMCPTool => ({ ...tool, call: (args, context) => tool.call(validateMCPArguments(tool.inputSchema, args), context) });
  return ([{
    name: 'ui_read_screen',
    description: 'Read how a place in the owner\'s Chausar app is laid out: its blocks in order, which show, their names, which always show and why, saved views, and the rules for changing them. Also lists the places you can open.',
    inputSchema: schema({ place }, ['place']), readOnly: true,
    call: async args => {
      const context = ctx();
      const where = layoutPlace(args.place);
      const { state, venture } = readAs(deps, context, 'read');
      const view = layoutView(state, venture, context.memberId, where);
      return {
        place: view.place, title: view.title, blocks: view.blocks, views: view.views, custom: view.custom, rules: [...LAYOUT_RULES],
        places: LAYOUT_PLACES.map(id => ({ id, title: LAYOUT_LIBRARY[id].title })), canOpen: NAV_PLACES.map(item => item.id),
      };
    },
  }, {
    name: 'ui_arrange',
    description: 'Show, hide or move one block of a place, reset the place, or restore an earlier layout with the undo you were given. to is the slot among the blocks that can move, from 0. Blocks that always show refuse.',
    inputSchema: schema({ place, op: { type: 'string', enum: ['show', 'hide', 'move', 'reset', 'restore'] }, block: text(40), to: { type: 'integer' }, restoreTo: text(80) }, ['place', 'op']),
    readOnly: false,
    call: async args => {
      const op = args.op as string, block = String(args.block ?? '');
      if (op === 'move') return change(args.place, { op, block, to: Number(args.to ?? -1) });
      if (op === 'reset') return change(args.place, { op });
      if (op === 'restore') return change(args.place, { op, to: String(args.restoreTo ?? '') });
      return change(args.place, { op: op as 'show' | 'hide', block });
    },
  }, {
    name: 'ui_rename',
    description: 'Rename one block of a place in plain words, or put back its own name with an empty name. A block with figures takes only one of its listed names; other names cannot sound like money or grow the page.',
    inputSchema: schema({ place, block: text(40), name: text(40) }, ['place', 'block', 'name']), readOnly: false,
    call: async args => change(args.place, { op: 'rename', block: String(args.block), name: args.name === '' ? null : String(args.name) }),
  }, {
    name: 'ui_views',
    description: 'Save the current layout of a place as a named view, switch to a saved view by its id, or delete one. At most five views a place.',
    inputSchema: schema({ place, op: { type: 'string', enum: ['save', 'use', 'delete'] }, name: text(40), view: text(20) }, ['place', 'op']), readOnly: false,
    call: async args => {
      if (args.op === 'save') return change(args.place, { op: 'save-view', name: String(args.name ?? '') });
      return change(args.place, { op: args.op === 'use' ? 'use-view' : 'delete-view', view: String(args.view ?? '') });
    },
  }, {
    name: 'ui_navigate',
    description: 'Offer the owner a link to a place, and optionally a page in it (for example money and invoices). The app shows an Open button; it never opens the page by itself, so the owner decides.',
    inputSchema: schema({ place: { type: 'string', enum: NAV_PLACES.map(item => item.id) }, sub: text(32) }, ['place']), readOnly: false,
    call: async args => {
      const result = await layoutGo(deps, ctx(), args.place, args.sub);
      capability.assert();
      return result;
    },
  }] satisfies RegisteredMCPTool[]).map(checked);
}
