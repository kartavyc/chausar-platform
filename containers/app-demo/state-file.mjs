// Publish complete state documents atomically to the separate cursor reader.
import {writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export function writeDemoState(path,text,io={writeFileSync,renameSync,unlinkSync}){
 const temporary=path+'.'+randomUUID()+'.next';
 try{io.writeFileSync(temporary,text,{mode:0o600,flag:'wx'});io.renameSync(temporary,path);}
 finally{try{io.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
