// Exact approved article wrapper, shared by draft preview, live acceptance and the demo.
export function articleHtml(text:string):string{return '<pre data-chausar-article="true">'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')+'</pre>';}
