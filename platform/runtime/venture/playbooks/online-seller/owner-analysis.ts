// Chausar owner-source parsing. Original code, commerce MIT/Apache ideas only.
import {exact} from './operations-core.ts';
import {sellerFile,sellerCsv} from './source.ts';
import {sellerThresholdRows,type SellerOperationMode} from './operations-analysis.ts';
import {sellerDecimal} from './owner-form.ts';
/** Optional owner files are parsed by the engine, identically in rehearsal. */
export function sellerOwnerOptions(mode:SellerOperationMode,raw:unknown):unknown {
 if(mode==='alerts'&&raw&&typeof raw==='object'&&Object.hasOwn(raw,'thresholdFile')){exact(raw,['thresholdFile']);const file=sellerFile(raw.thresholdFile);return {thresholds:sellerThresholdRows(sellerCsv(file.text))};}
 if(mode==='catalogue'&&raw&&typeof raw==='object'&&Object.hasOwn(raw,'mapFile')){exact(raw,['mapFile','channel','checkedOn','source']);return {map:{channel:raw.channel,checkedOn:raw.checkedOn,source:raw.source,columns:sellerCsv(sellerFile(raw.mapFile).text)}};}
 if(mode==='price-history'&&raw&&typeof raw==='object'&&Object.hasOwn(raw,'wasRupees')){exact(raw,['wasRupees']);return {was:sellerDecimal(raw.wasRupees),currency:'INR'};}
 return raw;
}
