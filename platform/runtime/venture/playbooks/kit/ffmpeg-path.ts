// Existing Chausar social montage path escaping, shared unchanged with narration rendering.
export const filterPath=(path:string)=>path.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'").replace(/,/g,'\\,').replace(/\[/g,'\\[').replace(/\]/g,'\\]');
