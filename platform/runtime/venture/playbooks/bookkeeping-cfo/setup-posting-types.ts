// Owner setup proposals contain no credentials. Provider IDs are saved only after exact readback.
import type {ZohoSetupMasterInput,ZohoPreparedMaster,ZohoPreparedOpening,ZohoSetupMasterRecord} from '../../../adapters/accounting/zoho-setup-types.ts';
export type SetupMasterOutcome={input:ZohoSetupMasterInput;prepared:ZohoPreparedMaster|null;state:'existing'|'pending'|'created'|'not-sent'|'outcome_unknown';record:ZohoSetupMasterRecord|null};
export type SetupPosting={target:string;sourceDigest:string;masters:SetupMasterOutcome[];state:'masters-staged'|'masters-applying'|'masters-done'|'opening-staged'|'opening-applying'|'complete'|'stopped'|'outcome_unknown';opening:ZohoPreparedOpening|null;openingId:string|null;reviewDigest:string};
