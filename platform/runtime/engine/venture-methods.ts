import { DRAFT_DESK_METHODS, VENTURE_METHODS } from '../method-registry.ts';
import { check } from '../contracts.ts';
import type { EngineInternals } from './internals.ts';
import { openVenture, type Handler } from './admission.ts';
const special: ReadonlySet<string> = new Set([...DRAFT_DESK_METHODS, "venture.countries", "venture.preview", "venture.compliance.get", "venture.country.suggest", "venture.playbooks.list", "venture.ai.setup.trust", "venture.ai.claude.install", "venture.ai.claude.progress", "venture.work.list"]);
export const METHODS: Record<string, Handler> = {
  ...Object.fromEntries(VENTURE_METHODS.filter(method => !special.has(method)).map(method => [method, (internals: EngineInternals, payload: any) => openVenture(internals, method, payload)])),
  "venture.countries": async (internals, payload) => {
    return (await internals.privateVentureModule()).ventureCountries();
  },
  "venture.preview": async (internals, payload) => {
    return (await internals.privateVentureModule()).venturePreview(payload);
  },
  "venture.compliance.get": async (internals, payload) => {
    const method = "venture.compliance.get";
    if (!internals.vault) { return (await import('../venture/core/compliance.ts')).complianceBeforeVault(payload); }
    return openVenture(internals, method, payload);
  },
  "venture.country.suggest": async (internals, payload) => {
    const method = "venture.country.suggest";
    if (!internals.vault?.read().conversations.some(record => record?.kind === 'venture-record')) {
      return (await internals.privateDraftDesk()).request(internals.context, method, payload);
    }
    return openVenture(internals, method, payload);
  },
  "venture.playbooks.list": async (internals, payload) => {
    return (await internals.privateVentureModule()).venturePlaybooks(payload, internals.vault ? { state: internals.vault.read(), businessId: (internals.options.venture?.workspace ?? internals.privateVentureWorkspace).current().id } : null,
      (await internals.snapshotReads()).flatMap(read => (read.snapshot ? [{ businessId: read.id, name: read.snapshot.name, playbook: read.snapshot.playbook }] : [])));
  },
  "venture.work.list": async (internals, payload) => {
    check(Object.keys(payload).length === 0, 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    const here = internals.privateWorkBusiness();
    return { work: [...internals.privateWork.list(''), ...(here ? internals.privateWork.list(here) : [])] };
  }
};
