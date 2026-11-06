// Chausar venture launcher, mini apps (wave 6 package 6H1, DECISIONS D39): the pieces the engine, the fake engine, the
// desktop and the Ink app share, with no imports, so each can load this file on its own.
//
// A mini app is one HTML page the owner's AI wrote. It is data: Chausar never runs it outside the frame. The Ink app
// shows it in an iframe with sandbox="allow-scripts" and no allow-same-origin (an opaque origin of its own) loaded from
// the static sandbox proxy (app/ui/public/mini-frame.html), which the desktop serves with MINI_FRAME_CSP: no network,
// no nested frames, no forms, no plugins. The proxy writes the document built here into itself. The document starts
// with the same policy as a meta tag, a quiet base style and the bridge: a small MCP Apps View client that speaks
// JSON-RPC 2.0 over postMessage (ui/initialize, ui/notifications/initialized, tools/call, size changes), as the MCP
// Apps extension (SEP-1865, io.modelcontextprotocol/ui, stable 2026-01-26) describes it:
// https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx (read 1 November 2026).
// The app sees one global, chausar.call(tool, arguments), and only the tools its permission screen granted answer.

/** The MCP Apps protocol version this host and the bridge speak. */
export const APP_PROTOCOL_VERSION = '2026-01-26';
/** The MCP Apps resource type: an HTML view. Each app version is served as ui://chausar/apps/<id>/v<version>. */
export const APP_MIME_TYPE = 'text/html;profile=mcp-app';
export const appUri = (id: string, version: number): string => `ui://chausar/apps/${id}/v${version}`;

/** What an app may be allowed, in the order the permission screen lists them. */
export const APP_PERMISSIONS = ['clients', 'orders', 'invoices', 'notes', 'calculator', 'propose'] as const;
export type AppPermission = typeof APP_PERMISSIONS[number];

/** Each tool the bridge answers and the permission that lets it answer. Reads change nothing. */
export const APP_TOOLS: Readonly<Record<string, AppPermission>> = Object.freeze({
  clients_list: 'clients',
  orders_list: 'orders',
  invoices_list: 'invoices',
  notes_get: 'notes',
  notes_set: 'notes',
  calculate: 'calculator',
  propose: 'propose',
});

/**
 * The frame's policy: scripts and styles only from the document itself, images and fonts only as data, and no way out
 * (no fetch, no frames, no forms, no workers, no base URL, no plugins). The desktop sends it as the proxy's header too,
 * with "sandbox allow-scripts" added so the proxy is sandboxed even if something opened it on its own.
 */
export const MINI_FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

/**
 * A quiet base look, so an app reads like the rest of Chausar in both themes, until Chausar sends its own colours
 * (one-shot A1, row 12: hostContext.styles.variables, applied by the bridge below). tests check both themes at 4.5:1.
 */
export const FRAME_BASE_COLOURS = Object.freeze({
  light: Object.freeze({ bg: '#fbfbfa', fg: '#16181b', mute: '#5c6168', line: '#e3e5e8', link: '#2f5bd3' }),
  dark: Object.freeze({ bg: '#121417', fg: '#eceef0', mute: '#a3a8ae', line: '#2a2e33', link: '#8fb4ff' }),
});
/** The colour variables an app may be given and may use: var(--bg), var(--fg), var(--mute), var(--line), var(--link). */
export const FRAME_VARIABLES = Object.freeze(['--bg', '--fg', '--mute', '--line', '--link'] as const);
const colours = (theme: keyof typeof FRAME_BASE_COLOURS) => Object.entries(FRAME_BASE_COLOURS[theme]).map(([name, value]) => `--${name}:${value}`).join(';');
const BASE_STYLE = `:root{color-scheme:light dark;${colours('light')}}`
  + `@media (prefers-color-scheme:dark){:root{${colours('dark')}}}`
  + `:root[data-theme=light]{color-scheme:light;${colours('light')}}`
  + `:root[data-theme=dark]{color-scheme:dark;${colours('dark')}}`
  + 'html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}a{color:var(--link)}'
  + 'body{padding:12px 14px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}'
  + 'th{color:var(--mute);font-weight:500}button,input,select,textarea{font:inherit;color:inherit}'
  + 'button{background:transparent;border:1px solid var(--line);border-radius:8px;padding:4px 10px;cursor:pointer}';

