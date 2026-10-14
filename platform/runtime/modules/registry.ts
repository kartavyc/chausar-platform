import type { EngineModule, MethodSpec } from './types.ts';
import { modules } from './index.ts';

const METHOD = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/;

export interface RegisteredMethod extends MethodSpec { readonly module: string }

export function buildRegistry(list: readonly EngineModule[], reserved: ReadonlySet<string> = new Set()): ReadonlyMap<string, RegisteredMethod> {
  const ids = new Set<string>(); const methods = new Map<string, RegisteredMethod>();
  for (const module of list) {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(module.id) || ids.has(module.id)) throw new Error(`Invalid or duplicate engine module id: ${module.id}`);
    ids.add(module.id);
    for (const [name, spec] of Object.entries(module.methods)) {
      if (!METHOD.test(name) || name.length > 80) throw new Error(`Invalid module method name: ${name}`);
      if (reserved.has(name) || methods.has(name)) throw new Error(`Module method collides with an existing method: ${name}`);
      if (!['read', 'prepare', 'approve', 'admin'].includes(spec.permission) || typeof spec.handler !== 'function') throw new Error(`Invalid method spec: ${name}`);
      methods.set(name, Object.freeze({ ...spec, module: module.id }));
    }
  }
  return methods;
}

export const engineModules: readonly EngineModule[] = modules;
export const moduleMethods: ReadonlyMap<string, RegisteredMethod> = buildRegistry(modules);
