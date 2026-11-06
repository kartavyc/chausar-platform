import { digest } from '../../portable.ts';

export type ClientAiConsent = {id:string;revision:number;disclosureDigest:string;grantedAt:string;grantedBy:string;withdrawnAt:string|null};
export type ClientAiContextBinding = {ventureId:string;orderId:string;clientId:string;consentId:string;consentRevision:number};
export type ClientAiConsentView = {clientId:string;clientName:string;status:'required'|'agreed'|'withdrawn';disclosure:string;disclosureDigest:string;consent:ClientAiConsent|null};
type ConsentClient = {id:string;ventureId:string;name:string;email:string|null;aiConsent?:ClientAiConsent};
export const CLIENT_AI_DISCLOSURE = "Allow your connected AI to read this client's details, requests and files for their work. Only share data you have permission to share. You can withdraw this permission at any time. Withdrawal stops future sharing but cannot take back data already shared. Sending anything to a client still needs your approval.";

/** C5 task 7: the same permission, given once for every client the owner adds from now on. */
export const CLIENT_AI_DEFAULT_DISCLOSURE = "Allow your connected AI to read the details, requests and files of every client you add from now on, for their work. Only share data you have permission to share. Clients you already have keep their own choice. You can withdraw any one client's permission, or turn this off, at any time. Withdrawal stops future sharing but cannot take back data already shared. Sending anything to a client still needs your approval.";

/** C5 task 7: Allow AI for new clients as the screens read it. */
export type ClientAiDefaultView = { on: boolean; disclosure: string; digest: string; setAt: string | null; line: string };

/** Shared display and exact approval identity. No storage, runtime authority or credentials. */
export function clientAiConsentView(client:ConsentClient):ClientAiConsentView {
  const consent=client.aiConsent??null;
  return {clientId:client.id,clientName:client.name,status:consent?consent.withdrawnAt?'withdrawn':'agreed':'required',disclosure:CLIENT_AI_DISCLOSURE,
    disclosureDigest:digest({clientId:client.id,ventureId:client.ventureId,name:client.name,email:client.email,revision:consent?.revision??0,disclosure:CLIENT_AI_DISCLOSURE}),consent};
}
