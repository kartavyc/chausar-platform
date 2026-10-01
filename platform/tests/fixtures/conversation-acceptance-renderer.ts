import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

// Execute the actual renderer and preload with a structured-clone IPC fixture.
// Host-Node worker integration uses only a fresh synthetic temporary vault. No Electron/GUI/network.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const contract = require(join(root, 'app/desktop/ipc-contract.cjs'));
const sources = await Promise.all(['app/renderer/app.js', 'app/desktop/preload.cjs', 'app/desktop/ipc-contract.cjs'].map(async path => ({ path, source: await readFile(join(root, path), 'utf8') })));
const rendererSource = sources[0].source;
const preloadSource = sources[1].source;

export class Element {
  tagName: string; children: Element[]; attributes: Record<string,string>; listeners: Map<string, ((event: any) => unknown)[]>; value: string; checked: boolean; disabled: boolean; className: string; classList: { add(): void; remove(): void; toggle(): void }; parent?: Element; id?: string; textContent?: string;
  constructor(tag: string) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = new Map(); this.value = ''; this.checked = false; this.disabled = false; this.className = ''; this.classList = { add() {}, remove() {}, toggle() {} }; }
  setAttribute(key: string, value: unknown) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'id') this.id = String(value); }
  removeAttribute(key: string) { delete this.attributes[key]; }
  append(...children: (Element | string | null | undefined)[]) { for (const child of children) { const node = child instanceof Element ? child : Object.assign(new Element('#text'), { textContent: String(child) }); node.parent = this; this.children.push(node); } if (this.tagName === 'select' && this.children.length === children.length && children.length) this.value = this.children[0].value; }
  replaceChildren(...children: (Element | string | null | undefined)[]) { this.children = []; this.append(...children); }
  addEventListener(name: string, handler: (event: any) => unknown) { const handlers = this.listeners.get(name) || []; handlers.push(handler); this.listeners.set(name, handlers); }
  async dispatch(name: string) { for (const handler of this.listeners.get(name) || []) await handler({ preventDefault() {}, currentTarget: this, target: this }); }
  focus() {} scrollIntoView() {}
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
  showModal() { this.attributes.open = ''; }
  close() { delete this.attributes.open; void this.dispatch('close'); }
}
export function descendants(node: Element): Element[] { return [node, ...node.children.flatMap(descendants)]; }
export function find(node: Element, predicate: (node: Element) => boolean) { const found = descendants(node).find(predicate); assert.ok(found, 'Expected actual renderer control to be present.'); return found; }

