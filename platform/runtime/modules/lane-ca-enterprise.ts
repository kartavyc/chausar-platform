import type { EngineModule } from './types.ts';
import { caMethods } from '../ca-enterprise/ca-methods.ts';
import { enterpriseMethods } from '../ca-enterprise/enterprise-methods.ts';

/** The ca-enterprise lane: the CA console (clients.*) and the enterprise frame additions. Only the owning lane edits this file. */
export const caEnterpriseModule: EngineModule = {
  id: 'ca-enterprise',
  methods: { ...caMethods, ...enterpriseMethods },
  hostOptions: ({ env }) => (typeof env.CHAUSAR_CA_CONSENT_WORDING_FILE === 'string' && env.CHAUSAR_CA_CONSENT_WORDING_FILE.length > 0 ? { consentWordingFile: env.CHAUSAR_CA_CONSENT_WORDING_FILE } : {}),
};
