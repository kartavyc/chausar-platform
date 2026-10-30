// Original browser-safe owner setup contracts, based on official Zoho Books v3 schemas.
export const ZOHO_SETUP_ACCOUNT_TYPES=['other_asset','other_current_asset','cash','bank','fixed_asset','other_current_liability','credit_card','long_term_liability','equity','income','other_income','expense','cost_of_goods_sold','other_expense'] as const;
export type ZohoSetupAccountType=typeof ZOHO_SETUP_ACCOUNT_TYPES[number];
export type ZohoSetupMasterInput={kind:'contact';sourceId:string;name:string;number:string;contactType:'customer'|'vendor';customerSubtype:'business'|'individual'|null;gstTreatment:'business_gst'|'business_none'|'consumer';gstNo:string|null;placeOfContact:string;currencyId:string;openingBalanceMinor:string}|{kind:'account';sourceId:string;name:string;code:string;accountType:ZohoSetupAccountType;currencyId:string};
export type ZohoOpeningInput={migrationDate:string;locationId:string|null;currencyId:string;lines:{accountId:string;debitMinor:string;creditMinor:string}[]};
type PreparedBase={connectionIdentity:string;externalIdentity:string;method:'POST';query:Record<string,string>;body:string;materialDigest:string;evidenceDigest:string;digest:string};
export type ZohoPreparedMaster=PreparedBase&{kind:'zoho-setup-master';input:ZohoSetupMasterInput;path:'contacts'|'chartofaccounts'};
export type ZohoPreparedOpening=PreparedBase&{kind:'zoho-setup-opening';input:ZohoOpeningInput;path:'settings/openingbalances'};
export type ZohoSetupMasterRecord={id:string;kind:'contact'|'account';externalIdentity:string;materialDigest:string};
export type ZohoOpeningRecord={id:string;materialDigest:string;migrationDate:string;locationId:string|null;lines:{accountId:string;currencyId:string;debitMinor:string;creditMinor:string}[]};
