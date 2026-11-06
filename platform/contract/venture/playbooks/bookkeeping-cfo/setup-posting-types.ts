// Canonical browser-safe types, shared by the engine and renderer.
import type { ZohoSetupMasterInput } from '../../../../shared/adapters/accounting/zoho-setup-types.ts';
import type { ZohoPreparedMaster } from '../../../../shared/adapters/accounting/zoho-setup-types.ts';
import type { ZohoSetupMasterRecord } from '../../../../shared/adapters/accounting/zoho-setup-types.ts';

export type SetupMasterOutcome={input:ZohoSetupMasterInput;prepared:ZohoPreparedMaster|null;state:'existing'|'pending'|'created'|'not-sent'|'outcome_unknown';record:ZohoSetupMasterRecord|null};
