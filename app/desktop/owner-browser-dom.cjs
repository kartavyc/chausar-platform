'use strict';
// Original fixed isolated-world operations. No caller JavaScript, CSS selectors, passwords or file paths.
// Page JavaScript is disabled by owner-browser.cjs. Dynamic/AJAX forms remain a manual path.
function pageOperation(command) {
 const fail=code=>{throw new Error(code);};
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
 const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
 if(!object(command)||!['inspect','fill','prepare','submit','read-saved'].includes(command.op))fail('FORM_ACTION_HELD');
 const elements=Array.from(document.querySelectorAll('input,textarea,select,button,[role="button"]'));
 const forms=Array.from(document.forms);
 const sensitive=e=>e.type==='password'||/(?:^|\s)(?:one-time-code|current-password|new-password|cc-[a-z-]+)(?:$|\s)/i.test(e.autocomplete||'')||/password|passcode|\botp\b|\bcvv\b|card\s*number|security\s*code|authentication/i.test(e.name+' '+(e.getAttribute('aria-label')||''));
 const visible=e=>{if(e.hidden||e.type==='hidden'||e.closest('[hidden],[aria-hidden="true"]'))return false;for(let parent=e;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;}return true;};
 const kind=e=>e.getAttribute('role')==='button'?'role-button':e.tagName==='TEXTAREA'?'textarea':e.tagName==='SELECT'?'select':e.tagName==='BUTTON'?(e.type==='submit'?'submit':'button'):['text','email','tel','url','search','number','date'].includes(e.type)?'text':e.type;
 const value=e=>sensitive(e)||e.type==='hidden'||e.type==='file'?null:e.type==='checkbox'?String(e.checked):typeof e.value==='string'?e.value:null;
 if(command.op==='read-saved'){
  if(!exact(command,'op'))fail('FORM_MAPPING_INVALID');
  const readings=[];
  // Page scripts are disabled. Default properties preserve response markup even after the owner types locally.
  for(const [index,e] of elements.entries()){
   if(!visible(e)||sensitive(e)||e.closest('[contenteditable]')||!['text','textarea','select','checkbox'].includes(kind(e)))continue;
   let saved;
   if(kind(e)==='checkbox')saved=String(e.defaultChecked);
   else if(kind(e)==='select'){if(e.multiple)continue;const options=Array.from(e.options);const selected=options.filter(option=>option.defaultSelected);if(selected.length>1)continue;saved=(selected[0]||options[0])?.value??'';}
   else saved=e.defaultValue;
   if(typeof saved!=='string'||saved.length>4000)continue;
   readings.push({index,name:(e.getAttribute('aria-label')||e.name||'Saved field').slice(0,200),value:saved,kind:'saved-field',descriptor:JSON.stringify([e.tagName,e.type,e.name,e.id,e.form?.action])});
  }
  const texts=Array.from(document.querySelectorAll('output,dd,td,p,span'));
  for(const [index,e] of texts.entries()){
   if(!visible(e)||e.closest('[contenteditable],script,style,button,select,textarea')||e.querySelector('input,textarea,select,button,[contenteditable],output,dd,td,p,span'))continue;
   const text=(e.textContent||'').trim();if(!text||text.length>4000)continue;
   readings.push({index:elements.length+index,name:(e.getAttribute('aria-label')||e.getAttribute('data-field')||'Saved text').slice(0,200),value:text,kind:'saved-text',descriptor:JSON.stringify([e.tagName,e.id,index])});
  }
  const result={url:location.href,complete:readings.length<=200,readings:readings.slice(0,200)};
  return {...result,signature:JSON.stringify(result)};
 }
 function snapshot(){
  const fields=elements.map((e,index)=>({index,kind:kind(e),name:(e.name||e.getAttribute('aria-label')||e.labels?.[0]?.textContent||e.textContent||'').trim().slice(0,200),redacted:sensitive(e),disabled:e.matches(':disabled')||!!e.readOnly||!visible(e),inForm:!!e.form,formIndex:forms.indexOf(e.form),descriptor:JSON.stringify([e.tagName,e.type,e.name,e.id,e.getAttribute('role'),e.form?.action,e.form?.method,e.form?.enctype,e.getAttribute('maxlength'),e.getAttribute('pattern'),e.getAttribute('required'),e.getAttribute('formaction'),e.getAttribute('formmethod'),e.getAttribute('formenctype'),e.tagName==='SELECT'?Array.from(e.options).map(o=>[o.value,o.disabled]):null]),value:value(e)}));
  const formRows=forms.map((f,index)=>({index,action:f.action,method:f.method,enctype:f.enctype}));
  const rawText=document.body?.innerText??document.body?.textContent??'';
  const text=rawText.slice(0,100000);
  const page={url:location.href,title:document.title.slice(0,200),text,complete:rawText.length<=100000&&elements.length<=100&&forms.length<=20,fields:fields.slice(0,100),forms:formRows.slice(0,20)};
  const privateValues=elements.filter(e=>sensitive(e)||e.type==='hidden').flatMap(e=>[e.value,e.defaultValue]).filter(v=>typeof v==='string'&&v.length>0);
  const safe=JSON.parse(JSON.stringify(page,(_key,v)=>typeof v==='string'?privateValues.reduce((text,secret)=>text.split(secret).join('[private]'),v):v));
  return {...safe,signature:JSON.stringify(safe)};
 }
 const page=snapshot();
 if(command.op==='inspect'){if(!exact(command,'op'))fail('FORM_MAPPING_INVALID');return page;}
 if(!page.complete||typeof command.signature!=='string'||command.signature!==page.signature)fail('FORM_TARGET_CHANGED');
 if(command.op==='fill'){
  if(!exact(command,'op,signature,values')||!Array.isArray(command.values)||!command.values.length||command.values.length>100)fail('FORM_MAPPING_INVALID');
  const used=new Set();let form=null;
  // Validate the entire map before changing any field.
  for(const row of command.values){
   if(!exact(row,'index,value')||!Number.isInteger(row.index)||typeof row.value!=='string'||row.value.length>4000||used.has(row.index))fail('FORM_MAPPING_INVALID');
   used.add(row.index);const e=elements[row.index];
   if(!e||!e.form||e.matches(':disabled')||e.readOnly||!visible(e)||sensitive(e)||!['text','textarea','select','checkbox'].includes(kind(e)))fail('FORM_ACTION_HELD');
   if(form&&form!==e.form)fail('FORM_ACTION_HELD');form=e.form;
   if(e.maxLength>=0&&row.value.length>e.maxLength)fail('FORM_MAPPING_INVALID');
   if(kind(e)==='select'&&(e.multiple||!Array.from(e.options).some(o=>o.value===row.value&&!o.disabled)))fail('FORM_ACTION_HELD');
   if(kind(e)==='checkbox'&&!['true','false'].includes(row.value))fail('FORM_MAPPING_INVALID');
  }
  const previous=command.values.map(row=>({index:row.index,value:value(elements[row.index])}));
  for(const row of command.values){const e=elements[row.index];if(kind(e)==='checkbox')e.checked=row.value==='true';else e.value=row.value;}
  if(command.values.some(row=>value(elements[row.index])!==row.value)){
   for(const row of previous){const e=elements[row.index];if(kind(e)==='checkbox')e.checked=row.value==='true';else e.value=row.value;}
   fail('FORM_MAPPING_INVALID');
  }
  return snapshot();
 }
 if(!exact(command,command.op==='prepare'?'op,signature,index':'op,signature,index,body')||!Number.isInteger(command.index))fail('FORM_MAPPING_INVALID');
 const button=elements[command.index];const form=button?.form;
 if(!form||kind(button)!=='submit'||button.matches(':disabled')||!visible(button)||form.target&&form.target!=='_self')fail('FORM_ACTION_HELD');
 const action=new URL(button.getAttribute('formaction')||form.action,location.href);
 const method=(button.getAttribute('formmethod')||form.method).toLowerCase();
 const enctype=(button.getAttribute('formenctype')||form.enctype).toLowerCase();
 if(action.protocol!=='https:'||action.origin!==location.origin||action.username||action.password||action.hash||method!=='post'||enctype!=='application/x-www-form-urlencoded')fail('FORM_ACTION_HELD');
 const entries=Array.from(new FormData(form,button).entries());const names=new Set();
 if(!entries.length||entries.length>100||entries.some(([name,v])=>typeof v!=='string'||!name||name.length>120||v.length>4000||names.has(name)||(names.add(name),false)))fail('FORM_ACTION_HELD');
 // HTML's entry-list to name/value conversion uses CRLF on the wire. Keep source/review strings unchanged.
 const wireText=value=>value.replace(/\r\n|\r|\n/g,'\r\n');
 const body=new URLSearchParams(entries.map(([name,v])=>[wireText(name),wireText(v)])).toString();if(body.length>100000)fail('FORM_ACTION_HELD');
 const controls=Array.from(form.elements);
 const secretNames=new Set(controls.filter(e=>sensitive(e)||e.type==='hidden').map(e=>e.name));
 const result={url:action.href,method:'POST',contentType:'application/x-www-form-urlencoded',body,credential:controls.some(e=>sensitive(e)&&visible(e)),sensitive:entries.some(([name])=>secretNames.has(name)),review:entries.map(([name,v])=>({name,value:secretNames.has(name)?null:v})),signature:page.signature,index:command.index};
 if(command.op==='submit'){
  if(typeof command.body!=='string'||command.body!==body)fail('FORM_TARGET_CHANGED');
  // Actual transport is independently held by main's one-use exact request gate.
  form.requestSubmit(button);return {requested:true};
 }
 return result;
}
module.exports=Object.freeze({pageOperation});