export async function harness({ failureQuestion, dispatch, routes = [], preview, mount = false } : { failureQuestion?: string; dispatch?: (method: string, payload: Record<string,unknown>) => Promise<unknown>; routes?: any[]; preview?: any; mount?: boolean } = {}) {
  const calls: any[] = [], wires: any[] = [], rejected: any[] = [];
  let exposed: any;
  const ipcRenderer = {
    async invoke(channel: string, envelope: unknown) {
      assert.equal(channel, 'chausar:request');
      // Electron IPC serializes via structured clone, which keeps own undefined properties.
      // Do not JSON-roundtrip here: doing so would mask the original native-only bug.
      const wire = structuredClone(envelope); wires.push(wire);
      try {
        const request = contract.validateRequest(wire); calls.push(request);
        if (dispatch) return structuredClone({ ok: true, result: await dispatch(request.method, request.payload) });
        if (request.method === 'conversation.ask' && request.payload.question === failureQuestion) return { ok: false, error: { code: 'FIXTURE_REFUSED', message: 'Synthetic refusal.' } };
        let result;
        if (request.method === 'models.list') result = routes;
        else if (request.method === 'models.preview') result = preview;
        else if (request.method === 'dashboard.get') result = { factCount: 10, sources: 1, policy: { send: 'nothing' } };
        else if (request.method === 'conversation.ask') result = { status: 'unsupported', reason: 'Synthetic engine reply; no real engine was started.' };
        else result = { echoed: request.payload };
        return structuredClone({ ok: true, result });
      } catch (error: any) { const typed = contract.publicError(error); rejected.push({ wire, error: typed }); return { ok: false, error: typed }; }
    },
    on() {}, removeListener() {},
  };
  vm.runInNewContext(preloadSource, { require: (name: string) => { assert.equal(name, 'electron'); return { ipcRenderer, contextBridge: { exposeInMainWorld(name: string, api: any) { assert.equal(name, 'chausar'); exposed = api; } } }; } }, { filename: join(root, 'app/desktop/preload.cjs') });
  assert.ok(exposed);
  const body = new Element('body'), app = new Element('div'), notifications = new Element('div');
  body.append(app, notifications);
  const document = { body, createElement: (tag: string) => new Element(tag), createTextNode: (value: unknown) => Object.assign(new Element('#text'), { textContent: String(value) }), createElementNS: (namespaceURI: string, tag: string) => Object.assign(new Element(tag), { namespaceURI }), getElementById: (id: string) => descendants(body).find(node => node.id === id) || (id === 'app' ? app : id === 'notifications' ? notifications : null), querySelectorAll: () => [] };
  const context: any = { document, Node: Element, window: { chausar: exposed, location: { origin: 'chausar://app', hash: '', pathname: '/index.html', search: '' }, history: { replaceState() {} }, addEventListener() {} }, crypto: { randomUUID }, URL, URLSearchParams, structuredClone, console, setTimeout: () => 0, clearTimeout() {}, fetch() { throw new Error('Unexpected HTTP path in desktop boundary regression.'); } };
  assert.match(rendererSource, /\bboot\(\);\s*$/);
  // Disable only automatic boot; execute all actual renderer functions, including request/composer.
  vm.runInNewContext(rendererSource.replace(/\bboot\(\);\s*$/, '') + '\n;globalThis.__test = { request, renderConversation, renderAnswer, reviewOutbound, showCalculator, showWorkspace, state, applyWorkspaceStatus, renderSetup, showConversationHistory: typeof showConversationHistory === "function" ? showConversationHistory : undefined, showSavedConversation: typeof showSavedConversation === "function" ? showSavedConversation : undefined };', context, { filename: join(root, 'app/renderer/app.js') });
  const renderer = context.__test;
  const page = await renderer.renderConversation();
  const composer = find(page, node => node.tagName === 'form' && node.className === 'composer');
  const question = find(composer, node => node.tagName === 'textarea');
  const submit = find(composer, node => node.tagName === 'button' && node.attributes.type === 'submit');
  if (mount) {
    const current = new Element('span'); current.id = 'current-page';
    const content = new Element('div'); content.id = 'page-content'; content.append(page);
    app.append(current, content);
  }
  async function ask(text: string) {
    const current = mount ? find(app, node => node.tagName === 'form' && node.className === 'composer') : composer;
    find(current, node => node.tagName === 'textarea').value = text; await current.dispatch('submit');
  }
  return { renderer, exposed, calls, wires, rejected, body, app, notifications, page, composer, question, submit, ask };
}


export const hasText = (node: Element, text: string) => descendants(node).some(child => child.textContent === text);
export function namedButton(node: Element, label: string) { return find(node, child => child.tagName === 'button' && hasText(child, label)); }
export function lastNamedButton(node: Element, label: string) {
  const button = descendants(node).filter(child => child.tagName === 'button' && hasText(child, label)).at(-1);
  assert.ok(button, 'Expected renderer button: ' + label); return button;
}
export function dialogFor(body: Element, title: string) {
  const dialog = descendants(body).filter(node => node.tagName === 'dialog' && hasText(node, title)).at(-1);
  assert.ok(dialog, 'Expected renderer dialog: ' + title); return dialog;
}