/** Content sizing ignores viewport minimums while measuring, then restores them before paint. Fixed minimums,
 * borders, margins and positioned descendants keep their full box edges. All stylesheets are local by the CSP. */
const FRAME_SIZE = String.raw`(function(){
  var last=-1,resize,mutations;
  var viewport=/[0-9.](?:dvh|svh|lvh|vh|vmin|vmax|vb)\b/i;
  function size(){
    var changed=[],body=document.body,height;
    function relax(style){var value=style.getPropertyValue("min-height");if(viewport.test(value)){var priority=style.getPropertyPriority("min-height");changed.push([style,value,priority]);style.setProperty("min-height","0px",priority);}}
    function rules(list){for(var rule of list){if(rule.style)relax(rule.style);if(rule.cssRules)rules(rule.cssRules);}}
    try{
      for(var sheet of document.styleSheets)rules(sheet.cssRules);
      relax(body.style);for(var element of body.querySelectorAll("*"))relax(element.style);
      var css=getComputedStyle(body),margin=Math.max(0,parseFloat(css.marginBottom)||0),padding=(parseFloat(css.paddingBottom)||0)+(parseFloat(css.borderBottomWidth)||0);
      var bottom=body.getBoundingClientRect().bottom+margin;
      for(var element of body.querySelectorAll("*")){var rect=element.getBoundingClientRect(),style=getComputedStyle(element);bottom=Math.max(bottom,rect.bottom+Math.max(0,parseFloat(style.marginBottom)||0)+padding+margin);}
      height=Math.max(1,Math.ceil(bottom+scrollY));
    }finally{
      for(var change of changed)change[0].setProperty("min-height",change[1],change[2]);
      if(mutations)mutations.takeRecords();
    }
    if(height!==last){last=height;parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:{width:document.documentElement.scrollWidth,height:height}},"*");}
  }
  function watch(){if(resize){resize.disconnect();resize.observe(document.body);for(var element of document.body.querySelectorAll("*"))resize.observe(element);}size();}
  window.addEventListener("load",function(){if(window.ResizeObserver)resize=new ResizeObserver(size);if(window.MutationObserver){mutations=new MutationObserver(watch);mutations.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});}watch();});
})();`;

/** The bridge inside the frame: an MCP Apps View client. No string in it closes a script tag. */
const BRIDGE = '(function(){"use strict";var pending={},seq=0,done;var ready=new Promise(function(r){done=r;});'
  + 'function send(m){parent.postMessage(m,"*");}'
  + 'function ask(method,params){var id=++seq;send({jsonrpc:"2.0",id:id,method:method,params:params||{}});return new Promise(function(res,rej){pending[id]={res:res,rej:rej};});}'
  + 'function theme(c){if(!c)return;var root=document.documentElement;if(c.theme==="light"||c.theme==="dark")root.setAttribute("data-theme",c.theme);'
  + 'var v=c.styles&&c.styles.variables;if(!v||typeof v!=="object")return;'
  + 'for(var k in v){if(Object.prototype.hasOwnProperty.call(v,k)&&/^--(?:bg|fg|mute|line|link)$/.test(k)&&typeof v[k]==="string"&&/^#[0-9a-fA-F]{3,8}$/.test(v[k]))root.style.setProperty(k,v[k]);}}'
  + 'window.addEventListener("message",function(e){if(e.source!==parent)return;var m=e.data;if(!m||m.jsonrpc!=="2.0")return;'
  + 'if(m.id!=null&&!m.method&&pending[m.id]){var p=pending[m.id];delete pending[m.id];if(m.error)p.rej(new Error(String(m.error.message||"Chausar refused this.")));else p.res(m.result);return;}'
  + 'if(m.method==="ui/resource-teardown"&&m.id!=null){send({jsonrpc:"2.0",id:m.id,result:{}});return;}'
  + 'if(m.method==="ui/notifications/host-context-changed")theme(m.params);});'
  + `ask("ui/initialize",{protocolVersion:"${APP_PROTOCOL_VERSION}",appCapabilities:{},clientInfo:{name:"chausar-mini-app",version:"1"}}).then(function(r){theme(r&&r.hostContext);send({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}});done(r);});`
  + FRAME_SIZE
  + 'window.chausar=Object.freeze({ready:ready,call:function(name,args){return ready.then(function(){return ask("tools/call",{name:String(name),arguments:args||{}});}).then(function(r){'
  + 'if(r&&r.isError)throw new Error(String(r.content&&r.content[0]&&r.content[0].text||"Chausar refused this."));return r?r.structuredContent:null;});}});})();';

