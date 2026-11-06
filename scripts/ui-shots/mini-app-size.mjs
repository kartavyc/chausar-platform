// Real Chrome regression for the mini app's content-to-frame height protocol.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Browser, findChrome } from './browser.mjs';
import { runRoot } from '../../platform/runtime/run-root.mjs';
import { appDocument } from '../../platform/runtime/venture/apps/frame.ts';

const out = runRoot('mini-app-size');
mkdirSync(out, { recursive: true });
const profiles = mkdtempSync(join(out, 'profiles-'));
const browser = new Browser({ chrome: findChrome(), port: 9497, profiles });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
try {
  await browser.start();
  await browser.viewport(800, 700);
  console.log('minimum units', await browser.evaluate(`(() => {const probe=document.createElement('div');probe.style.minHeight='100vh';document.body.append(probe);const result={typed:probe.computedStyleMap().get('min-height').toString(),computed:getComputedStyle(probe).minHeight};probe.remove();return result;})()`));
  for (const [name, bodyCss, html] of [
    ['fixed minimum', 'margin:0;padding:12px', '<div id="content" style="min-height:480px;height:300px;border:3px solid;box-sizing:border-box">Short</div>'],
    ['bordered empty', 'margin:0;padding:12px', '<div id="content" style="min-height:480px;height:300px;border:3px solid;box-sizing:border-box"></div>'],
    ['child overflow', 'margin:0;padding:12px', '<div style="height:20px"><div id="content" style="height:300px">Content</div></div>'],
    ['margins', 'margin:12px;padding:14px', '<div id="content" style="height:300px">Content</div>'],
    ['overflow', 'margin:12px;padding:14px', '<div style="height:40px">Top</div><div id="content" style="position:absolute;top:100px;height:300px">Content</div>'],
    ['child viewport minimum', 'margin:0;padding:12px', '<div style="min-height:100vh"><div id="content" style="height:300px">Content</div></div>'],
    ['viewport minimum', 'margin:0;padding:12px;min-height:100vh', '<div id="content" style="height:300px">Content</div>'],
  ]) {
    const document = appDocument(`<style>body{${bodyCss}}</style>${html}`, 'Size test');
    await browser.evaluate(`(() => {
      window.sizes = [];
      document.body.replaceChildren();
      const frame = document.createElement('iframe'); frame.id = 'app'; frame.height = '600'; frame.width = '500'; frame.style.border = '0';
      window.onmessage = event => {
        if (event.source !== frame.contentWindow) return;
        const message = event.data;
        if (message.method === 'ui/initialize') frame.contentWindow.postMessage({jsonrpc:'2.0',id:message.id,result:{hostContext:{theme:'light'}}}, '*');
        if (message.method === 'ui/notifications/size-changed') { const height = Math.max(1, Math.min(1600, message.params.height)); window.sizes.push(height); frame.height = String(height); }
      };
      frame.srcdoc = ${JSON.stringify(document)}; document.body.append(frame);
    })()`);
    await pause(600);
    const read = () => browser.evaluate(`(() => {const frame=document.querySelector('#app'), doc=frame.contentDocument, content=doc.querySelector('#content');return {height:frame.height,bottom:content.getBoundingClientRect().bottom + parseFloat(getComputedStyle(doc.body).marginBottom) + parseFloat(getComputedStyle(doc.body).paddingBottom), minimum:content.computedStyleMap?.().get('min-height')?.toString(), bodyMinimum:doc.body.computedStyleMap?.().get('min-height')?.toString(), sizes:[...window.sizes]};})()`);
    const initial = await read();
    await browser.evaluate(`(() => { const content=document.querySelector('#app').contentDocument.querySelector('#content'); content.style.height='60px'; if(content.style.minHeight) content.style.minHeight='80px'; })()`);
    await pause(600);
    const small = await read();
    await browser.evaluate(`(() => { const content=document.querySelector('#app').contentDocument.querySelector('#content'); content.style.height='400px'; if(content.style.minHeight) content.style.minHeight='480px'; })()`);
    await pause(600);
    const large = await read();
    const result = { name, initial, small, large }; results.push(result);
    assert.ok(Number(initial.height) >= initial.bottom, `${name}: initial content clipped`);
    assert.ok(Number(small.height) >= small.bottom, `${name}: small content clipped`);
    assert.ok(Number(large.height) >= large.bottom, `${name}: large content clipped`);
    assert.ok(Number(small.height) < Number(initial.height), `${name}: did not shrink`);
    assert.ok(Number(large.height) > Number(small.height), `${name}: did not grow`);
    assert.ok(large.sizes.length < 12, `${name}: resize feedback loop`);
  }
} finally {
  console.log(JSON.stringify(results));
  await browser.stop();
  rmSync(profiles, { recursive: true, force: true });
}
