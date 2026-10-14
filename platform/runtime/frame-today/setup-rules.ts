/**
 * FR-12: the setup checklist's dated rule table. Rows come only from this table and the saved
 * identity card, never from a model. Each rule names the official source it rests on and the
 * date this table was last checked against it. When a rule changes, edit the row and its date.
 *
 * `checkedOn` is the date the row was written against the named statute or direction. The
 * table was written offline (no source was fetched during the build); a person re-checks each
 * source before a release and moves the date.
 */
import type { IdentityCard } from './identity.ts';

export type ChecklistId = 'entity' | 'registration' | 'bank' | 'gst' | 'udyam' | 'licences';
export type ChecklistState = 'done' | 'not-done' | 'not-applicable';
export type SetupRule = { id: ChecklistId; ruleId: string; source: string; checkedOn: string; state(card: IdentityCard | null): ChecklistState };

/** PAN's fourth character names the holder's kind: P person, C company, F firm or LLP, and so on. */
const panKind = (card: IdentityCard | null) => card?.fields.pan?.[3] ?? null;

export const SETUP_RULES: readonly SetupRule[] = [
  { id: 'entity', ruleId: 'in.pan.139a.v1', source: 'Income-tax Act, 1961, section 139A (Income Tax Department, PAN)', checkedOn: '2026-10-14',
    state: card => card?.fields.pan ? 'done' : 'not-done' },
  { id: 'registration', ruleId: 'in.mca.incorporation.v1', source: 'Companies Act, 2013, section 7, and Limited Liability Partnership Act, 2008 (Ministry of Corporate Affairs)', checkedOn: '2026-10-14',
    state: card => card?.fields.cin ? 'done' : panKind(card) === 'P' ? 'not-applicable' : 'not-done' },
  { id: 'bank', ruleId: 'in.rbi.kyc-md-2016.v1', source: 'Master Direction – Know Your Customer (KYC) Direction, 2016 (Reserve Bank of India)', checkedOn: '2026-10-14',
    // No engine state proves a current account; the row stays open until the books show one.
    state: () => 'not-done' },
  { id: 'gst', ruleId: 'in.cgst.22-24-10.v1', source: 'Central Goods and Services Tax Act, 2017, sections 10, 22 and 24 (CBIC)', checkedOn: '2026-10-14',
    state: card => card?.gstMode === 'not-registered' || (card?.gstMode && card.fields.gstin) ? 'done' : 'not-done' },
  { id: 'udyam', ruleId: 'in.msme.so-2119e-2020.v1', source: 'Notification S.O. 2119(E), 26 June 2020, Udyam Registration (Ministry of MSME)', checkedOn: '2026-10-14',
    state: card => card?.fields.udyam ? 'done' : 'not-done' },
  { id: 'licences', ruleId: 'in.fss-31.ftdr-7.v1', source: 'Food Safety and Standards Act, 2006, section 31 (FSSAI), and Foreign Trade (Development and Regulation) Act, 1992, section 7 (DGFT, IEC)', checkedOn: '2026-10-14',
    state: card => card?.fields.fssai || card?.fields.iec ? 'done' : 'not-done' },
];

export function setupChecklist(card: IdentityCard | null) {
  return { rows: SETUP_RULES.map(rule => ({ id: rule.id, ruleId: rule.ruleId, source: rule.source, checkedOn: rule.checkedOn, state: rule.state(card) })) };
}
