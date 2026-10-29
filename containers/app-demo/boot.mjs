// Original owned-image supervisor. It receives no host credentials or arbitrary command.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const DEMO_SESSION_SECONDS=3600;
export function demoEnvironment(){return {PATH:'/usr/bin:/bin',DISPLAY:':99',HOME:'/home/demo',LANG:'C.UTF-8',XDG_RUNTIME_DIR:'/tmp/chausar-demo/runtime'};}
export function demoRuntimePlan(){return [
 ['/usr/bin/Xvfb',':99','-screen','0','1280x720x24','-nolisten','tcp','-ac'],
 ['/usr/bin/openbox','--sm-disable'],
 ['/usr/bin/python3','/opt/chausar/cursor.py'],
 ['/usr/bin/chromium','--user-data-dir=/home/demo/profile','--no-first-run','--disable-sync','--disable-extensions','--window-size=1280,720','about:blank'],
 ['/usr/bin/x11vnc','-display',':99','-rfbport','5900','-localhost','-forever','-shared','-nopw','-quiet'],
 ['/usr/bin/websockify','--web=/usr/share/novnc','--token-plugin=TokenFile','--token-source=/tmp/chausar-demo/viewer.tokens','0.0.0.0:6080'],
 ];}
export async function boot(){
 const root='/tmp/chausar-demo';mkdirSync(root,{recursive:true,mode:0o700});mkdirSync(root+'/runtime',{mode:0o700});
 const token=randomBytes(32).toString('hex');writeFileSync(root+'/viewer.tokens',token+': 127.0.0.1:5900\n',{mode:0o600});writeFileSync(root+'/viewer.json',JSON.stringify({token}),{mode:0o600});
 writeFileSync(root+'/cursor.json',JSON.stringify({x:12,y:12,label:'Chausar agent'}),{mode:0o600});
 const children=[];let stopping=false;const stop=()=>{if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(1),250).unref();};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 const expiry=setTimeout(stop,DEMO_SESSION_SECONDS*1000);expiry.unref();
 const plan=demoRuntimePlan();for(let i=0;i<plan.length;i++){
  if(stopping)throw new Error('Demo startup failed.');const [program,...args]=plan[i];const child=spawn(program,args,{env:demoEnvironment(),shell:false,stdio:'ignore'});children.push(child);child.once('error',stop);child.once('exit',stop);
  if(i===0){for(let n=0;n<100&&!existsSync('/tmp/.X11-unix/X99')&&!stopping;n++)await new Promise(r=>setTimeout(r,50));if(!existsSync('/tmp/.X11-unix/X99')||stopping){stop();throw new Error('The isolated display is unavailable.');}}
 }
 // A crash stops the entire owned desktop. There is no automatic command replay.
 return {stop};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){boot().catch(()=>{process.stderr.write('The private demo desktop could not start.\n');process.exitCode=1;});}
