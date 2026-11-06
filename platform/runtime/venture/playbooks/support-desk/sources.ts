// Shop source adapter for support matching. Original Chausar code; reuses the bounded W4 table reader.
import {tablesOfFile,type FileLike} from '../../delivery/harness/files.ts';
import {matchShopRows,type MatchCandidate} from './match.ts';
/** Only files already scoped to the current order are passed here; no service-owner contacts enter. */
export function matchShopFiles(input:Omit<MatchCandidate,'id'>,files:readonly FileLike[]){
 const tables=files.filter(f=>f.format==='csv').flatMap(file=>tablesOfFile(file).map(t=>({...t,digest:file.digest})));
 return matchShopRows(input,tables);
}
