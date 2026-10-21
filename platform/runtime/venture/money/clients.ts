// Clients of the venture. Client details are client data: they stay in the vault and never reach a model here.
import { check, type Context } from '../../contracts.ts';
import { gstinValid } from '../../memory.ts';
import { activateTerm, exactPayload, listRecords, plainText, readVenture, singleLine, ventureAction } from '../records.ts';
import { INDIA_STATES } from '../contracts.ts';
import { newestFirst } from './shared.ts';
import { recordOwnerFields } from '../evidence/ledger.ts';
import type { ClientRecord, VentureDeps } from '../contracts.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTHER_TAX_ID = /^[A-Z0-9][A-Z0-9-]{4,22}[A-Z0-9]$/;

/** venture.client.add (level prepare). */
export async function addClient(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ClientRecord> {
  const body = exactPayload(payload, ['name', 'email', 'countryCode', 'taxId', 'stateCode', 'note'], ['name']);
  const name = singleLine(body.name, 'Client name', { min: 2, max: 120 });
  let email: string | null = null;
  if (body.email !== undefined) {
    check(typeof body.email === 'string' && body.email.trim().length <= 200 && EMAIL.test(body.email.trim()), 'INVALID_VENTURE_REQUEST', 'Use an email address like name@example.com.');
    email = body.email.trim();
  }
  let countryCode: string | null = null;
  if (body.countryCode !== undefined) {
    check(typeof body.countryCode === 'string' && /^[A-Z]{2}$/.test(body.countryCode), 'INVALID_VENTURE_REQUEST', 'Use a two-letter country code like IN or US.');
    countryCode = body.countryCode;
  }
  const rawTaxId = body.taxId === undefined ? null : body.taxId;
  check(rawTaxId === null || (typeof rawTaxId === 'string' && rawTaxId.length <= 60), 'INVALID_TAX_ID', "Check the client's tax number.");
  let stateCode: string | null = null;
  if (body.stateCode !== undefined) {
    check(typeof body.stateCode === 'string' && Object.hasOwn(INDIA_STATES, body.stateCode), 'INVALID_VENTURE_REQUEST', 'Choose a state from the list.');
    stateCode = body.stateCode;
  }
  const note = body.note === undefined ? null : plainText(body.note, 'Note', { min: 1, max: 500 });

  return ventureAction(deps, ctx, 'prepare', 'client.add', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const indiaVenture = venture.country.code === 'IN';
    let taxId: string | null = null;
    if (rawTaxId !== null) {
      taxId = rawTaxId.toUpperCase().replace(/\s+/g, '');
      const gstin = countryCode === 'IN' || (countryCode === null && indiaVenture);
      if (gstin) check(gstinValid(taxId), 'INVALID_TAX_ID', "Check the client's GSTIN.");
      else check(OTHER_TAX_ID.test(taxId), 'INVALID_TAX_ID', "Check the client's tax number.");
    }
    if (stateCode !== null) {
      check(indiaVenture, 'INVALID_VENTURE_REQUEST', 'A state is used only for businesses in India.');
      check(countryCode === null || countryCode === 'IN', 'INVALID_VENTURE_REQUEST', 'A state is used only for clients in India.');
    }
    if (indiaVenture && taxId !== null && gstinValid(taxId)) {
      const fromGstin = taxId.slice(0, 2);
      check(Object.hasOwn(INDIA_STATES, fromGstin), 'INVALID_TAX_ID', "Check the client's GSTIN.");
      check(stateCode === null || stateCode === fromGstin, 'INVALID_TAX_ID', "The client's state must match the first two digits of their GSTIN.");
      stateCode = fromGstin;
    }
    const client: ClientRecord = { ...tx.base('venture-client'), name, email, countryCode, taxId, stateCode, note };
    const stored = tx.put(client);
    // The evidence ledger: each field the owner typed is owner-entered and verified.
    recordOwnerFields(tx, `client:${stored.id}`, { name, email, countryCode, taxId, stateCode, note });
    activateTerm(tx, 'client', { recordId: stored.id, kind: 'venture-client' });
    tx.emit('client-added', { clientId: stored.id });
    return stored;
  });
}

/** venture.client.list (level read): newest first. */
export async function listClients(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ClientRecord[]> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return newestFirst(listRecords(state, 'venture-client', venture.id));
}
