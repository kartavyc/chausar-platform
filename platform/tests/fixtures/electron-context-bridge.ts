import vm from 'node:vm';
import { types } from 'node:util';

/**
 * Source-only fixture for the two copies relevant to a sandboxed preload:
 * IPC replies are materialized in the preload realm, then contextBridge copies
 * values and proxies functions into the caller realm. It does not run Electron.
 *
 * The supported data subset is primitives, arrays, own enumerable object data,
 * functions, promises and Errors. Accessors and other native objects are refused
 * so tests cannot silently substitute execution for a data copy.
 */
type Realm = vm.Context | undefined;
const replacementStack = 'Synthetic contextBridge Error copy: original stack replaced.';

function inRealm<T>(expression: string, realm: Realm, fallback: () => T): T {
  return realm ? vm.runInContext(expression, realm) as T : fallback();
}

/** Electron documents losing custom Error properties and replacing the stack. */
export function copyElectronError(error: unknown, target?: vm.Context): Error {
  const descriptor = error !== null && typeof error === 'object'
    ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
  const message = descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
    ? descriptor.value : 'Synthetic bridge invocation failed.';
  const copied = inRealm<Error>('new Error()', target, () => new Error());
  Object.defineProperty(copied, 'message', { value: message, configurable: true, writable: true });
  Object.defineProperty(copied, 'stack', { value: replacementStack, configurable: true, writable: true });
  return Object.freeze(copied);
}

function copy(value: unknown, target: Realm, source: Realm, bridge: boolean, seen = new Map<object, unknown>()): unknown {
  if (value === null || ['undefined', 'string', 'boolean', 'number'].includes(typeof value)) return value;
  if (typeof value === 'function') {
    if (!bridge) throw new TypeError('The synthetic IPC copy does not support functions.');
    // Arguments travel in the opposite direction to a proxied function's result.
    return function (...args: unknown[]) {
      try {
        const result = value(...args.map(argument => copy(argument, source, target, true)));
        if (types.isPromise(result)) {
          return result.then(
            reply => copy(reply, target, source, true),
            error => { throw copyElectronError(error, target); },
          );
        }
        return copy(result, target, source, true);
      } catch (error) { throw copyElectronError(error, target); }
    };
  }
  if (typeof value !== 'object') throw new TypeError('Unsupported synthetic bridge value.');
  if (types.isNativeError(value)) {
    if (bridge) return copyElectronError(value, target);
    const copied = inRealm<Error>('new Error()', target, () => new Error());
    for (const key of ['message', 'stack', 'cause']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.hasOwn(descriptor, 'value')) {
        Object.defineProperty(copied, key, { value: copy(descriptor.value, target, source, false, seen), configurable: true, writable: true });
      }
    }
    return copied;
  }
  if (types.isPromise(value)) {
    if (!bridge) throw new TypeError('The synthetic IPC copy does not support promises.');
    return value.then(
      reply => copy(reply, target, source, true),
      error => { throw copyElectronError(error, target); },
    );
  }
  if (types.isDate(value) || types.isRegExp(value) || types.isMap(value) || types.isSet(value)
    || types.isArrayBuffer(value) || types.isArrayBufferView(value) || types.isWeakMap(value) || types.isWeakSet(value)) {
    throw new TypeError('Native object is outside this synthetic bridge fixture.');
  }
  const previous = seen.get(value);
  if (previous !== undefined) return previous;
  const array = Array.isArray(value);
  const copied = array
    ? inRealm<unknown[]>('[]', target, () => [])
    : inRealm<Record<string, unknown>>('({})', target, () => ({}));
  seen.set(value, copied);
  // Like structured copy, a custom prototype is not carried into the new realm.
  if (array) (copied as unknown[]).length = value.length;
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable) continue;
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Accessors are outside this synthetic bridge fixture.');
    Object.defineProperty(copied, key, { value: copy(descriptor.value, target, source, bridge, seen), enumerable: true, configurable: true, writable: true });
  }
  return bridge ? Object.freeze(copied) : copied;
}

/** Copy a value into a caller realm; omitted target means the host/test realm. */
export function copyContextBridgeValue<T>(value: T, target?: vm.Context, source?: vm.Context): T {
  return copy(value, target, source, true) as T;
}

export interface ElectronPreloadFixtureOptions {
  source: string;
  filename?: string;
  /** This is a synthetic handler, never an Electron or native invocation. */
  invoke(channel: string, envelope: unknown): unknown | Promise<unknown>;
  on?(channel: string, listener: (...args: unknown[]) => void): void;
  removeListener?(channel: string, listener: (...args: unknown[]) => void): void;
  /** Supply a renderer VM context, or omit it to receive copies in the test realm. */
  rendererContext?: vm.Context;
}

export function loadElectronPreloadFixture<T extends object = Record<string, (...args: any[]) => any>>(options: ElectronPreloadFixtureOptions): { api: T; context: vm.Context } {
  let api: T | undefined;
  const listeners = new Map<(...args: unknown[]) => void, (...args: unknown[]) => void>();
  const context = vm.createContext({});
  const ipcRenderer = {
    async invoke(channel: string, envelope: unknown) {
      // Keep own undefined fields, sparse arrays and numeric values intact.
      const wire = copy(envelope, undefined, context, false);
      const reply = await options.invoke(channel, wire);
      return copy(reply, context, undefined, false);
    },
    on(channel: string, listener: (...args: unknown[]) => void) {
      const copiedListener = (...args: unknown[]) => listener(...args.map(value => copy(value, context, undefined, false)));
      listeners.set(listener, copiedListener); options.on?.(channel, copiedListener);
    },
    removeListener(channel: string, listener: (...args: unknown[]) => void) {
      const copiedListener = listeners.get(listener);
      if (copiedListener) { options.removeListener?.(channel, copiedListener); listeners.delete(listener); }
    },
  };
  context.require = (name: string) => {
    if (name !== 'electron') throw new Error('Unexpected preload module in source-only bridge fixture.');
    return { ipcRenderer, contextBridge: {
      exposeInMainWorld(name: string, exposed: T) {
        if (name !== 'chausar' || api !== undefined) throw new Error('Unexpected preload exposure in source-only bridge fixture.');
        api = copyContextBridgeValue(exposed, options.rendererContext, context);
      },
    } };
  };
  vm.runInContext(options.source, context, { filename: options.filename ?? 'synthetic-preload.cjs' });
  if (api === undefined) throw new Error('The preload did not expose the named bridge.');
  return { api, context };
}
