// The host owns session lifetime without importing any feature package. Callbacks must erase synchronously.
export const cleanups=new WeakMap<object,Set<()=>void>>();
export function registerSessionCleanup(owner:object,cleanup:()=>void){let set=cleanups.get(owner);if(!set){set=new Set();cleanups.set(owner,set);}set.add(cleanup);}
export function clearSessionMemory(owner:object){const set=cleanups.get(owner);cleanups.delete(owner);for(const cleanup of set??[]){try{cleanup();}catch{/* Other session stores must still be cleared. */}}}
