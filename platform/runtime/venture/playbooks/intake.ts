// Chausar flagship playbooks: what an order for a flagship offer asks at intake (playbook wiring). An offer that cuts
// footage (every YouTube channel offer) refuses the order with RIGHTS_REQUIRED until the rights to the footage are
// recorded, and only the bases that offer accepts count: clips of another show need a licence or the creator's clip
// programme, with its reference (delivery/rights.ts). The other fields say what the checks need to know: long video
// or Shorts, any AI voice, AI presenter or paid promotion, and the finished cut on this computer for the finishing
// check. An offer from any other plan takes no intake at all.
import { check } from '../../contracts.ts';
import type { IsoDate, IsoTime, OfferIntakeAsk, OrderIntake, VentureHostKind } from '../contracts.ts';
import { RIGHTS_LABELS, recordRights, requireRights } from '../delivery/rights.ts';
import type { FlagshipOffer } from './plan.ts';
import { SOCIAL_AGENCY_ID } from './social/registration.ts';
import { YOUTUBE_ID } from './youtube/registration.ts';

const KEYS = ['rights', 'format', 'aiVoice', 'aiPresenter', 'paidPromotion', 'cutFile'] as const;

/**
 * The intake fields besides the rights that each flagship playbook's checks read (playbooks/draft-checks.ts): the
 * YouTube checks read the format, the AI and paid promotion disclosures and the cut; the social checks read the
 * disclosures. The CA firm's checks read none, so its orders ask nothing.
 */
const FIELDS_READ: Readonly<Record<string, readonly OfferIntakeAsk['fields'][number][]>> = Object.freeze({
  [YOUTUBE_ID]: ['format', 'aiVoice', 'aiPresenter', 'paidPromotion', 'cutFile'],
  [SOCIAL_AGENCY_ID]: ['aiVoice', 'aiPresenter', 'paidPromotion'],
});

/**
 * What an order for a flagship offer asks at intake, for the order form: the rights the offer accepts and the other
 * fields its playbook's checks read. The hosted server reads no file on the owner's computer, so it never asks for the
 * cut. Null when the order asks nothing.
 */
export function offerIntakeAsk(playbookId: string, offer: Pick<FlagshipOffer, 'rights'>, host: VentureHostKind): OfferIntakeAsk | null {
  const fields = (FIELDS_READ[playbookId] ?? []).filter(field => field !== 'cutFile' || host !== 'hosted-web');
  return offer.rights.length || fields.length ? { rights: [...offer.rights], fields: [...fields] } : null;
}
const VIDEO = /\.(mp4|mov|m4v|mkv|webm)$/i;
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\/)/;

function flag(value: unknown, field: string): boolean {
  check(value === undefined || typeof value === 'boolean', 'INVALID_VENTURE_REQUEST', `Say yes or no to ${field}.`);
  return value === true;
}

/** The finished cut, as a full path to a video file on this computer. The hosted server reads no file of yours. */
function cutFile(value: unknown, host: VentureHostKind): string | null {
  if (value === undefined || value === null) return null;
  check(host !== 'hosted-web', 'INVALID_VENTURE_REQUEST', "The hosted server can't read a file on your computer. Name the cut in the desktop app.");
  check(typeof value === 'string' && value.length <= 500 && ABSOLUTE.test(value) && VIDEO.test(value) && !/[\u0000-\u001F\u007F]/.test(value), 'INVALID_VENTURE_REQUEST',
    'Name the cut as a full path to an MP4, MOV, M4V, MKV or WEBM file on this computer.');
  return value as string;
}

/**
 * Checks an order's intake against its plan offer. offer: the flagship offer the order is (playbooks/plan.ts), or null
 * for an offer from any other plan, which takes no intake. Returns what to keep on the order, or null when nothing is
 * asked. Refuses with RIGHTS_REQUIRED when the offer cuts footage and the rights are missing, unreadable, of a kind the
 * offer does not accept, or ended.
 */
export function orderIntake(raw: unknown, offer: { name: string; rights: FlagshipOffer['rights'] } | null, meta: { by: string; at: IsoTime; today: IsoDate; host: VentureHostKind }): OrderIntake | null {
  if (!offer) {
    check(raw === undefined, 'INVALID_VENTURE_REQUEST', 'This offer takes no intake.');
    return null;
  }
  check(raw === undefined || (raw !== null && typeof raw === 'object' && !Array.isArray(raw)), 'INVALID_VENTURE_REQUEST', 'Send the intake as named fields.');
  const body = (raw ?? {}) as Record<string, unknown>;
  const extra = Object.keys(body).filter(key => !(KEYS as readonly string[]).includes(key));
  check(extra.length === 0, 'INVALID_VENTURE_REQUEST', `The intake has no field called ${extra[0]}.`);
  const cuts = offer.rights.length > 0;
  if (!cuts) check(body.rights === undefined || body.rights === null, 'INVALID_VENTURE_REQUEST', 'This offer cuts no footage, so it records no rights.');
  let rights = null;
  if (cuts) {
    rights = recordRights(body.rights, { by: meta.by, at: meta.at });
    const wanted = offer.rights.map(basis => RIGHTS_LABELS[basis].toLowerCase()).join(' or ');
    check(offer.rights.includes(rights.basis), 'RIGHTS_REQUIRED', `${offer.name} needs ${wanted}, recorded at intake.`);
    requireRights({ id: 'intake', clipping: true }, { rights }, meta.today);
  }
  check(body.format === undefined || body.format === 'long' || body.format === 'short', 'INVALID_VENTURE_REQUEST', 'Choose a long video or Shorts.');
  const intake: OrderIntake = {
    rights,
    format: body.format === 'short' ? 'short' : 'long',
    aiVoice: flag(body.aiVoice, 'an AI voice'),
    aiPresenter: flag(body.aiPresenter, 'an AI presenter'),
    paidPromotion: flag(body.paidPromotion, 'paid promotion'),
    cutFile: cutFile(body.cutFile, meta.host),
  };
  // An offer that cuts no footage and was sent nothing keeps no intake.
  return !cuts && raw === undefined ? null : intake;
}