/** The same global in an exported copy: it runs on its own, outside Chausar, so it has no data and asks nothing. */
export const OFFLINE_LINE = 'This copy runs outside Chausar, so it has no data.';
const OFFLINE = `(function(){window.chausar=Object.freeze({ready:Promise.resolve(null),call:function(){return Promise.reject(new Error(${JSON.stringify(OFFLINE_LINE)}));}});})();`;

const escapeText = (text: string): string => text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

function wrap(html: string, name: string, script: string): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${MINI_FRAME_CSP}">`
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${escapeText(name)}</title><style>${BASE_STYLE}</style><script>${script}</script></head><body>${html}</body></html>`;
}

/** The document the sandbox proxy writes into the frame: policy, base look and bridge first, then the app's own HTML. */
export function appDocument(html: string, name: string): string {
  return wrap(html, name, BRIDGE);
}

/** The exported single file: the same app with the same policy, and a bridge that says it has no data. */
export function exportDocument(html: string, name: string): string {
  return wrap(html, name, OFFLINE);
}

/** The tools an app's code names, as whole words, in the bridge's order. */
export function toolsOf(html: string): string[] {
  return Object.keys(APP_TOOLS).filter(tool => new RegExp(`\\b${tool}\\b`).test(html));
}

/** The permissions an app needs: exactly the ones its code's tools use, in the permission screen's order. */
export function permissionsOf(html: string): AppPermission[] {
  const used = new Set(toolsOf(html).map(tool => APP_TOOLS[tool]));
  return APP_PERMISSIONS.filter(permission => used.has(permission));
}

/** The most an app's own HTML may be, in characters. */
export const APP_HTML_MAX = 60_000;

/**
 * Why Chausar refuses an app's code, if it does: anything that reaches outside (links to other sites, scripts or
 * styles from elsewhere, frames, forms, network calls, storage, new windows, code built from text) and amounts of money
 * written into the code, since every amount an app shows must come from a granted read or the calculator. The frame's
 * policy blocks the outside anyway; this tells the owner plainly and keeps such code out of the vault.
 */
export function appCodeFindings(html: string): string[] {
  const found: string[] = [];
  const rules: readonly [RegExp, string][] = [
    [/\bhttps?:\/\/|(?:src|href|action)\s*=\s*["']?\s*\/\/|url\(\s*["']?\s*\/\//i, 'It links to another site. Apps cannot use the internet.'],
    [/<\s*(?:script|img|audio|video|source|track)\b[^>]*\bsrc\s*=\s*["']?(?!data:)[a-z][a-z0-9+.-]*:/i, 'It loads something from outside the app.'],
    [/<\s*(?:iframe|frame|frameset|object|embed|base|form|link|portal)\b/i, 'It uses frames, forms or outside files, which apps cannot use.'],
    [/<\s*meta\b[^>]*http-equiv\s*=\s*["']?refresh/i, 'It tries to move to another page.'],
    [/@import\b/i, 'It loads a stylesheet from outside the app.'],
    [/\bfetch\s*\(|\b(?:XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|sendBeacon|importScripts)\b|\bnew\s+(?:Shared)?Worker\b/, 'It tries to use the network.'],
    [/\b(?:localStorage|sessionStorage|indexedDB)\b|\bcaches\.|document\.cookie/, 'It tries to keep data outside Chausar. Apps keep notes through Chausar only.'],
    [/\bwindow\.open\b|\b(?:top|parent)\.location\b|\bimport\s*\(/, 'It tries to open or load another page.'],
    [/\beval\s*\(|\bnew\s+Function\b|\bsetTimeout\s*\(\s*["'`]|\bsetInterval\s*\(\s*["'`]/, 'It builds code from text, which apps cannot do.'],
    [/[₹$€£¥]\s?\d|\b(?:rs\.?|inr|usd|eur|gbp)\s?\d|\d\s?(?:rupees?|lakhs?|crores?|rs\b|inr\b)/i, 'It writes an amount of money into its code. Amounts must come from your records or the calculator.'],
  ];
  for (const [pattern, line] of rules) if (pattern.test(html)) found.push(line);
  return found;
}
