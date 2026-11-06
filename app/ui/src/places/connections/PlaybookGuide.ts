// Setup copy for implemented playbook connectors; dynamic evidence remains the engine's own.
import words from '../../text/en/pb-connector-guides.json';
import type {ConnectorGuideLite} from '../../engine/types';
/** Replace only known static setup copy, retaining current missing settings and charge dates. */
export function localizedPlaybookGuide(t:(key:string)=>string,id:string|undefined,guide:ConnectorGuideLite):ConnectorGuideLite{
 const prefix=`pb-connector-guides.${id}.`;
 if(!Object.hasOwn(words,prefix+'step1'))return guide;
 const steps=Object.keys(words).filter(key=>key.startsWith(prefix+'step')).sort((a,b)=>Number(a.slice((prefix+'step').length))-Number(b.slice((prefix+'step').length))).map((key,index)=>`${index+1}. ${t(key)}`);
 return {...guide,steps,skipped:t(prefix+'skipped'),checks:t(prefix+'checks'),sends:t(prefix+'sends'),agentLimits:t(prefix+'agentLimits'),charges:{...guide.charges,line:t(prefix+'charges')}};
}
