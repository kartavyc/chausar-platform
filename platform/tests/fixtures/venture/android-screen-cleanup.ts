// Explicit test-only persistence port; production uses the workspace vault.
import type {AndroidScreenCleanup,AndroidScreenFile} from '../../../runtime/venture/build/android.ts';
export function fakeScreenCleanup():AndroidScreenCleanup{let pending:AndroidScreenFile[]=[];return{pending:()=>structuredClone(pending),async remember(file){pending.push({...file});},async forget(file){pending=pending.filter(v=>v.path!==file.path||v.serial!==file.serial);},guard(){},hold:()=>()=>{}};}
