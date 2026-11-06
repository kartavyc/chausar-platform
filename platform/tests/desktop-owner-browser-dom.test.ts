// Synthetic native form pages, no accounts or outside requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {JSDOM}=require('jsdom');
const {pageOperation}=require('../../app/desktop/owner-browser-dom.cjs');
function fixture(html:string){const dom=new JSDOM(html,{url:'https://records.example.com/entry',runScripts:'outside-only'});return {dom,run:(command:unknown)=>vm.runInContext(`(${pageOperation.toString()})(${JSON.stringify(command)})`,dom.getInternalVMContext())};}
const html='<h1>Client records</h1><form method="post" action="/save"><input name="customer" value="0007"><select name="tier"><option value="a">A</option><option value="b">B</option></select><input type="password" name="password" value="private-owner-secret"><input type="hidden" name="csrf" value="private-form-token"><button name="commit" value="yes">Save record</button></form>';
test('R2 native snapshot is complete and never exposes owner password or hidden token values',()=>{
 const f=fixture(html);try{const page=f.run({op:'inspect'});assert.equal(page.complete,true);assert.equal(page.fields.length,5);assert.equal(page.fields[0].value,'0007');assert.doesNotMatch(JSON.stringify(page),/private-owner-secret|private-form-token/);assert.equal(page.forms[0].method,'post');}finally{f.dom.window.close();}
});
test('R2 fixed fill requires exact current page and editable field identities, with no events or submit',()=>{
 const f=fixture(html);try{const before=f.run({op:'inspect'});let events=0;f.dom.window.document.addEventListener('input',()=>events++);const after=f.run({op:'fill',signature:before.signature,values:[{index:0,value:'0009'},{index:1,value:'b'}]});assert.equal(after.fields[0].value,'0009');assert.equal(after.fields[1].value,'b');assert.equal(events,0);assert.throws(()=>f.run({op:'fill',signature:before.signature,values:[{index:0,value:'changed'}]}),/FORM_TARGET_CHANGED/);assert.throws(()=>f.run({op:'fill',signature:after.signature,values:[{index:2,value:'secret'}]}),/FORM_ACTION_HELD/);assert.throws(()=>f.run({op:'fill',signature:after.signature,values:[{index:0,value:'x',selector:'input'}]}),/FORM_MAPPING_INVALID/);}finally{f.dom.window.close();}
});
test('R2 native prepared submit is exact, private and never sends during preparation',()=>{
 const f=fixture(html);try{const page=f.run({op:'inspect'});const request=f.run({op:'prepare',signature:page.signature,index:4});assert.equal(request.url,'https://records.example.com/save');assert.equal(request.method,'POST');assert.equal(request.body,'customer=0007&tier=a&password=private-owner-secret&csrf=private-form-token&commit=yes');assert.equal(request.sensitive,true);assert.doesNotMatch(JSON.stringify(request.review),/private-owner-secret|private-form-token/);f.dom.window.document.querySelector('input').value='0010';assert.throws(()=>f.run({op:'submit',signature:page.signature,index:4,body:request.body}),/FORM_TARGET_CHANGED/);}finally{f.dom.window.close();}
});
test('R2 unsupported forms and ambiguous controls are held with no guessed submission',()=>{
 for(const form of ['<form method="get"><input><button>Save</button></form>','<form method="post" action="https://else.example.com/save"><button>Save</button></form>','<form method="post" enctype="multipart/form-data"><button>Save</button></form>','<div role="button">Save</div>']){const f=fixture(form);try{const page=f.run({op:'inspect'});assert.throws(()=>f.run({op:'prepare',signature:page.signature,index:page.fields.length-1}),/FORM_ACTION_HELD/);}finally{f.dom.window.close();}}
 const f=fixture('<form method="post"><input name="account" value="one"><input name="account" value="two"><button>Save</button></form>');try{const p=f.run({op:'inspect'});assert.throws(()=>f.run({op:'prepare',signature:p.signature,index:2}),/FORM_ACTION_HELD/);}finally{f.dom.window.close();}
});
test('R2 hidden, disabled-fieldset and credential-autocomplete fields cannot be filled',()=>{
 for(const control of ['<div style="display:none"><input name="customer"></div>','<fieldset disabled><input name="customer"></fieldset>','<input name="code" autocomplete="one-time-code">','<input name="number" autocomplete="cc-number">']){const f=fixture('<form method="post">'+control+'<button>Save</button></form>');try{const page=f.run({op:'inspect'});assert.throws(()=>f.run({op:'fill',signature:page.signature,values:[{index:0,value:'0010'}]}),/FORM_ACTION_HELD/);}finally{f.dom.window.close();}}
});
test('R2 browser value normalization cannot silently change a mapped source string',()=>{
 const f=fixture('<form method="post"><input name="customer" value="before"><input name="day" type="date" value="2026-10-29"><button>Save</button></form>');try{const page=f.run({op:'inspect'});assert.throws(()=>f.run({op:'fill',signature:page.signature,values:[{index:0,value:'after'},{index:1,value:'not a date'}]}),/FORM_MAPPING_INVALID/);assert.equal(f.dom.window.document.querySelector('input').value,'before');}finally{f.dom.window.close();}
});
test('R2 saved readback uses server default fields and static text, never local edits or editable claimed IDs',()=>{
 const f=fixture('<h1>Saved record</h1><p aria-label="Record ID">REC-19</p><div contenteditable="true"><span>FAKE-LOCAL-ID</span></div><form><input name="customer" value="0008"><textarea name="note">saved server note</textarea><select name="tier"><option value="a" selected>A</option><option value="b">B</option></select><input name="active" type="checkbox" checked><input type="password" name="password" value="private-secret"></form>');
 try{const doc=f.dom.window.document;doc.querySelector('input').value='0007';doc.querySelector('textarea').value='owner changed';doc.querySelector('select').value='b';doc.querySelector('input[type=checkbox]').checked=false;const saved=f.run({op:'read-saved'});assert.equal(saved.complete,true);assert.equal(saved.readings.find((r:any)=>r.name==='customer').value,'0008');assert.equal(saved.readings.find((r:any)=>r.name==='note').value,'saved server note');assert.equal(saved.readings.find((r:any)=>r.name==='tier').value,'a');assert.equal(saved.readings.find((r:any)=>r.name==='active').value,'true');assert.equal(saved.readings.find((r:any)=>r.name==='Record ID').value,'REC-19');assert.doesNotMatch(JSON.stringify(saved),/FAKE-LOCAL-ID|private-secret|owner changed/);}finally{f.dom.window.close();}
});
test('R2 prepared native form bytes use browser CRLF encoding without changing the approved source review',()=>{
 const f=fixture('<form method="post"><textarea name="note">line1\nline2</textarea><button>Save</button></form>');try{const page=f.run({op:'inspect'});const prepared=f.run({op:'prepare',signature:page.signature,index:1});assert.equal(prepared.body,'note=line1%0D%0Aline2');assert.equal(prepared.review[0].value,'line1\nline2');}finally{f.dom.window.close();}
});

test('R2 snapshot binds actual submitted names and marks credential-autocomplete fields private',()=>{
 const f=fixture('<form method="post"><label for="customer">Customer full name</label><input id="customer" name="cust_name"><input name="code" autocomplete="one-time-code" value="private-code"><fieldset disabled><input name="held"></fieldset><button>Save</button></form>');try{const page=f.run({op:'inspect'});assert.equal(page.fields[0].name,'cust_name');assert.equal(page.fields[1].redacted,true);assert.equal(page.fields[2].disabled,true);assert.doesNotMatch(JSON.stringify(page),/private-code/);}finally{f.dom.window.close();}
});

test('R2 secret textarea defaults cannot leak through snapshot text pages',()=>{
 const f=fixture('<form method="post"><textarea name="password">private-owner-secret</textarea><button>Sign in</button></form>');try{const page=f.run({op:'inspect'});assert.doesNotMatch(JSON.stringify(page),/private-owner-secret/);}finally{f.dom.window.close();}
});
