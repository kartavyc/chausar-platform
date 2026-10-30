// F3 setup copy only. Current account status, dates and connector modes stay authoritative.
import words from '../../text/en/pb-seller-guides.json';import type {ConnectorGuideLite} from '../../engine/types';
export function localizedSellerGuide(t:(key:string)=>string,id:string|undefined,guide:ConnectorGuideLite):ConnectorGuideLite{
 const prefix=`pb-seller-guides.${id}.`;if(!Object.hasOwn(words,prefix+'step1'))return guide;
 return {...guide,steps:Object.keys(words).filter(key=>key.startsWith(prefix+'step')).sort().map((key,index)=>`${index+1}. ${t(key)}`),skipped:t(prefix+'skipped'),checks:t(prefix+'checks'),sends:t(prefix+'sends'),agentLimits:t(prefix+'agentLimits'),charges:{...guide.charges,line:t(prefix+'charges')}};
}
