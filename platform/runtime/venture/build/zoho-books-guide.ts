// Accurate owner-only Zoho guide. Provider API evidence is recorded in NOTES-5K2-ZOHO-SETUP.md.
import type {ConnectorGuide} from '../contracts.ts';
export const ZOHO_BOOKS_GUIDE:Omit<ConnectorGuide,'charges'|'missing'>={
 steps:['Open the bookkeeping desk and choose the client organisation and finance cycle.','Create an owner self-client access token in the matching Zoho account region, with only the read and write access needed for your chosen accounting operation.','Save the token for this open session. Setup needs no invented customer or item IDs; invoice and settlement work needs explicit mappings.','Read the exact proposal and approve it. Master creation, initial opening balances and invoice issue each ask separately.'],
 skipped:'Choose the correct client organisation and region. Reconnect after locking or reopening the app; a saved token is not an approval.',
 checks:'This connector is fixture-tested. Preparation reads current provider identities and amounts; each approved write requires exact readback. Live account qualification is not claimed.',
 sends:'Sends: only an exact owner-approved supported invoice or credit-note draft, issue action, received settlement payment, missing master or initial organisation opening balance. No email, bank transfer, overwrite or silent retry.',
 agentLimits:'Agents can prepare source work but cannot send directly to Zoho. Unsupported tax, currency, inventory and setup profiles stay on the manual bookkeeper path.',
};
