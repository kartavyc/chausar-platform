/**
 * What a new order says at intake, for an offer from a flagship playbook (BlueprintViewLite.intake, worked out by the
 * engine in platform/runtime/venture/playbooks/intake.ts). An offer that cuts footage is refused with RIGHTS_REQUIRED
 * unless the order says whose footage it is, on a basis the offer accepts; a licence or a clip programme also needs
 * its reference. The other fields are what the playbook's checks read. Pure helpers; the sheet keeps the state.
 */
import type { EngineMethods, OfferIntakeLite, RightsBasisLite } from '../../engine/types';

export interface IntakeDraft {
  basis: RightsBasisLite | ''; holder: string; reference: string;
  format: 'long' | 'short'; aiVoice: boolean; aiPresenter: boolean; paidPromotion: boolean; cutFile: string;
}
export const EMPTY_INTAKE: IntakeDraft = { basis: '', holder: '', reference: '', format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: '' };

type IntakeParams = NonNullable<EngineMethods['venture.order.create']['params']['intake']>;

/** The basis in use: the one chosen when this offer accepts it, else the only one the offer accepts, else none yet. */
export function basisFor(ask: OfferIntakeLite, draft: IntakeDraft): RightsBasisLite | '' {
  if (draft.basis !== '' && ask.rights.includes(draft.basis)) return draft.basis;
  return ask.rights.length === 1 ? ask.rights[0]! : '';
}

/** Whether the rights are complete enough to send: a basis the offer accepts, who owns the footage, and any reference. */
export function intakeReady(ask: OfferIntakeLite | null, draft: IntakeDraft): boolean {
  if (!ask || ask.rights.length === 0) return true;
  const basis = basisFor(ask, draft);
  return basis !== '' && draft.holder.trim() !== '' && (basis === 'own-footage' || draft.reference.trim() !== '');
}

/** The intake to send with the order: only the fields this offer asks for; nothing for an offer that asks nothing. */
export function intakeParams(ask: OfferIntakeLite | null, draft: IntakeDraft): IntakeParams | undefined {
  if (!ask) return undefined;
  const out: IntakeParams = {};
  const basis = basisFor(ask, draft);
  if (ask.rights.length > 0 && basis !== '') {
    out.rights = { basis, holder: draft.holder.trim(), ...(basis === 'own-footage' ? {} : { reference: draft.reference.trim() }) };
  }
  if (ask.fields.includes('format')) out.format = draft.format;
  if (ask.fields.includes('aiVoice')) out.aiVoice = draft.aiVoice;
  if (ask.fields.includes('aiPresenter')) out.aiPresenter = draft.aiPresenter;
  if (ask.fields.includes('paidPromotion')) out.paidPromotion = draft.paidPromotion;
  if (ask.fields.includes('cutFile') && draft.cutFile.trim() !== '') out.cutFile = draft.cutFile.trim();
  return out;
}
