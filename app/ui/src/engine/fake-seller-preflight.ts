// Chausar seller rehearsal prerequisites. Same source parsing and computation as the engine, no paid calls.
import {EngineError,type BlueprintViewLite,type OrderLite} from './types';
import {analyseSellerOperation,type SellerOperationMode} from '../../../../platform/runtime/venture/playbooks/online-seller/operations-analysis';
import {sellerSourceOptions} from '../../../../platform/runtime/venture/playbooks/online-seller/operations-input';
import {sellerCsv} from '../../../../platform/runtime/venture/playbooks/online-seller/source';
/** Invalid source evidence refuses before a simulated draft can start. */
export function fakeSellerPreflight(plan:BlueprintViewLite|null|undefined,order:OrderLite,files:readonly {id:string;contentBase64:string;format:string}[],now:string) {
 if(plan?.playbook?.id!=='online-seller')return null;const offer=plan.blueprint.offers.find(row=>row.id===order.offerId)?.playbookOffer;
 const modes:Record<string,SellerOperationMode>={'product-research':'research','catalogue-upload':'catalogue','multi-store-report':'multi-store'};const mode=offer?modes[offer]:undefined;if(!mode)return null;
 const fields=order.intake?.fields??{};const rows=(id:string)=>{const source=files.find(file=>file.id===id);if(!source||source.format!=='csv')throw new EngineError('SELLER_INPUT_INVALID','Add the original seller export to this order.');return sellerCsv(new TextDecoder().decode(Uint8Array.from(atob(source.contentBase64),c=>c.charCodeAt(0))));};
 try{return analyseSellerOperation(mode,rows(String(fields.exports)),sellerSourceOptions(mode,fields,rows),now.slice(0,10));}catch(error){const e=error as Error&{code?:string};throw new EngineError(e.code??'SELLER_INPUT_INVALID',e.message);}
}
