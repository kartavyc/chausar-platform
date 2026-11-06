// Chausar playbook: the sign-off desk (wave 6, 6E5). The engine gate: in a sign-off desk business every client
// output is regulated, so a draft can be accepted, shared or posted only once the named professional of record signed
// those exact papers (kit/signoff-core.ts, the gate the CA firm uses too). Reads only. Written for Chausar.
import type {State} from '../../../contracts.ts';
import type {VentureRecord} from '../../contracts.ts';
import {findRecord,listRecords} from '../../records.ts';
import {acceptedBlueprintOrNull} from '../../delivery/shared.ts';
import {pickPlaybook} from '../registry.ts';
import {deskBlock,type DeskRun} from './core.ts';
import {professionOfOffer,type ProfessionSpec} from './professions.ts';
import {SIGNOFF_DESK_ID} from './registration.ts';

/** The profession whose professional signs an order's papers, or null outside a sign-off desk business. */
export function signoffDeskSpec(state:State,venture:VentureRecord,orderId:string):ProfessionSpec|null{
 if(pickPlaybook(venture.idea)?.id!==SIGNOFF_DESK_ID)return null;
 const order=findRecord(state,'venture-order',orderId);
 if(!order||order.ventureId!==venture.id)return null;
 const offers=acceptedBlueprintOrNull(state,venture)?.offers??[];
 // An offer the owner added still needs a signature: it takes the profession of the plan's first desk offer.
 return professionOfOffer(offers.find(offer=>offer.id===order.offerId)?.playbookOffer)??offers.map(offer=>professionOfOffer(offer.playbookOffer)).find(Boolean)??null;
}

export function signoffDeskRows(state:State,ventureId:string){return listRecords(state,'venture-signoff',ventureId);}

/** Why a sign-off desk run's papers cannot be accepted, shared or posted yet, or null. */
export function signoffDeskBlock(state:State,venture:VentureRecord,run:DeskRun):string|null{
 const spec=signoffDeskSpec(state,venture,run.orderId);
 return spec?deskBlock(signoffDeskRows(state,venture.id),spec,run):null;
}

/**
 * The tools the regulators of a sign-off desk business's professions switch off (core/compliance.ts refuses them with
 * REGULATOR_FORBIDS): every profession the accepted plan's desk offers serve. Empty outside a sign-off desk business.
 */
export function signoffDeskSwitchOffs(state:State,venture:VentureRecord):{tool:string;line:string}[]{
 if(pickPlaybook(venture.idea)?.id!==SIGNOFF_DESK_ID)return [];
 const specs=(acceptedBlueprintOrNull(state,venture)?.offers??[]).map(offer=>professionOfOffer(offer.playbookOffer)).filter((spec):spec is ProfessionSpec=>!!spec);
 return specs.flatMap(spec=>spec.refusedTools.map(item=>({tool:item.tool,line:item.line})));
}
