// Only this implemented owner connector has local guide copy; other live guide evidence stays unchanged.
import type {ConnectorGuideLite} from '../../engine/types';
export function localizedBooksGuide(t:(key:string)=>string,connectorId:string|undefined,guide:ConnectorGuideLite):ConnectorGuideLite{
 if(connectorId!=='zoho-books')return guide;const word=(key:string)=>t('pb-books-guide.'+key);
 return {...guide,steps:[1,2,3,4].map(index=>index+'. '+word('step'+index)),skipped:word('skipped'),charges:{...guide.charges,line:word('charges')},checks:word('checks'),sends:word('sends'),agentLimits:word('limits')};
}
