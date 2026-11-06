// One-shot A1 (row 0): the models port with one preview swapped in, for a chat or a search that holds each preview
// against its own budget or keeps its call ids. The host's port is frozen (host.ts #modelsProxy), and a Proxy may not
// answer a frozen property with a different value (JavaScript throws "'get' on proxy"), so this builds a plain object:
// every method of the port, bound to it, with preview replaced. Data properties are copied as they are now.
import type { ModelPort } from '../contracts.ts';

/** The port's own and inherited property names, short of Object.prototype. */
function namesOf(port: object): string[] {
  const names = new Set<string>();
  for (let at: object | null = port; at && at !== Object.prototype; at = Object.getPrototypeOf(at)) {
    for (const name of Object.getOwnPropertyNames(at)) if (name !== 'constructor') names.add(name);
  }
  return [...names];
}

/** A frozen copy of port whose methods call the port itself, and whose preview is the one given. */
export function withPreview(port: ModelPort, preview: ModelPort['preview']): ModelPort {
  const copy: Record<string, unknown> = {};
  for (const name of namesOf(port)) {
    if (name === 'preview') continue;
    const value = (port as unknown as Record<string, unknown>)[name];
    copy[name] = typeof value === 'function' ? value.bind(port) : value;
  }
  copy.preview = preview;
  return Object.freeze(copy) as unknown as ModelPort;
}
