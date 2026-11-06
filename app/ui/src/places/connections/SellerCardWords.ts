// Localize only known static F3 copy. Never replace changed live evidence or capability fields.
import words from '../../text/en/pb-seller-cards.json';import type {ConnectorCardLite} from '../../engine/types';
export function localizedSellerCard(t:(key:string)=>string,card:ConnectorCardLite):ConnectorCardLite{
 const copy=words as Record<string,string>,prefix='pb-seller-cards.'+card.id+'.',translate=(key:string,current:string)=>copy[prefix+key]===current?t(prefix+key):current;
 return {...card,note:translate('note',card.note),modes:card.modes.map(mode=>({...mode,what:translate(mode.mode,mode.what)}))};
}
