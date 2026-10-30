// Native client/source binding. No requested model input can replace current owner consent or source bytes.
import {check,digest} from '../../../portable.ts';
import type {VentureTx} from '../../records.ts';
import {chooseFormRow} from './source-core.ts';
export type FormsSourceReader=Pick<VentureTx,'venture'|'find'>;
export function loadFormsSource(read:FormsSourceReader,orderId:string,fileId:string,identityColumn:string,rowIndex:number){
 const order=read.find('venture-order',orderId);
 check(order&&read.find('venture-client',order.clientId),'FORM_ORDER_REQUIRED','Choose an active data-entry client order.');
 check(order.status==='open'||order.status==='invoiced','FORM_ORDER_CLOSED','This order is closed. Review its existing outcome without entering another record.');
 check(order.intake?.fields?.['data-consent']===true,'FORM_CONSENT_REQUIRED','The client must consent to this current source before data entry.');
 const blueprint=read.venture?.acceptedBlueprintId?read.find('venture-blueprint',read.venture.acceptedBlueprintId):undefined;
 const offer=blueprint?.offers.find(value=>value.id===order.offerId);
 check(offer?.playbookOffer&&['data-entry-monthly','backlog-project'].includes(offer.playbookOffer),'FORM_ORDER_REQUIRED','Choose this data-entry service, not another playbook order.');
 const file=read.find('venture-upload',fileId);
 check(file&&file.format==='csv'&&file.scope.kind==='order'&&file.scope.orderId===order.id&&file.ventureId===order.ventureId&&Buffer.byteLength(file.contentBase64,'base64')<=500000,'FORM_SOURCE_INVALID','Choose the bounded CSV uploaded for this exact client order.');
 const source=chooseFormRow(Buffer.from(file.contentBase64,'base64').toString('utf8'),identityColumn,rowIndex);
 return {...source,order,file,sourceDigest:digest({orderId:order.id,clientId:order.clientId,offerId:order.offerId,playbookOffer:offer.playbookOffer,intake:order.intake,fileId:file.id,bytes:file.contentBase64,identityColumn,rowIndex})};
}
