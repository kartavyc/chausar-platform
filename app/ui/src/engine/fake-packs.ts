// W6 6F2 (D31): playbook packs in the fake engine, answering exactly as platform/runtime/venture/packs/packs.ts does:
// the same pack validator (pack-format.ts is browser-safe), the same preview, digest and refusal codes, in the same order.
// The demo never runs a calculator; packs here are shown, added and removed only.
import { validatePack, packOperation, packView } from '../../../../platform/shared/venture/packs/pack-format.ts';
import type { PackDoc, PackView } from '../../../../platform/runtime/venture/packs/pack-format.ts';
import { EngineError } from './types';

type Host = { current(): string; exists(): boolean; changed(): void };
function payload(raw: unknown, allowed: string[], required: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send one request object.');
  const p = raw as Record<string, unknown>;
  if (Object.keys(p).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(p, key))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  return p;
}
const known = (error: unknown): never => { const e = error as { code?: string; message?: string }; throw new EngineError(e.code ?? 'INVALID_VENTURE_REQUEST', e.message ?? 'This pack is not valid.'); };

export class FakePacks {
  private saved = new Map<string, { doc: PackDoc; digest: string }[]>();
  private readonly host: Host;
  constructor(host: Host) { this.host = host; }
  static answers(method: string): boolean { return method === 'venture.packs.list' || method === 'venture.packs.add' || method === 'venture.packs.remove'; }
  private exists() { if (!this.host.exists()) throw new EngineError('VENTURE_NOT_FOUND', 'Start a business first.'); }
  private rows() { return this.saved.get(this.host.current()) ?? []; }
  request(method: string, raw: unknown): unknown {
    if (method === 'venture.packs.list') {
      payload(raw, [], []); this.exists();
      return { packs: this.rows().map(row => packView(row.doc, row.digest)).sort((a, b) => a.id.localeCompare(b.id)) };
    }
    if (method === 'venture.packs.add') {
      const p = payload(raw, ['pack', 'digest'], ['pack']);
      let valid: ReturnType<typeof validatePack>;
      try { valid = validatePack(p.pack); } catch (error) { return known(error); }
      if (p.digest === undefined) { this.exists(); return { added: false, digest: valid.digest, pack: valid.view }; }
      if (typeof p.digest !== 'string') throw new EngineError('INVALID_VENTURE_REQUEST', 'Approve the exact pack you previewed.');
      if (p.digest !== valid.digest) throw new EngineError('PREVIEW_CHANGED', 'This pack changed since you previewed it. Review it again.');
      this.exists();
      const rows = this.rows();
      if (rows.some(row => row.doc.id === valid.doc.id)) throw new EngineError('PACK_EXISTS', 'A pack with this id is already added. Remove it first to add another version.');
      const taken = new Set(rows.flatMap(row => row.doc.calculators.map(calc => packOperation(row.doc.id, calc.id))));
      if (valid.doc.calculators.some(calc => taken.has(packOperation(valid.doc.id, calc.id)))) throw new EngineError('PACK_EXISTS', 'A calculator name in this pack clashes with one already added.');
      this.saved.set(this.host.current(), [...rows, { doc: valid.doc, digest: valid.digest }]); this.host.changed();
      return { added: true, digest: valid.digest, pack: valid.view as PackView };
    }
    const p = payload(raw, ['packId'], ['packId']);
    if (typeof p.packId !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(p.packId)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose an added pack.');
    this.exists();
    const rows = this.rows();
    if (!rows.some(row => row.doc.id === p.packId)) throw new EngineError('PACK_NOT_FOUND', 'This pack is not added.');
    this.saved.set(this.host.current(), rows.filter(row => row.doc.id !== p.packId)); this.host.changed();
    return { removed: true };
  }
}
