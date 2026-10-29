// Local synthetic qualification. Fixture-only certificate trust and dial injection never enter production.
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {formsTestCertificate} from './fixtures/forms-certificate.mjs';
import {createServer} from 'node:https';
import {connect} from 'node:net';
import {once} from 'node:events';
import {createFormsTunnel} from '../platform/runtime/venture/build/form-fill-network.ts';
const directory=await mkdtemp(join(tmpdir(),'chausar-r2-browser-'));let server,tunnel,child;
if(dirname(directory)!==resolve(tmpdir()))throw new Error('Fixture scratch directory is outside the intended temp folder.');
const posts=[];
try{
 const {key,cert}=formsTestCertificate();
 server=createServer({key,cert},async(req,res)=>{
  if(req.method==='POST'){let body='';for await(const part of req)body+=part;posts.push({url:req.url,body});res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><h1>Saved</h1><p aria-label="Record ID">REC-19</p><form><input name="customer" value="0008"><textarea name="note">client record</textarea></form>');return;}
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><h1>Client entry</h1><form action="/save" method="post"><label>Customer<input name="customer" value="0000"></label><label>Note<textarea name="note"></textarea></label><input type="hidden" name="csrf" value="fixture-token"><button name="commit" value="save">Save record</button></form><script>document.querySelector("input").value="PAGE SCRIPT RAN";</script>');
 });server.listen(0,'127.0.0.1');await once(server,'listening');const localPort=server.address().port;
 tunnel=await createFormsTunnel({origin:'https://records.example.com',current:()=>true,resolve:async()=>[{address:'8.8.8.8',family:4}],connect:()=>connect({host:'127.0.0.1',port:localPort})});
 const config=join(directory,'fixture.json'),output=join(directory,'result.json');await mkdir(join(directory,'electron-profile'));await writeFile(config,JSON.stringify({profile:join(directory,'electron-profile'),cert,proxy:{port:tunnel.port,proxyUrl:tunnel.proxyUrl,username:tunnel.username,password:tunnel.password,realm:tunnel.realm},output}));
 const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
 child=spawn(createRequire(import.meta.url)('electron'),[resolve('scripts/fixtures/forms-browser.cjs'),config],{windowsHide:true,stdio:'ignore',env:environment});
 const timeout=setTimeout(()=>child.kill(),40000);const [code]=await once(child,'exit');clearTimeout(timeout);const result=JSON.parse(await readFile(output,'utf8'));result.posts=posts;result.exit=code;process.stdout.write(JSON.stringify({pass:result.pass,...(result.error?{error:result.error}:{}),exit:code,posts:posts.length,physicalVerifications:result.events?.filter(event=>event.physicalVerification).length,mismatchedSavedValue:result.readback?.targets.some(target=>target.name==='customer'&&target.value==='0008')})+'\n');if(code!==0||!result.pass||posts.length!==1)process.exitCode=1;
}finally{child?.kill();await tunnel?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
